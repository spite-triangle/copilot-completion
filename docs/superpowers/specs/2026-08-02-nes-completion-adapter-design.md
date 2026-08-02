# NES Completion Adapter 支持 — 设计文档

**日期**: 2026-08-02
**状态**: 设计中

---

## 1. 概述

为 NES（Next Edit Suggestion）的 `NesWorkflow` 和 `NextCursorPredictor` 新增通过 `/completions` 端点（FIM adapter）发送请求的能力，通过 `cc-completion.nes.requestFormat` 配置项动态切换。

**注意**：`cc-completion.nes.requestFormat`（本次新增）与现有 `cc-completion.nes.supportedEndpoint`（`'chat/completions' | 'responses' | 'messages'`）是两个**完全独立**的配置：
- `supportedEndpoint`：选择 LLM API 协议（chat/responses/messages）
- `requestFormat`：选择请求格式 / adapter 类型（`fim` 用纯文本 prompt，`chat` 用 messages 数组）

---

## 2. 动机

当前 NES 固定使用 Chat Completion API（`/chat/completions`），以 `messages` 数组（system + user）格式发送。某些部署场景下仅提供 `/completions` 端点，需要将 chat-style 消息通过模板渲染为纯文本 `prompt` 后发送。

---

## 3. 配置变更

### 3.1 `configKeys.ts` — 新增两个配置键

```typescript
Nes: {
    // ...existing keys...
    requestFormat: 'cc-completion.nes.requestFormat',
    promptTemplate: 'cc-completion.nes.promptTemplate',
}
```

### 3.2 配置项详情

| 键 | 类型 | 默认值 | 说明 |
|----|------|--------|------|
| `cc-completion.nes.requestFormat` | `'fim' \| 'chat'` | `'chat'` | 控制发送请求时使用的 adapter 类型和请求格式 |
| `cc-completion.nes.promptTemplate` | `string` | 见 §3.3 | 仅 `requestFormat === 'fim'` 时使用，`{system}` / `{user}` 占位符 |

**与 `supportedEndpoint` 的关系**：
- `requestFormat === 'chat'` 时：使用 `supportedEndpoint` 决定 API 协议（现有行为）
- `requestFormat === 'fim'` 时：`supportedEndpoint` **被忽略**，直接使用 `'completions'` adapter

### 3.3 默认 `promptTemplate`

```
<|im_start|>system
{system}<|im_end|>
<|im_start|>user
{user}<|im_end|>
<|im_start|>assistant

```

末尾 `<|im_start|>assistant\n\n` 的两个换行符是 prompt 格式的一部分，用于引导模型在 `assistant` 标记后直接开始生成回复内容。

### 3.4 `INesConfigProvider` 接口新增

```typescript
get requestFormat(): 'fim' | 'chat';
get promptTemplate(): string;
```

### 3.5 `VSCodeNesConfigProvider` 实现

- `requestFormat`：读取 `ConfigKeys.Nes.requestFormat`，默认 `'chat'`，走现有 `_cached()` 缓存
- `promptTemplate`：读取 `ConfigKeys.Nes.promptTemplate`，默认值如 §3.3，走 `_cached()` 缓存

---

## 4. 请求构建层

### 4.1 工具函数 `renderCompletionPrompt`

新建于 `src/completions/nes/promptCraftingUtils.ts`：

```typescript
/**
 * 将 system + user 消息通过模板渲染为纯文本 prompt。
 * 注意：这是简单的字符串替换。若 system/user 内容中意外包含
 * 字面量 "{system}" / "{user}"，会被错误替换。这是尽力而为的简单替换。
 */
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

### 4.2 `NesWorkflow` 分支逻辑

在 `execute()` 方法中，`promptAssembly` 由 `this._promptAssembler.assemble(document, position, lintEnable, xtabHistory)` 生成，提供 `promptAssembly.systemPrompt` 和 `promptAssembly.userPrompt`。构建 LLM 请求时：

```typescript
// 现有代码
const endpoint = this._config.supportedEndpoint;  // chat/completions | responses | messages
const requestFormat = this._config.requestFormat;  // 'fim' | 'chat'

