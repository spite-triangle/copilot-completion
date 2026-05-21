import * as vscode from 'vscode';
import { INesConfigProvider } from '../../../config/nesConfig';
import { ILLMAdapterManager } from '../../shared/llm/llmAdapter';
import { ILogService } from '../../shared/log/logService';
import { CachedEdit, INextEditCache } from '../nextEditCache';
import { NextEditResult } from '../types';
import { PromptPieces } from '../promptCrafting';
import { DocumentId } from '../stubs/types';
import { PromptAssembler } from './promptAssembler';
import { EditWindowResolver } from './editWindowResolver';
import { EditResultAssembler } from './editResultAssembler';
import { ResponsePipeline, ResponsePipelineContext } from '../response/responsePipeline';
import { EditFilterChain } from '../response/editFilterChain';
import { NesHistoryTracker } from './nesHistoryTracker';


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

    private readonly _historyTracker = new NesHistoryTracker();

    constructor(
        @INesConfigProvider private readonly _config: INesConfigProvider,
        @ILLMAdapterManager private readonly _llmManager: ILLMAdapterManager,
        @ILogService private readonly _log: ILogService,
        @INextEditCache private readonly _cache: INextEditCache,
    ) {
        this._promptAssembler = new PromptAssembler(_config, this._editWindowResolver);
        this._resultAssembler = new EditResultAssembler(this._editWindowResolver);
    }

    dispose(): void {
        this._historyTracker.dispose();
    }

    async execute(
        document: vscode.TextDocument,
        position: vscode.Position,
        lintEnable: boolean,
        token?: vscode.CancellationToken,
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
        const cached = this._cache.lookupNextEdit(DocumentId.create(document.uri.toString()), document, position);
        if (cached) {
            this._log.info(`[NES]  CACHE_HIT edit=${cached.edit.length}ch age=${Date.now() - cached.cacheTime}ms total=${Date.now() - t0}ms`);
            if (token?.isCancellationRequested) {
                this._log.info(`[NES]  CANCEL after_cache_hit`);
                return { editResult: undefined };
            }
            const result = this._buildResultFromCached(cached, document, position);
            this._log.info(`edit = '${result.edit}', editfull = '${result.fullEditText}'\n range = (start = ${result.range.start}, end =${result.range.end}), cursorAfterEdit = ${result.cursorAfterEdit}\njump = ${result.isFromCursorJump}, ${result.jumpToPosition}`);
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
            const xtabHistory = this._historyTracker.getHistory(DocumentId.create(document.uri.toString()));
            promptAssembly = this._promptAssembler.assemble(document, position,lintEnable, xtabHistory);
            this._log.debug('\n' + promptAssembly.userPrompt);
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
            this._log.info('\n' + response.text);

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
                this._log
            );

            // Step 7: Cache result
            const docText = document.getText();
            const cacheEntry: CachedEdit = {
                docId: DocumentId.create(document.uri.toString()),
                documentBeforeEdit: docText,
                editWindow: {
                    startLine: Math.max(0, position.line - 2),
                    endLineExclusive: position.line + 6,
                },
                edit: finalEdit,
                cacheTime: Date.now(),
            };
            this._cache.setKthNextEdit(cacheEntry.docId, cacheEntry);

            result.cacheEntry = cacheEntry;

            const totalMs = Date.now() - t0;
            this._log.info(`[NES]  RESULT edit=${result.edit.length}ch total=${totalMs}ms`);
            this._log.info(`edit = '${result.edit}', editfull = '${result.fullEditText}'\n range = (start = ${result.range.start}, end =${result.range.end}), cursorAfterEdit = ${result.cursorAfterEdit}\njump = ${result.isFromCursorJump}, ${result.jumpToPosition}`);

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
            this._log
        );
    }

    private _trunc(s: string, max: number): string {
        const escaped = s.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        return escaped.length <= max ? escaped : escaped.substring(0, max) + '…';
    }
}
