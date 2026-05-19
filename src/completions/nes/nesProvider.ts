import * as vscode from 'vscode';
import { INesConfigProvider } from '../../config/nesConfig';
import { ILLMAdapterManager } from '../shared/llm/llmAdapter';
import { ILogService } from '../shared/log/logService';
import { INextEditCache } from './nextEditCache';
import { NextEditResult } from './types';
import { NesWorkflow } from './core/nesWorkflow';

/**
 * Thin wrapper around NesWorkflow for standalone NES calls.
 * NextEditProvider uses NesWorkflow directly.
 */
export class NesProvider {
    private readonly _workflow: NesWorkflow;

    constructor(
        @INesConfigProvider config: INesConfigProvider,
        @ILLMAdapterManager llmManager: ILLMAdapterManager,
        @ILogService log: ILogService,
        @INextEditCache cache: INextEditCache,
    ) {
        this._workflow = new NesWorkflow(config, llmManager, log, cache);
    }

    async provideNextEdit(
        document: vscode.TextDocument,
        position: vscode.Position,
        token?: vscode.CancellationToken,
    ): Promise<NextEditResult | undefined> {
        const { editResult } = await this._workflow.execute(document, position, token);
        return editResult;
    }
}
