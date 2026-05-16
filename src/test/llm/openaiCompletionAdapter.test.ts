import * as assert from 'assert';
import { OpenAICompletionAdapter } from '../../completions/shared/llm/openaiCompletionAdapter';

suite('OpenAICompletionAdapter', () => {
    test('should build FIM prompt request', () => {
        const adapter = new OpenAICompletionAdapter('https://api.openai.com', 'sk-test', 'gpt-4o');
        const body = adapter.buildBody({
            prompt: '<|fim_prefix|>function hello() {<|fim_suffix|>}<|fim_middle|>',
            max_tokens: 128,
            temperature: 0.2,
            stop: ['\n'],
        });
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.model, 'gpt-4o');
        assert.strictEqual(parsed.stream, false);
        assert.strictEqual(parsed.max_tokens, 128);
        assert.deepStrictEqual(parsed.stop, ['\n']);
        assert.strictEqual(parsed.prompt, '<|fim_prefix|>function hello() {<|fim_suffix|>}<|fim_middle|>');
    });

    test('should parse completions response', () => {
        const adapter = new OpenAICompletionAdapter('', '', '');
        const response = adapter.parseResponse({
            choices: [{ text: '  console.log("hi");', finish_reason: 'stop' }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        });
        assert.strictEqual(response.text, '  console.log("hi");');
        assert.strictEqual(response.finishReason, 'stop');
        assert.strictEqual(response.usage?.prompt_tokens, 20);
    });
});
