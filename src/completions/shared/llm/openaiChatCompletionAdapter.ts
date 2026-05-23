import { ILogService } from '../log/logService';
import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError, Capabilities, normalizeBody } from './llmRequest';
import { readSSEStream, splitChunk, SSEChunk } from './sseStream';

export class OpenAIChatCompletionAdapter implements ILLMAdapter {

    async *sendStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<string, LLMResponse> {
        const url = `${request.baseUrl}/chat/completions`;
        const bodyObj: Record<string, unknown> = {
            model: request.model,
            messages: request.messages || [],
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            presence_penalty: request.presence_penalty,
            frequency_penalty: request.frequency_penalty,
            stream: request.stream,
            stop: request.stop,
            top_p: request.top_p,
            n: request.n,
        };

        applyThinkingParams(bodyObj, request.capabilities, request.family);

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
            throw new LLMError(`OpenAI chat request failed: ${response.status}`, response.status, text + body);
        }

        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) {
            let text = '';
            let finishReason = 'stop';
            const stream = response.body!.pipeThrough(new TextDecoderStream());
            const reader = stream.getReader();
            let extra = '';
            try {
                while (true) {
                    if (signal?.aborted) {
                        return { text, finishReason };
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
                            return { text, finishReason };
                        }
                        try {
                            const json = JSON.parse(data) as SSEChunk;
                            const choice = json.choices?.[0];
                            if (choice?.delta?.content) {
                                text += choice.delta.content;
                                yield choice.delta.content;
                            }
                            if (choice?.finish_reason) finishReason = choice.finish_reason;
                        } catch { /* skip malformed JSON */ }
                    }
                }
            } finally {
                try { await reader.cancel(); } catch { /* ignore */ }
                try { await response.body?.cancel(); } catch { /* ignore */ }
            }
            return { text, finishReason };
        }
        // Non-streaming fallback: yield full text, return the response
        const result = this._parseJSON(await response.text());
        yield result.text;
        return result;
    }

    async send(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
        const url = `${request.baseUrl}/chat/completions`;
        const bodyObj: Record<string, unknown> = {
            model: request.model,
            messages: request.messages || [],
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            presence_penalty: request.presence_penalty,
            frequency_penalty: request.frequency_penalty,
            stream: request.stream,
            stop: request.stop,
            top_p: request.top_p,
            n: request.n,
        };

        applyThinkingParams(bodyObj, request.capabilities,request.family);

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

function applyThinkingParams(
    body: Record<string, unknown>,
    capabilities?: Capabilities,
    family?: string,
): void {
    if(family === undefined) return;

    if (capabilities?.thinking) {
        switch (family) {
            case 'deepseek':
                body.enable_thinking = capabilities?.thinking === true;
                break;
            case 'qwen':
                body.enable_thinking = capabilities?.thinking === true;
                break;
        }
    }

    if(capabilities?.reasoning_effort){
        const effort = (capabilities?.reasoning_effort as string) || 'medium'; 
        switch (family) {
            case 'openai-o':
                body.reasoning_effort = effort;
                break;
            case 'openai-gpt5':
                body.reasoning = { effort };
                break;
        }
    }

}

export { applyThinkingParams };
