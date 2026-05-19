## 1. 配置 & 类型准备

- [x] 1.1 `configKeys.ts` 添加 `Nes.nextCursorPredictionEnabled` 配置键
- [x] 1.2 `nesConfig.ts` 增加 `nextCursorPredictionEnabled` getter + change listener
- [x] 1.3 `types.ts` 扩展 `NextEditResult`，增加可选的 `cursorPrediction` 字段

## 2. 新增响应处理组件

- [x] 2.1 新建 `response/responsePipeline.ts`：`IResponseStage` 接口 + `ResponsePipeline` 类
- [x] 2.2 `ResponsePipeline` 实现 `BoundaryMarkerParser` stage（提取 `###remain edit start/end boundary line###` 之间的行）
- [x] 2.3 `ResponsePipeline` 实现 `CursorTagStripper` stage（条件移除 `<|cursor|>`）
- [x] 2.4 `ResponsePipeline` 集成已有的 `TrimNESResponseSuffixOverlap` 为第三个 stage

## 3. 新增编辑过滤组件

- [x] 3.1 新建 `response/editFilterChain.ts`：`IEditFilter` 接口 + `EditFilterChain` 类
- [x] 3.2 实现 `EmptyEditFilter`（拒绝空/纯空白编辑）
- [x] 3.3 实现 `NoopEditFilter`（拒绝与原文相同的编辑）
- [x] 3.4 实现 `WhitespaceOnlyFilter`（拒绝仅空白差异的编辑）
- [x] 3.5 实现 `CommentOnlyFilter`（拒绝仅注释变更的编辑）

## 4. 新增核心组件

- [x] 4.1 新建 `core/editWindowResolver.ts`：`EditWindowResolver` 类，计算编辑窗口范围 + merge conflict 检测扩展
- [x] 4.2 新建 `core/nesWorkflow.ts`：`NesWorkflow` 类（Template Method），编排单次 NES 完整流程：编辑窗口 → prompt → LLM → 响应管线 → 过滤 → 缓存

## 5. 重构 NextCursorPredictor

- [x] 5.1 重构 `nextCursorPredictor.ts`：改用 `PromptPieces` + `constructTaggedFile` + `getUserPrompt` 构建 prompt
- [x] 5.2 增加 `determineEnablement()` 方法（检查配置 + `isDisabled` flag）
- [x] 5.3 增加 `predict()` 方法接收 `PromptPieces` 参数
- [x] 5.4 重构 `parseResponse()` 增加 `keptRange` 范围校验

## 6. 重构 NextEditProvider（编排器）

- [x] 6.1 重构 `nextEditProvider.ts`：注入 `NesWorkflow` + `NextCursorPredictor`
- [x] 6.2 实现 retry 逻辑：NES 无结果 → 检查 token 取消 + enablement → CursorPredictor.predict() → same-file retry `NesWorkflow.execute()`

## 7. 简化 NesProvider & 清理

- [x] 7.1 简化 `nesProvider.ts`：委托给 `NesWorkflow`，移除已抽离的内联逻辑
- [x] 7.2 `systemMessages.ts` 去掉 switch，只保留 `xtab275SystemPrompt`
- [x] 7.3 `promptCrafting.ts` 中 `getPostScript()` 去掉 switch，只保留 `PromptingStrategy.Xtab275` 分支

## 8. Status Bar

- [x] 8.1 `statusBarPanel.ts`：QuickPick 增加第三项 `Next Cursor Prediction (NCP)` toggle
- [x] 8.2 `_updateStatusBar()` 更新文本为 `CC [G/N/C]`（C 仅在 cursor prediction 开启时显示）

## 9. DI 注册

- [x] 9.1 `extension.ts` 注册新组件（`EditWindowResolver`、`NesWorkflow`、`ResponsePipeline`、`EditFilterChain`）— DI 自动解析
- [x] 9.2 确保 `NextEditProvider` 通过 DI 获取 `NesWorkflow` 和 `NextCursorPredictor`

## 10. 测试 & 验证

- [x] 10.1 `responsePipeline.test.ts`：测试 BoundaryParser、CursorTagStripper、管道组合
- [x] 10.2 `editFilterChain.test.ts`：测试各个 filter 及链式组合
- [x] 10.3 `nextCursorPredictor.test.ts`：测试 enablement、parseResponse with keptRange
- [ ] 10.4 端到端手动验证：打开文件，确认 NES inline completion 正常弹出，status bar toggle 功能正常
