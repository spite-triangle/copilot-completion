# 可配置 wordPattern 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户可通过 settings.json 的 `cc-completion.wordPatterns` 为指定语言追加 wordPattern 分支（内置兜底 `(?:[\u4e00-\u9fff]|[a-zA-Z0-9_]+|\s+)` 仅在被配置语言上追加，绝不替换原生分词、绝不带 `g` flag），配置修改即时生效。

**Architecture:** 新建独立 `WordPatternManager`（普通类，非 DI 服务），直接读 `getConfiguration('cc-completion')`，把配置翻译为逐语言的 `setLanguageConfiguration(lang, { wordPattern })` 注册。注册生命周期由 `register()` 管理：初始应用 + 配置变更即时重应用 + 插件扩展变化/文档打开惰性补注册 + dispose 清理。核心纯逻辑（`parseRegexFragment`/`buildPattern`/`resolveUserFragment`）导出为纯函数，可独立单测；`setLanguageConfiguration` 构造注入，可注入 fake 做集成测试。

**Tech Stack:** TypeScript, VS Code API (`languages.setLanguageConfiguration`/`languages.getLanguages`/`workspace.getConfiguration`/`workspace.onDidChangeConfiguration`/`extensions.onDidChange`/`workspace.onDidOpenTextDocument`), mocha (`suite`/`test`) + `assert`, `@vscode/test-cli`.

## Global Constraints

以下约束对每个任务都隐式生效，全部来自 spec `docs/superpowers/specs/2026-08-15-wordpattern-config-design.md`：

- **配置键**：`cc-completion.wordPatterns`（object，`{ [languageId]: string }`，**顶层**，不放 Ghost/Nes 节）。
- **绝无 `g` flag**：`buildPattern` 构造的 RegExp 一律不传 flags；用户 `/.../g` 中的 `g` 被剥离只取 body。带 `g` 的 lastIndex 状态会导致 VS Code 匹配异常。
- **只注册用户配置过的语言**：`buildPattern(undefined)` 返回 `undefined` → 该语言不注册、保持原生；已注册语言被移除配置 → dispose（还原原生）。默认 `{}` 时插件完全不干预任何语言。
- **追加顺序**：用户分支在前、内置兜底在后 → `(?:{用户分支}|(?:[\u4e00-\u9fff]|[a-zA-Z0-9_]+|\s+))`。
- **优先级**：语言级键 > `"*"` 键 > 不注册。`"*"` 仅对无显式键的语言生效。
- **空匹配拒绝**：用户分支经 `new RegExp('(?:' + body + ')').test('')` 为 `true` 时拒绝（返回 `undefined`），避免 acceptNextWord 死循环。
- **`setLanguageConfiguration` 是合并**：只覆盖 `wordPattern`，`brackets`/`comments`/`onEnterRules`/`autoClosingPairs` 等保留。
- **无 `onDidChangeLanguages` 事件**（平台限制）：用 `extensions.onDidChange`（尽力而为）+ `workspace.onDidOpenTextDocument` 惰性补注册。
- **`getLanguages()` 返回 `Thenable<string[]>`**，必须 await；用生成号防竞态。

---

### Task 1: 配置声明（package.json + configKeys）

**Files:**
- Modify: `package.json`（`contributes.configuration.properties` 顶层，`cc-completion.ghost.baseUrl` 之前）
- Modify: `src/config/configKeys.ts`

**Interfaces:**
- Consumes: 无
- Produces: `ConfigKeys.wordPatterns` 常量 = `'cc-completion.wordPatterns'`（Task 2/3/4 不使用它——WordPatternManager 直接读配置字符串；保留该常量是为了与项目 ConfigKeys 惯例一致）

- [ ] **Step 1: 在 package.json 声明配置**

在 `package.json` 的 `contributes.configuration.properties` 中，`"cc-completion.ghost.baseUrl"` 之前插入（顶层，与 `cc-completion.ghost.*` 平级）：

```json
"cc-completion.wordPatterns": {
  "type": "object",
  "default": {},
  "description": "Per-language wordPattern additions (appended to the built-in pattern, not replacing it). Only languages with an explicit key (or the \"*\" fallback) are affected; other languages keep their native wordPattern. Keys are language IDs; \"*\" is a fallback for languages without an explicit key. Values are regex fragments, optionally wrapped as /fragment/flags (flags are ignored).",
  "additionalProperties": { "type": "string" }
},
```

