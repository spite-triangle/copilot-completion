import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError } from './llmRequest';

export class OpenAIResponseAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
    ) {}

    async send(request: LLMRequest): Promise<LLMResponse> {
        const url = `${this.baseUrl}/v1/responses`;
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
            throw new LLMError(`OpenAI responses API failed: ${response.status}`, response.status, text);
        }
        const json = await response.json() as Record<string, unknown>;
        return this.parseResponse(json);
    }

    buildBody(request: LLMRequest): string {
        const input = (request.messages || []).map(m => ({
            role: m.role,
            content: m.content,
        }));
        const body: Record<string, unknown> = {
            model: this.model,
            input,
            max_output_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: false,
        };
        return JSON.stringify(body);
    }

    parseResponse(json: Record<string, unknown>): LLMResponse {
        const output = (json.output as Array<Record<string, unknown>>)[0];
        const content = (output.content as Array<Record<string, unknown>>)[0];
        return {
            text: content.text as string,
            finishReason: 'stop',
            usage: json.usage ? {
                prompt_tokens: (json.usage as Record<string, number>).input_tokens,
                completion_tokens: (json.usage as Record<string, number>).output_tokens,
                total_tokens: (json.usage as Record<string, number>).total_tokens,
            } : undefined,
        };
    }
}
