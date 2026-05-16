import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { IGhostConfigProvider } from '../../config/ghostConfig';
import { ILogService } from '../shared/log/logService';
import { GhostText } from './inlineCompletion';
import { createServiceIdentifier } from '../../di/services';

export const IGhostTextProvider = createServiceIdentifier<IGhostTextProvider>('IGhostTextProvider');

export interface IGhostTextProvider {
    readonly _serviceBrand: undefined;
    register(): vscode.Disposable;
}

export class GhostTextProvider implements IGhostTextProvider, vscode.InlineCompletionItemProvider {
    readonly _serviceBrand: undefined;
    private _disposable: vscode.Disposable | undefined;

    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @IGhostConfigProvider private readonly _config: IGhostConfigProvider,
        @ILogService private readonly _log: ILogService,
    ) {}

    register(): vscode.Disposable {
        this._disposable = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            this,
        );

        const configDisposable = this._config.onDidChangeEnabled(() => {
            this._log.info(`GHOST enabled changed to: ${this._config.enabled}`);
            if (this._disposable) {
                this._disposable.dispose();
            }
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
        _token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
        if (!this._config.enabled) return undefined;

        const ghostText = this._instantiationService.createInstance(GhostText);
        const result = await ghostText.getInlineCompletions(document, position);

        if (!result || result.completions.length === 0) return undefined;

        const items = result.completions.map(c => {
            return new vscode.InlineCompletionItem(
                c.completionText,
                new vscode.Range(position, position),
            );
        });

        return items;
    }
}
