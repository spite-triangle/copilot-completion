import * as assert from 'assert';
import { OpenAIChatAdapter, applyThinkingParams } from '../../completions/shared/llm/openaiChatAdapter';
import { Capabilities } from '../../completions/shared/llm/llmRequest';

suite('OpenAIChatAdapter', () => {

    test('should construct with correct URL path', () => {
        const adapter = new OpenAIChatAdapter('http://127.0.0.1:8080/v1', 'sk-test', 'gpt-4o');
        assert.ok(adapter instanceof OpenAIChatAdapter);
    });

    test('default family is standard', () => {
        const adapter = new OpenAIChatAdapter('http://127.0.0.1:8080/v1', 'sk-test', 'gpt-4o');
        assert.strictEqual((adapter as any).family, 'standard');
    });

    suite('applyThinkingParams', () => {

        test('standard family — no params added when thinking=true', () => {
            const body: Record<string, unknown> = { temperature: 0 };
            applyThinkingParams(body, 'standard', { thinking: true });
            assert.deepStrictEqual(body, { temperature: 0 });
        });

        test('standard family — no params added when thinking=false', () => {
            const body: Record<string, unknown> = { temperature: 0 };
            applyThinkingParams(body, 'standard', { thinking: false });
            assert.deepStrictEqual(body, { temperature: 0 });
        });

        test('openai-o family — adds reasoning_effort and removes temperature', () => {
            const body: Record<string, unknown> = { temperature: 0 };
            applyThinkingParams(body, 'openai-o', { thinking: true });
            assert.strictEqual(body.reasoning_effort, 'medium');
            assert.strictEqual(body.temperature, undefined);
        });

        test('openai-o family — uses capabilities.reasoning_effort when provided', () => {
            const body: Record<string, unknown> = { temperature: 0 };
            applyThinkingParams(body, 'openai-o', { thinking: true, reasoning_effort: 'high' });
            assert.strictEqual(body.reasoning_effort, 'high');
        });

        test('openai-o family — no params when thinking=false', () => {
            const body: Record<string, unknown> = { temperature: 0 };
            applyThinkingParams(body, 'openai-o', { thinking: false });
            assert.deepStrictEqual(body, { temperature: 0 });
        });

        test('openai-gpt5 family — adds reasoning object with effort', () => {
            const body: Record<string, unknown> = {};
            applyThinkingParams(body, 'openai-gpt5', { thinking: true });
            assert.deepStrictEqual(body.reasoning, { effort: 'medium' });
            assert.strictEqual(body.temperature, undefined); // temperature is preserved (not deleted)
        });

        test('openai-gpt5 family — uses capabilities.reasoning_effort', () => {
            const body: Record<string, unknown> = {};
            applyThinkingParams(body, 'openai-gpt5', { thinking: true, reasoning_effort: 'low' });
            assert.deepStrictEqual(body.reasoning, { effort: 'low' });
        });

        test('openai-gpt5 family — no params when thinking=false', () => {
            const body: Record<string, unknown> = {};
            applyThinkingParams(body, 'openai-gpt5', { thinking: false });
            assert.deepStrictEqual(body, {});
        });

        test('deepseek family — enable_thinking=true when thinking=true', () => {
            const body: Record<string, unknown> = {};
            applyThinkingParams(body, 'deepseek', { thinking: true });
            assert.strictEqual(body.enable_thinking, true);
        });

        test('deepseek family — enable_thinking=false when thinking=false', () => {
            const body: Record<string, unknown> = {};
            applyThinkingParams(body, 'deepseek', { thinking: false });
            assert.strictEqual(body.enable_thinking, false);
        });

        test('qwen family — enable_thinking=true when thinking=true', () => {
            const body: Record<string, unknown> = {};
            applyThinkingParams(body, 'qwen', { thinking: true });
            assert.strictEqual(body.enable_thinking, true);
        });

        test('qwen family — enable_thinking=false when thinking=false', () => {
            const body: Record<string, unknown> = {};
            applyThinkingParams(body, 'qwen', { thinking: false });
            assert.strictEqual(body.enable_thinking, false);
        });

        test('unknown family — no params, falls back to standard', () => {
            const body: Record<string, unknown> = { temperature: 0 };
            applyThinkingParams(body, 'unknown-family', { thinking: true });
            assert.deepStrictEqual(body, { temperature: 0 });
        });

        test('no capabilities — no params', () => {
            const body: Record<string, unknown> = { temperature: 0 };
            applyThinkingParams(body, 'openai-o', undefined);
            assert.deepStrictEqual(body, { temperature: 0 });
        });

    });
});
