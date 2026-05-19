import { ILogService } from '../log/logService';
import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError, normalizeBody } from './llmRequest';
import { readSSEStream } from './sseStream';

export class OpenAIChatAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
        private readonly _defaultPresencePenalty: number = 1,
        private readonly _defaultFrequencyPenalty: number = 0.2,
        private readonly _defaultStream: boolean = true,
    ) {}

    async send(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
        const url = `${this.baseUrl}/chat/completions`;
        const body = JSON.stringify({
            model: this.model,
            messages: request.messages || [],
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            presence_penalty: request.presence_penalty ?? this._defaultPresencePenalty,
            frequency_penalty: request.frequency_penalty ?? this._defaultFrequencyPenalty,
            stream: request.stream ?? this._defaultStream,
            ...(request.stop ? { stop: request.stop } : {}),
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
            throw new LLMError(`OpenAI chat request failed: ${response.status}`, response.status, text + body);
        }

        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) {
            let text = '';
            let finishReason = 'stop';
            await readSSEStream(response, signal, json => {
                const choice = json.choices?.[0];
                if (choice?.delta?.content) text += choice.delta.content;
                if (choice?.finish_reason) finishReason = choice.finish_reason;
            });
            return { text, finishReason };
        }
        return this._parseJSON(await response.text());
    }

    private _parseJSON(raw: string): LLMResponse {
        const json = JSON.parse(raw) as Record<string, unknown>;
        const choices = json.choices as Array<Record<string, unknown>>;
        const message = choices[0]?.message as Record<string, string> | undefined;
        return {
            text: message?.content || '',
            finishReason: choices[0]?.finish_reason as string || 'stop',
        };
    }
}
