## Context

当前 `ghostTextComputer.ts:135` 的 `isSingleLine` 逻辑：

```typescript
const isSingleLine = textAfterCursor.trim() === '';
```

仅检查光标所在行光标后是否有非空白文本。参考项目 `ghostTextStrategy.ts` 的 `shouldRequestMultiline` 虽然逻辑更完备，但实现是过程式的——层层 if-else 堆叠、依赖全局 `accessor` 拉取服务、多个检测维度耦合在一个函数中。

本次设计不仅移植功能，更要重构为面向对象结构。

## Goals / Non-Goals

**Goals:**
- 用 **Chain of Responsibility** 模式拆解多行检测为独立检测器
- 用 **Strategy** 模式封装整体决策策略（允许未来替换）
- 用 **Builder** 模式构造检测上下文
- 每个检测器独立可测试、可替换
- 保留参考项目全部逻辑覆盖面（AST 空块检测、ML 评分、空行检测等）

**Non-Goals:**
- 不移植完整的 `BlockMode` 枚举体系（Server/Parsing/ParsingAndServer/MoreMultiline）
- 不移植 `contextProviderBridge` / `featuresService` / 实验系统
- 不移植 JSX 组件 prompt 系统
- 不改变 GHOST 的 FIM 模板格式

## Decisions

### 1. 整体架构：Chain of Responsibility + Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                     IMultilineStrategy                          │
│                     (Strategy 接口)                              │
│  + determineMultiline(ctx): DetectionResult                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                DefaultMultilineStrategy                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  afterAccept? ───true──▶ { decision: 'multiline' }          │ │
│  │       │                                                    │ │
│  │      false                                                 │ │
│  │       ▼                                                    │ │
│  │  ┌─────────────────────────────────────────────────────┐   │ │
│  │  │              DetectorChain (Composite)               │   │ │
│  │  │                                                     │   │ │
│  │  │  FileSizeGuard → NewLine → EmptyBlock → MLModel → SuffixPresence  │
│  │  │      │              │           │           │           │         │
│  │  │      ▼              ▼           ▼           ▼           ▼         │
│  │  │  'singleline'  'multiline' 'multiline'  'multiline'  'multiline'  │
│  │  │  (short-circuit)(short-circuit)                                    │
│  │  │                                                                   │
│  │  │  全部 defer → default: 'singleline'                                │
│  │  └─────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

IMultilineDetector (接口)
   ├── FileSizeGuardDetector       — 文件行数 ≥ 阈值 → 强制单行
   ├── NewLineDetector             — TypeScript/TSX 空白行 → 多行
   ├── EmptyBlockDetector          — AST 空块起始 → 多行 (tree-sitter WASM)
   │     ├── inline=false: 只检查光标位置
   │     └── inline=true: 双重检查 (光标 + 行尾)
   ├── MLModelDetector             — 14 维特征 ML 评分 > 阈值 → 多行 (JS/JSX/Python)
   ├── SuffixPresenceDetector      — suffix 非空 + 行尾 → 多行 (语言无关 fallback)
   │     └── inline=true: defer (不强推)
   └── DetectorChain (Composite)   — 组合 5 个 detector，按序短路求值
```

**为什么不用单个 Strategy 多实现？**

多行检测本质是**多条独立规则的短路求值链**。不同规则关注不同维度（文件大小、光标类型、AST 结构、统计模型），彼此正交。Chain of Responsibility 比 Strategy 多实现更自然——新增规则只需追加一个 detector，无需修改现有代码，符合开闭原则。

### 2. 类型设计

```typescript
/** 检测器输入上下文 */
interface MultilineContext {
    document: vscode.TextDocument;
    position: vscode.Position;
    prefix: string;
    suffix: string;
    languageId: string;
    isMiddleOfTheLine: boolean;   // 行内补全 (inline suggestion)
    afterAccept: boolean;         // 刚刚接受了一次补全
}

/** 单项检测结果 */
type DetectionResult =
    | { decision: 'multiline' }
    | { decision: 'singleline' }
    | { decision: 'defer' };      // 无法判断，交由下游

/** 检测器接口 — Chain of Responsibility 节点 */
interface IMultilineDetector {
    readonly name: string;
    detect(ctx: MultilineContext): DetectionResult;
}

