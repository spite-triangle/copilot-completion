# 可配置 wordPattern（按语言追加，全局生效）

## 问题

插件目前没有任何自定义分词逻辑。当用户在中文文本中接受 GHOST 补全时，VS Code 的 `acceptNextWord` 使用语言默认的 `wordPattern`，导致中文按整段/按标点分词，`accept word` 行为不符合中文习惯。

`wrap.md` 已验证：`vscode.languages.setLanguageConfiguration` 可覆盖 `wordPattern`，使 `acceptNextWord` 每次匹配单个中文字符。但该 API **按语言全局生效**（同时影响双击选词、Ctrl+Right 等），且**无法做到只在 accept word 时使用自定义分词规则**——这是 VS Code 平台限制，本设计接受此限制。

目标：用户可通过 settings.json 配置按语言的 wordPattern，插件随时应用（即时生效）。内置兜底分词**仅在用户为该语言配置了分支时**作为兜底追加，**不替换**原生 wordPattern，也**不无差别铺开**到所有语言。

## 需求与语义

1. 新增配置键 `cc-completion.wordPatterns`（object：`{ [languageId]: string }`，**顶层**，与 ghost/nes 平级）。
2. 内置兜底分词 `(?:[\u4e00-\u9fff]|[a-zA-Z0-9_]+|\s+)` **仅在用户为该语言配置了分支时**追加进最终正则，**不替换**原生 wordPattern，也**不无差别铺开**。未被配置的语言完全不动（保持 VS Code 原生行为），避免破坏 TypeScript 的 `$`、CSS 的 `-`、Ruby 的 `@` 等原生分词。
3. 追加顺序：**用户分支在前，内置兜底在后** → `(?:{用户分支}|{内置})`。JS alternation 从左到右，用户模式优先匹配。
4. 键 `"*"` 表示备用配置：对**没有显式键**的语言生效。语言级键优先级高于 `"*"`（互斥，`"*"` 只是备用）。
5. 用户删除某语言键 → 该语言回退到 `"*"` 的当前值（若配置了 `"*"`），否则**不干预**（恢复原生行为，因为该语言从未被注册过 wordPattern）。
6. 修改配置**即时生效**（无需重载窗口）。
7. 用户配置值支持 `/body/flags` 包装或裸 body；拼接时**忽略 flags，只提取 body**（JS 无法让 flags 只作用于 alternation 中的单个分支）。**插件输出的 wordPattern 一律不带任何 flags，尤其不带 `g`**——带 `g` 的全局正则会携带 `lastIndex` 状态，VS Code 的匹配逻辑（如 `acceptNextWord`）会对带状态的正则产生异常行为。用户配置中的 `/.../g` 也会被剥离，只取 body。

## 方案

采用**独立 `WordPatternManager` 服务**（方案 A）。理由：该功能本质是"配置 → 逐语言注册/更新/撤销"的独立生命周期管理器；与 GHOST/NES 补全逻辑完全解耦；可独立单元测试。但**不通过 DI 容器**——纯副作用管理服务，无需被其他服务注入，直接实例化（去掉服务标识符，见评审 7）。

### 1. 配置声明（package.json）

在 `contributes.configuration.properties` **顶层**（与 `cc-completion.ghost.*` / `cc-completion.nes.*` 平级）新增：

```json
"cc-completion.wordPatterns": {
  "type": "object",
  "default": {},
  "description": "Per-language wordPattern additions (appended to the built-in pattern, not replacing it). Only languages with an explicit key (or the \"*\" fallback) are affected; other languages keep their native wordPattern. Keys are language IDs; \"*\" is a fallback for languages without an explicit key. Values are regex fragments, optionally wrapped as /fragment/flags (flags are ignored).",
  "additionalProperties": { "type": "string" }
}
```

同时 `src/config/configKeys.ts` 新增**顶层**键：`wordPatterns: 'cc-completion.wordPatterns'`（不放 `Ghost` 节，因为该功能是全局的，见评审 5）。

