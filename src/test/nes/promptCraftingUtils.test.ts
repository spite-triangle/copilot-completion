import * as assert from 'assert';
import { renderCompletionPrompt } from '../../completions/nes/promptCraftingUtils';

suite('renderCompletionPrompt', () => {

    const DEFAULT_TEMPLATE = [
        '<|im_start|>system',
        '{system}<|im_end|>',
        '<|im_start|>user',
        '{user}<|im_end|>',
        '<|im_start|>assistant',
        '',
        '',
    ].join('\n');

    test('replaces system and user placeholders', () => {
        const result = renderCompletionPrompt(DEFAULT_TEMPLATE, 'You are helpful', 'Hello');
        assert.ok(result.includes('You are helpful'));
        assert.ok(result.includes('Hello'));
        assert.ok(!result.includes('{system}'));
        assert.ok(!result.includes('{user}'));
    });

    test('returns template unchanged when no placeholders present', () => {
        const template = 'plain text with no placeholders';
        const result = renderCompletionPrompt(template, 'sys', 'usr');
        assert.strictEqual(result, template);
    });

    test('handles empty system and user', () => {
        const result = renderCompletionPrompt(DEFAULT_TEMPLATE, '', '');
        assert.ok(!result.includes('{system}'));
        assert.ok(!result.includes('{user}'));
    });

    test('handles literal {system} in content (known limitation - bidirectional)', () => {
        // 已知限制：`.replace()` 只替换首次出现。
        // system 中的 {user} 不会被替换（{user} 替换只命中模板中的第一个），
        // user 中的 {system} 也不会被替换（{system} 替换已执行完毕）。
        const result = renderCompletionPrompt(DEFAULT_TEMPLATE, 'literal {user}', 'literal {system}');
        assert.ok(result.includes('{user}'));   // system content 中的 {user} 保留
        assert.ok(result.includes('{system}')); // user content 中的 {system} 保留
    });

    test('system only contains {user} literal (known limitation)', () => {
        // system content 中的 {user} 先被 {user} 替换匹配到（位置在模板 {user} 之前），
        // 导致模板中的 {user} 占位符保留不替换
        const result = renderCompletionPrompt(DEFAULT_TEMPLATE, 'explain how to use {user}', 'Hello');
        assert.ok(result.includes('{user}'));           // 模板中的 {user} 占位符未被替换
        assert.ok(result.includes('explain how to use Hello')); // system 中的 {user} 先被匹配替换
    });

    test('user only contains {system} literal (known limitation)', () => {
        // user content 中的 {system} 不会被替换（{system} 替换已执行完毕）
        const result = renderCompletionPrompt(DEFAULT_TEMPLATE, 'You are helpful', 'explain the {system} concept');
        assert.ok(result.includes('{system}'));
        assert.ok(result.includes('explain the {system} concept'));
    });

    test('preserves trailing newlines from template', () => {
        const template = '{system}\n{user}\n\n';
        const result = renderCompletionPrompt(template, 'S', 'U');
        assert.strictEqual(result, 'S\nU\n\n');
    });
});
