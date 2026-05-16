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
        if (!this._config.enabled) {
            this._log.debug('GHOST is disabled, skipping');
            return undefined;
        }

        const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const suffix = document.getText(new vscode.Range(position, document.lineAt(document.lineCount - 1).range.end));

        const cached = this._cache.findAll(prefix, suffix);
        if (cached.length > 0) {
            this._log.debug('GHOST: cache hit');
            return {
                completions: cached.map(c => this._toGhostCompletion(c)),
                resultType: ResultType.Cache,
                suffixCoverage: 0,
            };
        }

        const diagnostics = this._collectDiagnostics(document, position);

        const prompt = this._promptFactory.createPrompt({
            template: this._config.promptTemplate,
            prefix,
            suffix,
            languageId: document.languageId,
            diagnostics,
            recentEdits: this._recentEdits.recentEdits,
        });

        const isSingleLine = suffix.startsWith('\n') || suffix.startsWith('\r\n') || suffix.trim() === '';
        const maxTokens = this._config.maxOutputTokens;
        const effectiveTokens = Math.min(isSingleLine ? 64 : maxTokens, maxTokens);

        const adapter = this._llmManager.getAdapter('/v1/completions');
        try {
            const response = await adapter.send({
                prompt,
                max_tokens: effectiveTokens,
                temperature: 0.2,
                stop: isSingleLine ? ['\n'] : undefined,
            });

            const trimmedText = isSingleLine
                ? new TerseBlockTrimmer().trim(response.text)
                : new VerboseBlockTrimmer().trim(response.text);

            const choices: CompletionChoice[] = [{
                text: trimmedText,
                finishReason: response.finishReason,
            }];
            this._cache.append(prefix, suffix, choices[0]);

            return {
                completions: choices.map(c => this._toGhostCompletion(c)),
                resultType: ResultType.Network,
                suffixCoverage: 0,
            };
        } catch (err) {
            this._log.error(`GHOST request failed: ${err}`);
            return undefined;
        }
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
}
