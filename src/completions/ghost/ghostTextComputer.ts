import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { IGhostConfigProvider } from '../../config/ghostConfig';
import { IGhostPromptFactory } from './promptFactory';
import { IGhostCompletionsCache, CompletionChoice } from './completionsCache';
import { IRecentEditsProvider } from './recentEditsProvider';
import { ILLMAdapterManager } from '../shared/llm/llmAdapter';
import { ILogService } from '../shared/log/logService';
import { CurrentGhostText, LastGhostText } from './ghostTextState';
import { IAsyncCompletionsManager } from './asyncCompletions';
import { TerseBlockTrimmer, VerboseBlockTrimmer } from './blockTrimmer';
import { TrimNESResponseSuffixOverlap } from '../../common/suffixOverlapTrim';
import { DiagnosticSummary, GhostCompletion, ResultType } from './types';
import { isInlineSuggestionFromTextAfterCursor } from './inlineSuggestion';
import { IMultilineStrategy } from './multiline/types';
import { MultilineContextBuilder } from './multiline/MultilineContextBuilder';

// Module-level rate limiting (matches original fetch.ts design)
let lastRequestTime = 0;
let lastTimeoutId: ReturnType<typeof setTimeout> | null = null;

export interface GhostTextResult {
    completions: GhostCompletion[];
    resultType: ResultType;
    suffixCoverage: number;
}

export class GhostTextComputer {
    constructor(
        private readonly _currentGhostText: CurrentGhostText,
        private readonly _lastGhostText: LastGhostText,
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @IGhostConfigProvider private readonly _config: IGhostConfigProvider,
        @IGhostPromptFactory private readonly _promptFactory: IGhostPromptFactory,
        @IGhostCompletionsCache private readonly _cache: IGhostCompletionsCache,
        @IRecentEditsProvider private readonly _recentEdits: IRecentEditsProvider,
        @ILLMAdapterManager private readonly _llmManager: ILLMAdapterManager,
        @IAsyncCompletionsManager private readonly _asyncManager: IAsyncCompletionsManager,
        @ILogService private readonly _log: ILogService,
        @IMultilineStrategy private readonly multilineStrategy: IMultilineStrategy,
    ) {}

