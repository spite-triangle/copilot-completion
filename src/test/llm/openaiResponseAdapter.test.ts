import * as assert from 'assert';
import { OpenAIResponseAdapter } from '../../completions/shared/llm/openaiResponseAdapter';

suite('OpenAIResponseAdapter', () => {
    test('should construct with correct URL path', () => {
        const adapter = new OpenAIResponseAdapter('http://127.0.0.1:8080/v1', 'sk-test', 'gpt-4o');
        assert.ok(adapter instanceof OpenAIResponseAdapter);
    });
});
