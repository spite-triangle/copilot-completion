import * as vscode from 'vscode';
import { INesConfigProvider } from '../../../config/nesConfig';
import { ILLMAdapterManager } from '../../shared/llm/llmAdapter';
import { LLMResponse } from '../../shared/llm/llmRequest';
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
import { Deferred } from '../../../common/async';


export interface NesExecutionResult {
    editResult: NextEditResult | undefined;
    /** Undefined when editResult exists or the request was cancelled/disabled early. */
    promptPieces?: PromptPieces;
}

interface PendingNesRequest {
    headerRequestId: string;
    documentUri: string;
    documentText: string;
    position: vscode.Position;
    abortController: AbortController;
    liveDependants: number;
    deferred: Deferred<NesExecutionResult>;
}

export class NesWorkflow {
    private readonly _editWindowResolver = new EditWindowResolver();
    private readonly _promptAssembler: PromptAssembler;
    private readonly _responsePipeline = new ResponsePipeline();
    private readonly _editFilterChain = new EditFilterChain();
    private readonly _resultAssembler: EditResultAssembler;

    private readonly _historyTracker = new NesHistoryTracker();

    private _pendingRequest: PendingNesRequest | undefined;

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

        // Step 0.5: Check for pending in-flight request
        const docUri = document.uri.toString();
        const docText = document.getText();

        if (this._pendingRequest) {
            const pending = this._pendingRequest;
            const sameDoc = pending.documentUri === docUri && pending.documentText === docText;
            const cursorNearby = Math.abs(pending.position.line - position.line) <= 10;

            if (sameDoc && cursorNearby) {
                // Join existing pending request
                this._log.info(`[NES]  JOIN pending=${pending.headerRequestId} liveDependants=${pending.liveDependants}`);
                pending.liveDependants++;

                const cancelDisposable = token?.onCancellationRequested(() => {
                    pending.liveDependants--;
                    if (pending.liveDependants <= 0) {
                        this._log.info(`[NES]  ABORT — all dependants gone (1000ms delay)`);
                        setTimeout(() => {
                            if (pending.liveDependants <= 0) {
                                pending.abortController.abort();
                            }
                        }, 1000);
                    }
                });

                try {
                    const result = await pending.deferred.promise;
                    this._log.info(`[NES]  JOIN_RESULT edit=${result.editResult?.edit.length ?? 0}ch`);
                    return result;
                } finally {
                    pending.liveDependants--;
                    cancelDisposable?.dispose();
                }
            }

            // Document changed — clean up stale pending if no dependants
            if (pending.liveDependants <= 0) {
                this._log.debug(`[NES]  DISCARD stale pending request ${pending.headerRequestId}`);
                this._pendingRequest = undefined;
            }
        }

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

