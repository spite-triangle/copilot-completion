## Why

当前 GHOST 补全的 `isSingleLine` 判断仅依据 `textAfterCursor.trim() === ''`（光标是否在行尾），导致 FIM 场景下光标在行尾但 suffix 有大量后续代码时被误判为单行补全，模型在第一个 `\n` 即停止，无法生成多行实现。需从参考项目移植完整的 OOP 多行检测策略 + tree-sitter AST 解析 + FIM suffix 感知 fallback。

## What Changes

- 替换 `isSingleLine = textAfterCursor.trim() === ''` 为面向对象的多行检测器链（Chain of Responsibility + Strategy + Builder + Composite 模式）
- 新建 `multiline/` 模块：`IMultilineDetector` 接口 + 5 个检测器 + `DetectorChain` + `DefaultMultilineStrategy` + `MultilineContextBuilder`
- **5 个检测器**：
  - `FileSizeGuardDetector` — 超大文件守卫（≥8000 行 → 单行）
  - `NewLineDetector` — TS/TSX 空行检测 → 多行
  - `EmptyBlockDetector` — AST 空块起始检测（tree-sitter WASM），支持 11 种语言
  - `MLModelDetector` — 14 维特征 ML 评分（JS/JSX/Python）→ 多行
  - `SuffixPresenceDetector`（新增）— FIM suffix 非空 + 行尾 → 多行，语言无关 fallback
- **tree-sitter WASM 集成**（从参考项目移植）：
  - 12 个 `.wasm` 文件 → `dist/wasm/`
  - `parse.ts` — `parseTreeSitter`、`isSupportedLanguageId`、`WASMLanguage` 枚举
  - `fileLoader.ts` — WASM 文件加载（适配 VS Code extension context）
  - `blockParser.ts` — `isEmptyBlockStart` AST 空块检测（移植自 `parseBlock.ts`）
  - `statementTree.ts` — `StatementNode` / `StatementTree` 抽象语法树（`BlockPositionType` 依赖）
- 调整 `stop` token、`BlockTrimmer`、`maxTokens`，由 `requestMultiline` 驱动
- `inlineSuggestion` 场景：EmptyBlockDetector 双位置检测（光标 + 行尾）
- `afterAccept` 场景：接受补全后强制多行
- suffix 提取修正：`offsetAt()` + `substring(offset)` 再 `strip \r`（避免 `\r\n` 预归一化 offset 漂移）
- `\r\n` 归一化收敛到 prompt 组装后一处

## Capabilities

### New Capabilities

- `ghost-multiline-detection`: 基于 5 检测器链（AST 空块检测 + ML 评分 + 语言特性 + suffix 感知）判断 GHOST 补全应为单行还是多行，替代当前仅依赖行尾光标位置的简单启发式

### Modified Capabilities

<!-- No existing specs to modify -->

## Impact

- `src/completions/ghost/ghostTextComputer.ts` — 替换 `isSingleLine`，注入 `IMultilineStrategy`；修正 suffix 提取和 `\r\n` 归一化
- `src/completions/ghost/multiline/`（新建 ~17 个文件）：
  - 类型与接口：`types.ts`
  - 5 个检测器：`FileSizeGuardDetector.ts`、`NewLineDetector.ts`、`EmptyBlockDetector.ts`、`MLModelDetector.ts`、`SuffixPresenceDetector.ts`
  - 组合与策略：`DetectorChain.ts`、`DefaultMultilineStrategy.ts`、`MultilineContextBuilder.ts`
  - ML 模型：`multilineModel.ts`、`multilineModelWeights.ts`、`contextualFilterConstants.ts`
  - tree-sitter 层：`treeSitter/parse.ts`、`treeSitter/fileLoader.ts`、`treeSitter/error.ts`、`treeSitter/blockParser.ts`、`treeSitter/statementTree.ts`
- `dist/wasm/` — 12 个 tree-sitter `.wasm` 文件
- `src/completions/ghost/blockTrimmer.ts` — 新增 `BlockPositionType` + `getBlockPositionType()` + `BlockTrimmer.isSupported()`
- `src/extension.ts` — DI 注册 `IMultilineStrategy`
- 单元测试 — `src/test/ghost/multiline/`（9 个测试文件 + helpers）
- `package.json` — 新增 `web-tree-sitter` 依赖
