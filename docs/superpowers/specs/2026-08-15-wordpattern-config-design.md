# GHOST：可配置 wordPattern（按语言追加）

## 问题

插件目前没有任何自定义分词逻辑。当用户在中文文本中接受 GHOST 补全时，VS Code 的 `acceptNextWord` 使用语言默认的 `wordPattern`，导致中文按整段/按标点分词，`accept word` 行为不符合中文习惯。

`wrap.md` 已验证：`vscode.languages.setLanguageConfiguration` 可覆盖 `wordPattern`，使 `acceptNextWord` 每次匹配单个中文字符。但该 API **按语言全局生效**（同时影响双击选词、Ctrl+Right 等），且**无法做到只在 accept word 时使用自定义分词规则**——这是 VS Code 平台限制，本设计接受此限制。

目标：用户可通过 settings.json 配置按语言的 wordPattern，插件随时应用（即时生效），内置默认分词永远保留，用户配置在**内置表达式上追加**而非替换。

## 需求与语义

1. 新增配置键 `cc-completion.ghost.wordPatterns`（object：`{ [languageId]: string }`）。
2. 内置默认分词 `(?:[\u4e00-\u9fff]|[a-zA-Z0-9_]+|\s+)` **永远生效**，用户配置只是在内置表达式上**追加（append）分支**，不替换。
3. 追加顺序：**用户分支在前，内置分支在后** → `(?:{用户分支}|{内置})`。JS alternation 从左到右，用户模式优先匹配。
4. 键 `"*"` 表示备用配置：对**没有显式键**的语言生效。语言级键优先级高于 `"*"`（互斥，`"*"` 只是备用）。
5. 用户删除某语言键 → 该语言回退到 `"*"` 的当前值（若配置了 `"*"`），否则仅内置生效。**无需特殊"恢复原生"处理**，因为本设计从不替换内置。
6. 修改配置**即时生效**（无需重载窗口）。
7. 用户配置值支持 `/body/flags` 包装或裸 body；拼接时**忽略 flags，只提取 body**（JS 无法让 flags 只作用于 alternation 中的单个分支）。

## 方案

采用**独立 `WordPatternManager` 服务**（方案 A）。理由：该功能本质是"配置 → 逐语言注册/更新/撤销"的独立生命周期管理器；与 GHOST/NES 补全逻辑完全解耦；可独立单元测试；符合项目现有 DI 模式。

### 1. 配置声明（package.json）

在 `contributes.configuration.properties` 的 ghost 节内新增：

```json
"cc-completion.ghost.wordPatterns": {
  "type": "object",
  "default": {},
  "description": "Per-language wordPattern additions (appended to the built-in pattern, not replacing it). Keys are language IDs; \"*\" is a fallback for languages without an explicit key. Values are regex fragments, optionally wrapped as /fragment/flags (flags are ignored).",
  "additionalProperties": { "type": "string" }
}
```

同时 `src/config/configKeys.ts` 的 `Ghost` 节新增：`wordPatterns: 'cc-completion.ghost.wordPatterns'`。

### 2. WordPatternManager 组件

**新文件** `src/config/wordPatternManager.ts`：

```typescript
export const IWordPatternManager = createServiceIdentifier<IWordPatternManager>('IWordPatternManager');
export interface IWordPatternManager {
    readonly _serviceBrand: undefined;
    register(): vscode.Disposable;
}
```

**内置常量**（文件顶部）：

```typescript
const BUILTIN_WORD_PATTERN = '(?:[\\u4e00-\\u9fff]|[a-zA-Z0-9_]+|\\s+)';
```

**依赖注入**：`IGhostConfigProvider`（新增 `get wordPatterns(): Record<string, string>`，走现有 `_cached` 缓存机制）+ `ILogService`。

**核心纯逻辑**（不碰 vscode API，便于单测）：

| 函数 | 行为 |
|------|------|
| `parseRegexFragment(input)` | 剥离 `/.../flags` 包装，返回 `{ body }`；空串/非法形态 → `undefined` 并记日志 |
| `buildPattern(userBody?)` | `undefined` → `RegExp(BUILTIN_WORD_PATTERN)`；否则 `RegExp('(?:' + userBody + '|' + BUILTIN_WORD_PATTERN + ')')`。统一不带 flags |
| `resolveUserFragment(lang, config)` | 语言级键 → `"*"` 键 → `undefined` |

**注册生命周期（`register()`）**：