        // Step 3: Network request (streaming)
        const t4 = Date.now();
        const endpoint = this._config.supportedEndpoint;
        const adapter = this._llmManager.getAdapter(endpoint);
        const abortController = new AbortController();
        const headerRequestId = `nes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const deferred = new Deferred<NesExecutionResult>();
        const pendingRequest: PendingNesRequest = {
            headerRequestId,
            documentUri: docUri,
            documentText: docText,
            position,
            abortController,
            liveDependants: 1,
            deferred,
        };
        // Cancel any previous pending (stale), register new one
        if (this._pendingRequest && this._pendingRequest.liveDependants <= 0) {
            this._pendingRequest.abortController.abort();
        }
        this._pendingRequest = pendingRequest;
        let cancelTimer: ReturnType<typeof setTimeout> | undefined;
        const cancelListener = token?.onCancellationRequested(() => {
            this._log.info(`[NES]  ABORT — CancellationToken triggered (1000ms delay)`);
            if (cancelTimer) clearTimeout(cancelTimer);
            cancelTimer = setTimeout(() => {
                if (abortController.signal.aborted) return;
                if (pendingRequest.liveDependants > 1) {
                    this._log.info(`[NES]  ABORT — skipped (${pendingRequest.liveDependants} dependants)`);
                    return;
                }
                this._log.info(`[NES]  ABORT — executing after 1000ms delay`);
                abortController.abort();
            }, 1000);
        });

        this._log.debug(`[NES]  endpoint=${endpoint} model=${this._config.model} max_tokens=${this._config.maxOutputTokens}`);

        try {
            const stream = adapter.sendStream(
                {
                    baseUrl: this._config.baseUrl,
                    apiKey: this._config.apiKey,
                    model: this._config.model,
                    family: this._config.family,
                    messages: [
                        { role: 'system', content: promptAssembly.systemPrompt },
                        { role: 'user', content: promptAssembly.userPrompt },
                    ],
                    max_tokens: this._config.maxOutputTokens,
                    temperature: 0,
                    top_p: 1,
                    n: 1,
                    stream: this._config.stream,
                    presence_penalty: this._config.presencePenalty,
                    frequency_penalty: this._config.frequencyPenalty,
                    capabilities: {
                        thinking: this._config.capabilities.supports.thinking,
                        reasoning_effort: this._config.capabilities.supports.reasoning_effort,
                    },
                },
                abortController.signal,
            );

            let accumulated = '';
            let firstEditResolved = false;
            let firstResult: NextEditResult | undefined;
            const editWindowHadCursorTag = promptAssembly.editWindowLines.some(l => l.includes('<|cursor|>'));
            const pipelineContext: ResponsePipelineContext = { editWindowHadCursorTag };

            for await (const delta of stream) {
                if (abortController.signal.aborted) break;

                accumulated += delta;

                if (!firstEditResolved) {
                    const parsedLines = this._responsePipeline.process(accumulated, pipelineContext);
                    if (parsedLines && parsedLines.length > 0 && !parsedLines.every(l => l.trim() === '')) {
                        const finalEdit = this._editFilterChain.apply(parsedLines, promptAssembly.editWindowLines);
                        if (finalEdit) {
                            this._log.info('\n' + parsedLines.join('\n'));
                            const result = this._resultAssembler.assemble(
                                parsedLines,
                                document,
                                position,
                                undefined,
                                this._config.suffixOverlapThreshold,
                                this._config.suffixOverlapType,
                                this._log
                            );
                            firstResult = result;
                            firstEditResolved = true;

                            const networkMs = Date.now() - t4;
                            this._log.info(`[NES]  FIRST_EDIT network=${networkMs}ms edit=${result.edit.length}ch`);

                            // Background: continue consuming stream to populate cache
                            this._consumeRemainingStream(
                                stream, accumulated,
                                DocumentId.create(document.uri.toString()),
                                position, promptAssembly,
                                pipelineContext, abortController.signal
                            ).catch(err => {
                                if ((err as { name?: string })?.name !== 'AbortError') {
                                    this._log.error(`[NES]  background_stream error: ${err}`);
                                }
                            });
                            break;
                        }
                    }
                }
            }

            // If first edit was found during streaming, return it immediately
            if (firstResult) {
                const totalMs = Date.now() - t0;
                this._log.info(`[NES]  RESULT (streaming) edit=${firstResult.edit.length}ch total=${totalMs}ms`);
                this._log.info(`edit = '${firstResult.edit}', editfull = '${firstResult.fullEditText}'\n range = (start = ${firstResult.range.start}, end =${firstResult.range.end}), cursorAfterEdit = ${firstResult.cursorAfterEdit}\njump = ${firstResult.isFromCursorJump}, ${firstResult.jumpToPosition}`);
                const nesResult: NesExecutionResult = { editResult: firstResult, promptPieces: promptAssembly.promptPieces };
                deferred.resolve(nesResult);
                return nesResult;
            }

            // Fallback: stream completed without finding an edit
            const networkMs = Date.now() - t4;
            this._log.info(`[NES]  NETWORK finish (no first edit) [${networkMs}ms]`);
            this._log.info('\n' + accumulated);

            // Step 4: Response pipeline (on full accumulated text)
            const parsedLines = this._responsePipeline.process(accumulated, pipelineContext);
            if (!parsedLines || parsedLines.length === 0 || parsedLines.every(l => l.trim() === '')) {
                this._log.info(`[NES]  EMPTY_EDIT — pipeline returned no content total=${Date.now() - t0}ms`);
                return { editResult: undefined, promptPieces: promptAssembly.promptPieces };
            }

            // Step 5: Edit filtering
            const finalEdit = this._editFilterChain.apply(parsedLines, promptAssembly.editWindowLines);
            if (!finalEdit) {
                this._log.info(`[NES]  FILTERED — edit rejected by filter chain total=${Date.now() - t0}ms`);
                return { editResult: undefined, promptPieces: promptAssembly.promptPieces };
            }

            // Step 6: Build result
            const result = this._resultAssembler.assemble(
                parsedLines, document, position, undefined,
                this._config.suffixOverlapThreshold, this._config.suffixOverlapType, this._log
            );

            // Step 7: Cache result
            const docText = document.getText();
            const docId = DocumentId.create(document.uri.toString());
            const cacheEntry: CachedEdit = {
                docId,
                documentBeforeEdit: docText,
                editWindow: {
                    startLine: Math.max(0, position.line - 2),
                    endLineExclusive: position.line + 6,
                },
                edit: finalEdit,
                cacheTime: Date.now(),
            };
            this._cache.setKthNextEdit(docId, cacheEntry);

            result.cacheEntry = cacheEntry;

            const totalMs = Date.now() - t0;
            this._log.info(`[NES]  RESULT (fallback) edit=${result.edit.length}ch total=${totalMs}ms`);
            this._log.info(`edit = '${result.edit}', editfull = '${result.fullEditText}'\n range = (start = ${result.range.start}, end =${result.range.end}), cursorAfterEdit = ${result.cursorAfterEdit}\njump = ${result.isFromCursorJump}, ${result.jumpToPosition}`);

            const nesResult: NesExecutionResult = { editResult: result, promptPieces: promptAssembly.promptPieces };
            deferred.resolve(nesResult);
            return nesResult;

        } catch (err) {
            if ((err as { name?: string })?.name === 'AbortError') {
                this._log.info(`[NES]  ABORTED after ${Date.now() - t0}ms`);
                deferred.resolve({ editResult: undefined });
                return { editResult: undefined };
            }
            this._log.error(`[NES]  ERROR after ${Date.now() - t0}ms: ${err}`);
            deferred.resolve({ editResult: undefined });
            return { editResult: undefined };
        } finally {
            if (cancelTimer) clearTimeout(cancelTimer);
            cancelListener?.dispose();
            if (this._pendingRequest === pendingRequest) {
                this._pendingRequest = undefined;
            }
        }
    }

    private async _consumeRemainingStream(
        stream: AsyncGenerator<string, LLMResponse>,
        accumulated: string,
        docId: DocumentId,
        position: vscode.Position,
        promptAssembly: { promptPieces: PromptPieces; editWindowLines: string[] },
        pipelineContext: ResponsePipelineContext,
        signal: AbortSignal,
    ): Promise<void> {
        let text = accumulated;
        for await (const delta of stream) {
            if (signal.aborted) return;
            text += delta;
        }
        // Cache results from the complete response in the background
        const parsedLines = this._responsePipeline.process(text, pipelineContext);
        if (parsedLines && parsedLines.length > 0 && !parsedLines.every(l => l.trim() === '')) {
            const finalEdit = this._editFilterChain.apply(parsedLines, promptAssembly.editWindowLines);
            if (finalEdit) {
                const cacheEntry: CachedEdit = {
                    docId,
                    documentBeforeEdit: '',
                    editWindow: {
                        startLine: Math.max(0, position.line - 2),
                        endLineExclusive: position.line + 6,
                    },
                    edit: finalEdit,
                    cacheTime: Date.now(),
                };
                this._cache.setKthNextEdit(docId, cacheEntry);
                this._log.debug(`[NES]  background_stream cached edit=${finalEdit.length}ch`);
            }
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