/** 策略接口 — 整体决策入口 */
interface IMultilineStrategy {
    determineMultiline(ctx: MultilineContext): boolean;  // true=多行
}
```

### 3. FileSizeGuardDetector

**职责**：防止超大文件触发昂贵的 AST 解析。

- 阈值默认 8000 行（参考项目常量）
- `decision: 'singleline'` 短路链（性能保护）
- 不受 `inline`/`afterAccept` 影响

### 4. NewLineDetector

**职责**：TypeScript/TSX 文件中，光标在空白行（仅含缩进）时判定为多行。

- `targetLanguages = ['typescript', 'typescriptreact']`
- 不支持的语言直接 `defer`

### 5. EmptyBlockDetector

**职责**：用 AST 分析光标是否位于空块起始（如函数体开头、if/for 空体等）。

核心逻辑来自参考项目 `isEmptyBlockStartUtil`：
- `isSupportedLanguageId` 守卫 → 不支持的语言 `defer`
- 检查 `position` 处是否为块起始
- 若 `inline=true`，额外检查行尾位置

### 5b. SuffixPresenceDetector（新增）

**职责**：语言无关的 FIM fallback — 当所有语言特定检测器都 defer 时，检测 suffix 是否有实质内容。这是填补当前链覆盖 gap 的关键检测器。

```
detect(ctx):
    if ctx.isMiddleOfTheLine → defer  (inline 不强推多行)
    if ctx.suffix.trim() ≠ ""  → multiline
    else                       → defer  (EOF → default singleline)
```

- 放在链末尾（MLModel 之后、default 之前）
- 对 C++/Go/Java/Rust 等非 TS/JS/Python 语言，前置 4 个检测器全部 defer，由本检测器兜底
- 解决了"光标在行尾 + FIM suffix 有后续代码 → 误判单行"的核心 bug

### 6. MLModelDetector

**职责**：对 JS/JSX/Python 用 14 维特征 + 逻辑回归权重计算多行评分。

移植数据文件：
- `contextualFilterConstants.ts` — 字符→整数映射
- `multilineModelWeights.ts` — 逻辑回归权重 `multilineModelPredict()`

`requestMultilineScore()` 函数保持纯函数风格，Detector 仅封装阈值比较。

### 7. MultilineContextBuilder (Builder Pattern)

**职责**：从分散的原始参数构造 `MultilineContext`。

```typescript
class MultilineContextBuilder {
    build(params: {
        document: vscode.TextDocument;
        position: vscode.Position;
        prefix: string;
        suffix: string;
        languageId: string;
        isMiddleOfTheLine: boolean;
        afterAccept: boolean;
    }): MultilineContext;
}
```

Builder 模式隔离上下文构造逻辑：如果未来 `MultilineContext` 新增字段，只有 Builder 和调用方需改动，所有 Detector 不受影响。

### 8. DI 注册

```
IMultilineDetector (ServiceIdentifier, 不直接注入——DetectorChain 管理)
IMultilineStrategy   → DefaultMultilineStrategy   (SyncDescriptor)
  └── 构造：手动组装 DetectorChain([FileSizeGuard, NewLine, EmptyBlock, MLModel, SuffixPresence])
```

所有 5 个 Detector 作为 `DefaultMultilineStrategy` 的内部组合，不单独暴露 DI。

若未来需要按语言切换 detector 链，可将 `DetectorChain` 的创建提取为 `DetectorChainFactory`。

### 9. GhostTextComputer 的集成

在 `ghostTextComputer.ts` 中：

```
当前:  const isSingleLine = textAfterCursor.trim() === '';
       stop: isSingleLine ? ['\n'] : ['\n\n', "\n```"]
       maxTokens: isSingleLine ? 64 : maxTokens
       trimmer: isSingleLine ? TerseBlockTrimmer : VerboseBlockTrimmer

改为:
       const ctx = this.contextBuilder.build({...});
       const requestMultiline = this.multilineStrategy.determineMultiline(ctx);
       stop: requestMultiline ? ['\n\n', "\n```"] : ['\n']
       maxTokens: requestMultiline ? maxTokens : 单行限制
       trimmer: requestMultiline ? VerboseBlockTrimmer : TerseBlockTrimmer
```

### 10. suffix 提取修正

与策略无关，但影响 `MultilineContext` 的正确构造：

```
当前:  suffix = document.getText(pos.line + 1, end)  // 下一行开始，带 \r\n → \n 预归一化
改为:  suffix = document.getText().substring(offset)   // 光标 offset 开始（原始编码）
                 .replace(/\r/g, '')                   // 去除 \r，保留 \n
                 .replace(/^.*?\n/, '')                // 去除光标所在行残余
