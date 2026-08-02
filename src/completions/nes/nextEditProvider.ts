import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { INesConfigProvider } from '../../config/nesConfig';
import { ILogService } from '../shared/log/logService';
import { NesCompletionItem, NesCompletionList, NesCompletionInfo, NextEditResult } from './types';
import { createServiceIdentifier } from '../../di/services';
import { NesWorkflow } from './core/nesWorkflow';
import { NextCursorPredictor } from './nextCursorPredictor';
import { InlineSuggestionResolver } from './core/inlineSuggestionResolver';

export const INesProvider = createServiceIdentifier<INesProvider>('INesProvider');

export interface INesProvider {
    readonly _serviceBrand: undefined;
    register(): vscode.Disposable;
}

let _requestSeq = 0;

export class NextEditProvider implements INesProvider, vscode.InlineCompletionItemProvider {
    readonly _serviceBrand: undefined;
    private _disposable: vscode.Disposable | undefined;
    private _workflow: NesWorkflow;
    private _cursorPredictor: NextCursorPredictor;
    private readonly _inlineSuggestionResolver = new InlineSuggestionResolver();

    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @INesConfigProvider private readonly _config: INesConfigProvider,
        @ILogService private readonly _log: ILogService,
    ) {
        this._workflow = this._instantiationService.createInstance(NesWorkflow);
        this._cursorPredictor = this._instantiationService.createInstance(NextCursorPredictor);
    }

    register(): vscode.Disposable {
        this._disposable = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            this,
        );

        const configDisposable = this._config.onDidChangeEnabled(() => {
            this._log.info(`NES enabled changed to: ${this._config.enabled}`);
            if (this._disposable) { this._disposable.dispose(); }
            if (this._config.enabled) {
                this._disposable = vscode.languages.registerInlineCompletionItemProvider(
                    { pattern: '**' },
                    this,
                );
            }
        });

        return {
            dispose: () => {
                this._disposable?.dispose();
                configDisposable.dispose();
            },
        };
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
        if (!this._config.enabled) {
            this._log.debug(`[NES]  DISABLED`);
            return undefined;
        }

        const requestUuid = `nes-${Date.now()}-${++_requestSeq}`;

        // Primary NES request
        const startWorkflowTime = Date.now();
        const { editResult, promptPieces } = await this._workflow.execute(document, position, false, token);
        this._log.info(`[NES]  primary workflow took ${Date.now() - startWorkflowTime}ms`);

        if (editResult && editResult.fullEditText !== '') {
            return this._toInlineItems(editResult, document, position, requestUuid);
        }

        // Retry via cursor prediction
        if (!promptPieces || !this._cursorPredictor.isEnabled()) {
            this._log.info(`[NES]  NO_RESULT — cursor prediction disabled or no prompt`);
            return undefined;
        }

        this._log.info(`[NES]  NO_RESULT — attempting cursor prediction retry`);

        // 重新计时，因为接口提供的 token 可能提前取消
        const predictCts = new vscode.CancellationTokenSource();
        const predictTimeout = setTimeout(() => predictCts.cancel(),5000);
        try {
            const startPredictTime = Date.now();
            let predictionR = await this._cursorPredictor.predict(promptPieces, predictCts.token);
            this._log.info(`[NES]  cursor prediction took ${Date.now() - startPredictTime}ms`);
    
            if (predictionR.isError()) {
                this._log.debug(`[NES]  cursor prediction error: ${predictionR.err}`);
                return undefined;
            }
            // sameFile: retry NES at predicted position
            this._log.debug(`[NES]  retry NES at predicted line ${predictionR.val}`);

            // Aligns with official: if predicted line falls within the original edit window,
            // the user already saw / is near this area — skip cursor prediction.
            if (promptPieces.editWindowLinesRange.contains(predictionR.val)) {
                this._log.debug(`[NES]  cursor prediction within edit window, skipping retry`);
                return undefined;
            }

            const predictedPos = new vscode.Position(
                Math.min(predictionR.val, document.lineCount - 1),
                0,
            );
    
            const startRetryWorkflow = Date.now();
            const { editResult: retryResult } = await this._workflow.execute(
                document, predictedPos, true, predictCts.token
            );
            this._log.info(`[NES]  retry  workflow took ${Date.now() - startRetryWorkflow}ms`);
    
            if (retryResult) {
                retryResult.cursorPrediction = {
                    kind: 'sameFile',
                    lineNumber: predictionR.val
                };
                return this._toInlineItems(retryResult, document, predictedPos, requestUuid);
            }
        } finally {
            clearTimeout(predictTimeout);
            predictCts.dispose();
        }
        
        this._log.debug(`[NES]  NO_RESULT — retry also failed`);
        return undefined;
    }

    private _toInlineItems(
        result: NextEditResult,
        document: vscode.TextDocument,
        cursorPosition: vscode.Position,
        requestUuid: string,
    ): NesCompletionList {
        const info = new NesCompletionInfo(
            result,
            document.uri.toString(),
            document,
            requestUuid,
        );

        // 1. Try to convert to inline (ghost text) suggestion
        const inline = this._inlineSuggestionResolver.resolve(
            cursorPosition,
            document,
            result.range,
            result.edit,
        );

        const isInlineCompletion = !!inline;

        // 2. Gate: suppress if was previously shown as inline but now can't be
        if (
            this._config.mimicGhostTextBehavior
            && result.cacheEntry?.wasRenderedAsInlineSuggestion
            && !isInlineCompletion
        ) {
            this._log.debug(`[NES]  suppressing cached suggestion — was inline, now not`);
            return new NesCompletionList(requestUuid, []);
        }

        // 3. Mark cache entry as rendered inline
        if (isInlineCompletion && result.cacheEntry) {
            result.cacheEntry.wasRenderedAsInlineSuggestion = true;
        }

        // 4. Use adjusted range/text if inline, otherwise precise diff range/text
        const range = inline?.range ?? result.range;
        const insertText = inline?.newText ?? result.edit;

        // 5. Build item
        const item: NesCompletionItem = {
            insertText,
            range,
            isInlineEdit: !isInlineCompletion,
            isInlineCompletion,
            showInlineEditMenu: !isInlineCompletion,
            showInlinedDiff: !isInlineCompletion,
            shouldBeInlineEdit: true,
            info,
        };

        if (result.displayLocation) {
            item.displayLocation = result.displayLocation;
        }
        this._log.info(`[NES]  INLINE_EDIT — showing inline suggestion`);
        return new NesCompletionList(requestUuid, [item]);
    }
}
