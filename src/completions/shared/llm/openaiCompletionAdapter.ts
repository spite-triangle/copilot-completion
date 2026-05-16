import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError } from './llmRequest';

export class OpenAICompletionAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
    ) {}

    async send(request: LLMRequest): Promise<LLMResponse> {
        const url = `${this.baseUrl}/v1/completions`;
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
            throw new LLMError(`OpenAI completions API failed: ${response.status}`, response.status, text);
        }
        const json = await response.json() as Record<string, unknown>;
        return this.parseResponse(json);
    }

    buildBody(request: LLMRequest): string {
        const body: Record<string, unknown> = {
            model: this.model,
            prompt: request.prompt || '',
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
        const usage = json.usage as Record<string, number> | undefined;
        return {
            text: choice.text as string,
            finishReason: choice.finish_reason as string,
            usage: usage ? {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
            } : undefined,
        };
    }
}