- [ ] **Step 2: 在 configKeys.ts 添加顶层键**

`src/config/configKeys.ts` 中，`ConfigKeys` 对象顶部（`Ghost` 之前）插入：

```typescript
export const ConfigKeys = {
    wordPatterns: 'cc-completion.wordPatterns',
    Ghost: {
```

- [ ] **Step 3: 验证编译与 lint**

Run: `npm run lint && npm run compile`
Expected: 无错误。package.json 是 JSON，无 lint 覆盖，确认手写 JSON 合法（无尾逗号、引号配对）。

- [ ] **Step 4: Commit**

```bash
git add package.json src/config/configKeys.ts
git commit -m "feat: declare cc-completion.wordPatterns configuration"
```

---

### Task 2: 纯逻辑函数 + 单测（parseRegexFragment / buildPattern / resolveUserFragment）

**Files:**
- Create: `src/config/wordPatternManager.ts`
- Test: `src/test/config/wordPatternManager.test.ts`

**Interfaces:**
- Consumes: `ILogService`（`src/completions/shared/log/logService.ts`，方法 `info/warn/error/debug/show(message: string)`）
- Produces:
  - `export const BUILTIN_WORD_PATTERN = '(?:[\\u4e00-\\u9fff]|[a-zA-Z0-9_]+|\\s+)'`
  - `export function parseRegexFragment(input: string): { body: string } | undefined`
  - `export function buildPattern(input: string | undefined): RegExp | undefined`
  - `export function resolveUserFragment(lang: string, config: Record<string, string>): string | undefined`
  - （Task 3 在 `WordPatternManager` 类中使用这三个纯函数；Task 4 不需要它们）

- [ ] **Step 1: 写失败测试**

创建 `src/test/config/wordPatternManager.test.ts`（纯逻辑部分，不调用 vscode API，只 import 纯函数；与 `src/test/config/ghostConfig.test.ts` 风格一致，使用全局 `suite`/`test`，不显式 import mocha）：

```typescript
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL——`Cannot find module '../../config/wordPatternManager'`（模块不存在）。

- [ ] **Step 3: 实现纯函数**

创建 `src/config/wordPatternManager.ts`：

```typescript
export const BUILTIN_WORD_PATTERN = '(?:[\\u4e00-\\u9fff]|[a-zA-Z0-9_]+|\\s+)';

export interface ParsedFragment {
    body: string;
}

/**
 * 剥离 /.../flags 包装（flags 一律丢弃，尤其 g），或按裸 body 处理。
 * 规则：以 / 开头且最后一个 / 之后只含 flag 字符（a-zA-Z）→ 包装形态；
 *      以 / 开头但不满足 → 非法（undefined）；否则整体为裸 body。
 */
export function parseRegexFragment(input: string): ParsedFragment | undefined {
    if (input.length === 0) {
        return undefined;
    }
    if (input.startsWith('/')) {
        const lastSlash = input.lastIndexOf('/');
        if (lastSlash > 0) {
            const flags = input.slice(lastSlash + 1);
            if (/^[a-zA-Z]*$/.test(flags)) {
                const body = input.slice(1, lastSlash);
                if (body.length === 0) {
                    return undefined;
                }
                return { body };
            }
        }
        return undefined;
    }
    return { body: input };
}

/**
 * 返回最终 wordPattern：undefined → 该语言不注册（保持原生）。
 * 用户分支在前、内置兜底在后；统一不带 flags（绝无 g）。
 * 空匹配分支与非法正则 → undefined（拒绝）。
 */
export function buildPattern(input: string | undefined): RegExp | undefined {
    if (input === undefined) {
        return undefined;
    }
    const parsed = parseRegexFragment(input);
    if (parsed === undefined) {
        return undefined;
    }
    const body = parsed.body;
    try {
        if (new RegExp('(?:' + body + ')').test('')) {
            return undefined; // 空匹配拒绝
        }
    } catch {
        return undefined; // 非法正则
    }
    return new RegExp('(?:' + body + '|' + BUILTIN_WORD_PATTERN + ')');
}