    async getGhostText(
        document: vscode.TextDocument,
        position: vscode.Position,
        token?: vscode.CancellationToken,
        isSpeculative: boolean = false,
    ): Promise<GhostTextResult | undefined> {
        const t0 = Date.now();
        this._log.info(`[GHOST] ===== START speculative=${isSpeculative} =====`);

        // Step 0: Check cancellation before any work
        if (token?.isCancellationRequested) {
            this._log.info(`[GHOST] CANCEL before_start`);
            return undefined;
        }

        // Step 1: Config check
        if (!this._config.enabled) {
            this._log.info(`[GHOST] SKIP — disabled by config`);
            return undefined;
        }

        // Step 2: Validate inline suggestion position (isInlineSuggestion ported from source)
        const line = document.lineAt(position.line);
        const textAfterCursor = line.text.substring(position.character);
        const inlineSuggestion = isInlineSuggestionFromTextAfterCursor(textAfterCursor);
        if (inlineSuggestion === undefined) {
            this._log.debug(`[GHOST] SKIP — invalid mid-line position`);
            return undefined;
        }
        const isMiddleOfTheLine = !!inlineSuggestion;

        // Step 3: Extract prefix/suffix
        // suffix 从光标 offset 开始截取，去除光标所在行残余文本及 \n，保留后续行
        const t1 = Date.now();
        const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const offset = document.offsetAt(position);
        const suffix = document.getText().substring(offset)
            .replace(/\r/g, '')
            .replace(/^.*?\n/, '');
        this._log.debug(`[GHOST] prefix=${prefix.length}ch suffix=${suffix.length}ch [${Date.now() - t1}ms]`);
        this._log.debug(`[GHOST] prefix_tail="${this._trunc(prefix, 80)}"`);
        this._log.debug(`[GHOST] suffix_head="${this._trunc(suffix, 80)}"`);

        // Step 3.5: Typing-as-suggested check (via CurrentGhostText singleton)
        const typingSuggested = this._currentGhostText.getCompletionsForUserTyping(prefix, suffix);
        if (typingSuggested && typingSuggested.length > 0) {
            // Apply line-level suffix overlap trim to each completion, filter empty results
            const trimmedCompletions = typingSuggested
                .map(c => ({
                    ...c,
                    completionText: this._trimLineSuffixOverlap(c.completionText, suffix),
                }))
                .filter(c => c.completionText !== '');
            if (trimmedCompletions.length === 0) {
                this._log.info(`[GHOST] TYPING_AS_SUGGESTED all trimmed to empty total=${Date.now() - t0}ms`);
                return undefined;
            }
            this._log.info(`[GHOST] TYPING_AS_SUGGESTED count=${trimmedCompletions.length}/${typingSuggested.length} total=${Date.now() - t0}ms`);
            return {
                completions: trimmedCompletions.map(c => this._toGhostCompletion(
                    { text: c.completionText, finishReason: 'stop' },
                    document, position, isMiddleOfTheLine,
                )),
                resultType: ResultType.TypingAsSuggested,
                suffixCoverage: this._calcSuffixCoverage(trimmedCompletions[0].completionText, suffix),
            };
        }

        // Step 4: Cache lookup
        const t2 = Date.now();
        const cached = this._cache.findAll(prefix, suffix);
        if (cached.length > 0) {
            // Apply line-level suffix overlap trim BEFORE postProcess (consistent with Network path)
            const trimmedCacheText = this._trimLineSuffixOverlap(cached[0].text, suffix);
            const cacheResult = this._postProcessChoiceInContext(
                { text: trimmedCacheText, finishReason: cached[0].finishReason },
                document,
                position,
            );
            this._log.info(`[GHOST] CACHE_HIT count=${cached.length} result="${this._trunc(cacheResult.text, 60)}" [${Date.now() - t2}ms] total=${Date.now() - t0}ms`);
            const ghostCompletionCache = this._toGhostCompletion(cacheResult, document, position, isMiddleOfTheLine);
            this._currentGhostText.setGhostText(prefix, suffix, [ghostCompletionCache], ResultType.Cache);
            return {
                completions: [ghostCompletionCache],
                resultType: ResultType.Cache,
                suffixCoverage: this._calcSuffixCoverage(cacheResult.text, suffix),
            };
        }
        this._log.debug(`[GHOST] cache_miss [${Date.now() - t2}ms]`);

        if (token?.isCancellationRequested) {
            this._log.info(`[GHOST] CANCEL after_cache_check`);
            return undefined;
        }

        // Step 4.5: Check async completions (in-flight request reuse)
        const asyncHeaderRequestId = `ghost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (this._asyncManager.shouldWaitForAsyncCompletions(prefix, suffix)) {
            this._log.info(`[GHOST] async_wait — checking in-flight requests`);
            const asyncResult = await this._asyncManager.getFirstMatchingRequest(
                asyncHeaderRequestId, prefix, suffix
            );
            if (asyncResult) {
                // Apply char-level then line-level suffix overlap trim BEFORE postProcess (consistent with Network path)
                const charTrimmedAsyncText = this._trimCharOverlap(asyncResult.completionText, suffix);
                const trimmedAsyncText = this._trimLineSuffixOverlap(charTrimmedAsyncText, suffix);
                const choice: CompletionChoice = {
                    text: trimmedAsyncText,
                    finishReason: asyncResult.finishReason,
                };
                const processed = this._postProcessChoiceInContext(choice, document, position);
                const suffixCoverage = this._calcSuffixCoverage(processed.text, suffix);
                this._log.info(`[GHOST] ASYNC_REUSE result=${processed.text.length}ch total=${Date.now() - t0}ms`);
                const ghostCompletion = this._toGhostCompletion(processed, document, position, isMiddleOfTheLine);
                this._currentGhostText.setGhostText(prefix, suffix, [ghostCompletion], ResultType.Async);
                return {
                    completions: [ghostCompletion],
                    resultType: ResultType.Async,
                    suffixCoverage,
                };
            }
            this._log.info(`[GHOST] async_wait — no matching request found`);
        }

        // Step 5: Collect diagnostics
        const t3 = Date.now();
        const diagnostics = this._collectDiagnostics(document, position);
        this._log.debug(`[GHOST] diagnostics=${diagnostics.length} recentEdits=${this._recentEdits.recentEdits.length} [${Date.now() - t3}ms]`);

        // Step 6: Build prompt
        const t4 = Date.now();
        let prompt = this._promptFactory.createPrompt({
            template: this._config.promptTemplate,
            prefix,
            suffix,
            languageId: document.languageId,
            diagnostics,
            recentEdits: this._recentEdits.recentEdits,
        });
        prompt = prompt.replace(/\r\n/g, '\n');
        this._log.debug(`[GHOST] prompt=${prompt.length}ch model=${this._config.model} [${Date.now() - t4}ms]`);
        this._log.debug('\n' + prompt);

        if (token?.isCancellationRequested) {
            this._log.info(`[GHOST] CANCEL after_prompt_build`);
            return undefined;
        }

        // Step 7: Determine multiline strategy via detector chain
        const afterAccept = this._currentGhostText.hasAcceptedCurrentCompletion_original();
        const multilineCtx = new MultilineContextBuilder().build({
            document,
            position,
            prefix,
            suffix,
            languageId: document.languageId,
            isMiddleOfTheLine,
            afterAccept,
        });
        const requestMultiline = await this.multilineStrategy.determineMultiline(multilineCtx);
        const maxTokens = Math.min(this._config.maxOutputTokens, 512);
        const effectiveTokens = Math.min(requestMultiline ? maxTokens : 64, maxTokens);
        this._log.debug(`[GHOST] strategy multiline=${requestMultiline} tokens=${effectiveTokens}/${maxTokens}`);

        // Step 8: Network request with rate limiting + AbortController
        const t5 = Date.now();
        const abortController = new AbortController();
        let cancelTimer: ReturnType<typeof setTimeout> | undefined;
        const cancelListener = token?.onCancellationRequested(() => {
            this._log.info(`[GHOST] ABORT — CancellationToken triggered (1000ms delay)`);
            if (cancelTimer) clearTimeout(cancelTimer);
            cancelTimer = setTimeout(() => {
                if (abortController.signal.aborted) return;
                if (this._asyncManager.hasActiveWaiters()) {
                    this._log.info(`[GHOST] ABORT — skipped, active waiters present`);
                    return;
                }
                this._log.info(`[GHOST] ABORT — executing after 1000ms delay`);
                abortController.abort();
            }, 1000);
        });

        // Rate limiting: enforce minimum interval between requests
        const delayMs = this._config.delay;
        const waitTime = Math.max(0, delayMs - (Date.now() - lastRequestTime));
        if (waitTime > 0) {
            this._log.debug(`[GHOST] rate_limiting delay=${waitTime}ms`);
            await new Promise<void>((resolve, reject) => {
                const tid = setTimeout(() => {
                    if (abortController.signal.aborted) {
                        const err = new Error('Aborted');
                        err.name = 'AbortError';
                        reject(err);
                        return;
                    }
                    lastRequestTime = Date.now();
                    resolve();
                }, waitTime);
                if (lastTimeoutId) clearTimeout(lastTimeoutId);
                lastTimeoutId = tid;
            });
        } else {
            lastRequestTime = Date.now();
        }

        const adapter = this._llmManager.getAdapter('completions');
        const ourRequestId = `ghost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const asyncCancellationTokenSource = { cancel: () => abortController.abort() };

        try {
            // Initiate network request but DON'T await yet
            const requestPromise = adapter.send(
                {
                    baseUrl: this._config.baseUrl,
                    apiKey: this._config.apiKey,
                    model: this._config.model,
                    prompt,
                    max_tokens: effectiveTokens,
                    temperature: 0,
                    stop: (requestMultiline ? ['\n\n',"\n```"] : ['\n']).concat(this._config.stops),
                    top_p:1,
                    n:1,
                    stream: this._config.stream,
                    presence_penalty: this._config.presencePenalty,
                    frequency_penalty: this._config.frequencyPenalty,
                },
                abortController.signal,
            );

            // Register as pending IMMEDIATELY — before awaiting
            void this._asyncManager.queueCompletionRequest(
                ourRequestId,
                prefix,
                suffix,
                asyncCancellationTokenSource,
                requestPromise.then(response => ({
                    completionText: response.text,
                    finishReason: response.finishReason,
                })),
            );

            // Wait for result via async manager (handles both our own and reused requests)
            const asyncResult = await this._asyncManager.getFirstMatchingRequest(
                ourRequestId, prefix, suffix
            );

            if (!asyncResult) {
                this._log.info(`[GHOST] NO_RESULT — getFirstMatchingRequest returned undefined total=${Date.now() - t0}ms`);
                return undefined;
            }

            const networkMs = (Date.now() - t5);
            this._log.info(`[GHOST] NETWORK finish=${asyncResult.finishReason} text=${asyncResult.completionText.length}ch [${networkMs}ms]`);
            this._log.debug('\n'+asyncResult.completionText);

            // Step 9: Block trim
            const rawText = asyncResult.completionText;
            const blockTrimmedText = requestMultiline
                ? new VerboseBlockTrimmer().trim(rawText)
                : new TerseBlockTrimmer().trim(rawText);
            if (blockTrimmedText !== rawText) {
                this._log.debug(`[GHOST] block_trim ${rawText.length}→${blockTrimmedText.length}ch multiline=${requestMultiline}`);
            }

            // Step 10: Character-level suffix overlap
            const charTrimmedText = this._trimCharOverlap(blockTrimmedText, suffix);
            if (charTrimmedText !== blockTrimmedText) {
                this._log.info(`[GHOST] char_trim removed="${this._trunc(blockTrimmedText.slice(charTrimmedText.length), 40)}"`);
            }

            // Step 11: Line-level suffix overlap (via shared method)
            const trimmedText = this._trimLineSuffixOverlap(charTrimmedText, suffix);

            // Step 12: Post-process (adjustLeadingWhitespace, displayText separation)
            const processed = this._postProcessChoiceInContext(
                { text: trimmedText, finishReason: asyncResult.finishReason },
                document,
                position,
            );

            // Step 13: Calculated suffix coverage
            const suffixCoverage = this._calcSuffixCoverage(processed.text, suffix);

            this._log.info(`[GHOST] RESULT resultType=Network final=${processed.text.length}ch total=${Date.now() - t0}ms`);
            this._log.debug(`\n`+ processed.text);

            // Step 14: Cache & return
            const choices: CompletionChoice[] = [{
                text: processed.text,
                finishReason: asyncResult.finishReason,
            }];
            this._cache.append(prefix, suffix, choices[0]);

            // Step 13.5: Build GhostCompletion
            const ghostCompletion = this._toGhostCompletion(processed, document, position, isMiddleOfTheLine);

            // Store for typing-as-suggested on next keystroke
            this._currentGhostText.setGhostText(prefix, suffix, [ghostCompletion], ResultType.Network, asyncResult.finishReason);

            // Step 14: Return
            return {
                completions: [ghostCompletion],
                resultType: ResultType.Network,
                suffixCoverage,
            };
        } catch (err) {
            if ((err as {name?: string})?.name === 'AbortError') {
                this._log.info(`[GHOST] ABORTED after ${Date.now() - t0}ms`);
                return undefined;
            }
            this._log.error(`[GHOST] ERROR after ${Date.now() - t0}ms: ${err}`);
            return undefined;
        } finally {
            if (cancelTimer) clearTimeout(cancelTimer);
            cancelListener?.dispose();
        }
    }