if (requestFormat === 'fim') {
    // supportedEndpoint 在 fim 模式下被忽略
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
        // 无 messages, 无 capabilities（thinking/reasoning_effort 仅 chat 有）
    }, abortController.signal);
} else {
    // 现有 chat 逻辑不变
    const adapter = this._llmManager.getAdapter(endpoint);
    const stream = adapter.sendStream({
        // ...现有 messages + capabilities 参数不变
    }, abortController.signal);
}
```

**重要：`OpenAICompletionAdapter.sendStream()` 是伪流式**。其内部调用 `send()`（收集完整响应）后只 yield 一次，并非 SSE 逐 token 增量输出。这意味着在 `fim` 模式下，`NesWorkflow` 的 `for await (const delta of stream)` 循环只会迭代一次，拿到完整响应文本。这会导致：

- 第一版编辑结果（`firstEditResolved`）的提前解析行为与 `chat` 模式不同——它会在整个响应返回后才触发
- 1000ms abort 延迟逻辑仍然正常工作（`AbortController` 在 `send()` 调用前设置）
- 若未来需要逐 token 流式行为，需让 `OpenAICompletionAdapter` 支持真正的 SSE 流式（`/completions` 端点本身支持 `stream: true`）

### 4.3 `NextCursorPredictor` 分支逻辑

在 `predict()` 方法中，构建 LLM 请求时：

```typescript
const supportedEndpoint = this._config.supportedEndpoint;
const requestFormat = this._config.requestFormat;

// NextCursorPredictor 使用 adapter.send()（非流式），两种模式一致
const requestBase = {
    baseUrl: this._config.baseUrl,
    apiKey: this._config.apiKey,
    model: this._config.model,
    family: this._config.family,
    max_tokens: this._config.maxOutputTokens,
    temperature: 0,
    n: 1,
    presence_penalty: this._config.presencePenalty,
    frequency_penalty: this._config.frequencyPenalty,
};

