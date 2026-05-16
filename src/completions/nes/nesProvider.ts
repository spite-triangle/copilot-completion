import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { INesConfigProvider } from '../../config/nesConfig';
import { ILLMAdapterManager } from '../shared/llm/llmAdapter';
import { ILogService } from '../shared/log/logService';
import { PromptingStrategy, NextEditResult, PromptPieces, LineRange0Based } from './types';
import { pickSystemPrompt } from './systemMessages';
import { handleEditWindowOnly } from './responseFormatHandlers';
import { TrimNESResponseSuffixOverlap } from './suffixOverlapTrim';
import { INextEditCache } from './nextEditCache';

export class NesProvider {
    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @INesConfigProvider private readonly _config: INesConfigProvider,
        @ILLMAdapterManager private readonly _llmManager: ILLMAdapterManager,
        @ILogService private readonly _log: ILogService,
        @INextEditCache private readonly _cache: INextEditCache,
    ) {}

    async provideNextEdit(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<NextEditResult | undefined> {
        if (!this._config.enabled) {
            this._log.debug('NES is disabled, skipping');
            return undefined;
        }

        // Check cache
        const docText = document.getText();
        const cached = this._cache.lookupNextEdit(document.uri.toString(), document);
        if (cached) {
            this._log.debug('NES: cache hit');
            return this._buildResult(cached.edit, document, position);
        }

        // Build prompt
        const promptPieces = this._buildPromptPieces(document, position);
        const userPrompt = this._buildUserPrompt(promptPieces);
        const systemPrompt = pickSystemPrompt(PromptingStrategy.Xtab275);

        // Send request
        const endpoint = this._config.supportedEndpoint;
        const adapter = this._llmManager.getAdapter(endpoint);

        try {
            const response = await adapter.send({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                max_tokens: this._config.maxOutputTokens,
                temperature: 0,
                capabilities: {
                    thinking: this._config.capabilities.supports.thinking,
                },
            });

            // Parse response
            const parsed = handleEditWindowOnly(response.text);
            const editText = parsed.lines.join('\n');

            if (!editText.trim()) {
                this._log.debug('NES: empty edit from model');
                return undefined;
            }

            // Apply suffix overlap trimming
            const trimmer = new TrimNESResponseSuffixOverlap(
                this._config.suffixOverlapThreshold,
                this._config.suffixOverlapType,
            );
            const suffixLines = document.getText(
                new vscode.Range(position, document.lineAt(document.lineCount - 1).range.end)
            ).split('\n');
            const overlapCount = trimmer.calculateOverlap(parsed.lines, suffixLines);
            const finalLines = overlapCount > 0
                ? parsed.lines.slice(0, parsed.lines.length - overlapCount)
                : parsed.lines;
            const finalEdit = finalLines.join('\n');

            // Cache result
            this._cache.setKthNextEdit(document.uri.toString(), {
                docId: document.uri.toString(),
                docContentHash: this._hash(docText),
                editWindow: {
                    startLine: Math.max(0, position.line - 2),
                    endLineExclusive: position.line + 5,
                },
                edit: finalEdit,
                cacheTime: Date.now(),
            });

            return this._buildResult(finalEdit, document, position);
        } catch (err) {
            this._log.error(`NES request failed: ${err}`);
            return undefined;
        }
    }

    private _buildPromptPieces(document: vscode.TextDocument, position: vscode.Position): PromptPieces {
        const nLinesAbove = 2;
        const nLinesBelow = 5;
        const nContextLines = 15;

        const editWindowStart = Math.max(0, position.line - nLinesAbove);
        const editWindowEnd = Math.min(document.lineCount, position.line + nLinesBelow + 1);
        const contextStart = Math.max(0, position.line - nContextLines);

        return {
            currentDocument: {
                text: document.getText(),
                cursorLine: position.line,
                cursorColumn: position.character,
            },
            editWindowRange: {
                startLine: editWindowStart,
                endLineExclusive: editWindowEnd,
            },
            areaAroundRange: {
                startLine: contextStart,
                endLineExclusive: editWindowEnd,
            },
            languageContext: document.languageId,
            lintErrors: [],
            editHistory: [],
            neighborSnippets: [],
        };
    }

    private _buildUserPrompt(pieces: PromptPieces): string {
        // Build prompt in the same format as the original Xtab275 promptCrafting
        const doc = pieces.currentDocument;
        const docLines = doc.text.split('\n');

        const editWindowLines = docLines.slice(
            pieces.editWindowRange.startLine,
            pieces.editWindowRange.endLineExclusive,
        );

        const areaAroundLines = docLines.slice(
            pieces.areaAroundRange.startLine,
            pieces.editWindowRange.endLineExclusive,
        );

        let prompt = '';

        // Edit window
        prompt += '<edit_window>\n';
        prompt += '###remain edit start boundary line###\n';
        prompt += editWindowLines.join('\n');
        prompt += '\n###remain edit end boundary line###\n';
        prompt += '</edit_window>\n\n';

        // Area around
        prompt += '<area_around>\n';
        prompt += areaAroundLines.join('\n');
        prompt += '\n</area_around>\n\n';

        // Language context
        if (pieces.languageContext) {
            prompt += `Language: ${pieces.languageContext}\n`;
        }

        // Cursor location
        prompt += `Cursor is at line ${doc.cursorLine}, column ${doc.cursorColumn}\n`;

        return prompt;
    }

    private _buildResult(edit: string, document: vscode.TextDocument, position: vscode.Position): NextEditResult {
        const editStartLine = Math.max(0, position.line - 2);
        const nextLine = Math.min(position.line + 1, document.lineCount - 1);
        return {
            edit,
            range: new vscode.Range(
                new vscode.Position(editStartLine, 0),
                new vscode.Position(Math.min(position.line + 5, document.lineCount - 1), 0),
            ),
            cursorAfterEdit: new vscode.Position(nextLine, 0),
        };
    }

    private _hash(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }
}
