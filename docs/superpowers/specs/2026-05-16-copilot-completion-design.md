# copilot-completion 插件设计规格

## 概述

从 `fake-vscode-copilot-chat` 项目中提取 Ghost 补全和 NES 补全功能，构建独立的 VS Code 插件 `copilot-completion`。去掉权限校验、账号校验、遥测反馈上报等无关功能。

---

## 架构

分层 + 模块独立架构：

```
UI Layer:            StatusBar WebView Panel
                     ↓
Completion Layer:    GHOST Module (FIM)    NES Module (Next Edit)
                     ↓                     ↓
LLM Adapter Layer:   OpenAI Chat / Responses / Anthropic / OpenAI Completion
                     ↓
Configuration Layer: GHOST Config          NES Config
                     ↓
DI Infrastructure:   createDecorator + SyncDescriptor + InstantiationService
```

- GHOST 和 NES 各自独立模块，仅通过 DI 接口通信
- LLM 适配器层用策略模式封装 4 种 endpoint
- 完全从 `fake-vscode-copilot-chat` 复制 DI 基础设施
- 设计模式合理应用，不强制凑齐 23 种 GoF

---

## 目录结构

```
src/
├── extension.ts                          # 入口：创建 DI、注册服务、激活
├── di/                                   # DI 基础设施 (从 fake-vscode-copilot-chat 复制)
│   ├── instantiation.ts                  #   createDecorator, ServiceIdentifier, IInstantiationService
│   ├── instantiationService.ts           #   InstantiationService 实现
│   ├── descriptors.ts                    #   SyncDescriptor
│   ├── serviceCollection.ts              #   ServiceCollection
│   └── services.ts                       #   InstantiationServiceBuilder + createServiceIdentifier 重导出
│
├── config/                               # 配置层
│   ├── configKeys.ts                     #   所有 configuration key 常量
│   ├── ghostConfig.ts                    #   IGhostConfigProvider 接口 + VSCode 实现
│   └── nesConfig.ts                      #   INesConfigProvider 接口 + VSCode 实现
│
├── completions/                          # 补全功能层
│   ├── ghost/                            # GHOST FIM 补全模块
│   │   ├── ghostTextProvider.ts          #   VS Code InlineCompletionItemProvider
│   │   ├── ghostTextComputer.ts          #   核心 FIM 补全流水线
│   │   ├── ghostTextStrategy.ts          #   策略选择 (行内/多行/block)
│   │   ├── inlineSuggestion.ts           #   行内补全位置验证 (3 态逻辑, 移植自源项目)
│   │   ├── promptFactory.ts              #   模板 + 上下文 prompt 生成
│   │   ├── recentEditsProvider.ts        #   RecentEdit 记录与查询
│   │   ├── completionsCache.ts           #   LRU 缓存
│   │   ├── asyncCompletions.ts           #   异步请求管理
│   │   ├── current.ts                    #   "typing as suggested" 状态
│   │   ├── last.ts                       #   上次补全跟踪 (accept/reject)
│   │   ├── blockTrimmer.ts               #   Block 修剪
│   │   ├── normalizeIndent.ts            #   缩进规范化
│   │   ├── inlineCompletion.ts           #   公开 API 入口
│   │   ├── resultType.ts                 #   结果类型枚举
│   │   ├── requestContext.ts             #   请求上下文
│   │   └── types.ts                      #   内部类型定义
│   │
│   ├── nes/                              # NES 补全模块
│   │   ├── nesProvider.ts                #   无状态 NES provider (XtabProvider 核心)
│   │   ├── nextEditProvider.ts           #   有状态编排器
│   │   ├── promptCrafting.ts             #   Prompt 构建
│   │   ├── systemMessages.ts             #   系统 prompt 定义
│   │   ├── responseFormatHandlers.ts     #   响应格式解析
│   │   ├── editIntent.ts                 #   编辑意图解析
│   │   ├── nextEditCache.ts              #   文档级编辑缓存
│   │   ├── speculativeRequest.ts         #   推测性预取管理
│   │   ├── editRebase.ts                 #   编辑 rebase 算法
│   │   ├── cursorLineDivergence.ts       #   提前分叉检测
│   │   ├── suffixOverlapTrim.ts           #   后缀重叠检测与裁剪 (TrimNESResponseSuffixOverlap)
│   │   └── types.ts                      #   内部类型定义
│   │
│   └── shared/                           # GHOST/NES 共享
│       ├── log/
│       │   ├── logService.ts              #   VS Code LogOutputChannel 封装
│       │   └── srcLoc.ts                  #   栈追踪解析 — 日志中输出源码文件名:行号
│       ├── document/
│       │   ├── documentTracker.ts        #   文档变更跟踪
│       │   └── textDocumentManager.ts    #   文档适配器
│       └── llm/                          # LLM 适配器层
│           ├── llmAdapter.ts             #   ILLMAdapter 统一接口 + ILLMAdapterManager
│           ├── llmRequest.ts             #   请求/响应类型定义
│           ├── openaiChatAdapter.ts      #   /v1/chat/completions (NES)
│           ├── openaiResponseAdapter.ts  #   /v1/responses (NES)
│           ├── anthropicAdapter.ts       #   /v1/messages (NES)
│           └── openaiCompletionAdapter.ts  # /v1/completions (GHOST FIM)
│
├── ui/                                   # UI 层
│   └── statusBarPanel.ts                 # StatusBar 按钮 + WebView 面板
│
└── test/                                 # 单元测试 (与 src 结构镜像)
    ├── config/
    │   ├── ghostConfig.test.ts
    │   └── nesConfig.test.ts
    ├── ghost/
    │   ├── promptFactory.test.ts
    │   ├── recentEditsProvider.test.ts
    │   ├── ghostTextComputer.test.ts
    │   ├── completionsCache.test.ts
    │   ├── blockTrimmer.test.ts
    │   └── inlineCompletion.test.ts
    ├── nes/
    │   ├── nesProvider.test.ts
    │   ├── promptCrafting.test.ts
    │   ├── responseFormatHandlers.test.ts
    │   ├── editRebase.test.ts
    │   ├── nextEditCache.test.ts
    │   └── suffixOverlapTrim.test.ts
    ├── llm/
    │   ├── openaiChatAdapter.test.ts
    │   ├── openaiResponseAdapter.test.ts
    │   ├── anthropicAdapter.test.ts
    │   └── openaiCompletionAdapter.test.ts
    └── ui/
        └── statusBarPanel.test.ts
```