/** 语言级键优先，其次 "*"，否则 undefined（不注册）。 */
export function resolveUserFragment(lang: string, config: Record<string, string>): string | undefined {
    if (Object.prototype.hasOwnProperty.call(config, lang)) {
        return config[lang];
    }
    if (Object.prototype.hasOwnProperty.call(config, '*')) {
        return config['*'];
    }
    return undefined;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS——8 个纯逻辑用例全部通过（其余现有测试不受影响）。

- [ ] **Step 5: Commit**

```bash
git add src/config/wordPatternManager.ts src/test/config/wordPatternManager.test.ts
git commit -m "feat: add wordPattern pure logic with tests"
```

---

### Task 3: WordPatternManager 类 + 集成测试

**Files:**
- Modify: `src/config/wordPatternManager.ts`（追加 `WordPatternManager` 类）
- Modify: `src/test/config/wordPatternManager.test.ts`（追加集成测试）

**Interfaces:**
- Consumes: `parseRegexFragment`/`buildPattern`/`resolveUserFragment`/`BUILTIN_WORD_PATTERN`（Task 2）、`ILogService`
- Produces: `export class WordPatternManager`，构造签名 `(log: ILogService, setLanguageConfiguration?: (lang: string, conf: { wordPattern: RegExp }) => vscode.Disposable)`；方法 `register(): vscode.Disposable`（Task 4 使用）

- [ ] **Step 1: 写失败测试（集成）**

在 `src/test/config/wordPatternManager.test.ts` 末尾追加以下 suite，并在文件顶部 import 区添加 `import * as vscode from 'vscode';` 与 `import { WordPatternManager } from '../../config/wordPatternManager';`（`waitUntil` 是函数声明，会被提升，定义在文件末尾即可，前面的 suite 可直接使用）：

```typescript
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
```

> 第三个用例中 `manager['_registrations']` 访问私有字段，TS 会报错。修正：给 `_registrations` 的断言改为仅依赖 `calls`（`await waitUntil(() => calls.length > 0)` 永不满足则超时报错；但两个键都非法时 calls 恒空，会超时）。更稳妥：改为配置合法键 + 非法键混合：
> `{ plaintext: 'x+', markdown: '(abc', css: 'a*' }`，断言 `calls.includes('plaintext')` 为 true 且 `markdown`/`css` 不在 calls 中。实现时以此为准（见 Step 3 修正提示）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL——`WordPatternManager` 未定义（`TypeError: WordPatternManager is not a constructor`）。

- [ ] **Step 3: 实现 WordPatternManager 类**

在 `src/config/wordPatternManager.ts` 末尾追加：

```typescript
import * as vscode from 'vscode';
import { ILogService } from '../completions/shared/log/logService';

export class WordPatternManager {
    private readonly _registrations = new Map<string, vscode.Disposable>();
    private _generation = 0;
    private readonly _setLanguageConfiguration: (lang: string, conf: { wordPattern: RegExp }) => vscode.Disposable;

    constructor(
        private readonly _log: ILogService,
        setLanguageConfiguration?: (lang: string, conf: { wordPattern: RegExp }) => vscode.Disposable,
    ) {
        this._setLanguageConfiguration = setLanguageConfiguration ?? vscode.languages.setLanguageConfiguration;
    }

    register(): vscode.Disposable {
        void this.applyAll();

        const disposables: vscode.Disposable[] = [
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('cc-completion.wordPatterns')) {
                    void this.applyAll();
                }
            }),
            vscode.extensions.onDidChange(() => {
                // 插件安装/卸载/更新可能注册新语言；尽力而为（无 onDidChangeLanguages 事件）
                void this.applyAll();
            }),
            vscode.workspace.onDidOpenTextDocument(doc => {
                // 惰性补注册：语言已在但插件激活后才打开文档
                if (!this._registrations.has(doc.languageId)) {
                    const fragment = resolveUserFragment(doc.languageId, this._getConfig());
                    const pattern = buildPattern(fragment);
                    if (pattern) {
                        this._applyOne(doc.languageId, pattern);
                    }
                }
            }),
        ];

        return {
            dispose: () => {
                for (const d of disposables) {
                    d.dispose();
                }
                for (const d of this._registrations.values()) {
                    d.dispose();
                }
                this._registrations.clear();
            },
        };
    }

    private _getConfig(): Record<string, string> {
        return vscode.workspace.getConfiguration('cc-completion')
            .get<Record<string, string>>('wordPatterns', {});
    }

    private _applyOne(lang: string, pattern: RegExp): void {
        try {
            const d = this._setLanguageConfiguration(lang, { wordPattern: pattern });
            this._registrations.get(lang)?.dispose();
            this._registrations.set(lang, d);
        } catch (e) {
            this._log.error(`[WordPattern] setLanguageConfiguration failed for ${lang}: ${String(e)}`);
        }
    }

    private async applyAll(): Promise<void> {
        const generation = ++this._generation;

        let config: Record<string, string>;
        try {
            config = this._getConfig();
        } catch (e) {
            this._log.error(`[WordPattern] failed to read config: ${String(e)}`);
            return;
        }

        let languages: string[];
        try {
            languages = await vscode.languages.getLanguages();
        } catch (e) {
            this._log.error(`[WordPattern] getLanguages failed: ${String(e)}`);
            return;
        }
        if (generation !== this._generation) {
            return; // 过期结果丢弃（竞态防护）
        }

        const next = new Map<string, vscode.Disposable>();
        for (const lang of languages) {
            const fragment = resolveUserFragment(lang, config);
            const pattern = buildPattern(fragment);
            if (pattern) {
                try {
                    next.set(lang, this._setLanguageConfiguration(lang, { wordPattern: pattern }));
                } catch (e) {
                    this._log.error(`[WordPattern] setLanguageConfiguration failed for ${lang}: ${String(e)}`);
                }
            }
        }

        // dispose 已不再配置的语言（还原原生），并替换注册表
        for (const [lang, d] of this._registrations) {
            if (!next.has(lang)) {
                d.dispose();
            }
        }
        this._registrations.clear();
        for (const [lang, d] of next) {
            this._registrations.set(lang, d);
        }
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS——3 个集成用例通过（含真实 `getLanguages` + fake `setLanguageConfiguration`）。

- [ ] **Step 5: Commit**

```bash
git add src/config/wordPatternManager.ts src/test/config/wordPatternManager.test.ts
git commit -m "feat: add WordPatternManager with config-change reapply and lazy registration"
```

---

### Task 4: extension.ts 接线

**Files:**
- Modify: `src/extension.ts`（activate 内 config 注册之后）

**Interfaces:**
- Consumes: `WordPatternManager`（Task 3）、`ILogService`/`logService`（activate 内已构造）
- Produces: 无

- [ ] **Step 1: 实例化并注册**

`src/extension.ts` 中，`const nesConfig = new VSCodeNesConfigProvider(context);` 之后插入：

```typescript
    const ghostConfig = new VSCodeGhostConfigProvider(context);
    const nesConfig = new VSCodeNesConfigProvider(context);

    // === WordPattern (global, independent of ghost/nes enabled state) ===
    const wordPatternManager = new WordPatternManager(logService);
    context.subscriptions.push(wordPatternManager.register());
```

并在文件头部 import 区（config import 之后）添加：

```typescript
import { WordPatternManager } from './config/wordPatternManager';
```

- [ ] **Step 2: 验证编译与 lint**

Run: `npm run lint && npm run compile`
Expected: 无错误。

- [ ] **Step 3: 冒烟验证（可选，手动）**

启动 Extension Development Host（F5），在 settings.json 中设置：

```json
"cc-completion.wordPatterns": {
  "*": "/[\\u4e00-\\u9fff。，！？]/",
  "python": "\\$\\w+"
}
```

打开一个 python 文件，在中文注释旁接受 GHOST 补全的 next word，确认中文按单字/标点接受；双击中文验证选词行为；确认 TypeScript 的 `$` 变量未被拆散（未配置 TS 时）。

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire WordPatternManager into extension activation"
```

---

## 验证清单（全部任务完成后）

1. `npm test` 全绿（含新增 8 个纯逻辑 + 3 个集成用例）。
2. `npm run lint && npm run compile` 无错误。
3. 手动冒烟：未配置 `cc-completion.wordPatterns`（默认 `{}`）时插件不干预任何语言。
4. 手动冒烟：配置 `"*"` + 语言级键后，中文 accept word 按预期；配置修改即时生效（无需重载）。
