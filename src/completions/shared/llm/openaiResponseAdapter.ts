import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError, normalizeBody } from './llmRequest';
import { readSSEStream } from './sseStream';

export class OpenAIResponseAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
        private readonly _defaultPresencePenalty: number = 1,
        private readonly _defaultFrequencyPenalty: number = 0.2,
        private readonly _defaultStream: boolean = true,
    ) {}

    async send(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
        const url = `${this.baseUrl}/responses`;
        const input = (request.messages || []).map(m => ({ role: m.role, content: m.content }));
        const body = JSON.stringify({
            model: this.model,
            input,
            max_output_tokens: request.max_tokens,
            temperature: request.temperature,
            presence_penalty: request.presence_penalty ?? this._defaultPresencePenalty,
            frequency_penalty: request.frequency_penalty ?? this._defaultFrequencyPenalty,
            stream: request.stream ?? this._defaultStream,
        });

        const response = await fetch(url, {
            method: 'POST',
            signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: normalizeBody(body),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new LLMError(`OpenAI responses API failed: ${response.status}`, response.status, text);
        }

        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) {
            let text = '';
            await readSSEStream(response, signal, json => {
                if (json.type === 'response.output_text.delta' && json.delta) {
                    text += (json.delta as unknown as { text?: string })?.text || (json.delta as unknown as string) || '';
                } else if (json.type === 'response.completed' && json.response) {
                    const output = json.response.output?.[0];
                    const content = output?.content?.[0];
                    if (content?.text && !text) text = content.text;
                }
            });
            return { text, finishReason: 'stop' };
        }
        return this._parseJSON(await response.text());
    }

    private _parseJSON(raw: string): LLMResponse {
        const json = JSON.parse(raw) as Record<string, unknown>;
        const output = (json.output as Array<Record<string, unknown>>)?.[0];
        const content = (output?.content as Array<Record<string, unknown>>)?.[0];
        return { text: content?.text as string || '', finishReason: 'stop' };
    }
}