---

## 依赖注入

### 基础设施

从 `fake-vscode-copilot-chat` 复制以下文件，不做修改：

| 文件 | 作用 |
|------|------|
| `di/instantiation.ts` | `createDecorator` (别名 `createServiceIdentifier`), `IInstantiationService`, `ServiceIdentifier`, `ServicesAccessor` |
| `di/instantiationService.ts` | `InstantiationService` 实现 (懒解析、proxy 延迟注入、循环检测) |
| `di/descriptors.ts` | `SyncDescriptor` (构造函数包装器，支持静态参数) |
| `di/serviceCollection.ts` | `ServiceCollection` (服务注册表) |
| `di/services.ts` | `InstantiationServiceBuilder` 和 `createServiceIdentifier` 重导出 |

### 核心 Service Identifiers

```typescript
// 配置层
IGhostConfigProvider   — 读取 GHOST 配置 (baseUrl, apiKey, model, promptTemplate, enables...)
INesConfigProvider     — 读取 NES 配置 (baseUrl, apiKey, model, supportedEndpoint, enables...)

// LLM 适配器层
ILLMAdapterManager     — 根据 endpoint 返回对应 ILLMAdapter

// GHOST 模块
IGhostTextProvider       — VS Code InlineCompletionItemProvider 注册
IGhostPromptFactory      — FIM prompt 生成
IGhostCompletionsCache   — 补全结果缓存
IRecentEditsProvider      — RecentEdit 记录与查询（供 GHOST prompt 使用）

// NES 模块
INesProvider           — NES InlineCompletionItemProvider 注册
INextEditCache         — NES 编辑缓存

// 基础设施
ILogService            — VS Code LogOutputChannel 日志输出

// UI
IStatusBarPanel        — StatusBar + WebView 注册
```