if (requestFormat === 'fim') {
    const prompt = renderCompletionPrompt(
        this._config.promptTemplate,
        // 复用与 chat 模式完全相同的系统提示（见下方完整文本）
        NCP_SYSTEM_PROMPT,
        userMessage + '\n\n **just output the line int number where the developer will make their next edit.**',
    );
    const adapter = this._llmManager.getAdapter('completions');
    const response = await adapter.send({ ...requestBase, prompt }, abortController.signal);
} else {
    // 现有 chat 逻辑不变
    const adapter = this._llmManager.getAdapter(supportedEndpoint);
    const response = await adapter.send({
        ...requestBase,
        messages: [
            { role: 'system', content: NCP_SYSTEM_PROMPT },
            { role: 'user', content: userMessage + '\n\n **just output the line int number where the developer will make their next edit.**' },
        ],
    }, abortController.signal);
}
```

`NCP_SYSTEM_PROMPT` 常量提取为类级常量（避免重复），其值为 chat 模式现有文本：
> *"Your task is to predict the line number where the developer is most likely to make their next edit. If you jump in the current file, just output the line number. If you don't think anywhere is a good next line jump target, just output the current line number of the cursor. Make sure to output no explanation, reasoning, extra spaces, etc."*

**参数对比**：

| 参数 | NesWorkflow (chat) | NesWorkflow (fim) | NextCursorPredictor (chat) | NextCursorPredictor (fim) |
|------|--------------------|--------------------|----------------------------|----------------------------|
| `messages` | ✅ | ❌ | ✅ | ❌ |
| `prompt` | ❌ | ✅ | ❌ | ✅ |
| `capabilities` | ✅ | ❌ | ❌ | ❌ |
| `stream` | ✅ | ✅ | ❌ | ❌ |
| `top_p` | ✅ (1) | ✅ (1) | ❌ | ❌ |
| `presence_penalty` | ✅ | ✅ | ✅ | ✅ |
| `frequency_penalty` | ✅ | ✅ | ✅ | ✅ |

> `NextCursorPredictor` 使用 `adapter.send()`（非流式），因此不传 `stream`、`top_p`。`capabilities` 仅在 chat 模式下与 messages 搭配使用，fim 模式下不含此字段。`stop` 仅在 `NesWorkflow` fim 模式下显式传 `undefined`（`OpenAICompletionAdapter` 的 JSON body 包含该字段）。

---

## 5. 端点与 Adapter 映射

| `nes.requestFormat` | 使用的 adapter 端点 | `LLMRequest` 关键字段 | `supportedEndpoint` |
|---------------------|--------------------|-----------------------|---------------------|
| `'chat'` | `this._config.supportedEndpoint`（默认 `'chat/completions'`） | `messages`, `capabilities` | 参与决策 |
| `'fim'` | `'completions'`（硬编码） | `prompt`（无 `messages`, 无 `capabilities`） | **被忽略** |

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
| `src/config/configKeys.ts` | 修改 | 新增 `Nes.requestFormat`, `Nes.promptTemplate` |
| `src/config/nesConfig.ts` | 修改 | 接口 + 实现新增 `requestFormat`, `promptTemplate` |
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

- `requestFormat` 默认值为 `'chat'`
- `requestFormat` 设为 `'fim'` 后正确读取
- `promptTemplate` 默认值为 `<|im_start|>` 模板
- `promptTemplate` 自定义值正确读取
- 配置变更后缓存正确清除

### 8.2 工具函数测试

- `renderCompletionPrompt` 正确替换 `{system}` 和 `{user}`
- 空字符串输入处理
- 模板不含占位符时的行为
- `{system}` / `{user}` 字面量出现在 content 中的边界情况（已知限制，确保不崩溃）

### 8.3 分支逻辑 Mock 测试（通过 DI 注入）

由于 `NesWorkflow` 和 `NextCursorPredictor` 通过 DI 获取 `ILLMAdapterManager` 和 `INesConfigProvider`，可以通过 mock 这两个依赖来验证分支逻辑：

```typescript
// 伪代码示意
test('NesWorkflow uses completion adapter when requestFormat=fim', async () => {
    const mockConfig = mock<INesConfigProvider>({
        requestFormat: 'fim',
        promptTemplate: '<|im_start|>system\n{system}<|im_end|>\n...',
        // ... 其他必要 config 值
    });
    const mockLlmManager = mock<ILLMAdapterManager>();
    const mockAdapter = mock<ILLMAdapter>();
    mockLlmManager.getAdapter.withArgs('completions').returns(mockAdapter);

    const workflow = new NesWorkflow(mockConfig, mockLlmManager, ...);
    await workflow.execute(document, position, true);

    // 验证：调用了 getAdapter('completions')
    // 验证：sendStream 传入的参数包含 prompt 字段，不含 messages
    expect(mockLlmManager.getAdapter).toHaveBeenCalledWith('completions');
    expect(mockAdapter.sendStream).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: expect.any(String) }),
        expect.any(AbortSignal),
    );
});

test('NextCursorPredictor uses completion adapter when requestFormat=fim', async () => {
    // 同理验证 predictor 分支
});
```

### 8.4 集成回归测试

- `requestFormat='chat'` 时 NES 行为与现有完全一致（回归测试）
- `requestFormat='fim'` 时 `LLMRequest` 包含 `prompt` 字段，不含 `messages`/`capabilities`

---

## 9. 向后兼容

- 默认 `requestFormat = 'chat'`，现有行为**完全不变**
- `supportedEndpoint` 字段保持不变，`requestFormat='chat'` 时继续使用
- 所有现有测试无需修改
