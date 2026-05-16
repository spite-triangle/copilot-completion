import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError } from './llmRequest';

export class AnthropicAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
    ) {}

    async send(request: LLMRequest): Promise<LLMResponse> {
        const url = `${this.baseUrl}/v1/messages`;
        const body = this.buildBody(request);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new LLMError(`Anthropic API failed: ${response.status}`, response.status, text);
        }
        const json = await response.json() as Record<string, unknown>;
        return this.parseResponse(json);
    }

    buildBody(request: LLMRequest): string {
        const messages = request.messages || [];
        let system: string | undefined;
        const userMessages = messages.filter(m => {
            if (m.role === 'system') {
                system = m.content;
                return false;
            }
            return true;
        });
        const body: Record<string, unknown> = {
            model: this.model,
            messages: userMessages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: false,
        };
        if (system) { body.system = system; }
        if (request.stop) { body.stop_sequences = request.stop; }
        return JSON.stringify(body);
    }

    parseResponse(json: Record<string, unknown>): LLMResponse {
        const content = (json.content as Array<Record<string, unknown>>)[0];
        const usage = json.usage as Record<string, number> | undefined;
        return {
            text: content.text as string,
            finishReason: json.stop_reason as string,
            usage: usage ? {
                prompt_tokens: usage.input_tokens,
                completion_tokens: usage.output_tokens,
                total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
            } : undefined,
        };
    }
}