### 注册方式

- **直接实例**（无依赖）: `builder.define(IGhostConfigProvider, new VSCodeGhostConfigProvider())`
- **SyncDescriptor**（有依赖，懒加载）: `builder.define(IGhostTextProvider, new SyncDescriptor(GhostTextProvider))`

### 构造函数注入示例

```typescript
class GhostTextProvider implements IGhostTextProvider {
    constructor(
        @IGhostConfigProvider private readonly config: IGhostConfigProvider,
        @IGhostPromptFactory private readonly promptFactory: IGhostPromptFactory,
        @IGhostCompletionsCache private readonly cache: IGhostCompletionsCache,
        @ILLMAdapterManager private readonly llmManager: ILLMAdapterManager,
    ) {}
}
```

---

## 配置

### GHOST 配置 (`cc-completion.ghost.*`)

| 键 | 类型 | 默认值 | 说明 |
|----|------|--------|------|
| `enabled` | boolean | `true` | 是否启用 GHOST |
| `baseUrl` | string | `""` | API base URL |
| `apiKey` | string | `""` | API key |
| `model` | string | `"gpt-4o"` | 模型名称 |
| `promptTemplate` | string | `"<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>"` | FIM prompt 模板 |
| `capabilities.limits.max_output_tokens` | number | `256` | 最大输出 token（硬上限，算法逻辑确定的 token 数未超过此值时以算法为准） |
| `capabilities.limits.max_context_window_tokens` | number | `128000` | 最大上下文窗口 |
| `suffixOverlapThreshold` | number | `0.6` | 后缀重叠裁剪相似度阈值 |
| `suffixOverlapType` | enum | `"low"` | 后缀重叠裁剪类型: `"low"` 或 `"high"` |

### NES 配置 (`cc-completion.nes.*`)

| 键 | 类型 | 默认值 | 说明 |
|----|------|--------|------|
| `enabled` | boolean | `true` | 是否启用 NES |
| `baseUrl` | string | `""` | API base URL |
| `apiKey` | string | `""` | API key |
| `model` | string | `"gpt-4o"` | 模型名称 |
| `supportedEndpoint` | enum | `"/chat/completions"` | API endpoint: `/chat/completions`, `/responses`, `/v1/messages` |
| `capabilities.limits.max_output_tokens` | number | `4096` | 最大输出 token（硬上限，算法逻辑确定的 token 数未超过此值时以算法为准） |
| `capabilities.limits.max_context_window_tokens` | number | `128000` | 最大上下文窗口 |
| `capabilities.supports.thinking` | boolean | `false` | 是否支持 thinking |
| `suffixOverlapThreshold` | number | `0.5` | 后缀重叠裁剪相似度阈值 (TrimNESResponseSuffixOverlap) |
| `suffixOverlapType` | enum | `"low"` | 后缀重叠裁剪类型: `"low"` 或 `"high"` |
| `capabilities.supports.reasoning_effort` | string[] | `[]` | 支持的 reasoning 级别 |

---

## LLM 适配器层

### 统一请求/响应模型

```typescript
interface LLMRequest {
    messages?: ChatMessage[];   // NES 使用
    prompt?: string;            // GHOST 使用
    max_tokens: number;
    temperature: number;
    stop?: string[];
    capabilities?: Capabilities;
}

interface LLMResponse {
    text: string;
    finishReason: string;
    usage?: TokenUsage;
}
```

### 四种适配器

| Adapter | Endpoint | 用于 | stream |
|---------|----------|------|--------|
| `OpenAIChatAdapter` | `/v1/chat/completions` | NES | **false** |
| `OpenAIResponseAdapter` | `/v1/responses` | NES | **false** |
| `AnthropicAdapter` | `/v1/messages` | NES | **false** |
| `OpenAICompletionAdapter` | `/v1/completions` | GHOST | **false** |