```

**关键约束**：`offset = document.offsetAt(position)` 返回的是原始文档（含 `\r\n`）中的 offset。若先对全文做 `\r\n` → `\n` 归一化再 `substring(offset)`，offset 会因每行少 1 字节而漂移，Windows 下截取位置错误。因此必须**先 substring 后 strip \r**。

### 11. `\r\n` 归一化策略

**原则**：只在发送 LLM 请求前对组装好的 prompt 统一归一化，中间流程保留原始编码以确保文档索引/offset 正确。

```
prefix 提取  → 保留原始编码 (document.getText(range), 不做 \r\n → \n)
suffix 提取  → substring(offset) 后 strip \r (必须，offset 依赖原始编码)
prompt 组装  → {prefix}{suffix} 拼入模板
归一化      → prompt.replace(/\r\n/g, '\n')  ← 仅此一处
```

这避免了早期归一化导致的 offset 漂移、缓存 key 不一致、以及 suffix 与 LLM 响应的行尾字符对齐问题。

### 12. tree-sitter WASM 集成

**职责**：让 `EmptyBlockDetector` 真正工作，而不是永远返回 `defer`。

从参考项目移植的依赖链：

```
parseBlock.ts (isEmptyBlockStart)
    ↓ 依赖
parse.ts (parseTreeSitter, isSupportedLanguageId, WASMLanguage)
    ↓ 依赖
fileLoader.ts (readFile, locateFile)   ← 需适配 VS Code extension 路径
    ↓ 依赖
web-tree-sitter (Parser.init, new Parser())
    ↓ 加载
dist/wasm/tree-sitter.wasm + tree-sitter-{lang}.wasm × 11
```

**语言覆盖**：

```typescript
const languageIdToWasmLanguageMapping = {
    python: 'python',          javascript: 'javascript',
    javascriptreact: 'javascript',  typescript: 'typescript',
    typescriptreact: 'tsx',    go: 'go',
    ruby: 'ruby',             csharp: 'c-sharp',
    java: 'java',             php: 'php',
    c: 'cpp',                 cpp: 'cpp',
};
```

**`isSupportedLanguageId` 调整**：参考项目排除了 csharp/java/php/c/cpp（临时限制），本次放开全部 11 种语言（对应 WASM 文件已全部提供）。

**`locateFile` 路径适配**：

```
参考项目: resolve(__dirname, 'dist', filename)     // Node.js 文件系统
本项目:   resolve(context.extensionUri.fsPath,      // VS Code extension 沙箱
                  'dist', 'wasm', filename)
```

WASM 文件放在 `dist/wasm/`，由 webpack `copy-webpack-plugin` 在构建时拷贝。

**移植文件结构**：

```
src/completions/ghost/multiline/treeSitter/
├── parse.ts          — WASMLanguage 枚举 + languageIdToWasmLanguageMapping
│                        + isSupportedLanguageId + parseTreeSitter
├── fileLoader.ts     — readFile + locateFile（适配 VS Code extension 路径）
├── error.ts          — CopilotPromptLoadFailure 异常类
├── blockParser.ts    — isEmptyBlockStart + getBlockParser（移植自 parseBlock.ts）
└── statementTree.ts  — StatementNode + StatementTree（移植，为 BlockPositionType 提供 isSupported）
```

`blockParser.ts` 只实现 `isEmptyBlockStart`，`isBlockBodyFinished` 和 `getNodeStart` 保留空实现（NES 不使用）。

### 13. EmptyBlockDetector 重构

当前 stub：
```typescript
function isEmptyBlockStart(_doc, _pos): false { return false; }
```

改为调用 tree-sitter：
```typescript
function isEmptyBlockStart(doc: vscode.TextDocument, pos: vscode.Position): boolean {
    if (!isSupportedLanguageId(doc.languageId)) return false;
    const text = doc.getText();
    const offset = doc.offsetAt(pos);
    return isEmptyBlockStartUtil(doc.languageId, text, offset);
}
```

`isEmptyBlockStartUtil` 内部调用 `getBlockParser(languageId).isEmptyBlockStart(text, offset)`，后者对每种语言实现 AST 级的空块检测（如函数体 `{}`、if/for 空体等）。

## Risks / Trade-offs

- [Risk] OOP 抽象层次增加理解成本 → Mitigation: 每个 detector 职责单一，类名自解释
- [Risk] `EmptyBlockDetector` 对部分语言无 AST 解析 → Mitigation: `isSupportedLanguageId` 守卫，不支持则 `defer`；SuffixPresenceDetector 兜底
- [Risk] ML 模型权重基于 Microsoft 训练数据 → Mitigation: threshold 可配置化
- [Risk] suffix 提取修正可能导致缓存 miss → Mitigation: 缓存 key 已包含 prefix/suffix，无正确性问题
- [Risk] tree-sitter WASM 初始化耗时（首调 `Parser.init` 需加载 ~2MB）→ Mitigation: `languageLoadPromises` Map 缓存已加载语言，懒加载，仅 `EmptyBlockDetector` 触发

## Open Questions

- `multilineAfterAcceptLines` 默认值？→ 参考项目取值，默认 5
- 是否需要 `DetectorChainFactory` 支持按语言选择不同检测器链？→ 当前不必要，接口已预留扩展空间
