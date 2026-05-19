import * as vscode from 'vscode';
import { INesConfigProvider } from '../../../config/nesConfig';
import { ILLMAdapterManager } from '../../shared/llm/llmAdapter';
import { ILogService } from '../../shared/log/logService';
import { CachedEdit, INextEditCache } from '../nextEditCache';
import { NextEditResult } from '../types';
import { PromptPieces } from '../promptCrafting';
import { PromptAssembler } from './promptAssembler';
import { EditWindowResolver } from './editWindowResolver';
import { EditResultAssembler } from './editResultAssembler';
import { ResponsePipeline, ResponsePipelineContext } from '../response/responsePipeline';
import { EditFilterChain } from '../response/editFilterChain';
import { recordDocumentForDiffHistory } from '../diffHistoryForPrompt';

export interface NesExecutionResult {
    editResult: NextEditResult | undefined;
    /** Undefined when editResult exists or the request was cancelled/disabled early. */
    promptPieces?: PromptPieces;
}

export class NesWorkflow {
    private readonly _editWindowResolver = new EditWindowResolver();
    private readonly _promptAssembler: PromptAssembler;
    private readonly _responsePipeline = new ResponsePipeline();
    private readonly _editFilterChain = new EditFilterChain();
    private readonly _resultAssembler: EditResultAssembler;

    constructor(
        @INesConfigProvider private readonly _config: INesConfigProvider,
        @ILLMAdapterManager private readonly _llmManager: ILLMAdapterManager,
        @ILogService private readonly _log: ILogService,
        @INextEditCache private readonly _cache: INextEditCache,
    ) {
        this._promptAssembler = new PromptAssembler(_config, this._editWindowResolver);
        this._resultAssembler = new EditResultAssembler(this._editWindowResolver);
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
            return { editResult: undefined };
        }

        if (!this._config.enabled) {
            this._log.info(`[NES]  SKIP — disabled by config`);
            return { editResult: undefined };
        }

        // Step 1: Cache lookup
        const t1 = Date.now();
        const cached = this._cache.lookupNextEdit(document.uri.toString(), document);
        if (cached) {
            this._log.info(`[NES]  CACHE_HIT edit=${cached.edit.length}ch age=${Date.now() - cached.cacheTime}ms total=${Date.now() - t0}ms`);
            if (token?.isCancellationRequested) {
                this._log.info(`[NES]  CANCEL after_cache_hit`);
                return { editResult: undefined };
            }
            const result = this._buildResultFromCached(cached, document, position);
            recordDocumentForDiffHistory(document.uri.toString(), document.getText().replace(/\r\n/g, '\n').split('\n'));
            return { editResult: result };
        }
        this._log.debug(`[NES]  cache_miss [${Date.now() - t1}ms]`);

        if (token?.isCancellationRequested) {
            this._log.info(`[NES]  CANCEL after_cache_miss`);
            return { editResult: undefined };
        }

        // Step 2: Build prompt
        let promptAssembly;
        try {
            promptAssembly = this._promptAssembler.assemble(document, position, overridePosition);
        } catch {
            this._log.info(`[NES]  SKIP — prompt too large`);
            return { editResult: undefined };
        }

        if (token?.isCancellationRequested) {
            this._log.info(`[NES]  CANCEL after_prompt_build`);
            return { editResult: undefined };
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
                        { role: 'system', content: promptAssembly.systemPrompt },
                        { role: 'user', content: promptAssembly.userPrompt },
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

            // Step 4: Response pipeline — Phase 1 (boundary markers + cursor tag stripping)
            const editWindowHadCursorTag = promptAssembly.editWindowLines.some(l => l.includes('<|cursor|>'));
            const pipelineContext: ResponsePipelineContext = { editWindowHadCursorTag };
            const parsedLines = this._responsePipeline.process(response.text, pipelineContext);

            if (!parsedLines || parsedLines.length === 0 || parsedLines.every(l => l.trim() === '')) {
                this._log.info(`[NES]  EMPTY_EDIT — pipeline returned no content total=${Date.now() - t0}ms`);
                return { editResult: undefined, promptPieces: promptAssembly.promptPieces };
            }

            // Step 5: Edit filtering — Phase 5
            const finalEdit = this._editFilterChain.apply(parsedLines, promptAssembly.editWindowLines);
            if (!finalEdit) {
                this._log.info(`[NES]  FILTERED — edit rejected by filter chain total=${Date.now() - t0}ms`);
                return { editResult: undefined, promptPieces: promptAssembly.promptPieces };
            }

            // Step 6: Build result — Phase 3-4-6 (diff → post-process → suffix overlap → result)
            const result = this._resultAssembler.assemble(
                parsedLines,
                document,
                position,
                undefined,
                this._config.suffixOverlapThreshold,
                this._config.suffixOverlapType,
            );

            // Step 7: Cache result
            const docText = document.getText();
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

            result.cacheEntry = cacheEntry;

            const totalMs = Date.now() - t0;
            this._log.info(`[NES]  RESULT edit=${result.edit.length}ch preview="${this._trunc(result.edit, 100)}" total=${totalMs}ms`);

            recordDocumentForDiffHistory(document.uri.toString(), document.getText().replace(/\r\n/g, '\n').split('\n'));

            return { editResult: result, promptPieces: promptAssembly.promptPieces };
        } catch (err) {
            if ((err as { name?: string })?.name === 'AbortError') {
                this._log.info(`[NES]  ABORTED after ${Date.now() - t0}ms`);
                return { editResult: undefined };
            }
            this._log.error(`[NES]  ERROR after ${Date.now() - t0}ms: ${err}`);
            return { editResult: undefined };
        } finally {
            cancelListener?.dispose();
        }
    }

    private _buildResultFromCached(
        cached: CachedEdit,
        document: vscode.TextDocument,
        position: vscode.Position,
    ): NextEditResult {
        const responseLines = cached.edit.split('\n');
        return this._resultAssembler.assemble(
            responseLines,
            document,
            position,
            cached,
            this._config.suffixOverlapThreshold,
            this._config.suffixOverlapType,
        );
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