- **所有适配器使用 `stream: false`**，返回完整 JSON 响应
- 纯 `fetch` HTTP 请求，不依赖任何 SDK
- NES 通过 `INesConfigProvider.getSupportedEndpoint()` 选择适配器
- GHOST 固定使用 `/v1/completions`

### 适配器职责

1. 将 `LLMRequest` 映射为目标 API 格式
2. `fetch(url, {method:'POST', headers, body})` 发送请求
3. 解析响应为统一 `LLMResponse`
4. HTTP 错误 → 统一异常类型

---

## GHOST 补全模块

### Prompt 生成

**简化模板替换**：用户配置模板字符串，运行时替换占位符。

- `{prefix}` → 光标前的代码文本
- `{suffix}` → 光标后的代码文本（**保持原样，不去除首行起始空格**）
- 在 prompt 前追加基础上下文：
  - 语言 ID：`// language: <languageId>`
  - Diagnostics 摘要：`// diagnostics: [Line N] <message>`
  - RecentEdits：`// recent edits:\n<diff_1>\n<diff_2>...`（用户最近的文档编辑变更记录，帮助模型理解当前修改意图）

**示例：**

```
// language: typescript
// diagnostics: [Line 1] missing return type
// recent edits:
// +  function calculate(a: number, b: number) {
// +    return a + b;
// +  }
<|fim_prefix|>function hello() {
  console.log('hi')
}<|fim_suffix|>
}<|fim_middle|>
```

### 核心流水线

```
GhostTextComputer
  1. 位置验证 → `isInlineSuggestionFromTextAfterCursor()` (3 态: false=行尾/true=行中闭合符号/undefined=中止)
  2. 上下文收集 → 文件 prefix/suffix + diagnostics + languageId + recentEdits
  3. Prompt 生成 → GhostPromptFactory.createPrompt()
  4. 策略选择 → GhostTextStrategy (行内/多行/block)
  5. 缓存查询 → GhostCompletionsCache
  6. 网络请求 → OpenAIChatAdapter (/v1/completions, stream:false)
  7. 后处理 → BlockTrimmer, normalizeIndent
  8. 返回结果 → vscode.InlineCompletionItem
```

### GHOST 功能范围

- FIM 模板 prompt 生成（含语言 ID + diagnostics + recentEdits 上下文）
- 行内/多行/block 模式策略
- LRU 缓存 (prefix-suffix → choices)
- "typing as suggested" 状态跟踪
- Block 修剪 (TerseBlockTrimmer/VerboseBlockTrimmer)
- 缩进规范化
- RecentEdits 记录与查询（用户最近文档编辑 diff）
- ~~遥测反馈上报~~

---

## NES 补全模块

### 策略

**仅使用 `PromptingStrategy.Xtab275`**

- 系统 prompt: `"Predict the next code edit based on user context, following Microsoft content policies and avoiding copyright violations. If a request may breach guidelines, reply: 'Sorry, I can't assist with that.'"`
- 响应格式: `ResponseFormat.EditWindowOnly` (返回代码行，不做额外解析)

### Prompt 构建

**与 `fake-vscode-copilot-chat` 原始实现保持一致**，完整移植 `promptCrafting.ts` 的 `getUserPrompt()` 和 `PromptPieces` 机制：

```
1. 当前文件标记: 编辑窗口 (光标上 2 行 + 下 5 行) 用 <edit_window> 标签包裹
   - 内部用 `###remain edit start boundary line###` / `###remain edit end boundary line###` 标记编辑边界
