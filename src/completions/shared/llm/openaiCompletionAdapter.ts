import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError } from './llmRequest';
import { readSSEStream } from './sseStream';

export class OpenAICompletionAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
    ) {}

    async send(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
        const url = `${this.baseUrl}/completions`;
        const body = JSON.stringify({
            model: this.model,
            prompt: request.prompt || '',
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            top_p: request.top_p,
            n:request.n,
            stream: true,
            ...(request.stop ? { stop: request.stop } : {}),
        });

        const response = await fetch(url, {
            method: 'POST',
            signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body,
        });

        if (!response.ok) {
            const text = await response.text();
            throw new LLMError(`OpenAI completions API failed: ${response.status}`, response.status, text + body);
        }

        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) {
            let text = '';
            let finishReason = 'stop';
            await readSSEStream(response, signal, json => {
                const choice = json.choices?.[0];
                if (choice?.text) text += choice.text;
                if (choice?.finish_reason) finishReason = choice.finish_reason;
            });
            return { text, finishReason };
        }
        return this._parseJSON(await response.text());
    }

    private _parseJSON(raw: string): LLMResponse {
        const json = JSON.parse(raw) as Record<string, unknown>;
        const choices = json.choices as Array<Record<string, unknown>>;
        return {
            text: choices[0]?.text as string || '',
            finishReason: choices[0]?.finish_reason as string || 'stop',
        };
    }
}