### 2. WordPatternManager 组件

**新文件** `src/config/wordPatternManager.ts`：

```typescript
export class WordPatternManager {
    private readonly _registrations = new Map<string, vscode.Disposable>();
    private _generation = 0;
    private readonly _setLanguageConfiguration: (lang: string, conf: { wordPattern: RegExp }) => vscode.Disposable;
    constructor(
        private readonly _log: ILogService,
        setLanguageConfiguration?: (lang: string, conf: { wordPattern: RegExp }) => vscode.Disposable,
    ) {
        // 默认绑定真实 API；测试注入 fake（评审 10）
        this._setLanguageConfiguration = setLanguageConfiguration ?? vscode.languages.setLanguageConfiguration;
    }
    register(): vscode.Disposable { ... }
    private async applyAll(): Promise<void> { ... }
}
```

**要点（回应评审）**：

- **不是 DI 服务**：去掉 `IWordPatternManager` 标识符与 `_serviceBrand`（评审 7），普通类直接实例化。
- **不依赖 `IGhostConfigProvider`**：直接读 `vscode.workspace.getConfiguration('cc-completion').get<Record<string, string>>('wordPatterns', {})`，消除缓存失效的时序依赖（评审 6），也不污染 Ghost 配置职责（评审 5）。
- **内部状态**：`Map<languageId, Disposable>` 显式存储每个语言的注册，`applyAll` 时先 dispose 旧注册再注册新值（评审 9）。
- **可测试性**：`_setLanguageConfiguration` 可注入 fake，集成路径（register/applyAll/dispose、非法跳过）可测（评审 10）。

**内置常量**（文件顶部）：

```typescript
const BUILTIN_WORD_PATTERN = '(?:[\\u4e00-\\u9fff]|[a-zA-Z0-9_]+|\\s+)';
```

**核心纯逻辑**（不碰 vscode API，便于单测）：

| 函数 | 行为 |
|------|------|
| `parseRegexFragment(input)` | 剥离 `/.../flags` 包装，返回 `{ body }`。判定规则（评审 8）：**以 `/` 开头且最后一个 `/` 之后只含 flag 字符（`a-zA-Z`）** → 视为包装形态；否则整体视为裸 body。**flags（含 `g`）一律剥离丢弃**。空串/body 为空 → `undefined` 并记日志 |
| `buildPattern(userBody?)` | 返回类型统一为 `RegExp \| undefined`（评审 4）：`undefined`（无用户分支）→ `undefined`（该语言**不注册**，保持原生）；有分支 → `new RegExp('(?:' + userBody + '|' + BUILTIN_WORD_PATTERN + ')')`。**构造时不传任何 flags，绝不带 `g`**（带 `g` 的 lastIndex 状态会导致 VS Code 分词异常） |
| `resolveUserFragment(lang, config)` | 语言级键 → `"*"` 键 → `undefined` |

**空匹配检测（评审 4）**：`buildPattern` 内部对用户分支做启发式检查——`new RegExp('(?:' + userBody + ')').test('')` 为 `true` 则判定该分支可匹配空串，返回 `undefined`（拒绝）。理由：wordPattern 匹配空串会导致 `acceptNextWord` 死循环（wrap.md 已验证）。启发式覆盖常见情形（`a*`、`(a|)` 等），复杂度可控。

**注册生命周期（`register()`）**：

- 立即执行一次 `applyAll()`（fire-and-forget）
- 监听 `onDidChangeConfiguration`（命中 `cc-completion.wordPatterns`）→ `applyAll()`（即时生效）
- 监听 `vscode.extensions.onDidChange` → `applyAll()`（插件安装/卸载/更新时可能注册新语言；**VS Code 无 `onDidChangeLanguages` 事件（评审 1），这是平台限制，`extensions.onDidChange` 为尽力而为的近似**）
- **惰性补注册**（评审 1）：监听 `vscode.workspace.onDidOpenTextDocument`，若文档 `languageId` 有配置但尚未注册，则补注册该语言——覆盖"语言已在但插件激活后才打开文档"的场景
- dispose 时清理所有注册（`Map` 逐项 dispose）与监听

