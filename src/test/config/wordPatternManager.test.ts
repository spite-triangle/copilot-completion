import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    parseRegexFragment,
    buildPattern,
    resolveUserFragment,
    WordPatternManager,
} from '../../config/wordPatternManager';

suite('wordPattern pure logic', () => {

    test('parseRegexFragment strips /.../flags wrapper and parses flags', () => {
        assert.deepStrictEqual(parseRegexFragment('/abc/gi'), { expression: 'abc', flags: 'gi' });
        assert.deepStrictEqual(parseRegexFragment('/abc/g'), { expression: 'abc', flags: 'g' });
        assert.deepStrictEqual(parseRegexFragment('/abc/'), { expression: 'abc' }); // 空 flags 段 → 无 flags 字段
    });

    test('parseRegexFragment treats non-slash-prefixed input as bare expression', () => {
        assert.deepStrictEqual(parseRegexFragment('abc'), { expression: 'abc' });
        assert.deepStrictEqual(parseRegexFragment('a/b'), { expression: 'a/b' });
    });

    test('parseRegexFragment rejects invalid forms', () => {
        assert.strictEqual(parseRegexFragment(''), undefined);
        assert.strictEqual(parseRegexFragment('/'), undefined);
        assert.strictEqual(parseRegexFragment('/abc'), undefined); // 以 / 开头但无尾 / + flags 段
        assert.strictEqual(parseRegexFragment('/abc/1'), undefined); // 非法 flag 字符
    });

    test('buildPattern returns undefined when no user branch (language not registered)', () => {
        assert.strictEqual(buildPattern(undefined), undefined);
    });

    test('buildPattern returns undefined for non-string input', () => {
        assert.strictEqual(buildPattern(123 as unknown as string), undefined);
    });

    test('buildPattern prepends user branch before builtin, without g flag', () => {
        const re = buildPattern('[\\u4e00-\\u9fff。，]');
        assert.ok(re instanceof RegExp);
        assert.strictEqual(re.source, '(?:[\\u4e00-\\u9fff。，])');
        assert.strictEqual(re.flags, ''); // 无 flags 时构造不传第二参
    });

    test('buildPattern passes non-g flags through and strips g', () => {
        assert.strictEqual(buildPattern('/abc/i')?.flags, 'i');
        assert.strictEqual(buildPattern('/abc/im')?.flags, 'im');
        assert.strictEqual(buildPattern('/abc/gi')?.flags, 'i'); // g 剥离，i 保留
        assert.strictEqual(buildPattern('/abc/g')?.flags, '');    // 仅 g → 无 flags
        assert.strictEqual(buildPattern('/abc/uu'), undefined);   // 非法 flags 组合 → undefined
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

    suiteTeardown(async () => {
        // 兜底清理：即使断言失败或 waitUntil 超时，也不把 wordPatterns 泄漏进开发者全局配置
        await vscode.workspace.getConfiguration('cc-completion')
            .update('wordPatterns', undefined, vscode.ConfigurationTarget.Global);
    });

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

    test('changing a language pattern disposes prior registration (no leak, restores native)', async () => {
        const calls: { lang: string; pattern: string }[] = [];
        const disposed: { lang: string; pattern: string }[] = [];
        const fakeSet = (lang: string, conf: { wordPattern: RegExp }) => {
            calls.push({ lang, pattern: conf.wordPattern.source });
            return { dispose: () => disposed.push({ lang, pattern: conf.wordPattern.source }) };
        };
        const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, show: () => {} } as any;
        const manager = new WordPatternManager(log, fakeSet);
        const config = vscode.workspace.getConfiguration('cc-completion');

        // 1. 配置 x+ → 注册
        await config.update('wordPatterns', { plaintext: 'x+' }, vscode.ConfigurationTarget.Global);
        const sub = manager.register();
        await waitUntil(() => calls.some(c => c.lang === 'plaintext' && c.pattern.includes('x+')));

        // 2. 改为 y+ → 应重新注册，且旧的 x+ 注册必须先 dispose（不泄漏）
        await config.update('wordPatterns', { plaintext: 'y+' }, vscode.ConfigurationTarget.Global);
        await waitUntil(() => calls.some(c => c.lang === 'plaintext' && c.pattern.includes('y+')));
        await waitUntil(() => disposed.some(d => d.lang === 'plaintext' && d.pattern.includes('x+')));

        // 3. 移除配置 → 应 dispose 最新的 y+ 注册（还原原生）
        await config.update('wordPatterns', {}, vscode.ConfigurationTarget.Global);
        await waitUntil(() => disposed.some(d => d.lang === 'plaintext' && d.pattern.includes('y+')));

        // 断言：两次注册（x+、y+）都发生过，且各自的 disposable 全部被 dispose，无一泄漏
        assert.ok(calls.some(c => c.lang === 'plaintext' && c.pattern.includes('x+')), 'x+ registration must have happened');
        assert.ok(calls.some(c => c.lang === 'plaintext' && c.pattern.includes('y+')), 'y+ registration must have happened');
        const plaintextDisposed = disposed.filter(d => d.lang === 'plaintext');
        assert.ok(plaintextDisposed.some(d => d.pattern.includes('x+')), 'first registration (x+) must be disposed');
        assert.ok(plaintextDisposed.some(d => d.pattern.includes('y+')), 'second registration (y+) must be disposed');

        sub.dispose();
        await config.update('wordPatterns', undefined, vscode.ConfigurationTarget.Global);
    });

    test('invalid regex or empty-matching branch is skipped without throwing', async () => {
        const calls: string[] = [];
        const fakeSet = (lang: string) => { calls.push(lang); return { dispose: () => {} }; };
        const warns: string[] = [];
        const log = { info: () => {}, warn: (m: string) => warns.push(m), error: () => {}, debug: () => {}, show: () => {} } as any;
        const manager = new WordPatternManager(log, fakeSet);
        const config = vscode.workspace.getConfiguration('cc-completion');

        // 合法键 + 非法键 + 空匹配键混合
        await config.update('wordPatterns', { plaintext: 'x+', markdown: '(abc', css: 'a*' }, vscode.ConfigurationTarget.Global);
        const sub = manager.register();
        await waitUntil(() => calls.includes('plaintext'));

        assert.ok(calls.includes('plaintext'), 'valid regex must be registered');
        assert.ok(!calls.includes('markdown'), 'invalid regex must be skipped');
        assert.ok(!calls.includes('css'), 'empty-matching branch must be skipped');
        assert.ok(warns.some(m => m.includes('markdown')), 'invalid regex must log a warning');
        assert.ok(warns.some(m => m.includes('css')), 'empty-matching branch must log a warning');

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
