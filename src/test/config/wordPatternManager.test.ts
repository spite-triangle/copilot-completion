import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    BUILTIN_WORD_PATTERN,
    parseRegexFragment,
    buildPattern,
    resolveUserFragment,
    WordPatternManager,
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

suite('WordPatternManager integration (fake setLanguageConfiguration)', () => {

    test('register applies configured languages, skips unconfigured, disposes cleanly', async () => {
        const calls: { lang: string; pattern: string }[] = [];
        const disposed: string[] = [];
        const fakeSet = (_lang: string, conf: { wordPattern: RegExp }) => {
            calls.push({ lang: _lang, pattern: conf.wordPattern.source });
            return { dispose: () => disposed.push(_lang) };
        };
        const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, show: () => {} } as any;
        const manager = new WordPatternManager(log, fakeSet);

        // 先写配置再 register，保证 register 初始 applyAll 读到新值（确定性）
        const config = vscode.workspace.getConfiguration('cc-completion');
        await config.update('wordPatterns', { plaintext: 'x+' }, vscode.ConfigurationTarget.Global);

        const sub = manager.register();
        await waitUntil(() => calls.some(c => c.lang === 'plaintext'));

        assert.ok(calls.some(c => c.lang === 'plaintext' && c.pattern.includes('x+')), 'plaintext should be registered with user branch');
        assert.ok(calls.every(c => c.lang === 'plaintext'), 'only configured language may be registered');

        sub.dispose();
        assert.ok(disposed.includes('plaintext'), 'dispose must dispose plaintext registration');

        await config.update('wordPatterns', undefined, vscode.ConfigurationTarget.Global);
    });

    test('removing config disposes previous registration (restores native)', async () => {
        const calls: string[] = [];
        const disposed: string[] = [];
        const fakeSet = (lang: string) => { calls.push(lang); return { dispose: () => disposed.push(lang) }; };
        const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, show: () => {} } as any;
        const manager = new WordPatternManager(log, fakeSet);
        const config = vscode.workspace.getConfiguration('cc-completion');

        await config.update('wordPatterns', { plaintext: 'x+' }, vscode.ConfigurationTarget.Global);
        const sub = manager.register();
        await waitUntil(() => calls.includes('plaintext'));

        // 移除配置 → applyAll 应 dispose plaintext（还原原生）
        await config.update('wordPatterns', {}, vscode.ConfigurationTarget.Global);
        await waitUntil(() => disposed.includes('plaintext'));

        sub.dispose();
        await config.update('wordPatterns', undefined, vscode.ConfigurationTarget.Global);
    });

    test('invalid regex or empty-matching branch is skipped without throwing', async () => {
        const calls: string[] = [];
        const fakeSet = (lang: string) => { calls.push(lang); return { dispose: () => {} }; };
        const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, show: () => {} } as any;
        const manager = new WordPatternManager(log, fakeSet);
        const config = vscode.workspace.getConfiguration('cc-completion');

        // 合法键 + 非法键 + 空匹配键混合
        await config.update('wordPatterns', { plaintext: 'x+', markdown: '(abc', css: 'a*' }, vscode.ConfigurationTarget.Global);
        const sub = manager.register();
        await waitUntil(() => calls.includes('plaintext'));

        assert.ok(calls.includes('plaintext'), 'valid regex must be registered');
        assert.ok(!calls.includes('markdown'), 'invalid regex must be skipped');
        assert.ok(!calls.includes('css'), 'empty-matching branch must be skipped');

        sub.dispose();
        await config.update('wordPatterns', undefined, vscode.ConfigurationTarget.Global);
    });
});

async function waitUntil(cond: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('waitUntil timeout');
        }
        await new Promise(r => setTimeout(r, 20));
    }
}