**`applyAll()`（async，评审 3）**：

```typescript
private async applyAll(): Promise<void> {
    const generation = ++this._generation;      // 生成号，防竞态
    const config = vscode.workspace.getConfiguration('cc-completion')
        .get<Record<string, string>>('wordPatterns', {});
    const languages = await vscode.languages.getLanguages();  // Thenable，必须 await
    if (generation !== this._generation) return;              // 过期结果丢弃
    for (const lang of languages) {
        const fragment = resolveUserFragment(lang, config);
        const pattern = buildPattern(fragment);
        // 有 pattern → dispose 旧注册 + setLanguageConfiguration
        // 无 pattern 但有旧注册 → dispose（还原原生）
    }
}
```

**竞态防护**：配置快速变化时，旧的 `await getLanguages()` 可能晚于新调用返回。用**生成号**（`_generation`）标记每次调用，await 后校验，过期结果直接丢弃。register() 与各事件回调均以 fire-and-forget 方式调用 `applyAll()`。

**错误处理**：

- `parseRegexFragment` 非法 → log error + 该键视为未配置（该语言不注册），不中断其他语言
- `buildPattern` 空匹配拒绝 → log warning + 该语言不注册，不中断其他语言
- `setLanguageConfiguration` 抛异常 → log error，继续
- `applyAll()` 自身异常 → log error，防止事件回调未捕获 rejection

### 3. extension.ts 接线

紧随现有 config 注册之后：

```typescript
// === WordPattern ===
const wordPatternManager = new WordPatternManager(logService);
context.subscriptions.push(wordPatternManager.register());
```

要点：

- 直接实例化 + 注册，**不通过 DI 容器**——纯副作用管理服务，无需被其他服务注入，与 `setWasmDirPath` 同级
- **不依赖 `IGhostConfigProvider`**：配置直接读 `getConfiguration('cc-completion')`（评审 5/6）
- **独立于 GHOST/NES 启用状态**（wordPattern 是全局的，不受 `ghost.enabled` 开关影响）
- `register()` 返回的 Disposable 进入 `context.subscriptions`，随插件停用自动清理

### 4. 数据流

```
settings.json: cc-completion.wordPatterns
    { "*": "…", "python": "…" }
        │
        ▼
WordPatternManager.applyAll()            ← async（评审 3）
    │  const config = getConfiguration('cc-completion').get('wordPatterns')   ← 直接读，不经过 provider 缓存（评审 5/6）
    │  const languages = await vscode.languages.getLanguages()                ← Thenable，await
    │  if (generation 过期) return                                           ← 生成号防竞态
    │  遍历 languages：
    │    resolveUserFragment(lang, config)   ← 语言级优先 → "*" 备用 → undefined
    │    buildPattern(fragment)              ← RegExp | undefined（评审 4）；空匹配拒绝
    │    有 pattern → dispose 旧注册 + setLanguageConfiguration(lang, { wordPattern })
    │    无 pattern 但有旧注册 → dispose（还原原生）
    ▼
VS Code 运行时：acceptNextWord / 双击选词 / Ctrl+Right 使用该 wordPattern
（未配置的语言：从未注册，保持 VS Code 原生 wordPattern）—— 评审 2
```

### 5. 测试

**新文件** `src/test/config/wordPatternManager.test.ts`。**纯逻辑单测**（不依赖 vscode API，导出纯函数，参考现有 `ghostConfig.test.ts` 风格）：

