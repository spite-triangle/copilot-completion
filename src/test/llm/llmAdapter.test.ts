import * as assert from 'assert';
import { LLMAdapterManager } from '../../completions/shared/llm/llmAdapter';
import { LLMResponse } from '../../completions/shared/llm/llmRequest';

suite('LLMAdapterManager', () => {
    test('should register and retrieve adapter', () => {
        const manager = new LLMAdapterManager();
        const mockAdapter = {
            send: async (_req: any): Promise<LLMResponse> => ({ text: 'test', finishReason: 'stop' }),
        };
        manager.register('/chat/completions', mockAdapter);
        const retrieved = manager.getAdapter('/chat/completions');
        assert.strictEqual(retrieved, mockAdapter);
    });

    test('should throw for unregistered endpoint', () => {
        const manager = new LLMAdapterManager();
        assert.throws(() => manager.getAdapter('/responses'));
    });

    test('should replace adapter for same endpoint', () => {
        const manager = new LLMAdapterManager();
        const adapter1 = { send: async (_req: any): Promise<LLMResponse> => ({ text: 'a', finishReason: 'stop' }) };
        const adapter2 = { send: async (_req: any): Promise<LLMResponse> => ({ text: 'b', finishReason: 'stop' }) };
        manager.register('/v1/messages', adapter1);
        manager.register('/v1/messages', adapter2);
        assert.strictEqual(manager.getAdapter('/v1/messages'), adapter2);
    });
});
