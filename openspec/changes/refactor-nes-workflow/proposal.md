## Why

当前 NES 实现中，`NesProvider` 将所有处理逻辑揉在一个方法里（prompt 构建、响应解析、后缀裁剪、编辑过滤），`NextCursorPredictor` 使用独立的简化 prompt 且仅 fire-and-forget，`responseFormatHandlers` 未真正解析边界标记。需要重构为与参考项目一致的面向对象架构，补齐缺失的数据处理环节。

## What Changes

- **新增 `EditWindowResolver`** — 编辑窗口范围计算 + merge conflict 标记检测与扩展
- **新增 `ResponsePipeline`** — Chain of Responsibility 管线：BoundaryMarkerParser → CursorTagStripper → SuffixOverlapTrimmer
- **新增 `EditFilterChain`** — Composite Pattern 编辑过滤器：Empty / Noop / Whitespace / CommentOnly
- **新增 `NesWorkflow`** — Template Method 编排单次 NES 完整流程（prompt 构建 → LLM 调用 → 响应解析 → 过滤）
- **重构 `NextCursorPredictor`** — 复用 `PromptPieces` / `constructTaggedFile` / `getUserPrompt` 管线；增加 `determineEnablement()`；`parseResponse` 增加 `keptRange` 范围校验
- **重构 `NextEditProvider`** — 从 fire-and-forget 改为 retry 编排器：NES 无结果时调用 CursorPredictor 预测新位置并重试 NES
- **简化 `NesProvider`** — 委托给 `NesWorkflow`，自身变为薄封装或移除
- **新增 Status Bar toggle** — QuickPick 增加 `Next Cursor Prediction` 开关，status bar 文本更新为 `CC [G/N/C]`
- **清理 `systemMessages.ts` / `getPostScript`** — 只保留 `PromptingStrategy.Xtab275` 路径，移除其他 strategy 分支

## Capabilities

### New Capabilities

- `nes-workflow`: NES 单次请求完整管线（编辑窗口计算 → prompt 构建 → 响应解析 → 编辑过滤）
- `nes-cursor-prediction`: 光标位置预测（复用 NES prompt 管线、enablement 控制、keptRange 校验）
- `nes-retry-orchestration`: NES 无结果时通过光标预测触发 retry 的编排逻辑

### Modified Capabilities

<!-- No existing specs to modify -->

## Impact

- **新增文件**: `core/editWindowResolver.ts`, `core/nesWorkflow.ts`, `response/responsePipeline.ts`, `response/editFilterChain.ts`
- **重构文件**: `nesProvider.ts`, `nextEditProvider.ts`, `nextCursorPredictor.ts`
- **修改文件**: `nesConfig.ts`, `configKeys.ts`, `statusBarPanel.ts`, `systemMessages.ts`, `types.ts`
- **不涉及**: LLM adapter 层、ghost 模块、缓存层
