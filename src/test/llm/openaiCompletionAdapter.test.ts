import * as assert from 'assert';
import { OpenAICompletionAdapter } from '../../completions/shared/llm/openaiCompletionAdapter';

suite('OpenAICompletionAdapter', () => {
    test('should construct with correct URL path', () => {
        const adapter = new OpenAICompletionAdapter('http://127.0.0.1:8080/v1', 'sk-test', 'gpt-4o');
        assert.ok(adapter instanceof OpenAICompletionAdapter);
    });
});
