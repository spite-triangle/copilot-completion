// Adapted from platform/networking/node/stream.ts — splitChunk + SSE parsing pattern

export function splitChunk(chunk: string): [string[], string] {
    const dataLines = chunk.split('\n');
    const extra = dataLines.pop() || '';
    return [dataLines.filter(line => line !== ''), extra];
}

export interface SSEChunk {
    choices?: Array<{
        index: number;
        text?: string;
        delta?: { content: string | null };
        finish_reason?: string | null;
    }>;
    model?: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        input_tokens?: number;
        output_tokens?: number;
    };
    // Anthropic
    type?: string;
    delta?: { type?: string; text?: string; stop_reason?: string };
    message?: { usage?: { input_tokens: number; output_tokens: number } };
    // Responses API
    response?: {
        output?: Array<{ content?: Array<{ text?: string }> }>;
        usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
    };
}

export type TextAccumulator = {
    addCompletionText(chunk: SSEChunk): void;
    addChatDelta(chunk: SSEChunk): void;
    addAnthropicDelta(chunk: SSEChunk, result: { text: string; finishReason: string }): void;
    addResponseDelta(chunk: SSEChunk, result: { text: string }): void;
};

export async function readSSEStream(
    response: Response,
    signal: AbortSignal | undefined,
    onChunk: (chunk: SSEChunk) => void,
): Promise<void> {
    const stream = response.body!.pipeThrough(new TextDecoderStream());
    let extra = '';

    const reader = stream.getReader();
    try {
        while (true) {
            if (signal?.aborted) return;

            const { value: rawChunk, done } = await reader.read();
            if (done) break;
            const chunkStr = rawChunk ?? '';

            const [lines, remainder] = splitChunk(extra + chunkStr);
            extra = remainder;

            for (const line of lines) {
                if (line.startsWith(':')) continue;
                const data = line.slice('data:'.length).trim();
                if (data === '[DONE]') return;

                try {
                    const json = JSON.parse(data) as SSEChunk;
                    onChunk(json);
                } catch { /* skip malformed JSON */ }
            }
        }
    } finally {
        try { await reader.cancel(); } catch { /* ignore */ }
        try { await response.body?.cancel(); } catch { /* ignore */ }
    }
}
