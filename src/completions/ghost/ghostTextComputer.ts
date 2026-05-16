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
        isSpeculative: boolean = false,
    ): Promise<GhostTextResult | undefined> {
        const t0 = Date.now();
        const loc = `${document.uri.fsPath}:${position.line + 1}:${position.character + 1}`;
        this._log.info(`[GHOST] ===== START ${loc} speculative=${isSpeculative} =====`);

        // Step 1: Config check
        if (!this._config.enabled) {
            this._log.info(`[GHOST] SKIP ${loc} — disabled by config`);
            return undefined;
        }

        // Step 2: Extract prefix/suffix
        const t1 = Date.now();
        const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const suffix = document.getText(new vscode.Range(position, document.lineAt(document.lineCount - 1).range.end));
        this._log.debug(`[GHOST] ${loc} prefix=${prefix.length}ch suffix=${suffix.length}ch [${Date.now() - t1}ms]`);
        this._log.debug(`[GHOST] ${loc} prefix_tail="${this._trunc(prefix, 80)}"`);
        this._log.debug(`[GHOST] ${loc} suffix_head="${this._trunc(suffix, 80)}"`);

        // Step 3: Cache lookup
        const t2 = Date.now();
        const cached = this._cache.findAll(prefix, suffix);
        if (cached.length > 0) {
            this._log.info(`[GHOST] CACHE_HIT ${loc} count=${cached.length} [${Date.now() - t2}ms] total=${Date.now() - t0}ms`);
            return {
                completions: cached.map(c => this._toGhostCompletion(c)),
                resultType: ResultType.Cache,
                suffixCoverage: 0,
            };
        }
        this._log.debug(`[GHOST] ${loc} cache_miss [${Date.now() - t2}ms]`);

        // Step 4: Collect context
        const t3 = Date.now();
        const diagnostics = this._collectDiagnostics(document, position);
        this._log.debug(`[GHOST] ${loc} diagnostics=${diagnostics.length} recentEdits=${this._recentEdits.recentEdits.length} [${Date.now() - t3}ms]`);

        // Step 5: Build prompt
        const t4 = Date.now();
        const prompt = this._promptFactory.createPrompt({
            template: this._config.promptTemplate,
            prefix,
            suffix,
            languageId: document.languageId,
            diagnostics,
            recentEdits: this._recentEdits.recentEdits,
        });
        this._log.debug(`[GHOST] ${loc} prompt=${prompt.length}ch model=${this._config.model} template="${this._trunc(this._config.promptTemplate, 60)}" [${Date.now() - t4}ms]`);

        // Step 6: Determine strategy
        const isSingleLine = suffix.startsWith('\n') || suffix.startsWith('\r\n') || suffix.trim() === '';
        const maxTokens = this._config.maxOutputTokens;
        const effectiveTokens = Math.min(isSingleLine ? 64 : maxTokens, maxTokens);
        this._log.debug(`[GHOST] ${loc} strategy singleLine=${isSingleLine} tokens=${effectiveTokens}/${maxTokens}`);

        // Step 7: Network request
        const t5 = Date.now();
        const adapter = this._llmManager.getAdapter('/v1/completions');
        try {
            const response = await adapter.send({
                prompt,
                max_tokens: effectiveTokens,
                temperature: 0.2,
                stop: isSingleLine ? ['\n'] : undefined,
            });
            const networkMs = Date.now() - t5;
            this._log.info(`[GHOST] ${loc} NETWORK status=${response.finishReason} text=${response.text.length}ch usage=${JSON.stringify(response.usage)} [${networkMs}ms]`);
            this._log.debug(`[GHOST] ${loc} raw_response="${this._trunc(response.text, 120)}"`);

            // Step 8: Block trim
            const rawText = response.text;
            const blockTrimmedText = isSingleLine
                ? new TerseBlockTrimmer().trim(rawText)
                : new VerboseBlockTrimmer().trim(rawText);
            if (blockTrimmedText !== rawText) {
                this._log.debug(`[GHOST] ${loc} block_trim ${rawText.length}→${blockTrimmedText.length}ch singleLine=${isSingleLine}`);
            }

            // Step 9: Character-level suffix overlap trim
            const charTrimmedText = this._trimCharOverlap(blockTrimmedText, suffix);
            if (charTrimmedText !== blockTrimmedText) {
                this._log.info(`[GHOST] ${loc} char_trim ${blockTrimmedText.length}→${charTrimmedText.length}ch removed="${this._trunc(blockTrimmedText.slice(charTrimmedText.length), 40)}"`);
            }

            // Step 10: Line-level suffix overlap trim
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
                this._log.info(`[GHOST] ${loc} line_trim overlap=${lineOverlapCount} lines threshold=${this._config.suffixOverlapThreshold} type=${this._config.suffixOverlapType}`);
            }
            const trimmedText = trimmedLines.join('\n');

            const finalText = trimmedText.length > 0 ? trimmedText : charTrimmedText;
            this._log.info(`[GHOST] ${loc} RESULT resultType=Network final=${finalText.length}ch result="${this._trunc(finalText, 100)}" total=${Date.now() - t0}ms`);

            // Step 11: Cache & return
            const choices: CompletionChoice[] = [{
                text: finalText,
                finishReason: response.finishReason,
            }];
            this._cache.append(prefix, suffix, choices[0]);

            return {
                completions: choices.map(c => this._toGhostCompletion(c)),
                resultType: ResultType.Network,
                suffixCoverage: lineOverlapCount,
            };
        } catch (err) {
            this._log.error(`[GHOST] ${loc} ERROR after ${Date.now() - t0}ms: ${err}`);
            return undefined;
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

    private _toGhostCompletion(choice: CompletionChoice): GhostCompletion {
        return {
            completionIndex: 0,
            completionText: choice.text,
            displayText: choice.text,
            displayNeedsWsOffset: false,
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
