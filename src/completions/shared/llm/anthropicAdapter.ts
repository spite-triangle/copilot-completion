import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError } from './llmRequest';
import { readSSEStream } from './sseStream';

export class AnthropicAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
    ) {}

    async send(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
        const url = `${this.baseUrl}/messages`;
        const messages = request.messages || [];
        let system: string | undefined;
        const userMessages = messages.filter(m => {
            if (m.role === 'system') { system = m.content; return false; }
            return true;
        });

        const bodyObj: Record<string, unknown> = {
            model: this.model,
            messages: userMessages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: true,
        };
        if (system) bodyObj.system = system;
        if (request.stop) bodyObj.stop_sequences = request.stop;

        const response = await fetch(url, {
            method: 'POST',
            signal,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(bodyObj),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new LLMError(`Anthropic API failed: ${response.status}`, response.status, text);
        }

        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) {
            let text = '';
            let finishReason = 'stop';
            await readSSEStream(response, signal, json => {
                if (json.type === 'content_block_delta') {
                    const d = json.delta;
                    if (d?.type === 'text_delta' && d.text) text += d.text;
                } else if (json.type === 'message_delta') {
                    if (json.delta?.stop_reason) finishReason = json.delta.stop_reason;
                }
            });
            return { text, finishReason };
        }
        return this._parseJSON(await response.text());
    }

    private _parseJSON(raw: string): LLMResponse {
        const json = JSON.parse(raw) as Record<string, unknown>;
        const content = (json.content as Array<Record<string, unknown>>)?.[0];
        return {
            text: content?.text as string || '',
            finishReason: json.stop_reason as string || 'stop',
        };
    }
}