| 用例 | 断言 |
|------|------|
| `parseRegexFragment('/abc/gi')` | `{ body: 'abc' }`（flags 被忽略） |
| `parseRegexFragment('/abc/g')` | `{ body: 'abc' }`（**`g` flag 被剥离**，不进入 body） |
| `parseRegexFragment('abc')` | `{ body: 'abc' }` |
| `parseRegexFragment('a/b')` | `{ body: 'a/b' }`（不以 `/` 开头 → 裸 body，评审 8） |
| `parseRegexFragment('/')` | `undefined`（以 `/` 开头但无 flag 字符段） |
| `parseRegexFragment('')` | `undefined` |
| `buildPattern(undefined)` | `undefined`（该语言不注册，评审 2） |
| `buildPattern('[\\u4e00-\\u9fff。，]')` | `RegExp` 源码含 `(?:用户|内置)` 且用户在前 |
| `buildPattern('a*')` | `undefined`（空匹配拒绝，评审 4） |
| `buildPattern('a+')` | `RegExp`（非空匹配，接受） |
| `buildPattern(...)` 输出的 `RegExp.flags` | `''`（**绝无 `g`**，杜绝 lastIndex 状态） |
| `resolveUserFragment('python', { '*': 'a', 'python': 'b' })` | `'b'`（语言级优先） |
| `resolveUserFragment('go', { '*': 'a', 'python': 'b' })` | `'a'`（`"*"` 备用） |
| `resolveUserFragment('go', { 'python': 'b' })` | `undefined`（不注册，评审 2） |

**集成测试**（注入 fake `_setLanguageConfiguration`，评审 10）：用 fake 记录调用，验证 `register()` 初始应用、配置变更即时重应用、`dispose` 清理全部注册、非法正则/空匹配跳过不抛错。真实 `vscode.languages.setLanguageConfiguration` 的调用路径由 `register()` 冒烟测试覆盖（`vscode-test` 环境）。

## 影响范围

| 文件 | 变更 |
|------|------|
| `package.json` | 新增 `cc-completion.wordPatterns` 配置声明（顶层） |
| `src/config/configKeys.ts` | 新增顶层 `wordPatterns` 键 |
| `src/config/wordPatternManager.ts` | **新增** `WordPatternManager`（普通类，非 DI 服务） |
| `src/extension.ts` | 实例化并注册 `WordPatternManager` |
| `src/test/config/wordPatternManager.test.ts` | **新增** 纯逻辑单测 + 集成测试 |

> `src/config/ghostConfig.ts` 与 `nesConfig.ts` **不改**：wordPattern 是全局关注点，不塞进 GHOST 配置（评审 5）。

## 已知限制（文档中需向用户说明）

- **语言注册无法被精确监听**：VS Code 没有 `onDidChangeLanguages` 事件（评审 1）。插件用 `vscode.extensions.onDidChange`（尽力而为）+ 文档打开时惰性补注册作为近似。
- **`setLanguageConfiguration` 按语言全局生效**：自定义 wordPattern 会影响该语言的双击选词、Ctrl+Right 等所有依赖 wordPattern 的功能，**无法**做到只在 inline completion accept word 时生效（VS Code 平台限制）。因此插件**只注册用户配置过的语言**（评审 2），未配置语言保持原生，最大限度缩小影响面。
- **`setLanguageConfiguration` 是合并而非整体替换**：扩展设置的 `wordPattern` 覆盖原生值，但 `brackets`/`comments`/`onEnterRules`/`autoClosingPairs` 等其他语言配置**保留**，不会误伤。
- **wordPattern 绝不带 `g` flag**：插件输出的 wordPattern 一律不带 flags，尤其不带 `g`。带 `g` 的全局正则会携带 `lastIndex` 状态，VS Code 的 `acceptNextWord` 等匹配逻辑会对带状态的正则产生异常。用户配置中的 `g` 会被剥离（`/.../g` → 只取 body）。
- **用户配置的 flags 被忽略**：拼接语义下无法让 flags 只作用于 alternation 的单个分支（JS 正则限制）。
- **`buildPattern` 拒绝可匹配空串的分支**：`a*`、`(a|)` 等分支会被拒绝并跳过（避免 `acceptNextWord` 死循环），文档中应提示用户避免。
