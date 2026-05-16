import * as vscode from 'vscode';
import { InstantiationServiceBuilder, SyncDescriptor } from './di/services';
import { IInstantiationService } from './di/instantiation';

// Config
import { IGhostConfigProvider, VSCodeGhostConfigProvider } from './config/ghostConfig';
import { INesConfigProvider, VSCodeNesConfigProvider } from './config/nesConfig';

// Shared
import { ILogService, LogService } from './completions/shared/log/logService';
import { ILLMAdapterManager, LLMAdapterManager } from './completions/shared/llm/llmAdapter';
import { OpenAIChatAdapter } from './completions/shared/llm/openaiChatAdapter';
import { OpenAIResponseAdapter } from './completions/shared/llm/openaiResponseAdapter';
import { AnthropicAdapter } from './completions/shared/llm/anthropicAdapter';
import { OpenAICompletionAdapter } from './completions/shared/llm/openaiCompletionAdapter';

// GHOST
import { IGhostPromptFactory, GhostPromptFactory } from './completions/ghost/promptFactory';
import { IGhostCompletionsCache, GhostCompletionsCache } from './completions/ghost/completionsCache';
import { IRecentEditsProvider, RecentEditsProvider } from './completions/ghost/recentEditsProvider';
import { IGhostTextProvider, GhostTextProvider } from './completions/ghost/ghostTextProvider';
import { IAsyncCompletionsManager, AsyncCompletionsManager } from './completions/ghost/asyncCompletions';

// NES
import { INesProvider, NextEditProvider } from './completions/nes/nextEditProvider';
import { INextEditCache, NextEditCache } from './completions/nes/nextEditCache';

// UI
import { IStatusBarPanel, StatusBarPanel } from './ui/statusBarPanel';

export function activate(context: vscode.ExtensionContext) {
    const logService = new LogService();
    logService.info('CC Completion activating...');

    // Build DI container
    const builder = new InstantiationServiceBuilder();

    // === Config (direct instances) ===
    const ghostConfig = new VSCodeGhostConfigProvider();
    const nesConfig = new VSCodeNesConfigProvider();
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

    // Re-register adapters on config change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('cc-completion.ghost.baseUrl') ||
                e.affectsConfiguration('cc-completion.ghost.apiKey') ||
                e.affectsConfiguration('cc-completion.nes.baseUrl') ||
                e.affectsConfiguration('cc-completion.nes.apiKey') ||
                e.affectsConfiguration('cc-completion.nes.supportedEndpoint')) {
                registerLLMAdapters(instantiationService, ghostConfig, nesConfig, logService);
            }
        }),
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
    llmManager.register('completions', new OpenAICompletionAdapter(
        ghostConfig.baseUrl,
        ghostConfig.apiKey,
        ghostConfig.model,
    ));
    log.debug('Registered GHOST adapter: completions');

    // NES: based on supportedEndpoint config
    const endpoint = nesConfig.supportedEndpoint;
    const { baseUrl, apiKey, model } = nesConfig;

    switch (endpoint) {
        case 'chat/completions':
            llmManager.register('chat/completions', new OpenAIChatAdapter(baseUrl, apiKey, model));
            break;
        case 'responses':
            llmManager.register('responses', new OpenAIResponseAdapter(baseUrl, apiKey, model));
            break;
        case 'messages':
            llmManager.register('messages', new AnthropicAdapter(baseUrl, apiKey, model));
            break;
    }
    log.debug(`Registered NES adapter: ${endpoint}`);
}

export function deactivate() {}