- 立即执行一次 `applyAll()`
- 监听 `onDidChangeConfiguration`（命中 `cc-completion.ghost.wordPatterns`）→ `applyAll()`（即时生效）
- 监听 `onDidChangeLanguages` → `applyAll()`（处理插件激活后才注册的语言）
- dispose 时清理所有已注册的 language configuration（`context.subscriptions` 统一管理）

**`applyAll()`**：`vscode.languages.getLanguages()` 全量重算 → 每个语言 `resolveUserFragment` → `buildPattern` → dispose 旧注册、`setLanguageConfiguration(lang, { wordPattern })` 新注册。语言数量有限，全量重建成本可忽略；`setLanguageConfiguration` 后注册覆盖先注册，无竞态。

**错误处理**：

- 非法正则 → log error + 跳过该键，不中断其他语言
- 可匹配空字符串的正则 → log warning + 拒绝（避免 acceptNextWord 死循环；wrap.md 已注明约束）
- `setLanguageConfiguration` 抛异常 → log error，继续

### 3. extension.ts 接线

紧随现有 config 注册之后：

```typescript
// === WordPattern ===
const wordPatternManager = new WordPatternManager(ghostConfig, logService);
context.subscriptions.push(wordPatternManager.register());
```

要点：

- 直接实例化 + 注册，**不通过 DI 容器**——纯副作用管理服务，无需被其他服务注入，与 `setWasmDirPath` 同级
- **独立于 GHOST/NES 启用状态**（wordPattern 是全局的，不受 `ghost.enabled` 开关影响）
- `register()` 返回的 Disposable 进入 `context.subscriptions`，随插件停用自动清理

### 4. 数据流

```
settings.json: cc-completion.ghost.wordPatterns
    { "*": "…", "python": "…" }
        │
        ▼
VSCodeGhostConfigProvider.wordPatterns   ← 新增 getter，走现有 _cached 缓存
        │  (onDidChangeConfiguration 命中 → 清缓存)
        ▼
WordPatternManager.applyAll()
    │  遍历 vscode.languages.getLanguages()
    │  resolveUserFragment(lang, config)   ← 语言级优先 → "*" 备用 → undefined
    │  buildPattern(userBody)              ← (?:用户|内置) 或 (?:内置)
    │  校验：非法正则跳过 / 空匹配拒绝
    ▼
setLanguageConfiguration(lang, { wordPattern })
    │  dispose 旧注册 → 新注册（后注册覆盖先注册，无竞态）
    ▼
VS Code 运行时：acceptNextWord / 双击选词 / Ctrl+Right 使用该 wordPattern
```

### 5. 测试

**新文件** `src/test/config/wordPatternManager.test.ts`（纯逻辑，无需 vscode 环境，参考现有 `ghostConfig.test.ts` 风格）：

| 用例 | 断言 |
|------|------|
| `parseRegexFragment('/abc/gi')` | `{ body: 'abc' }`（flags 被忽略） |
| `parseRegexFragment('abc')` | `{ body: 'abc' }` |
| `parseRegexFragment('')` | `undefined` |
| `buildPattern(undefined)` | `new RegExp(BUILTIN_WORD_PATTERN)` |
| `buildPattern('[\\u4e00-\\u9fff。，]')` | 源码含 `(?:用户|内置)` 且用户在前 |
| `resolveUserFragment('python', { '*': 'a', 'python': 'b' })` | `'b'`（语言级优先） |
| `resolveUserFragment('go', { '*': 'a', 'python': 'b' })` | `'a'`（`"*"` 备用） |
| `resolveUserFragment('go', { 'python': 'b' })` | `undefined`（仅内置） |
| 空匹配拒绝 | `buildPattern('a*')` 返回标记/被拒，记 warning |

## 影响范围

| 文件 | 变更 |
|------|------|
| `package.json` | 新增 `cc-completion.ghost.wordPatterns` 配置声明 |
| `src/config/configKeys.ts` | `Ghost` 节新增 `wordPatterns` |
| `src/config/ghostConfig.ts` | `IGhostConfigProvider` 接口 + `VSCodeGhostConfigProvider` 新增 `wordPatterns` getter |
| `src/config/wordPatternManager.ts` | **新增** `WordPatternManager` |
| `src/extension.ts` | 实例化并注册 `WordPatternManager` |
| `src/test/config/wordPatternManager.test.ts` | **新增** 纯逻辑测试 |

## 已知限制（文档中需向用户说明）

- `setLanguageConfiguration` 按语言全局生效：自定义 wordPattern 会影响该语言的双击选词、Ctrl+Right 等所有依赖 wordPattern 的功能，**无法**做到只在 inline completion accept word 时生效（VS Code 平台限制）。
- 用户配置的 flags 被忽略（拼接语义无法局部应用 flags）。
