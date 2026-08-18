import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError, normalizeBody } from './llmRequest';
import { readSSEStream, splitChunk, SSEChunk } from './sseStream';
import { ILogService } from '../log/logService';

export class OpenAIFimCompletionAdapter implements ILLMAdapter {
    constructor(
        private readonly logService: ILogService,
    ) {}

    async send(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
        this.logService.debug(`[OpenAI-FIM] Sending request | model=${request.model} | maxTokens=${request.max_tokens}`);

        const url = `${request.baseUrl}/fim/completions`;

        const bodyObj: Record<string, unknown> = {
            model: request.model,
            prompt: request.prompt || '',
            suffix: request.suffix || '',
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            top_p: request.top_p,
            n: request.n,
            presence_penalty: request.presence_penalty,
            frequency_penalty: request.frequency_penalty,
            stream: request.stream,
            stop: request.stop,
        };

        const body = JSON.stringify(bodyObj);
        const response = await fetch(url, {
            method: 'POST',
            signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${request.apiKey}`,
            },
            body: normalizeBody(body),
        });

        if (!response.ok) {
            const text = await response.text();
            this.logService.error(`[OpenAI-FIM] Request failed | status=${response.status} | error=${text}`);
            throw new LLMError(`OpenAI fim/completions API failed: ${response.status}`, response.status, text + body);
        }

        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) {
            let text = '';
            let finishReason = 'stop';
            await readSSEStream(response, signal, json => {
                const choice = json.choices?.[0];
                const content = this._extractContent(choice as Record<string, unknown> | undefined);
                if (content) text += content;
                if (choice?.finish_reason) finishReason = choice.finish_reason;
            });
            this.logService.debug(`[OpenAI-FIM] Streaming response complete | textLength=${text.length}`);
            return { text, finishReason };
        }
        const jsonResponse = this._parseJSON(await response.text());
        this.logService.debug(`[OpenAI-FIM] Response success | textLength=${jsonResponse.text.length} | finishReason=${jsonResponse.finishReason}`);
        return jsonResponse;
    }

   async *sendStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<string, LLMResponse> {
        this.logService.debug(`[OpenAI-FIM] Streaming request | model=${request.model} | maxTokens=${request.max_tokens}`);

        const url = `${request.baseUrl}/fim/completions`;

        const bodyObj: Record<string, unknown> = {
            model: request.model,
            prompt: request.prompt || '',
            suffix: request.suffix || '',
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            top_p: request.top_p,
            n: request.n,
            presence_penalty: request.presence_penalty,
            frequency_penalty: request.frequency_penalty,
            stream: true,   // sendStream() 始终强制流式，忽略 request.stream 的值
            stop: request.stop,
        };

        const body = JSON.stringify(bodyObj);

        const response = await fetch(url, {
            method: 'POST', signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${request.apiKey}`,
            },
            body: normalizeBody(body),
        });
        if (!response.ok) {
            const text = await response.text();
            this.logService.error(`[OpenAI-FIM] Request failed | status=${response.status} | error=${text}`);
            throw new LLMError(`OpenAI fim/completions API failed: ${response.status}`, response.status, text + body);
        }

        const ct = response.headers.get('content-type') || '';
        // 非 SSE 回退：读取完整响应，yield 一次
        if (!ct.includes('text/event-stream')) {
            const jsonResponse = this._parseJSON(await response.text());
            yield jsonResponse.text;
            return jsonResponse;
        }

        // 真 SSE 流式：逐 token 输出（choices[0].text 增量，与 /completions 一致）
        let fullText = '';
        let finishReason = 'stop';
        const stream = response.body!.pipeThrough(new TextDecoderStream());
        const reader = stream.getReader();
        let extra = '';
        try {
            while (true) {
                if (signal?.aborted) {
                    return { text: fullText, finishReason };
                }
                const { value: rawChunk, done } = await reader.read();
                if (done) break;
                const chunkStr = rawChunk ?? '';
                const [lines, remainder] = splitChunk(extra + chunkStr);
                extra = remainder;
                for (const line of lines) {
                    if (line.startsWith(':')) continue;
                    const data = line.slice('data:'.length).trim();
                    if (data === '[DONE]') {
                        return { text: fullText, finishReason };
                    }
                    try {
                        const json = JSON.parse(data) as SSEChunk;
                        const choice = json.choices?.[0];
                        const cumulative = this._extractContent(choice as Record<string, unknown> | undefined);
                        if (cumulative) {
                            fullText += cumulative;
                            yield cumulative;
                        }
                        if (choice?.finish_reason) finishReason = choice.finish_reason;
                    } catch { /* skip malformed JSON */ }
                }
            }
        } finally {
            try { await reader.cancel(); } catch { /* ignore */ }
            try { await response.body?.cancel(); } catch { /* ignore */ }
        }
        return { text: fullText, finishReason };
    }

    private _extractContent(choice?: Record<string, unknown>): string {
        const message = choice?.message as { content?: unknown } | undefined;
        if (typeof message?.content === 'string' && message.content) return message.content;
        const text = choice?.text;
        if (typeof text === 'string' && text) return text;
        const delta = choice?.delta as { content?: unknown } | undefined;
        if (typeof delta?.content === 'string' && delta.content) return delta.content;
        return '';
    }

    private _parseJSON(raw: string): LLMResponse {
        const json = JSON.parse(raw) as Record<string, unknown>;
        const choices = json.choices as Array<Record<string, unknown>>;
        return {
            text: this._extractContent(choices[0]),
            finishReason: choices[0]?.finish_reason as string || 'stop',
        };
    }
}