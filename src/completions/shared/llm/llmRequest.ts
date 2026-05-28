export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** Replace \r\n → \n before sending to LLM. LLMs handle \n consistently but \r\n support varies. */
export function normalizeBody(body: string): string {
    return body.replace(/\r\n/g, '\n');
}

export interface Capabilities {
    thinking?: boolean;
    reasoning_effort?: string;
}

export interface LLMRequest {
    model: string;
    baseUrl: string;
    apiKey: string; 
    family?: string;
    messages?: ChatMessage[];
    prompt?: string;
    max_tokens: number;
    temperature: number;
    n?: number;
    top_p?: number;
    stop?: string[];
    capabilities?: Capabilities;
    presence_penalty?: number;
    frequency_penalty?: number;
    stream?: boolean;
    suffix?: string;
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
