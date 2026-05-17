## 1. 类型与接口定义

- [x] 1.1 新建 `src/completions/ghost/multiline/types.ts` — 定义 `MultilineContext`、`DetectionResult`、`IMultilineDetector`、`IMultilineStrategy` 接口

## 2. 数据文件移植

- [x] 2.1 新建 `src/completions/ghost/multiline/contextualFilterConstants.ts` — 从参考项目移植字符→整数映射表
- [x] 2.2 新建 `src/completions/ghost/multiline/multilineModelWeights.ts` — 移植 `multilineModelPredict()` 权重矩阵

## 3. MLModelDetector 实现

- [x] 3.1 新建 `src/completions/ghost/multiline/multilineModel.ts` — 移植 `PromptFeatures`、`MultilineModelFeatures`、`requestMultilineScore` 纯函数
- [x] 3.2 新建 `src/completions/ghost/multiline/MLModelDetector.ts` — 实现 `IMultilineDetector`，封装阈值比较逻辑

## 4. 结构型检测器实现

- [x] 4.1 增强 `src/completions/ghost/blockTrimmer.ts` — 移植 `BlockPositionType` 枚举 + `getBlockPositionType()` + `BlockTrimmer.isSupported()`
- [x] 4.2 新建 `src/completions/ghost/multiline/FileSizeGuardDetector.ts` — 实现 `IMultilineDetector`，行数阈值守卫
- [x] 4.3 新建 `src/completions/ghost/multiline/NewLineDetector.ts` — 实现 `IMultilineDetector`，TypeScript/TSX 空行检测
- [x] 4.4 新建 `src/completions/ghost/multiline/EmptyBlockDetector.ts` — 实现 `IMultilineDetector`，stub 版（tree-sitter 集成后重构）

## 5. 组合与策略

- [x] 5.1 新建 `src/completions/ghost/multiline/DetectorChain.ts` — 实现 Composite 模式，按序短路求值，默认 fallback 单行
- [x] 5.2 新建 `src/completions/ghost/multiline/DefaultMultilineStrategy.ts` — 实现 `IMultilineStrategy`，组装 DetectorChain + afterAccept 覆写
- [x] 5.3 新建 `src/completions/ghost/multiline/MultilineContextBuilder.ts` — Builder 模式构造 `MultilineContext`

## 6. GhostTextComputer 集成

- [x] 6.1 修正 `ghostTextComputer.ts` 中 suffix 提取方式 — `document.offsetAt(position)` + `substring(offset)` 再 `.replace(/\r/g, '')`，替换 `position.line + 1`；prefix 去除早期 `\r\n` → `\n` 归一化
- [x] 6.2 替换 `isSingleLine` 为 `this.multilineStrategy.determineMultiline(ctx)` — 驱动 stop token / BlockTrimmer / maxTokens
- [x] 6.3 注册 DI — `IMultilineStrategy` → `DefaultMultilineStrategy` (SyncDescriptor)，注入 `GhostTextComputer`
- [x] 6.4 `promptFactory.ts` — `createPrompt` 中 `{prefix}` 替换为 `'\n' + context + prefix`，`{suffix}` 替换为 `'\n' + suffix`，确保 FIM sentinel 后都有前导换行

## 7. 单元测试

- [x] 7.1 `multiline/types.test.ts` — 验证接口类型编译期正确
- [x] 7.2 `multiline/MLModelDetector.test.ts` — 验证 14 维特征提取 + 阈值边界
- [x] 7.3 `multiline/FileSizeGuardDetector.test.ts` — 验证阈值守卫短路
- [x] 7.4 `multiline/NewLineDetector.test.ts` — 验证空行/非空行/非目标语言分支
- [x] 7.5 `multiline/EmptyBlockDetector.test.ts` — 验证空块/非空块/inline双位置/不支持语言
- [x] 7.6 `multiline/DetectorChain.test.ts` — 验证链式短路 + 默认 fallback
- [x] 7.7 `multiline/DefaultMultilineStrategy.test.ts` — 验证 afterAccept 覆写 + 正常链路
- [x] 7.8 `ghostTextComputer.test.ts` — 回归测试：FIM 行尾+非空 suffix → 输出多行

## 8. SuffixPresenceDetector（语言无关 FIM fallback）

- [x] 8.1 新建 `src/completions/ghost/multiline/SuffixPresenceDetector.ts` — 实现 `IMultilineDetector`，`!isMiddleOfTheLine && suffix.trim() !== '' → multiline`
- [x] 8.2 追加 `SuffixPresenceDetector` 到 `DefaultMultilineStrategy` 的 DetectorChain 末尾（MLModel 之后）
- [x] 8.3 `multiline/SuffixPresenceDetector.test.ts` — 验证行尾+非空 suffix → multiline / inline → defer / 空 suffix → defer

## 9. Tree-sitter WASM 文件移植

- [x] 9.1 创建 `dist/wasm/` 目录，从参考项目 `dist/` 拷贝 12 个 `.wasm` 文件
- [x] 9.2 配置 webpack `copy-webpack-plugin` 将 `dist/wasm/` 拷贝到输出目录

## 10. Tree-sitter parse 层移植

- [x] 10.1 新建 `src/completions/ghost/multiline/treeSitter/error.ts` — 移植 `CopilotPromptLoadFailure` 异常类
- [x] 10.2 新建 `src/completions/ghost/multiline/treeSitter/fileLoader.ts` — 移植 `readFile` + `locateFile`，`locateFile` 适配 VS Code extension 路径（`context.extensionUri.fsPath + '/dist/wasm/'`）
- [x] 10.3 新建 `src/completions/ghost/multiline/treeSitter/parse.ts` — 移植 `WASMLanguage` 枚举 + `languageIdToWasmLanguageMapping` + `isSupportedLanguageId`（放开 cpp/c/java/php/csharp）+ `parseTreeSitter` + `parseTreeSitterIncludingVersion`
- [x] 10.4 新建 `src/completions/ghost/multiline/treeSitter/statementTree.ts` — 移植 `StatementNode` + `StatementTree` 抽象语法树类
- [x] 10.5 新建 `src/completions/ghost/multiline/treeSitter/blockParser.ts` — 移植 `isEmptyBlockStart` + `getBlockParser`（仅 `isEmptyBlockStart` 完整移植，`isBlockBodyFinished`/`getNodeStart` 空实现）

## 11. EmptyBlockDetector 重构 + DI/配置

- [x] 11.1 重构 `EmptyBlockDetector.ts` — 将 stub `isEmptyBlockStart` 替换为调用 `treeSitter/blockParser.ts` 的真实实现
- [x] 11.2 安装 `web-tree-sitter` npm 依赖
- [x] 11.3 `extension.ts` 或 `activate()` 中传递 `vscode.ExtensionContext` 给 `fileLoader` 用于 WASM 路径解析

## 12. 单元测试（追加）

- [x] 12.1 `multiline/SuffixPresenceDetector.test.ts` — 行尾+非空 suffix / inline / 空 suffix 三个分支
- [x] 12.2 `multiline/DefaultMultilineStrategy.test.ts` 更新 — 验证链包含 5 个 detector + async 适配
- [x] 12.3 `ghostTextComputer.test.ts` 更新 — 验证 C++ FIM 场景（光标行尾 + 非空 suffix）→ multiline=true
