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
    n?: number;
    top_p?: number;
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

    toString(): string {
        const parts = [`${this.name}: ${this.message}`];
        if (this.statusCode !== undefined) parts.push(`status=${this.statusCode}`);
        if (this.responseBody) parts.push(`body=${this.responseBody}`);
        return parts.join(' ');
    }
}