    // Exported for unit testing
    _trimCharOverlap(completion: string, suffix: string): string {
        if (!completion || !suffix) return completion;

        const completionFirstLine = completion.split('\n')[0];
        const suffixFirstLine = suffix.split('\n')[0];

        if (!completionFirstLine || !suffixFirstLine) return completion;

        const maxLen = Math.min(completionFirstLine.length, suffixFirstLine.length);
        for (let len = maxLen; len > 0; len--) {
            const suffixHead = suffixFirstLine.substring(0, len);
            if (completionFirstLine.endsWith(suffixHead)) {
                const trimmedFirstLine = completionFirstLine.substring(0, completionFirstLine.length - len);
                const restLines = completion.split('\n').slice(1);
                return [trimmedFirstLine, ...restLines].join('\n');
            }
        }
        return completion;
    }

    // Line-level suffix overlap trimmer — shared across all 4 return paths
    _trimLineSuffixOverlap(text: string, suffix: string): string {
        const completionLines = text.split('\n');
        const suffixLines = suffix.split('\n');
        const trimmer = new TrimNESResponseSuffixOverlap(
            this._config.suffixOverlapThreshold,
            this._config.suffixOverlapType,
        );
        const overlapCount = trimmer.calculateOverlap(completionLines, suffixLines);
        if (overlapCount > 0 && overlapCount < completionLines.length) {
            this._log.info(`[GHOST] line_trim overlap=${overlapCount} lines`);
            return completionLines.slice(0, completionLines.length - overlapCount).join('\n');
        }
        if (overlapCount >= completionLines.length) {
            this._log.info(`[GHOST] line_trim ALL_LINES overlap=${overlapCount} >= ${completionLines.length} — returning empty`);
            return '';
        }
        return text;
    }

