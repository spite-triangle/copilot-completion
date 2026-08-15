import * as assert from 'assert';
import {
    BUILTIN_WORD_PATTERN,
    parseRegexFragment,
    buildPattern,
    resolveUserFragment,
} from '../../config/wordPatternManager';

suite('wordPattern pure logic', () => {

    test('parseRegexFragment strips /.../flags wrapper and ignores flags', () => {
        assert.deepStrictEqual(parseRegexFragment('/abc/gi'), { body: 'abc' });
        assert.deepStrictEqual(parseRegexFragment('/abc/g'), { body: 'abc' });
    });

    test('parseRegexFragment treats non-slash-prefixed input as bare body', () => {
        assert.deepStrictEqual(parseRegexFragment('abc'), { body: 'abc' });
        assert.deepStrictEqual(parseRegexFragment('a/b'), { body: 'a/b' });
    });

    test('parseRegexFragment rejects invalid forms', () => {
        assert.strictEqual(parseRegexFragment(''), undefined);
        assert.strictEqual(parseRegexFragment('/'), undefined);
        assert.strictEqual(parseRegexFragment('/abc'), undefined); // 以 / 开头但无尾 / + flags 段
    });

    test('buildPattern returns undefined when no user branch (language not registered)', () => {
        assert.strictEqual(buildPattern(undefined), undefined);
    });

    test('buildPattern prepends user branch before builtin, without g flag', () => {
        const re = buildPattern('[\\u4e00-\\u9fff。，]');
        assert.ok(re instanceof RegExp);
        assert.strictEqual(re.source, '(?:[\\u4e00-\\u9fff。，]|' + BUILTIN_WORD_PATTERN + ')');
        assert.strictEqual(re.flags, ''); // 绝无 g
    });

    test('buildPattern rejects empty-matching branches', () => {
        assert.strictEqual(buildPattern('a*'), undefined);
        assert.strictEqual(buildPattern('(a|)'), undefined);
    });

    test('buildPattern accepts non-empty-matching branch', () => {
        assert.ok(buildPattern('a+') instanceof RegExp);
    });

    test('buildPattern rejects invalid regex', () => {
        assert.strictEqual(buildPattern('(abc'), undefined);
    });

    test('resolveUserFragment prefers language key over star, star is fallback', () => {
        const config = { '*': 'a', python: 'b' };
        assert.strictEqual(resolveUserFragment('python', config), 'b');
        assert.strictEqual(resolveUserFragment('go', config), 'a');
        assert.strictEqual(resolveUserFragment('go', { python: 'b' }), undefined);
    });
});
