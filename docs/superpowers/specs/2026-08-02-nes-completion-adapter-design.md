# NES Completion Adapter 支持 — 设计文档

**日期**: 2026-08-02
**状态**: 设计中

---

## 1. 概述

为 NES（Next Edit Suggestion）的 `NesWorkflow` 和 `NextCursorPredictor` 新增通过 `/completions` 端点（FIM/adapter）发送请求的能力，通过 `cc-completion.nes.endpoint` 配置项动态切换。

---

## 2. 动机

当前 NES 固定使用 Chat Completion API（`/chat/completions`），以 `messages` 数组（system + user）格式发送。某些部署场景下仅提供 `/completions` 端点，需要将 chat-style 消息通过模板渲染为纯文本 `prompt` 后发送。

---

## 3. 配置变更

### 3.1 `configKeys.ts` — 新增两个配置键

```typescript
Nes: {
    // ...existing keys...
    endpoint: 'cc-completion.nes.endpoint',
    promptTemplate: 'cc-completion.nes.promptTemplate',
}
```

### 3.2 配置项详情

| 键 | 类型 | 默认值 | 说明 |
|----|------|--------|------|
| `cc-completion.nes.endpoint` | `'completion' \| 'chat'` | `'chat'` | 控制发送请求时使用的 adapter 类型 |
| `cc-completion.nes.promptTemplate` | `string` | 见 §3.3 | 仅 `endpoint === 'completion'` 时使用，`{system}` / `{user}` 占位符 |

### 3.3 默认 `promptTemplate`

```
<|im_start|>system
{system}<|im_end|>
<|im_start|>user
{user}<|im_end|>
<|im_start|>assistant

```

### 3.4 `INesConfigProvider` 接口新增

```typescript
get endpoint(): 'completion' | 'chat';
get promptTemplate(): string;
```

### 3.5 `VSCodeNesConfigProvider` 实现

- `endpoint`：读取 `ConfigKeys.Nes.endpoint`，默认 `'chat'`，走现有 `_cached()` 缓存
- `promptTemplate`：读取 `ConfigKeys.Nes.promptTemplate`，默认值如上，走 `_cached()` 缓存

---

## 4. 请求构建层

### 4.1 工具函数 `renderCompletionPrompt`

新建于 `src/completions/nes/promptCraftingUtils.ts`（或就近放置）：

```typescript
export function renderCompletionPrompt(
    template: string,
    system: string,
    user: string,
): string {
    return template
        .replace('{system}', system)
        .replace('{user}', user);
}
```

- 纯文本替换，不涉及转义
- 若 `template` 不含占位符，结果即 template 原样（调用方自行保证）

### 4.2 `NesWorkflow` 分支逻辑

在 `execute()` 方法中，构建 LLM 请求时：

```typescript
// 现有代码
const endpoint = this._config.supportedEndpoint;  // chat/completions | responses | messages
const nesEndpoint = this._config.endpoint;         // 'completion' | 'chat'

if (nesEndpoint === 'completion') {
    const prompt = renderCompletionPrompt(
        this._config.promptTemplate,
        promptAssembly.systemPrompt,
        promptAssembly.userPrompt,
    );
    const adapter = this._llmManager.getAdapter('completions');
    const stream = adapter.sendStream({
        baseUrl: this._config.baseUrl,
        apiKey: this._config.apiKey,
        model: this._config.model,
        family: this._config.family,
        prompt,
        max_tokens: this._config.maxOutputTokens,
        temperature: 0,
        top_p: 1,
        n: 1,
        stream: this._config.stream,
        presence_penalty: this._config.presencePenalty,
        frequency_penalty: this._config.frequencyPenalty,
        stop: undefined,
        // 无 messages, 无 capabilities
    }, abortController.signal);
} else {
    // 现有 chat 逻辑不变
    const adapter = this._llmManager.getAdapter(endpoint);
    const stream = adapter.sendStream({
        // ...现有 messages + capabilities 参数不变
    }, abortController.signal);
}
```

### 4.3 `NextCursorPredictor` 分支逻辑

