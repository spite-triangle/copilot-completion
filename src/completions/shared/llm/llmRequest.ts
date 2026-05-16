export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface Capabilities {
    thinking?: boolean;
    reasoning_effort?: string;
}

export interface LLMRequest {
    messages?: ChatMessage[];
    prompt?: string;
    max_tokens: number;
    temperature: number;
    stop?: string[];
    capabilities?: Capabilities;
}

export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface LLMResponse {
    text: string;
    finishReason: string;
    usage?: TokenUsage;
}

export class LLMError extends Error {
    constructor(
        message: string,
        public readonly statusCode?: number,
        public readonly responseBody?: string,
    ) {
        super(message);
        this.name = 'LLMError';
    }
}
