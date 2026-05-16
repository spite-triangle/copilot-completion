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
        token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
        if (!this._config.enabled) {
            this._log.debug(`[GHOST] DISABLED`);
            return undefined;
        }

        const ghostText = this._instantiationService.createInstance(GhostText);
        const result = await ghostText.getInlineCompletions(document, position, token);

        if (!result || result.completions.length === 0) {
            this._log.debug(`[GHOST] NO_RESULT`);
            return undefined;
        }

        const items = result.completions.map(c => {
            const range = c.isMiddleOfTheLine
                ? new vscode.Range(position, document.lineAt(position.line).range.end)
                : new vscode.Range(position, position);
            return new vscode.InlineCompletionItem(c.completionText, range);
        });

        return items;
    }
}
