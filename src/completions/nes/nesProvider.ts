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
        const t0 = Date.now();
        const loc = `${document.uri.fsPath}:${position.line + 1}:${position.character + 1}`;
        this._log.info(`[NES]  ===== START ${loc} =====`);

        // Step 1: Config check
        if (!this._config.enabled) {
            this._log.info(`[NES]  SKIP ${loc} — disabled by config`);
            return undefined;
        }

        // Step 2: Cache lookup
        const t1 = Date.now();
        const docText = document.getText();
        const cached = this._cache.lookupNextEdit(document.uri.toString(), document);
        if (cached) {
            this._log.info(`[NES]  CACHE_HIT ${loc} edit=${cached.edit.length}ch age=${Date.now() - cached.cacheTime}ms total=${Date.now() - t0}ms`);
            this._log.debug(`[NES]  ${loc} cached_edit="${this._trunc(cached.edit, 100)}"`);
            return this._buildResult(cached.edit, document, position);
        }
        this._log.debug(`[NES]  ${loc} cache_miss [${Date.now() - t1}ms]`);

        // Step 3: Build prompt pieces
        const t2 = Date.now();
        const promptPieces = this._buildPromptPieces(document, position);
        this._log.debug(`[NES]  ${loc} edit_window L${promptPieces.editWindowRange.startLine + 1}-L${promptPieces.editWindowRange.endLineExclusive} area_around L${promptPieces.areaAroundRange.startLine + 1}-L${promptPieces.areaAroundRange.endLineExclusive} lang=${promptPieces.languageContext} [${Date.now() - t2}ms]`);

        // Step 4: Build user prompt
        const t3 = Date.now();
        const userPrompt = this._buildUserPrompt(promptPieces);
        const systemPrompt = pickSystemPrompt(PromptingStrategy.Xtab275);
        this._log.debug(`[NES]  ${loc} system_prompt=${systemPrompt.length}ch user_prompt=${userPrompt.length}ch [${Date.now() - t3}ms]`);

        // Step 5: Network request
        const t4 = Date.now();
        const endpoint = this._config.supportedEndpoint;
        const adapter = this._llmManager.getAdapter(endpoint);
        this._log.debug(`[NES]  ${loc} endpoint=${endpoint} model=${this._config.model} max_tokens=${this._config.maxOutputTokens}`);

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
            const networkMs = Date.now() - t4;
            this._log.info(`[NES]  ${loc} NETWORK finish=${response.finishReason} text=${response.text.length}ch usage=${JSON.stringify(response.usage)} [${networkMs}ms]`);
            this._log.debug(`[NES]  ${loc} raw_response="${this._trunc(response.text, 200)}"`);

            // Step 6: Parse response
            const parsed = handleEditWindowOnly(response.text);
            const editText = parsed.lines.join('\n');
            this._log.debug(`[NES]  ${loc} parsed lines=${parsed.lines.length} edit=${editText.length}ch`);

            if (!editText.trim()) {
                this._log.info(`[NES]  ${loc} EMPTY_EDIT — model returned no content total=${Date.now() - t0}ms`);
                return undefined;
            }

            // Step 7: Suffix overlap trimming (line-level)
            const trimmer = new TrimNESResponseSuffixOverlap(
                this._config.suffixOverlapThreshold,
                this._config.suffixOverlapType,
            );
            const suffixText = document.getText(
                new vscode.Range(position, document.lineAt(document.lineCount - 1).range.end)
            );
            const suffixLines = suffixText.split('\n');
            const overlapCount = trimmer.calculateOverlap(parsed.lines, suffixLines);
            const finalLines = overlapCount > 0
                ? parsed.lines.slice(0, parsed.lines.length - overlapCount)
                : parsed.lines;
            if (overlapCount > 0) {
                this._log.info(`[NES]  ${loc} suffix_trim overlap=${overlapCount} lines threshold=${this._config.suffixOverlapThreshold} type=${this._config.suffixOverlapType}`);
            }
            const finalEdit = finalLines.join('\n');

            // Step 8: Cache result
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

            const totalMs = Date.now() - t0;
            this._log.info(`[NES]  ${loc} RESULT edit=${finalEdit.length}ch preview="${this._trunc(finalEdit, 100)}" total=${totalMs}ms`);

            return this._buildResult(finalEdit, document, position);
        } catch (err) {
            this._log.error(`[NES]  ${loc} ERROR after ${Date.now() - t0}ms: ${err}`);
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

        prompt += '<edit_window>\n';
        prompt += '###remain edit start boundary line###\n';
        prompt += editWindowLines.join('\n');
        prompt += '\n###remain edit end boundary line###\n';
        prompt += '</edit_window>\n\n';

        prompt += '<area_around>\n';
        prompt += areaAroundLines.join('\n');
        prompt += '\n</area_around>\n\n';

        if (pieces.languageContext) {
            prompt += `Language: ${pieces.languageContext}\n`;
        }

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

    private _trunc(s: string, max: number): string {
        const escaped = s.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        return escaped.length <= max ? escaped : escaped.substring(0, max) + '…';
    }
}