2. 周围上下文: 15 行代码 (用 <area_around> 标签包裹)
3. 语言上下文 (languageContext)
4. Lint 错误格式化 (lintErrors)
5. 编辑 diff 历史 (editHistory — 用户的修改轨迹)
6. 最近查看文件片段 (recentFiles)
7. PostScript — 输出格式指令
```

不简化，保持与源项目完全一致的 prompt 结构。同时保留 `tags.ts` 中的 PromptTags / ResponseTags 常量定义。

### 核心流水线

```
NextEditProvider (有状态编排器)
  │
  ├── 缓存查询 → NextEditCache.lookupNextEdit()
  │     ├── 精确匹配 → 直接返回
  │     └── Rebase → tryRebase() 适配用户编辑
  │
  ├── 无缓存 → NesProvider.provideNextEdit() (无状态)
  │     1. 构建 PromptPieces (文档、编辑窗口、上下文)
  │     2. getUserPrompt() → 用户 prompt 字符串
  │     3. pickSystemPrompt(strategy) → 系统 prompt
  │     4. LLMAdapter.send() → 非流式请求
  │     5. handleEditWindowOnly() → 解析响应
  │     6. diff() → diff 模型输出与编辑窗口
  │     7. suffixOverlapTrim() → 基于 Levenshtein 相似度裁剪后缀重叠行
│     8. filterEdit() → 过滤空/noop/注释/光标移动编辑
  │
  ├── 推测性预取 → SpeculativeRequestManager
  │     └── 接受编辑后预取下一个编辑
  │
  └── 提前分叉检测 → CursorLineDivergence
