import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError, normalizeBody } from './llmRequest';
import { readSSEStream } from './sseStream';
import { ILogService } from '../log/logService';

export class OpenAICompletionAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
        private readonly logService: ILogService,
        private readonly _defaultPresencePenalty: number = 1,
        private readonly _defaultFrequencyPenalty: number = 0.2,
        private readonly _defaultStream: boolean = true,
    ) {}

    async send(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
        this.logService.debug(`[OpenAI] Sending request | model=${this.model} | maxTokens=${request.max_tokens} | temperature=${request.temperature}`);

        const url = `${this.baseUrl}/completions`;
        const body = JSON.stringify({
            model: this.model,
            prompt: request.prompt || '',
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            top_p: request.top_p,
            n: request.n,
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
            this.logService.error(`[OpenAI] Request failed | status=${response.status} | error=${text}`);
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
            this.logService.debug(`[OpenAI] Streaming response complete | textLength=${text.length}`);
            return { text, finishReason };
        }
        const jsonResponse = this._parseJSON(await response.text());
        this.logService.debug(`[OpenAI] Response success | textLength=${jsonResponse.text.length} | finishReason=${jsonResponse.finishReason}`);
        return jsonResponse;
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
