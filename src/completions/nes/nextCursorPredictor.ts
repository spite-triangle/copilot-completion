import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { ILLMAdapterManager } from '../shared/llm/llmAdapter';
import { LLMResponse } from '../shared/llm/llmRequest';
import { INesConfigProvider } from '../../config/nesConfig';
import { ILogService } from '../shared/log/logService';
import { renderCompletionPrompt } from './promptCraftingUtils';
import { PromptingStrategy, IncludeLineNumbersOption, PromptOptions, LintOptionWarning, LintOptionShowCode } from './stubs/types';
import { constructTaggedFile, getUserPrompt, PromptPieces } from './promptCrafting';
import { OffsetRange } from './stubs/offsetRange';
import { Result } from '../../common/result';


export class NextCursorPredictor {
    private static readonly NCP_SYSTEM_PROMPT =
        'Your task is to predict the line number where the developer is most likely to make their next edit. If you jump in the current file, just output the line number. If you don\'t think anywhere is a good next line jump target, just output the current line number of the cursor. Make sure to output no explanation, reasoning, extra spaces, etc.';

    private _isDisabled = false;

    constructor(
        @IInstantiationService private readonly _instaService: IInstantiationService,
        @INesConfigProvider private readonly _config: INesConfigProvider,
        @ILLMAdapterManager private readonly _llmManager: ILLMAdapterManager,
        @ILogService private readonly _log: ILogService,
    ) {}

    isEnabled(): boolean {
        if (this._isDisabled) {
            return false;
        }
        return this._config.nextCursorPredictionEnabled;
    }

    async predict(
        promptPieces: PromptPieces,
        token?: vscode.CancellationToken,
    ): Promise<Result<number, string>> {
        const computeTokens = (s: string) => Math.floor(s.length / 4);

        promptPieces.opts.lintOptions.enable = true;

        const taggedR = constructTaggedFile(
            promptPieces.currentDocument,
            promptPieces.editWindowLinesRange,
            promptPieces.areaAroundEditWindowLinesRange,
            {
                ...promptPieces.opts,
                currentFile: {
                    ...promptPieces.opts.currentFile,
                    maxTokens: 4000,
                    includeTags: false,
                },
                includePostScript: false,
            },
            computeTokens,
            {
                includeLineNumbers: {
                    areaAroundCodeToEdit: IncludeLineNumbersOption.None,
                    currentFileContent: IncludeLineNumbersOption.WithSpaceAfter,
                },
            },
            true
        );

        if (taggedR.isError()) {
            this._log.debug(`[NCP] prompt too large`);
            return Result.error('promptTooLarge');
        }

        const { clippedTaggedCurrentDoc, areaAroundCodeToEdit } = taggedR.val;

        const promptOptions: PromptOptions = {
            promptingStrategy: PromptingStrategy.Xtab275,
            includePostScript: false,
            includeEditCode: false,
            recentlyViewedDocuments: { maxTokens: 2000, nDocuments: 10, includeViewedFiles: true, clippingStrategy: 'TopToBottom' as any, includeLineNumbers: IncludeLineNumbersOption.None },
            currentFile: { includeCursorTag: true, includeLineNumbers: IncludeLineNumbersOption.None, maxTokens: 4000, prioritizeAboveCursor: true, includeTags: false },
            languageContext: { maxTokens: 2000, traitPosition: 'before' },
            lintOptions: { enable: true, tagName: 'diagnostics', warnings: LintOptionWarning.NO, showCode: LintOptionShowCode.NO, maxLints: 10, maxLineDistance: 50, nRecentFiles: 3 },
            neighborFiles: { enabled: false, maxTokens: 2000 },
            pagedClipping: { pageSize: 50 },
            diffHistory: { onlyForDocsInPrompt: true, maxTokens: 2000, nEntries: 15, useRelativePaths: true },
        };

        const newPromptPieces = new PromptPieces(
            promptPieces.currentDocument,
            promptPieces.editWindowLinesRange,
            promptPieces.areaAroundEditWindowLinesRange,
            promptPieces.activeDoc,
            promptPieces.xtabHistory,
            clippedTaggedCurrentDoc.lines,
            areaAroundCodeToEdit,
            promptPieces.langCtx,
            promptPieces.aggressivenessLevel,
            promptPieces.lintErrors,
            computeTokens,
            promptOptions
        );

        const { prompt: userMessage } = getUserPrompt(newPromptPieces);

        try {
            const endpoint = this._config.supportedEndpoint;
            const adapter = this._llmManager.getAdapter(endpoint);
            const abortController = new AbortController();
            const cancelListener = token?.onCancellationRequested(() => abortController.abort());

            const requestBase = {
                baseUrl: this._config.baseUrl,
                apiKey: this._config.apiKey,
                model: this._config.model,
                family: this._config.family,
                max_tokens: this._config.maxOutputTokens,
                temperature: 0,
                n: 1,
                presence_penalty: this._config.presencePenalty,
                frequency_penalty: this._config.frequencyPenalty,
            };

            const userMsgWithHint = userMessage + '\n\n **just output the line int number where the developer will make their next edit.**';
            let response: LLMResponse;
            if (endpoint === 'completions') {
                const prompt = renderCompletionPrompt(
                    this._config.promptTemplate,
                    NextCursorPredictor.NCP_SYSTEM_PROMPT,
                    userMsgWithHint,
                );
                
                this._log.debug(`completions prompt\n ${prompt}`);
                response = await adapter.send(
                    { ...requestBase, prompt },
                    abortController.signal,
                );
            } else {
                this._log.debug(`chat/completions prompt\n ${userMsgWithHint}`);
                response = await adapter.send(
                    {
                        ...requestBase,
                        messages: [
                            { role: 'system', content: NextCursorPredictor.NCP_SYSTEM_PROMPT },
                            { role: 'user', content: userMsgWithHint },
                        ],
                    },
                    abortController.signal,
                );
            }

            cancelListener?.dispose();

            if (response.text.trim() === '') {
                return Result.error('emptyResponse');
            }
            this._log.info(`predict next line: ${response.text}`);

            const lineNumber = parseInt(response.text.trim(), 10);
            if(isNaN(lineNumber) || lineNumber < 0){
                return Result.error('line number is not positive number');
            }

            return Result.ok(lineNumber);
        } catch (err: unknown) {
            if ((err as { name?: string })?.name === 'AbortError') {
                return Result.error('aborted');
            }
            this._log.error(`[NCP] ERROR: ${err}`);

            // Disable for session on 404/not-found
            const msg = String(err);
            if (msg.includes('404') || msg.includes('not found') || msg.includes('NotFound')) {
                this._isDisabled = true;
                this._log.info(`[NCP] disabled for session due to endpoint error`);
            }
            return Result.error(`fetchError:${msg}`);
        }
    }
}
