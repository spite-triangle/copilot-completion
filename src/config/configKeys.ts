export const ConfigKeys = {
    Ghost: {
        enabled: 'cc-completion.ghost.enabled',
        baseUrl: 'cc-completion.ghost.baseUrl',
        apiKey: 'cc-completion.ghost.apiKey',
        model: 'cc-completion.ghost.model',
        promptTemplate: 'cc-completion.ghost.promptTemplate',
        maxOutputTokens: 'cc-completion.ghost.capabilities.limits.max_output_tokens',
        maxContextWindowTokens: 'cc-completion.ghost.capabilities.limits.max_context_window_tokens',
        delay: 'cc-completion.ghost.capabilities.limits.delay',
        suffixOverlapThreshold: 'cc-completion.ghost.suffixOverlapThreshold',
        suffixOverlapType: 'cc-completion.ghost.suffixOverlapType',
    },
    Nes: {
        enabled: 'cc-completion.nes.enabled',
        baseUrl: 'cc-completion.nes.baseUrl',
        apiKey: 'cc-completion.nes.apiKey',
        model: 'cc-completion.nes.model',
        supportedEndpoint: 'cc-completion.nes.supportedEndpoint',
        maxOutputTokens: 'cc-completion.nes.capabilities.limits.max_output_tokens',
        maxContextWindowTokens: 'cc-completion.nes.capabilities.limits.max_context_window_tokens',
        thinking: 'cc-completion.nes.capabilities.supports.thinking',
        reasoningEffort: 'cc-completion.nes.capabilities.supports.reasoning_effort',
        suffixOverlapThreshold: 'cc-completion.nes.suffixOverlapThreshold',
        suffixOverlapType: 'cc-completion.nes.suffixOverlapType',
    }
} as const;
