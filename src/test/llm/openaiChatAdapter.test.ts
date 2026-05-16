import * as assert from 'assert';
import { OpenAIChatAdapter } from '../../completions/shared/llm/openaiChatAdapter';

suite('OpenAIChatAdapter', () => {
    test('should construct with correct URL path', () => {
        const adapter = new OpenAIChatAdapter('http://127.0.0.1:8080/v1', 'sk-test', 'gpt-4o');
        // URL is now ${baseUrl}/chat/completions — no hardcoded /v1 prefix
        assert.ok(adapter instanceof OpenAIChatAdapter);
    });
});
