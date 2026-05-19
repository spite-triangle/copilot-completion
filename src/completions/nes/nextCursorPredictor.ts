import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { ILLMAdapterManager } from '../shared/llm/llmAdapter';
import { INesConfigProvider } from '../../config/nesConfig';
import { ILogService } from '../shared/log/logService';
import { PromptingStrategy, IncludeLineNumbersOption } from './stubs/types';
import { constructTaggedFile, getUserPrompt, PromptPieces } from './promptCrafting';
import { CursorJumpPrediction } from './types';
import { OffsetRange } from './stubs/offsetRange';
import { Result } from './stubs/result';

const SYSTEM_MSG = 'Your task is to predict the line number where the developer is most likely to make their next edit. If you jump in the current file, just output the line number. If you want to jump to another file, output the filepath (relative to workspace root), colon, then line number. Output no explanation.';

export class NextCursorPredictor {
    private _isDisabled = false;

    constructor(
        @IInstantiationService private readonly _instaService: IInstantiationService,
        @INesConfigProvider private readonly _config: INesConfigProvider,
        @ILLMAdapterManager private readonly _llmManager: ILLMAdapterManager,
        @ILogService private readonly _log: ILogService,
    ) {}

    isEnabled(): boolean {
        if (this._isDisabled) {
            return false;
        }
        return this._config.nextCursorPredictionEnabled;
    }

    async predict(
        promptPieces: PromptPieces,
        token?: vscode.CancellationToken,
    ): Promise<Result<CursorJumpPrediction, string>> {
        const computeTokens = (s: string) => Math.floor(s.length / 4);

        const taggedR = constructTaggedFile(
            promptPieces.currentDocument,
            promptPieces.editWindowLinesRange,
            promptPieces.areaAroundEditWindowLinesRange,
            {
                ...promptPieces.opts,
                currentFile: {
                    ...promptPieces.opts.currentFile,
                    maxTokens: 4000,
                    includeTags: false,
                },
                includePostScript: false,
            },
            computeTokens,
            {
                includeLineNumbers: {
                    areaAroundCodeToEdit: IncludeLineNumbersOption.None,
                    currentFileContent: IncludeLineNumbersOption.WithSpaceAfter,
                },
            },
        );

        if (taggedR.isError()) {
            this._log.debug(`[NCP] prompt too large`);
            return Result.error('promptTooLarge');
        }

        const { clippedTaggedCurrentDoc, areaAroundCodeToEdit } = taggedR.val;

        const newPromptPieces = new PromptPieces(
            promptPieces.currentDocument,
            promptPieces.editWindowLinesRange,
            promptPieces.areaAroundEditWindowLinesRange,
            promptPieces.activeDoc,
            promptPieces.xtabHistory,
            clippedTaggedCurrentDoc.lines,
            areaAroundCodeToEdit,
            promptPieces.langCtx,
            promptPieces.aggressivenessLevel,
            promptPieces.lintErrors,
            computeTokens,
            {
                ...promptPieces.opts,
                includePostScript: false,
            },
        );

        const { prompt: userMessage } = getUserPrompt(newPromptPieces);

        try {
            const endpoint = this._config.supportedEndpoint;
            const adapter = this._llmManager.getAdapter(endpoint);
            const abortController = new AbortController();
            const cancelListener = token?.onCancellationRequested(() => abortController.abort());

            const response = await adapter.send(
                {
                    messages: [
                        { role: 'system', content: SYSTEM_MSG },
                        { role: 'user', content: userMessage },
                    ],
                    max_tokens: 64,
                    temperature: 0,
                },
                abortController.signal,
            );

            cancelListener?.dispose();

            if (response.text.trim() === '') {
                return Result.error('emptyResponse');
            }

            return this._parseResponse(response.text.trim(), clippedTaggedCurrentDoc.keptRange);
        } catch (err: unknown) {
            if ((err as { name?: string })?.name === 'AbortError') {
                return Result.error('aborted');
            }
            this._log.error(`[NCP] ERROR: ${err}`);

            // Disable for session on 404/not-found
            const msg = String(err);
            if (msg.includes('404') || msg.includes('not found') || msg.includes('NotFound')) {
                this._isDisabled = true;
                this._log.info(`[NCP] disabled for session due to endpoint error`);
            }
            return Result.error(`fetchError:${msg}`);
        }
    }

    private _parseResponse(trimmed: string, keptRange: OffsetRange): Result<CursorJumpPrediction, string> {
        const lineNumber = parseInt(trimmed, 10);
        if (!isNaN(lineNumber) && String(lineNumber) === trimmed) {
            if (lineNumber < 0) {
                return Result.error('negativeLineNumber');
            }
            if (lineNumber < keptRange.start || keptRange.endExclusive <= lineNumber) {
                return Result.error('modelNotSeenLineNumber');
            }
            return Result.ok({ kind: 'sameFile', lineNumber });
        }

        const lastColonIdx = trimmed.lastIndexOf(':');
        if (lastColonIdx <= 0) {
            return Result.error('gotNaN');
        }

        const filePath = trimmed.substring(0, lastColonIdx).trim();
        const crossLine = parseInt(trimmed.substring(lastColonIdx + 1), 10);

        if (isNaN(crossLine) || crossLine < 0 || filePath.length === 0) {
            return Result.error('crossFileInvalidLineNumber');
        }

        return Result.ok({ kind: 'differentFile', filePath, lineNumber: crossLine });
    }
}
