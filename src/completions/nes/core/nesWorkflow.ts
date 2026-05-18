import * as vscode from 'vscode';
import { INesConfigProvider } from '../../../config/nesConfig';
import { ILLMAdapterManager } from '../../shared/llm/llmAdapter';
import { ILogService } from '../../shared/log/logService';
import { CachedEdit, INextEditCache } from '../nextEditCache';
import { NextEditResult } from '../types';
import { PromptingStrategy } from '../stubs/types';
import { pickSystemPrompt } from '../systemMessages';
import { CurrentDocument } from '../xtabCurrentDocument';
import { StringText } from '../stubs/abstractText';
import { Position } from '../stubs/position';
import { OffsetRange } from '../stubs/offsetRange';
import { DocumentId, StatelessNextEditDocument, PromptOptions, IncludeLineNumbersOption, AggressivenessLevel, LintOptionWarning, LintOptionShowCode } from '../stubs/types';
import { constructTaggedFile, getUserPrompt, PromptPieces, N_LINES_AS_CONTEXT } from '../promptCrafting';
import { LintErrors } from '../lintErrors';
import { EditWindowResolver } from './editWindowResolver';
import { ResponsePipeline, ResponsePipelineContext } from '../response/responsePipeline';
import { EditFilterChain } from '../response/editFilterChain';

export interface NesExecutionResult {
    editResult: NextEditResult | undefined;
    promptPieces: PromptPieces;
}

export class NesWorkflow {
    private readonly _editWindowResolver: EditWindowResolver;
    private readonly _responsePipeline: ResponsePipeline;
    private readonly _editFilterChain: EditFilterChain;

    constructor(
        @INesConfigProvider private readonly _config: INesConfigProvider,
        @ILLMAdapterManager private readonly _llmManager: ILLMAdapterManager,
        @ILogService private readonly _log: ILogService,
        @INextEditCache private readonly _cache: INextEditCache,
    ) {
        this._editWindowResolver = new EditWindowResolver();
        this._responsePipeline = new ResponsePipeline();
        this._editFilterChain = new EditFilterChain();
    }