```

### NES 功能范围

- Prompt 构建 (Xtab275 策略)
- 响应解析 (EditWindowOnly 格式)
- 编辑缓存 + Rebase
- 推测性预取
- 提前分叉检测
- 后缀重叠裁剪 (TrimNESResponseSuffixOverlap，Levenshtein 相似度算法)
- 编辑意图解析
- ~~遥测反馈上报~~
- ~~RejectionCollector~~

---

## QuickPick 状态栏控制

### 按钮

- 位置：VS Code 状态栏，靠右对齐
- 显示：`$(sparkle) CC [G/N]` — G=GHOST, N=NES 当前状态
- 点击：弹出 `vscode.window.showQuickPick` 下拉菜单
- 点击：弹出 `vscode.window.showQuickPick`

### QuickPick 菜单

```
┌──────────────────────────────────────────────┐
│  CC Completion                               │
│                                              │
│  ☑ Ghost Inline Completion (GHOST): ON       │
│    Click to disable                          │
│  ☑ Next Edit Suggestion (NES): ON            │
│    Click to enable                           │
└──────────────────────────────────────────────┘
```

- 选项切换 → `Configuration.update()` → 触发 `onDidChangeEnabled` → Provider 动态注册/注销

---

---
## 取消机制

- 所有 `provideInlineCompletionItems` 传递 VS Code `CancellationToken` 到底层 Provider
- Provider 内部创建 `AbortController`，通过 `token.onCancellationRequested` 触发 `abort()`
- LLM 适配器 `send(request, signal?)` 接受 `AbortSignal`，传递给 `fetch(signal)`
- 取消点覆盖：请求前、缓存查询后、prompt 构建后、网络请求中
- `AbortError` 被捕获并返回 `undefined`（不报错）

## GHOST 流程缺失补齐

相对于原始实现，当前实现做了以下简化/保留：

| 步骤 | 状态 |
|------|------|
| `isInlineSuggestion()` 位置验证 (3 态: false/true/undefined) | ✅ 移植自源项目 `inlineSuggestion.ts` |
| prefix/suffix 提取 | ✅ 保留 |
| 缓存查询 (prefix-suffix → choices) | ✅ 保留 |
| diagnostics + recentEdits 收集 | ✅ 保留 |
| FIM 模板 prompt 构建 | ✅ 保留 |
| 策略选择 (singleLine/multiline/tokens) | ✅ 保留 |
| `CancellationToken` 检查点 | ✅ 已补 |
| `postProcessChoiceInContext` (缩进规范化) | ✅ 已补 |
| `adjustLeadingWhitespace` (displayText 分离) | ✅ 已补 |
| 字符级后缀重叠裁剪 (`_trimCharOverlap`) | ✅ 已补 |
| 行级后缀重叠裁剪 (`TrimNESResponseSuffixOverlap`) | ✅ 已补 |
| `suffixCoverage` 计算 | ✅ 已补 |
| ~~JSX 组件系统 / context providers~~ | ❌ 按需求移除 |
| ~~Streaming / progressive reveal~~ | ❌ 按需求移除 (stream=false) |

## NES 流程缺失补齐

| 步骤 | 状态 |
|------|------|
| PromptPieces + getUserPrompt 构建 | ✅ 保留 |
| systemPrompt (Xtab275) | ✅ 保留 |
| 网络请求 (非流式) | ✅ 保留 |
| 响应解析 (EditWindowOnly) | ✅ 保留 |
| `CancellationToken` 检查点 | ✅ 已补 |
| `filterEdit()` (空/noop/空白/注释编辑过滤) | ✅ 已补 |
| 后缀重叠裁剪 (TrimNESResponseSuffixOverlap) | ✅ 保留 |
| 编辑缓存 + Rebase | ✅ 保留 |
| 推测性预取 | ✅ 保留 |
| ~~完整的 getUserPrompt (diff history, recent files)~~ | ❌ 简化版 |
| ~~ResponseProcessor.diff() 精确 diff~~ | ❌ 简化版 |
| ~~光标跳转预测~~ | ❌ 按需求移除 |
| ~~早期分叉检测~~ | ❌ 按需求移除 |

---
## 单元测试

- **框架**: mocha + @vscode/test-cli (沿用脚手架)
- **覆盖**: 所有功能模块
- **Mock**: 使用 Sinon 或手动 mock，不引入额外依赖
- **测试镜像**: test 目录结构与 src 一一对应

---
## 变更记录 (vs 原始 plan)

| 日期 | 变更 | 说明 |
|------|------|------|
| 2026-05-16 | WebView → QuickPick | 控制面板改用 `showQuickPick`，避免 WebView CSP/ServiceWorker 问题 |
| 2026-05-16 | GHOST 后缀重叠裁剪 | 移植 `_trimCharOverlap` (字符级首行比较) + `TrimNESResponseSuffixOverlap` (行级 Levenshtein) |
| 2026-05-16 | GHOST `isInlineSuggestion` | 从源项目移植 3 态逻辑 (`inlineSuggestion.ts`) — `false`=行尾/`true`=行中闭合/`undefined`=中止 |
| 2026-05-16 | CancellationToken 机制 | GHOST+NES 全链路 `CancellationToken` → `AbortController` → `fetch(signal)`，防止请求堆积 |
| 2026-05-16 | LLM Adapter `AbortSignal` | `ILLMAdapter.send(request, signal?)` 支持可选 AbortSignal |
| 2026-05-16 | GHOST 缺失步骤补齐 | `postProcessChoiceInContext` (缩进规范) / `adjustLeadingWhitespace` (displayText 分离) / `_calcSuffixCoverage` |
| 2026-05-16 | NES 缺失步骤补齐 | `_shouldRejectEdit` (空/noop/空白/注释编辑过滤) / `_getEditWindowLines` |
| 2026-05-16 | 源码行号日志 | `srcLoc()` 工具函数 — 从 `Error().stack` 提取调用者 `文件名:行号`，格式 `ghostTextComputer.ts:47` |
| 2026-05-16 | GHOST suffixOverlap 配置 | 新增 `cc-completion.ghost.suffixOverlapThreshold` (0.6) / `suffixOverlapType` ("low") |

---

### 日志

使用 VS Code `LogOutputChannel` (`vscode.window.createOutputChannel({ log: true })`)，通过 `ILogService` 注入到各模块。日志级别：`info`/`warn`/`error`/`debug`，输出到 `CC Completion` channel。

---

## 实现约束

1. **不移植权限校验、账号校验** — 无 auth 模块
2. **不移植遥测反馈** — 无 telemetry 模块、无 RejectionCollector、无反馈上报
3. **NES 仅 Xtab275 策略** — 不保留其他 PromptingStrategy
4. **GHOST 仅 FIM** — 不保留 JSX 组件系统、context providers、similar files、code snippets 等复杂 prompt 组装；保留 RecentEdits 作为 prompt 上下文
5. **stream: false** — 所有 LLM 请求非流式
6. **配置分离** — GHOST 和 NES 各自独立的 model/capabilities 配置
7. **去不掉的前置空格** — suffix 保持与文档一致，不去除首行起始空格
