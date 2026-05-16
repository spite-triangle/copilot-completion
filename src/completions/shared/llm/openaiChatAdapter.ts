import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError } from './llmRequest';

export class OpenAIChatAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
    ) {}

    async send(request: LLMRequest): Promise<LLMResponse> {
        const url = `${this.baseUrl}/v1/chat/completions`;
        const body = this.buildBody(request);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new LLMError(`OpenAI chat request failed: ${response.status}`, response.status, text);
        }
        const json = await response.json() as Record<string, unknown>;
        return this.parseResponse(json);
    }

    buildBody(request: LLMRequest): string {
        const body: Record<string, unknown> = {
            model: this.model,
            messages: request.messages || [],
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: false,
        };
        if (request.stop) { body.stop = request.stop; }
        return JSON.stringify(body);
    }

    parseResponse(json: Record<string, unknown>): LLMResponse {
        const choices = json.choices as Array<Record<string, unknown>>;
        const choice = choices[0];
        const message = choice.message as Record<string, string>;
        return {
            text: message.content,
            finishReason: choice.finish_reason as string,
            usage: json.usage ? {
                prompt_tokens: (json.usage as Record<string, number>).prompt_tokens,
                completion_tokens: (json.usage as Record<string, number>).completion_tokens,
                total_tokens: (json.usage as Record<string, number>).total_tokens,
            } : undefined,
        };
    }
}
