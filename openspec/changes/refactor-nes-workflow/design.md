## Context

当前 `src/completions/nes/` 目录有 30 个文件，核心处理逻辑集中在 `nesProvider.ts` (297 行) 的 `provideNextEdit()` 方法中。`NextCursorPredictor` 使用独立简化 prompt，仅 fire-and-forget。`responseFormatHandlers.ts` 仅按换行 split，未真正解析 `###remain edit start/end boundary line###` 标记。

参考项目 `fake-vscode-copilot-chat/src/extension/xtab/` 使用面向对象设计的 `XtabProvider` + `XtabNextCursorPredictor`，cursor prediction 作为 NES 无结果时的 retry 机制。本项目需要对齐该架构，但保持非流式处理、非流式 prompt 结构、只保留 Xtab275 策略。

现有 DI 框架 (`IInstantiationService` + `SyncDescriptor`) 已就绪，新增类通过 DI 注入。

## Goals / Non-Goals

**Goals:**
- 新增 `EditWindowResolver`、`ResponsePipeline`、`EditFilterChain`、`NesWorkflow` 四个面向对象组件
- 重构 `NextCursorPredictor` 复用共享 prompt 管线，增加 enablement 控制
- 重构 `NextEditProvider` 为 retry 编排器
- Status bar 增加 Next Cursor Prediction toggle
- `getUserPrompt` 完整保留，`systemMessages`/`getPostScript` 仅保留 Xtab275 分支

**Non-Goals:**
- 流式处理管线
- JSON 响应格式
- Language context / neighbor snippets（缺少外部基础设施）
- 跨文件 cursor jump
- Edit intent 解析/过滤
- ResponseProcessor.diff()（整体替换，不做逐行 diff）
- Early divergence cancellation / Artificial delay（属于流式+UI 增强）

## Decisions

### 1. 类职责拆分原则

**Decision**: 按处理阶段拆分为独立类，通过 DI 注入组合。

```
NesWorkflow (Template Method)
  ├── EditWindowResolver   → 编辑窗口计算
  ├── PromptBuilder        → constructTaggedFile + getUserPrompt (已有，纯函数)
  ├── ILLMAdapter          → LLM 调用 (已有)
  ├── ResponsePipeline     → Chain: BoundaryParser → CursorTagStripper → SuffixOverlapTrimmer
  └── EditFilterChain      → Composite: Empty/Noop/Whitespace/CommentOnly
```

**Alternatives considered**:
- 全部保留在 NesProvider 一个类中 → 拒绝，无法单独测试或替换
- 拆为更多独立 service → 拒绝，当前规模不需要过度抽象

### 2. ResponsePipeline 设计

**Decision**: Chain of Responsibility，每个 stage 实现 `IResponseStage` 接口。

```
interface IResponseStage {
    readonly name: string;
    process(lines: string[]): string[];
}
```

管线顺序：`BoundaryMarkerParser` → `CursorTagStripper` → `SuffixOverlapTrimmer`

**Why**: 每个 stage 可独立测试，新增 stage 无需修改已有代码。

### 3. EditFilterChain 设计

**Decision**: Composite Pattern，每个 filter 实现 `IEditFilter` 接口。

```
interface IEditFilter {
    readonly name: string;
    shouldReject(editLines: string[], editWindowLines: string[]): boolean;
}
```

过滤器按序执行：`EmptyEditFilter` → `NoopEditFilter` → `WhitespaceOnlyFilter` → `CommentOnlyFilter`

**Why**: 每个过滤规则可独立单元测试，可灵活增删。

### 4. NextCursorPredictor 复用 PromptPieces

**Decision**: `NextCursorPredictor` 不自行构建 prompt，接收 NES 主流程已构建的 `PromptPieces`，用 cursor-prediction 专用配置（`includeLineNumbers: WithSpaceAfter`、`includeTags: false`、专用 `maxTokens`）重新调用 `constructTaggedFile` → `getUserPrompt`。

**Why**: 与参考项目 `XtabNextCursorPredictor.predictNextCursorPosition()` 完全一致，复用相同的 prompt 结构和标记。

### 5. NextEditProvider Retry 机制

**Decision**: 当 `NesWorkflow.execute()` 返回 `undefined`（无编辑建议）时，检查 `NextCursorPredictor.isEnabled()`，若启用则调用 `predict()`，对 same-file 预测结果 retry `NesWorkflow.execute()` 到新位置。

**Why**: 与参考项目 `doGetNextEditsWithCursorJump()` 逻辑一致。

### 6. 只保留 Xtab275

**Decision**: `pickSystemPrompt()` 直接返回 `xtab275SystemPrompt`；`getPostScript()` 去掉 switch，只保留 `PromptingStrategy.Xtab275` 分支。

**Why**: 项目当前仅使用 `PromptingStrategy.Xtab275`，其他策略无配置入口。

## Risks / Trade-offs

- **EditFilterChain 顺序敏感**: 空编辑过滤必须在 Noop 过滤之前 → 通过单元测试保证顺序
- **CursorPrediction 独立 LLM 调用增加延迟**: retry 路径需要额外一次网络请求 → 与参考项目行为一致，且仅在 NES 无结果时触发
- **keptRange 校验可能拒绝有效预测**: 参考项目在 `parseSameFileLineNumber` 中校验预测行号必须在 `keptRange` 内 → 边界情况需要测试覆盖
