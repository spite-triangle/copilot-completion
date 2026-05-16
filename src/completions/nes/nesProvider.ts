import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { INesConfigProvider } from '../../config/nesConfig';
import { ILLMAdapterManager } from '../shared/llm/llmAdapter';
import { ILogService } from '../shared/log/logService';
import { srcLoc } from '../shared/log/srcLoc';
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
        token?: vscode.CancellationToken,
    ): Promise<NextEditResult | undefined> {
        const t0 = Date.now();
        const loc = `${document.uri.fsPath}:${position.line + 1}:${position.character + 1}`;
        this._log.info(`[NES]  ${srcLoc()} |   ===== START ${loc} =====`);

        if (token?.isCancellationRequested) {
            this._log.info(`[NES]  ${srcLoc()} |   CANCEL ${loc} before_start`);
            return undefined;
        }

        // Step 1: Config check
        if (!this._config.enabled) {
            this._log.info(`[NES]  ${srcLoc()} |   SKIP ${loc} — disabled by config`);
            return undefined;
        }

        // Step 2: Cache lookup
        const t1 = Date.now();
        const docText = document.getText();
        const cached = this._cache.lookupNextEdit(document.uri.toString(), document);
        if (cached) {
            this._log.info(`[NES]  ${srcLoc()} |   CACHE_HIT ${loc} edit=${cached.edit.length}ch age=${Date.now() - cached.cacheTime}ms total=${Date.now() - t0}ms`);
            this._log.debug(`[NES]  ${srcLoc()} |   ${loc} cached_edit="${this._trunc(cached.edit, 100)}"`);

            if (token?.isCancellationRequested) {
                this._log.info(`[NES]  ${srcLoc()} |   CANCEL ${loc} after_cache_hit`);
                return undefined;
            }
            return this._buildResult(cached.edit, document, position);
        }
        this._log.debug(`[NES]  ${srcLoc()} |   ${loc} cache_miss [${Date.now() - t1}ms]`);

        if (token?.isCancellationRequested) {
            this._log.info(`[NES]  ${srcLoc()} |   CANCEL ${loc} after_cache_miss`);
            return undefined;
        }

        // Step 3: Build prompt pieces
        const t2 = Date.now();
        const promptPieces = this._buildPromptPieces(document, position);
        this._log.debug(`[NES]  ${srcLoc()} |   ${loc} edit_window L${promptPieces.editWindowRange.startLine + 1}-L${promptPieces.editWindowRange.endLineExclusive} area_around L${promptPieces.areaAroundRange.startLine + 1}-L${promptPieces.areaAroundRange.endLineExclusive} lang=${promptPieces.languageContext} [${Date.now() - t2}ms]`);

        // Step 4: Build prompts
        const t3 = Date.now();
        const userPrompt = this._buildUserPrompt(promptPieces);
        const systemPrompt = pickSystemPrompt(PromptingStrategy.Xtab275);
        this._log.debug(`[NES]  ${srcLoc()} |   ${loc} system_prompt=${systemPrompt.length}ch user_prompt=${userPrompt.length}ch [${Date.now() - t3}ms]`);

        // Step 5: Network request with AbortController
        const t4 = Date.now();
        const endpoint = this._config.supportedEndpoint;
        const adapter = this._llmManager.getAdapter(endpoint);
        const abortController = new AbortController();
        const cancelListener = token?.onCancellationRequested(() => {
            this._log.info(`[NES]  ${srcLoc()} |   ABORT ${loc} — CancellationToken triggered`);
            abortController.abort();
        });

        this._log.debug(`[NES]  ${srcLoc()} |   ${loc} endpoint=${endpoint} model=${this._config.model} max_tokens=${this._config.maxOutputTokens}`);

        try {
            const response = await adapter.send(
                {
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    max_tokens: this._config.maxOutputTokens,
                    temperature: 0,
                    capabilities: {
                        thinking: this._config.capabilities.supports.thinking,
                    },
                },
                abortController.signal,
            );
            const networkMs = Date.now() - t4;
            this._log.info(`[NES]  ${srcLoc()} |   ${loc} NETWORK finish=${response.finishReason} text=${response.text.length}ch usage=${JSON.stringify(response.usage)} [${networkMs}ms]`);
            this._log.debug(`[NES]  ${srcLoc()} |   ${loc} raw_response="${this._trunc(response.text, 200)}"`);

            // Step 6: Parse response
            const parsed = handleEditWindowOnly(response.text);
            const editText = parsed.lines.join('\n');
            this._log.debug(`[NES]  ${srcLoc()} |   ${loc} parsed lines=${parsed.lines.length} edit=${editText.length}ch`);

            if (!editText.trim()) {
                this._log.info(`[NES]  ${srcLoc()} |   ${loc} EMPTY_EDIT — model returned no content total=${Date.now() - t0}ms`);
                return undefined;
            }

            // Step 7: Diff model output against edit window lines (to extract actual edits)
            const editWindowLines = this._getEditWindowLines(document, position);
            this._log.debug(`[NES]  ${srcLoc()} |   ${loc} edit_window_lines=${editWindowLines.length}`);

            // Step 8: Apply suffix overlap trimming (line-level)
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
            if (overlapCount > 0) {
                this._log.info(`[NES]  ${srcLoc()} |   ${loc} suffix_trim overlap=${overlapCount} lines threshold=${this._config.suffixOverlapThreshold} type=${this._config.suffixOverlapType}`);
            }
            const finalEdit = finalLines.join('\n');

            // Step 9: Filter edit (reject empty/noop/comment-only/whitespace-only edits)
            if (this._shouldRejectEdit(finalEdit, editWindowLines)) {
                this._log.info(`[NES]  ${srcLoc()} |   ${loc} FILTERED — edit rejected by filter total=${Date.now() - t0}ms`);
                return undefined;
            }

            // Step 10: Cache result
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
            this._log.info(`[NES]  ${srcLoc()} |   ${loc} RESULT edit=${finalEdit.length}ch preview="${this._trunc(finalEdit, 100)}" total=${totalMs}ms`);

            return this._buildResult(finalEdit, document, position);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                this._log.info(`[NES]  ${srcLoc()} |   ${loc} ABORTED after ${Date.now() - t0}ms`);
                return undefined;
            }
            this._log.error(`[NES]  ${srcLoc()} |   ${loc} ERROR after ${Date.now() - t0}ms: ${err}`);
            return undefined;
        } finally {
            cancelListener?.dispose();
        }
    }

    private _getEditWindowLines(document: vscode.TextDocument, position: vscode.Position): string[] {
        const startLine = Math.max(0, position.line - 2);
        const endLine = Math.min(document.lineCount, position.line + 6);
        const lines: string[] = [];
        for (let i = startLine; i < endLine; i++) {
            lines.push(document.lineAt(i).text);
        }
        return lines;
    }

    private _shouldRejectEdit(editText: string, editWindowLines: string[]): boolean {
        if (!editText.trim()) return true; // Empty edit

        // Diff: if the edit matches the original edit window exactly, it's a noop
        const editLines = editText.split('\n');
        if (editLines.length === editWindowLines.length &&
            editLines.every((l, i) => l === editWindowLines[i])) {
            return true; // No-op edit
        }

        // Reject whitespace-only changes
        const nonWhitespaceEdit = editLines.filter(l => l.trim()).join('\n');
        const nonWhitespaceOrig = editWindowLines.filter(l => l.trim()).join('\n');
        if (nonWhitespaceEdit === nonWhitespaceOrig) return true;

        // Reject comment-only edits (lines that are all comments)
        const hasNonComment = editLines.some(l => {
            const trimmed = l.trim();
            return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#') && !trimmed.startsWith('/*');
        });
        if (!hasNonComment) return true;

        return false;
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
