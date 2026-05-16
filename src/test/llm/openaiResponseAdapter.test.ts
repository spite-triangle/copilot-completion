import * as assert from 'assert';
import { OpenAIResponseAdapter } from '../../completions/shared/llm/openaiResponseAdapter';

suite('OpenAIResponseAdapter', () => {
    test('should build request body for responses API', () => {
        const adapter = new OpenAIResponseAdapter('https://api.openai.com', 'sk-test', 'gpt-4o');
        const body = adapter.buildBody({
            messages: [
                { role: 'system', content: 'You are a helper.' },
                { role: 'user', content: 'Edit code.' },
            ],
            max_tokens: 2048,
            temperature: 0,
        });
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.model, 'gpt-4o');
        assert.strictEqual(parsed.stream, false);
        assert.strictEqual(parsed.max_output_tokens, 2048);
        assert.strictEqual(parsed.input.length, 2);
        assert.strictEqual(parsed.input[0].role, 'system');
    });

    test('should parse response API output', () => {
        const adapter = new OpenAIResponseAdapter('', '', '');
        const response = adapter.parseResponse({
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'edited code' }] }],
            usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70 },
        });
        assert.strictEqual(response.text, 'edited code');
        assert.strictEqual(response.finishReason, 'stop');
        assert.strictEqual(response.usage?.prompt_tokens, 50);
        assert.strictEqual(response.usage?.completion_tokens, 20);
    });
});