在 `predict()` 方法中，构建 LLM 请求时：

```typescript
const endpoint = this._config.supportedEndpoint;
const nesEndpoint = this._config.endpoint;

if (nesEndpoint === 'completion') {
    const prompt = renderCompletionPrompt(
        this._config.promptTemplate,
        'Your task is to predict the line number...',  // system
        userMessage + '\n\n **just output the line int number...**',  // user
    );
    const adapter = this._llmManager.getAdapter('completions');
    // adapter.send({ prompt, ... })
} else {
    // 现有 chat 逻辑不变
}
```

**注意**：`nextCursorPredictor` 当前使用 `adapter.send()`（非流式），completion 模式下同样使用 `send()`。

---

## 5. 端点与 Adapter 映射

| `nes.endpoint` | 使用的 adapter 端点 | `LLMRequest` 关键字段 |
|----------------|--------------------|-----------------------|
| `'chat'` | `this._config.supportedEndpoint`（默认 `'chat/completions'`） | `messages`, `capabilities` |
| `'completion'` | `'completions'` | `prompt`（无 `messages`, 无 `capabilities`） |

### 5.1 Adapter 注册

`OpenAICompletionAdapter` 已在 `extension.ts` 中注册到 `'completions'` 端点，无需额外改动：

```typescript
llmManager.register('completions', new OpenAICompletionAdapter(log));
```

---

## 6. 错误处理

| 场景 | 处理方式 |
|------|----------|
| `/completions` API 返回非 200 | `OpenAICompletionAdapter` 抛出 `LLMError`，由 `NesWorkflow` / `nextCursorPredictor` 现有 catch 块处理 |
| `AbortError` | `nextCursorPredictor` 返回 `Result.error('aborted')`；`NesWorkflow` 现有 1000ms 延迟 abort 逻辑对两种模式均适用 |
| 404 / not found | `nextCursorPredictor` 自禁用逻辑复用现有 catch 块 |
| `getAdapter('completions')` 未注册 | `LLMAdapterManager` 抛出 `Error`，由各自 try/catch 兜底 |

---

## 7. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/config/configKeys.ts` | 修改 | 新增 `Nes.endpoint`, `Nes.promptTemplate` |
| `src/config/nesConfig.ts` | 修改 | 接口 + 实现新增 `endpoint`, `promptTemplate` |
| `src/completions/nes/core/nesWorkflow.ts` | 修改 | 请求构建分支逻辑 |
| `src/completions/nes/nextCursorPredictor.ts` | 修改 | 请求构建分支逻辑 |
| `src/completions/nes/promptCraftingUtils.ts` | 修改 | 新增 `renderCompletionPrompt()` |
| `src/test/config/nesConfig.test.ts` | 修改 | 新增配置项测试 |
| `src/test/nes/` | 新增/修改 | `renderCompletionPrompt` 单元测试 |

**不需要变更**：
- `src/completions/shared/llm/` — Adapter 接口和实现完全不变
- `src/completions/ghost/` — Ghost 与本次改动无关
- `src/extension.ts` — adapter 注册已存在，无需改动

---

## 8. 测试策略

### 8.1 配置测试 (`nesConfig.test.ts`)

- `endpoint` 默认值为 `'chat'`
- `endpoint` 设为 `'completion'` 后正确读取
- `promptTemplate` 默认值为 `<|im_start|>` 模板
- 配置变更后缓存正确清除

### 8.2 工具函数测试

- `renderCompletionPrompt` 正确替换 `{system}` 和 `{user}`
- 空字符串输入处理
- 模板不含占位符时的行为

### 8.3 集成测试

- `endpoint='chat'` 时 NES 行为与现有完全一致（回归测试）
- `endpoint='completion'` 时 `LLMRequest` 包含 `prompt` 字段，不含 `messages`/`capabilities`

---

## 9. 向后兼容

- 默认 `endpoint = 'chat'`，现有行为**完全不变**
- `supportedEndpoint` 字段保持不变，`endpoint='chat'` 时继续使用
- 所有现有测试无需修改
