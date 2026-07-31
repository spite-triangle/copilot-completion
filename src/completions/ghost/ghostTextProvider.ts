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

/**
 * When the cursor sits on a whitespace-only line (e.g. "    <|cursor|>"),
 * a completion like "    }" would be inserted as-is, producing "        }".
 * This trims the whitespace overlap so the result keeps correct indentation.
 *
 * Conditions:
 *  (1) The current line prefix (cursor column up to cursor) is all whitespace.
 *  (2) After trimming the overlap, the result starts with a non-whitespace char
 *      — meaning the completion's indent equals the current indent, i.e. it is
 *        dedenting (e.g. "}" / "pass" / "else:") rather than nesting deeper.
 */
function trimIndentOverlap(completionText: string, currentLinePrefix: string): string {
    if (!completionText) return completionText;
    // Condition 1: prefix must be all-whitespace
    if (currentLinePrefix.length === 0 || !/^\s*$/.test(currentLinePrefix)) {
        return completionText;
    }

    let overlap = 0;
    while (overlap < currentLinePrefix.length && overlap < completionText.length) {
        if (completionText[overlap] !== currentLinePrefix[overlap]) break;
        overlap++;
    }

    if (overlap === 0) return completionText;

    const trimmed = completionText.substring(overlap);

    // Condition 2: after trimming, must start with non-whitespace
    if (trimmed.length === 0 || /^\s/.test(trimmed)) return completionText;

    return trimmed;
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

        const currentLine = document.lineAt(position.line);
        const currentLinePrefix = currentLine.text.substring(0, position.character);

        const items = result.completions.map(c => {
            const text = trimIndentOverlap(c.completionText, currentLinePrefix);
            const range = c.isMiddleOfTheLine
                ? new vscode.Range(position, document.lineAt(position.line).range.end)
                : new vscode.Range(position, position);
            return new vscode.InlineCompletionItem(text, range);
        });

        return items;
    }
}