    async execute(
        document: vscode.TextDocument,
        position: vscode.Position,
        token?: vscode.CancellationToken,
        /** If provided, skip edit window resolution and use this position */
        overridePosition?: vscode.Position,
    ): Promise<NesExecutionResult> {
        const t0 = Date.now();
        this._log.info(`[NES]  ===== START =====`);

        if (token?.isCancellationRequested) {
            this._log.info(`[NES]  CANCEL before_start`);
            return this._emptyResult(document, position);
        }

        if (!this._config.enabled) {
            this._log.info(`[NES]  SKIP — disabled by config`);
            return this._emptyResult(document, position);
        }

        // Step 1: Cache lookup
        const t1 = Date.now();
        const docText = document.getText();
        const cached = this._cache.lookupNextEdit(document.uri.toString(), document);
        if (cached) {
            this._log.info(`[NES]  CACHE_HIT edit=${cached.edit.length}ch age=${Date.now() - cached.cacheTime}ms total=${Date.now() - t0}ms`);
            if (token?.isCancellationRequested) {
                this._log.info(`[NES]  CANCEL after_cache_hit`);
                return this._emptyResult(document, position);
            }
            const result = this._buildResult(cached.edit, document, position, cached);
            return { editResult: result, promptPieces: null! };
        }
        this._log.debug(`[NES]  cache_miss [${Date.now() - t1}ms]`);

        if (token?.isCancellationRequested) {
            this._log.info(`[NES]  CANCEL after_cache_miss`);
            return this._emptyResult(document, position);
        }

        // Step 2: Build prompt
        const { promptPieces, userPrompt, systemPrompt, editWindowLines } = this._buildPrompt(document, position, overridePosition);

        if (token?.isCancellationRequested) {
            this._log.info(`[NES]  CANCEL after_prompt_build`);
            return { editResult: undefined, promptPieces };
        }

        // Step 3: Network request
        const t4 = Date.now();
        const endpoint = this._config.supportedEndpoint;
        const adapter = this._llmManager.getAdapter(endpoint);
        const abortController = new AbortController();
        const cancelListener = token?.onCancellationRequested(() => {
            this._log.info(`[NES]  ABORT — CancellationToken triggered`);
            abortController.abort();
        });

        this._log.debug(`[NES]  endpoint=${endpoint} model=${this._config.model} max_tokens=${this._config.maxOutputTokens}`);

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
            this._log.info(`[NES]  NETWORK finish=${response.finishReason} text=${response.text.length}ch usage=${JSON.stringify(response.usage)} [${networkMs}ms]`);
            this._log.debug('\n' + response.text);

            // Step 4: Response pipeline
            const editWindowHadCursorTag = editWindowLines.some(l => l.includes('<|cursor|>'));
            const suffixLines = document.getText(
                new vscode.Range(position, document.lineAt(document.lineCount - 1).range.end)
            ).replace(/\r\n/g, '\n').split('\n');

            const pipelineContext: ResponsePipelineContext = {
                editWindowHadCursorTag,
                suffixLines,
                suffixOverlapThreshold: this._config.suffixOverlapThreshold,
                suffixOverlapType: this._config.suffixOverlapType,
            };

            const parsedLines = this._responsePipeline.process(response.text, pipelineContext);

            if (!parsedLines || parsedLines.length === 0 || parsedLines.every(l => l.trim() === '')) {
                this._log.info(`[NES]  EMPTY_EDIT — pipeline returned no content total=${Date.now() - t0}ms`);
                return { editResult: undefined, promptPieces };
            }

            // Step 5: Edit filtering
            const finalEdit = this._editFilterChain.apply(parsedLines, editWindowLines);
            if (!finalEdit) {
                this._log.info(`[NES]  FILTERED — edit rejected by filter chain total=${Date.now() - t0}ms`);
                return { editResult: undefined, promptPieces };
            }

            // Step 6: Cache result
            const cacheEntry: CachedEdit = {
                docId: document.uri.toString(),
                docContentHash: this._hash(docText),
                editWindow: {
                    startLine: Math.max(0, position.line - 2),
                    endLineExclusive: position.line + 6,
                },
                edit: finalEdit,
                cacheTime: Date.now(),
            };
            this._cache.setKthNextEdit(document.uri.toString(), cacheEntry);

            const totalMs = Date.now() - t0;
            this._log.info(`[NES]  RESULT edit=${finalEdit.length}ch preview="${this._trunc(finalEdit, 100)}" total=${totalMs}ms`);

            const result = this._buildResult(finalEdit, document, position, cacheEntry);
            return { editResult: result, promptPieces };
        } catch (err) {
            if ((err as { name?: string })?.name === 'AbortError') {
                this._log.info(`[NES]  ABORTED after ${Date.now() - t0}ms`);
                return { editResult: undefined, promptPieces };
            }
            this._log.error(`[NES]  ERROR after ${Date.now() - t0}ms: ${err}`);
            return { editResult: undefined, promptPieces };
        } finally {
            cancelListener?.dispose();
        }
    }

    private _buildPrompt(
        document: vscode.TextDocument,
        position: vscode.Position,
        overridePosition?: vscode.Position,
    ) {
        const t2 = Date.now();
        const normalizedText = document.getText().replace(/\r\n/g, '\n');
        const effectivePosition = overridePosition ?? position;
        const cursorPos = new Position(effectivePosition.line + 1, effectivePosition.character + 1);
        const currentDocument = new CurrentDocument(new StringText(normalizedText), cursorPos);

        // Use EditWindowResolver for range calculation
        const normalizedLines = normalizedText.split('\n');
        const ewRange = overridePosition
            ? this._editWindowResolver.resolve(normalizedLines, effectivePosition.line)
            : this._editWindowResolver.resolve(normalizedLines, position.line);

        const aaStart = Math.max(0, position.line - N_LINES_AS_CONTEXT);
        const aaEndExcl = Math.min(document.lineCount, position.line + N_LINES_AS_CONTEXT + 1);
        const areaAroundEditWindowLinesRange = new OffsetRange(aaStart, aaEndExcl);

        const computeTokens = (s: string) => Math.floor(s.length / 4);
        const promptOptions: PromptOptions = {
            promptingStrategy: PromptingStrategy.Xtab275,
            includePostScript: true,
            recentlyViewedDocuments: { maxTokens: 2000, nDocuments: 10, includeViewedFiles: true, clippingStrategy: 'TopToBottom' as any, includeLineNumbers: IncludeLineNumbersOption.None },
            currentFile: { includeCursorTag: true, includeLineNumbers: IncludeLineNumbersOption.None, maxTokens: 4000, prioritizeAboveCursor: true, includeTags: true },
            languageContext: { maxTokens: 2000, traitPosition: 'before' },
            lintOptions: { tagName: 'diagnostics', warnings: LintOptionWarning.NO, showCode: LintOptionShowCode.NO, maxLints: 10, maxLineDistance: 50, nRecentFiles: 3 },
            neighborFiles: { enabled: false, maxTokens: 2000 },
            pagedClipping: { pageSize: 50 },
            diffHistory: { onlyForDocsInPrompt: true, maxTokens: 2000, nEntries: 10, useRelativePaths: true },
        };

        const taggedR = constructTaggedFile(currentDocument, ewRange, areaAroundEditWindowLinesRange, promptOptions, computeTokens, {
            includeLineNumbers: { areaAroundCodeToEdit: IncludeLineNumbersOption.None, currentFileContent: IncludeLineNumbersOption.None },
        });
        if (taggedR.isError()) {
            this._log.info(`[NES]  SKIP — prompt too large total=${Date.now() - t2}ms`);
            throw new Error('Prompt too large');
        }
        const { clippedTaggedCurrentDoc, areaAroundCodeToEdit } = taggedR.val;

        const activeDoc: StatelessNextEditDocument = { id: DocumentId.create(document.uri.toString()) };
        const lintErrors = new LintErrors(activeDoc.id, currentDocument);

        const promptPieces = new PromptPieces(
            currentDocument, ewRange, areaAroundEditWindowLinesRange,
            activeDoc, [], clippedTaggedCurrentDoc.lines, areaAroundCodeToEdit,
            undefined, AggressivenessLevel.Medium, lintErrors, computeTokens, promptOptions,
        );

        const { prompt: baseUserPrompt } = getUserPrompt(promptPieces);

        const editWindowLines = normalizedLines.slice(ewRange.start, ewRange.endExclusive);
        const prediction = editWindowLines.join('\n');

        let userPrompt = baseUserPrompt + `current document is ${document.languageId}. **Just can improve \`code_to_eidt\` section and output modifying result. Don't return other content.**`;
        if (prediction.length > 0) {
            userPrompt += `\n\nThe output example is as follows:\n\n\`\`\`\n###remain edit start boundary line###\n${prediction}\n###remain edit end boundary line###\n\`\`\`\n`;
        }

        const systemPrompt = pickSystemPrompt();
        this._log.debug(`[NES]  edit_window L${ewRange.start + 1}-L${ewRange.endExclusive} area_around L${aaStart + 1}-L${aaEndExcl} lang=${document.languageId}`);
        this._log.debug(`[NES]  system_prompt=${systemPrompt.length}ch user_prompt=${userPrompt.length}ch [${Date.now() - t2}ms]`);

        return { promptPieces, userPrompt, systemPrompt, editWindowLines };
    }

    private _buildResult(
        edit: string,
        document: vscode.TextDocument,
        position: vscode.Position,
        cacheEntry?: CachedEdit,
    ): NextEditResult {
        const documentLines = document.getText().split('\n');
        const ewRange = this._editWindowResolver.resolve(documentLines, position.line);

        const startLine = ewRange.start;
        const endLineExclusive = Math.min(ewRange.endExclusive, document.lineCount);

        const range = new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLineExclusive, 0),
        );

        const nextLine = Math.min(position.line + 1, document.lineCount - 1);

        return {
            edit,
            range,
            cursorAfterEdit: new vscode.Position(nextLine, 0),
            displayLocation: {
                range,
                label: `L${startLine + 1}-L${endLineExclusive}`,
            },
            cacheEntry,
            isFromCursorJump: false,
        };
    }

    private _emptyResult(document: vscode.TextDocument, position: vscode.Position): NesExecutionResult {
        const normalizedText = document.getText().replace(/\r\n/g, '\n');
        const cursorPos = new Position(position.line + 1, position.character + 1);
        const currentDocument = new CurrentDocument(new StringText(normalizedText), cursorPos);
        const dummyPromptPieces = new PromptPieces(
            currentDocument,
            new OffsetRange(0, 0),
            new OffsetRange(0, 0),
            { id: DocumentId.create(document.uri.toString()) },
            [], [], '', undefined, AggressivenessLevel.Medium,
            new LintErrors(DocumentId.create(document.uri.toString()), currentDocument),
            () => 0,
            {} as PromptOptions,
        );
        return { editResult: undefined, promptPieces: dummyPromptPieces };
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
