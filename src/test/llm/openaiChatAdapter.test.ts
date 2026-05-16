import * as assert from 'assert';
import { OpenAIChatAdapter } from '../../completions/shared/llm/openaiChatAdapter';

suite('OpenAIChatAdapter', () => {
    test('should build request body correctly', () => {
        const adapter = new OpenAIChatAdapter('https://api.openai.com', 'sk-test', 'gpt-4o');
        const body = adapter.buildBody({
            messages: [
                { role: 'system', content: 'You are a helper.' },
                { role: 'user', content: 'Write code.' },
            ],
            max_tokens: 1024,
            temperature: 0,
        });
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.stream, false);
        assert.strictEqual(parsed.max_tokens, 1024);
        assert.strictEqual(parsed.model, 'gpt-4o');
        assert.strictEqual(parsed.messages.length, 2);
        assert.strictEqual(parsed.messages[0].role, 'system');
    });

    test('should parse OpenAI chat response', () => {
        const adapter = new OpenAIChatAdapter('', '', '');
        const response = adapter.parseResponse({
            choices: [{ message: { content: 'const x = 1;' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
        assert.strictEqual(response.text, 'const x = 1;');
        assert.strictEqual(response.finishReason, 'stop');
        assert.strictEqual(response.usage?.completion_tokens, 5);
    });

    test('should include stop sequences when provided', () => {
        const adapter = new OpenAIChatAdapter('http://localhost', 'key', 'm');
        const body = adapter.buildBody({
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 100,
            temperature: 0,
            stop: ['\n', '//'],
        });
        const parsed = JSON.parse(body);
        assert.deepStrictEqual(parsed.stop, ['\n', '//']);
    });
});