    private _postProcessChoiceInContext(
        choice: CompletionChoice,
        document: vscode.TextDocument,
        position: vscode.Position,
    ): CompletionChoice {
        let text = choice.text;
        const currentLine = document.lineAt(position.line);
        const baseIndent = currentLine.text.substring(0, currentLine.firstNonWhitespaceCharacterIndex);

        // Adjust leading whitespace: normalize multi-line completions to match current indent
        const lines = text.split('\n');
        if (lines.length > 1 && baseIndent.length > 0) {
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim().length > 0 && !lines[i].startsWith(baseIndent)) {
                    lines[i] = baseIndent + lines[i];
                }
            }
            text = lines.join('\n');
        }

        return { ...choice, text };
    }

    private _calcSuffixCoverage(completionText: string, suffix: string): number {
        if (!completionText || !suffix) return 0;
        // Count how many characters of the suffix the completion covers
        let i = 0;
        while (i < completionText.length && i < suffix.length && completionText[i] === suffix[i]) {
            i++;
        }
        return i;
    }

    private _toGhostCompletion(
        choice: CompletionChoice,
        document: vscode.TextDocument,
        position: vscode.Position,
        isMiddleOfTheLine: boolean,
    ): GhostCompletion {
        const currentLine = document.lineAt(position.line);
        const baseIndent = currentLine.text.substring(0, currentLine.firstNonWhitespaceCharacterIndex);
        const displayText = choice.text.replace(new RegExp(`^\\n${baseIndent}`, 'g'), '\n');

        return {
            completionIndex: 0,
            completionText: choice.text,
            displayText,
            displayNeedsWsOffset: position.character > 0,
            isMiddleOfTheLine,
        };
    }

    private _collectDiagnostics(document: vscode.TextDocument, position: vscode.Position): DiagnosticSummary[] {
        const allDiagnostics = vscode.languages.getDiagnostics(document.uri);
        return allDiagnostics
            .filter(d => d.range.start.line >= position.line - 20 && d.range.start.line <= position.line)
            .slice(0, 5)
            .map(d => ({
                line: d.range.start.line + 1,
                severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' as const : 'warning' as const,
                message: d.message,
            }));
    }

    private _trunc(s: string, max: number): string {
        const escaped = s.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        return escaped.length <= max ? escaped : escaped.substring(0, max) + '…';
    }
}
