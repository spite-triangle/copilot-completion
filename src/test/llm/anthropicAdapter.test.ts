import * as assert from 'assert';
import { AnthropicAdapter } from '../../completions/shared/llm/anthropicAdapter';

suite('AnthropicAdapter', () => {
    test('should build messages format for Anthropic API', () => {
        const adapter = new AnthropicAdapter('https://api.anthropic.com', 'sk-test', 'claude-3-haiku-20240307');
        const body = adapter.buildBody({
            messages: [
                { role: 'system', content: 'You are a coding assistant.' },
                { role: 'user', content: 'Write a function.' },
            ],
            max_tokens: 1024,
            temperature: 0,
        });
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.model, 'claude-3-haiku-20240307');
        assert.strictEqual(parsed.stream, false);
        assert.strictEqual(parsed.max_tokens, 1024);
        assert.strictEqual(parsed.system, 'You are a coding assistant.');
        assert.strictEqual(parsed.messages.length, 1);
        assert.strictEqual(parsed.messages[0].role, 'user');
    });

    test('should parse Anthropic response', () => {
        const adapter = new AnthropicAdapter('', '', '');
        const response = adapter.parseResponse({
            content: [{ type: 'text', text: 'function foo() {}' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 100, output_tokens: 50 },
        });
        assert.strictEqual(response.text, 'function foo() {}');
        assert.strictEqual(response.finishReason, 'end_turn');
        assert.strictEqual(response.usage?.prompt_tokens, 100);
    });

    test('should handle messages without system role', () => {
        const adapter = new AnthropicAdapter('http://localhost', 'k', 'm');
        const body = adapter.buildBody({
            messages: [{ role: 'user', content: 'hello' }],
            max_tokens: 10,
            temperature: 0.5,
        });
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.system, undefined);
    });
});
