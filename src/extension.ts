import * as vscode from 'vscode';
import { InstantiationServiceBuilder, SyncDescriptor, ICurrentGhostText, ILastGhostText } from './di/services';
import { IInstantiationService } from './di/instantiation';

// Config
import { IGhostConfigProvider, VSCodeGhostConfigProvider } from './config/ghostConfig';
import { INesConfigProvider, VSCodeNesConfigProvider } from './config/nesConfig';

// Shared
import { ILogService, LogService } from './completions/shared/log/logService';
import { ILLMAdapterManager, LLMAdapterManager } from './completions/shared/llm/llmAdapter';
import { OpenAIChatCompletionAdapter } from './completions/shared/llm/openaiChatCompletionAdapter';
import { OpenAIResponseAdapter } from './completions/shared/llm/openaiResponseAdapter';
import { AnthropicAdapter } from './completions/shared/llm/anthropicAdapter';
import { OpenAICompletionAdapter } from './completions/shared/llm/openaiCompletionAdapter';

// GHOST
import { IGhostPromptFactory, GhostPromptFactory } from './completions/ghost/promptFactory';
import { IGhostCompletionsCache, GhostCompletionsCache } from './completions/ghost/completionsCache';
import { IRecentEditsProvider, RecentEditsProvider } from './completions/ghost/recentEditsProvider';
import { IGhostTextProvider, GhostTextProvider } from './completions/ghost/ghostTextProvider';
import { CurrentGhostText, LastGhostText } from './completions/ghost/ghostTextState';
import { IAsyncCompletionsManager, AsyncCompletionsManager } from './completions/ghost/asyncCompletions';
import { IMultilineStrategy } from './completions/ghost/multiline/types';
import { DefaultMultilineStrategy } from './completions/ghost/multiline/DefaultMultilineStrategy';
import { setWasmDirPath } from './completions/ghost/multiline/treeSitter/fileLoader';

// NES
import { INesProvider, NextEditProvider } from './completions/nes/nextEditProvider';
import { INextEditCache, NextEditCache } from './completions/nes/nextEditCache';

// UI
import { IStatusBarPanel, StatusBarPanel } from './ui/statusBarPanel';

export function activate(context: vscode.ExtensionContext) {
    const logService = new LogService();
    logService.info('CC Completion activating...');

    // Initialize WASM path for tree-sitter
    setWasmDirPath(context.extensionUri.fsPath);

    // Build DI container
    const builder = new InstantiationServiceBuilder();

    // === Config (direct instances, with context for workspaceState) ===
    const ghostConfig = new VSCodeGhostConfigProvider(context);
    const nesConfig = new VSCodeNesConfigProvider(context);
    builder.define(IGhostConfigProvider, ghostConfig);
    builder.define(INesConfigProvider, nesConfig);

    // === Shared ===
    builder.define(ILogService, logService);
    builder.define(ILLMAdapterManager, new LLMAdapterManager());

    // === GHOST services ===
    builder.define(IGhostPromptFactory, new SyncDescriptor(GhostPromptFactory));
    builder.define(IGhostCompletionsCache, new SyncDescriptor(GhostCompletionsCache));
    builder.define(IRecentEditsProvider, new SyncDescriptor(RecentEditsProvider));
    builder.define(IAsyncCompletionsManager, new SyncDescriptor(AsyncCompletionsManager));
    builder.define(IGhostTextProvider, new SyncDescriptor(GhostTextProvider));
    builder.define(IMultilineStrategy, new SyncDescriptor(DefaultMultilineStrategy));
    builder.define(ICurrentGhostText, new SyncDescriptor(CurrentGhostText));
    builder.define(ILastGhostText, new SyncDescriptor(LastGhostText));

    // === NES services ===
    builder.define(INextEditCache, new SyncDescriptor(NextEditCache));
    builder.define(INesProvider, new SyncDescriptor(NextEditProvider));

    // === UI ===
    builder.define(IStatusBarPanel, new SyncDescriptor(StatusBarPanel));

    // Seal
    const instantiationService = builder.seal();
    context.subscriptions.push(instantiationService);

    // Register LLM adapters
    registerLLMAdapters(instantiationService, ghostConfig, nesConfig, logService);

    // Activate providers
    const ghostProvider = instantiationService.createInstance(GhostTextProvider);
    const nesProvider = instantiationService.createInstance(NextEditProvider);
    const statusBar = instantiationService.createInstance(StatusBarPanel);

    context.subscriptions.push(
        ghostProvider.register(),
        nesProvider.register(),
        statusBar.register(),
    );

    logService.info('CC Completion activated');
}

function registerLLMAdapters(
    is: IInstantiationService,
    ghostConfig: IGhostConfigProvider,
    nesConfig: INesConfigProvider,
    log: ILogService,
): void {
    const llmManager = is.invokeFunction(accessor =>
        accessor.get(ILLMAdapterManager),
    );

    // GHOST: always completions
    llmManager.register('completions', new OpenAICompletionAdapter(log));
    log.debug('Registered GHOST adapter: completions');

    // NES: based on supportedEndpoint config
    const endpoint = nesConfig.supportedEndpoint;
    const { baseUrl, apiKey, model } = nesConfig;

    switch (endpoint) {
        case 'chat/completions':
            llmManager.register('chat/completions', new OpenAIChatCompletionAdapter());
            break;
        // TODO - support other endpoints like 'responses' and 'messages' once we have a use case for them
        // case 'responses':
        //     llmManager.register('responses', new OpenAIResponseAdapter(
        //         baseUrl, apiKey, model,
        //         nesConfig.presencePenalty,
        //         nesConfig.frequencyPenalty,
        //         nesConfig.stream,
        //     ));
        //     break;
        // case 'messages':
        //     llmManager.register('messages', new AnthropicAdapter(
        //         baseUrl, apiKey, model,
        //         nesConfig.stream,
        //     ));
        //     break;
    }
    log.debug(`Registered NES adapter: ${endpoint}`);
}

export function deactivate() {}
