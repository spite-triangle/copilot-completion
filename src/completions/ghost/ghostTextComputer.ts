import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { IGhostConfigProvider } from '../../config/ghostConfig';
import { IGhostPromptFactory } from './promptFactory';
import { IGhostCompletionsCache, CompletionChoice } from './completionsCache';
import { IRecentEditsProvider } from './recentEditsProvider';
import { ILLMAdapterManager } from '../shared/llm/llmAdapter';
import { ILogService } from '../shared/log/logService';
import { CurrentGhostText } from './current';
import { LastGhostText } from './last';
import { IAsyncCompletionsManager } from './asyncCompletions';
import { TerseBlockTrimmer, VerboseBlockTrimmer } from './blockTrimmer';
import { TrimNESResponseSuffixOverlap } from '../nes/suffixOverlapTrim';
import { DiagnosticSummary, GhostCompletion } from './types';
import { ResultType } from './resultType';
import { isInlineSuggestionFromTextAfterCursor } from './inlineSuggestion';

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
        // suffix 从光标所在行的下一行开始，光标所在行光标后面的文本不进入 suffix
        const t1 = Date.now();
        const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position))
            .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const suffixStartLine = position.line + 1;
        const suffix ="\n" + (suffixStartLine < document.lineCount
            ? document.getText(
                new vscode.Range(
                    new vscode.Position(suffixStartLine, 0),
                    document.lineAt(document.lineCount - 1).range.end,
                ),
            ).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            : '');
        this._log.debug(`[GHOST] prefix=${prefix.length}ch suffix=${suffix.length}ch [${Date.now() - t1}ms]`);
        this._log.debug(`[GHOST] prefix_tail="${this._trunc(prefix, 80)}"`);
        this._log.debug(`[GHOST] suffix_head="${this._trunc(suffix, 80)}"`);

        // Step 4: Cache lookup
        const t2 = Date.now();
        const cached = this._cache.findAll(prefix, suffix);
        if (cached.length > 0) {
            const cacheResult = this._postProcessChoiceInContext(cached[0], document, position);
            this._log.info(`[GHOST] CACHE_HIT count=${cached.length} result="${this._trunc(cacheResult.text, 60)}" [${Date.now() - t2}ms] total=${Date.now() - t0}ms`);
            return {
                completions: [this._toGhostCompletion(cacheResult, document, position, isMiddleOfTheLine)],
                resultType: ResultType.Cache,
                suffixCoverage: this._calcSuffixCoverage(cacheResult.text, suffix),
            };
        }
        this._log.debug(`[GHOST] cache_miss [${Date.now() - t2}ms]`);

        if (token?.isCancellationRequested) {
            this._log.info(`[GHOST] CANCEL after_cache_check`);
            return undefined;
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
        prompt = prompt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        this._log.debug(`[GHOST] prompt=${prompt.length}ch model=${this._config.model} [${Date.now() - t4}ms]`);
        this._log.debug(`prompt\n ${prompt}`);

        if (token?.isCancellationRequested) {
            this._log.info(`[GHOST] CANCEL after_prompt_build`);
            return undefined;
        }

        // Step 7: Determine strategy (textAfterCursor from Step 2, already computed above)
        const isSingleLine = textAfterCursor.trim() === '';
        const maxTokens = Math.min(this._config.maxOutputTokens, 500);
        const effectiveTokens = Math.min(isSingleLine ? 20 : maxTokens, maxTokens);
        this._log.debug(`[GHOST] strategy singleLine=${isSingleLine} tokens=${effectiveTokens}/${maxTokens}`);

        // Step 8: Network request with rate limiting + AbortController
        const t5 = Date.now();
        const abortController = new AbortController();
        const cancelListener = token?.onCancellationRequested(() => {
            this._log.info(`[GHOST] ABORT — CancellationToken triggered`);
            abortController.abort();
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
        try {
            const response = await adapter.send(
                {
                    prompt,
                    max_tokens: effectiveTokens,
                    temperature: 0,
                    stop: isSingleLine ? ['\n'] : ['\n\n',"\n```"],
                    top_p:1,
                    n:1
                },
                abortController.signal,
            );
            const networkMs = (Date.now() - t5);
            this._log.info(`[GHOST] NETWORK finish=${response.finishReason} text=${response.text.length}ch usage=${JSON.stringify(response.usage)} [${networkMs}ms]`);
            this._log.debug(`[GHOST] raw_response="${this._trunc(response.text, 120)}"`);
            this._log.debug(`result\n ${response.text}`);

            // Step 9: Block trim
            const rawText = response.text;
            const blockTrimmedText = isSingleLine
                ? new TerseBlockTrimmer().trim(rawText)
                : new VerboseBlockTrimmer().trim(rawText);
            if (blockTrimmedText !== rawText) {
                this._log.debug(`[GHOST] block_trim ${rawText.length}→${blockTrimmedText.length}ch singleLine=${isSingleLine}`);
            }

            // Step 10: Character-level suffix overlap
            const charTrimmedText = this._trimCharOverlap(blockTrimmedText, suffix);
            if (charTrimmedText !== blockTrimmedText) {
                this._log.info(`[GHOST] char_trim removed="${this._trunc(blockTrimmedText.slice(charTrimmedText.length), 40)}"`);
            }

            // Step 11: Line-level suffix overlap
            const completionLines = charTrimmedText.split('\n');
            const suffixLines = suffix.split('\n');
            const overlapTrimmer = new TrimNESResponseSuffixOverlap(
                this._config.suffixOverlapThreshold,
                this._config.suffixOverlapType,
            );
            const lineOverlapCount = overlapTrimmer.calculateOverlap(completionLines, suffixLines);
            const trimmedLines = lineOverlapCount > 0
                ? completionLines.slice(0, completionLines.length - lineOverlapCount)
                : completionLines;
            if (lineOverlapCount > 0) {
                this._log.info(`[GHOST] line_trim overlap=${lineOverlapCount} lines`);
            }
            const trimmedText = trimmedLines.join('\n');

            const postTrimText = trimmedText.length > 0 ? trimmedText : charTrimmedText;

            // Step 12: Post-process (adjustLeadingWhitespace, displayText separation)
            const processed = this._postProcessChoiceInContext(
                { text: postTrimText, finishReason: response.finishReason },
                document,
                position,
            );

            // Step 13: Calculated suffix coverage
            const suffixCoverage = this._calcSuffixCoverage(processed.text, suffix);

            this._log.info(`[GHOST] RESULT resultType=Network final=${processed.text.length}ch result="${this._trunc(processed.text, 100)}" total=${Date.now() - t0}ms`);

            // Step 14: Cache & return
            const choices: CompletionChoice[] = [{
                text: processed.text,
                finishReason: response.finishReason,
            }];
            this._cache.append(prefix, suffix, choices[0]);

            return {
                completions: [this._toGhostCompletion(processed, document, position, isMiddleOfTheLine)],
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
