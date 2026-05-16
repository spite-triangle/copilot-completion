import * as assert from 'assert';
import { AnthropicAdapter } from '../../completions/shared/llm/anthropicAdapter';

suite('AnthropicAdapter', () => {
    test('should construct with correct URL path', () => {
        const adapter = new AnthropicAdapter('http://127.0.0.1:8080/v1', 'sk-test', 'claude-3-haiku-20240307');
        assert.ok(adapter instanceof AnthropicAdapter);
    });
});
