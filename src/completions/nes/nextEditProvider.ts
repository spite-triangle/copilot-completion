import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { INesConfigProvider } from '../../config/nesConfig';
import { ILogService } from '../shared/log/logService';
import { NesProvider } from './nesProvider';
import { NextEditResult } from './types';
import { SpeculativeRequestManager } from './speculativeRequest';
import { createServiceIdentifier } from '../../di/services';

export const INesProvider = createServiceIdentifier<INesProvider>('INesProvider');

export interface INesProvider {
    readonly _serviceBrand: undefined;
    register(): vscode.Disposable;
}

export class NextEditProvider implements INesProvider, vscode.InlineCompletionItemProvider {
    readonly _serviceBrand: undefined;
    private _disposable: vscode.Disposable | undefined;
    private _speculativeManager: SpeculativeRequestManager;

    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @INesConfigProvider private readonly _config: INesConfigProvider,
        @ILogService private readonly _log: ILogService,
    ) {
        this._speculativeManager = this._instantiationService.createInstance(SpeculativeRequestManager);
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

        const provider = this._instantiationService.createInstance(NesProvider);
        const result = await provider.provideNextEdit(document, position, token);

        if (!result || !result.edit.trim()) {
            this._log.debug(`[NES]  NO_RESULT`);
            return undefined;
        }

        const item = new vscode.InlineCompletionItem(
            result.edit,
            result.range,
        );
        return [item];
    }
}
