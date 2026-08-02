# NES Completion Adapter 支持 — 设计文档

**日期**: 2026-08-02
**状态**: 设计中

---

## 1. 概述

为 NES（Next Edit Suggestion）的 `NesWorkflow` 和 `NextCursorPredictor` 新增通过 `/completions` 端点（FIM adapter）发送请求的能力，通过扩展现有 `cc-completion.nes.supportedEndpoint` 配置项（新增 `'completions'` 值）来切换。

---

## 2. 动机

当前 NES 固定使用 Chat Completion API（`/chat/completions`），以 `messages` 数组（system + user）格式发送。某些部署场景下仅提供 `/completions` 端点，需要将 chat-style 消息通过模板渲染为纯文本 `prompt` 后发送。

---

## 3. 配置变更

### 3.1 `configKeys.ts` — 新增一个配置键

```typescript
Nes: {
    // ...existing keys...
    promptTemplate: 'cc-completion.nes.promptTemplate',
}
```

### 3.2 `NesSupportedEndpoint` 类型扩展

```typescript
// 现有：
export type NesSupportedEndpoint = 'chat/completions' | 'responses' | 'messages';

// 改为：
export type NesSupportedEndpoint = 'chat/completions' | 'responses' | 'messages' | 'completions';
```

### 3.3 配置项详情

| 键 | 类型 | 默认值 | 说明 |
|----|------|--------|------|
| `cc-completion.nes.supportedEndpoint` | `'chat/completions' \| 'responses' \| 'messages' \| 'completions'` | `'chat/completions'` | 控制 API 协议和 adapter 类型 |
| `cc-completion.nes.promptTemplate` | `string` | 见 §3.4 | 仅 `supportedEndpoint === 'completions'` 时使用，`{system}` / `{user}` 占位符 |

当 `supportedEndpoint === 'completions'` 时：
- 使用 `OpenAICompletionAdapter`（已注册到 `'completions'` 端点）
- `messages`（system + user）通过 `promptTemplate` 渲染为纯文本 `prompt`
- `capabilities`（thinking/reasoning_effort）不适用，不发送

### 3.4 默认 `promptTemplate`

```
<|im_start|>system
{system}<|im_end|>
<|im_start|>user
{user}<|im_end|>
<|im_start|>assistant

```

末尾 `<|im_start|>assistant\n\n` 的两个换行符是 prompt 格式的一部分，用于引导模型在 `assistant` 标记后直接开始生成回复内容。

### 3.5 `INesConfigProvider` 接口变更

`supportedEndpoint` 返回类型不变（仍是 `NesSupportedEndpoint`，该类型已包含 `'completions'`）。新增：

```typescript
get promptTemplate(): string;
```

### 3.6 `VSCodeNesConfigProvider` 实现

- `promptTemplate`：读取 `ConfigKeys.Nes.promptTemplate`，默认值如 §3.4，走 `_cached()` 缓存
- `supportedEndpoint` 现有实现无需修改（`_cached<string>` 直接支持新值 `'completions'`）

---

## 4. Adapter 层：修复 `OpenAICompletionAdapter.sendStream()` 为真流式

### 4.1 现状

```typescript
// 当前是伪流式——内部调用 send() 收集完整响应后只 yield 一次
async *sendStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<string, LLMResponse> {
    const result = await this.send(request, signal);
    yield result.text;
    return result;
}
```

### 4.2 改造目标

改为真正的 SSE 逐 token 增量输出，与 `OpenAIChatCompletionAdapter.sendStream()` 一致。

**关键差异**：`/completions` 端点的 SSE 事件格式为 `choices[0].text`（**累积**文本），而 `/chat/completions` 端点为 `choices[0].delta.content`（**增量**文本）。因此需要在流式循环中手动计算 delta。

**SSE 解析循环重复说明**：`sendStream()` 是 async generator（需要 `yield` 语义），而 `sseStream.ts` 的 `readSSEStream()` 是回调模式。在 async generator 内无法从回调中 yield，因此 `sendStream()` 内联了自己的 SSE 循环（与 `readSSEStream` 和 `OpenAIChatCompletionAdapter.sendStream()` 结构相同）。这是为了适应 yield 语义的有意取舍。

### 4.3 改造后代码

```typescript
async *sendStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<string, LLMResponse> {
    this.logService.debug(`[OpenAI] Streaming request | model=${request.model} | maxTokens=${request.max_tokens}`);

    const url = `${request.baseUrl}/completions`;
    const body = JSON.stringify({
        model: request.model,
        prompt: request.prompt || '',
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
        n: request.n,
        presence_penalty: request.presence_penalty,
        frequency_penalty: request.frequency_penalty,
        stream: true,   // sendStream() 始终强制流式，忽略 request.stream 的值
        stop: request.stop,
    });

    const response = await fetch(url, {
        method: 'POST', signal,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${request.apiKey}`,
        },
        body: normalizeBody(body),
    });

    if (!response.ok) {
        const text = await response.text();
        this.logService.error(`[OpenAI] Request failed | status=${response.status} | error=${text}`);
        throw new LLMError(`OpenAI completions API failed: ${response.status}`, response.status, text + body);
    }

    const ct = response.headers.get('content-type') || '';
    // 非 SSE 回退：读取完整响应，yield 一次
    if (!ct.includes('text/event-stream')) {
        const jsonResponse = this._parseJSON(await response.text());
        yield jsonResponse.text;
        return jsonResponse;
    }

    // 真 SSE 流式：逐 delta 输出
    let fullText = '';
    let finishReason = 'stop';
    const stream = response.body!.pipeThrough(new TextDecoderStream());
    const reader = stream.getReader();
    let extra = '';
    try {
        while (true) {
            if (signal?.aborted) {
                return { text: fullText, finishReason };
            }
            const { value: rawChunk, done } = await reader.read();
            if (done) break;
            const chunkStr = rawChunk ?? '';
            const [lines, remainder] = splitChunk(extra + chunkStr);
            extra = remainder;
            for (const line of lines) {
                if (line.startsWith(':')) continue;
                const data = line.slice('data:'.length).trim();
                if (data === '[DONE]') {
                    return { text: fullText, finishReason };
                }
                try {
                    const json = JSON.parse(data) as SSEChunk;
                    const choice = json.choices?.[0];
                    if (choice?.text !== undefined) {
                        // /completions 返回累积文本，计算增量
                        const cumulative = choice.text as string;
                        const delta = cumulative.slice(fullText.length);
                        if (delta) {
                            fullText = cumulative;
                            yield delta;
                        }
                    }
                    if (choice?.finish_reason) finishReason = choice.finish_reason;
                } catch { /* skip malformed JSON */ }
            }
        }
    } finally {
        try { await reader.cancel(); } catch { /* ignore */ }
        try { await response.body?.cancel(); } catch { /* ignore */ }
    }
    return { text: fullText, finishReason };
}
```

### 4.4 `send()` 方法不变

`send()` 保持现有实现（处理 stream 和非 stream 两种响应，但收集全部文本），供 `NextCursorPredictor` 等服务调用。

---

## 5. 请求构建层

### 5.1 工具函数 `renderCompletionPrompt`

新建于 `src/completions/nes/promptCraftingUtils.ts`：

```typescript
/**
 * 将 system + user 消息通过模板渲染为纯文本 prompt。
 *
 * 注意：这是简单的字符串替换。若 system 内容中包含字面量 "{user}"，
 * 或 user 内容中包含字面量 "{system}"，都会被错误替换。
 * 这是尽力而为的简单替换，适用于正常的 ChatML 模板场景。
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

### 5.2 `NesWorkflow` 分支逻辑

在 `execute()` 方法中，`promptAssembly` 由 `this._promptAssembler.assemble(document, position, lintEnable, xtabHistory)` 生成，提供 `promptAssembly.systemPrompt` 和 `promptAssembly.userPrompt`。构建 LLM 请求时：

```typescript
const endpoint = this._config.supportedEndpoint;

if (endpoint === 'completions') {
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
        stop: ['<|im_end|>'],  // ChatML 格式：模型完成生成后输出 <|im_end|> 作为自然停止
    }, abortController.signal);
} else {
    // 现有 chat/responses/messages 逻辑不变
    const adapter = this._llmManager.getAdapter(endpoint);
    const stream = adapter.sendStream({
        // ...现有 messages + capabilities 参数不变
    }, abortController.signal);
}
```

`sendStream()` 在 §4 中已改造为真正的 SSE 流式，因此 `fim` 模式下 `NesWorkflow` 的 `for await (const delta of stream)` 循环与 `chat` 模式行为一致——逐 token 增量输出。

### 5.3 `NextCursorPredictor` 分支逻辑

在 `predict()` 方法中，构建 LLM 请求时：

```typescript
const endpoint = this._config.supportedEndpoint;

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

if (endpoint === 'completions') {
    const prompt = renderCompletionPrompt(
        this._config.promptTemplate,
        // 复用与 chat 模式完全相同的系统提示
        NCP_SYSTEM_PROMPT,
        userMessage + '\n\n **just output the line int number where the developer will make their next edit.**',
    );
    const adapter = this._llmManager.getAdapter('completions');
    const response = await adapter.send({ ...requestBase, prompt }, abortController.signal);
} else {
    // 现有 chat/responses/messages 逻辑不变
    const adapter = this._llmManager.getAdapter(endpoint);
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

| 参数 | NesWorkflow (chat/responses/messages) | NesWorkflow (completions) | NextCursorPredictor (chat) | NextCursorPredictor (completions) |
|------|--------------------------------------|---------------------------|----------------------------|-----------------------------------|
| `messages` | ✅ | ❌ | ✅ | ❌ |
| `prompt` | ❌ | ✅ | ❌ | ✅ |
| `capabilities` | ✅ (chat) | ❌ | ❌ | ❌ |
| `stream` | ✅ | ✅ | ❌ | ❌ |
| `top_p` | ✅ (1) | ✅ (1) | ❌ | ❌ |
| `presence_penalty` | ✅ | ✅ | ✅ | ✅ |
| `frequency_penalty` | ✅ | ✅ | ✅ | ✅ |
| `stop` | ❌ | ✅ (`['<|im_end|>']`) | ❌ | ❌ |

> `NextCursorPredictor` 使用 `adapter.send()`（非流式），因此不传 `stream`、`top_p`、`stop`。`capabilities` 仅在 chat 模式下搭配 messages 使用。`stop: ['<|im_end|>']` 仅 `NesWorkflow` completions 分支使用，匹配 ChatML 模板的 `<|im_end|>` 结束标记。

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
| `src/config/configKeys.ts` | 修改 | 新增 `Nes.promptTemplate` |
| `src/config/nesConfig.ts` | 修改 | `NesSupportedEndpoint` 新增 `'completions'`；接口 + 实现新增 `promptTemplate` |
| `src/completions/shared/llm/openaiCompletionAdapter.ts` | **重要修改** | `sendStream()` 改为真 SSE 流式 |
| `src/completions/nes/core/nesWorkflow.ts` | 修改 | `supportedEndpoint === 'completions'` 分支逻辑 |
| `src/completions/nes/nextCursorPredictor.ts` | 修改 | 同上；提取 `NCP_SYSTEM_PROMPT` 常量 |
| `src/completions/nes/promptCraftingUtils.ts` | 修改 | 新增 `renderCompletionPrompt()` |
| `src/test/config/nesConfig.test.ts` | 修改 | 新增 `promptTemplate` 测试；`supportedEndpoint` 包含 `'completions'` |
| `src/test/nes/` | 新增/修改 | `renderCompletionPrompt` 单元测试；adapter 流式测试 |

**不需要变更**：
- `src/completions/ghost/` — Ghost 不受影响
- `src/extension.ts` — adapter 注册已存在，无需改动

---

## 8. 测试策略

### 8.1 配置测试 (`nesConfig.test.ts`)

- `supportedEndpoint` 支持新值 `'completions'`
- `promptTemplate` 默认值为 `<|im_start|>` 模板
- `promptTemplate` 自定义值正确读取
- 配置变更后缓存正确清除

### 8.2 Adapter 流式测试 (`openaiCompletionAdapter`)

- `sendStream()` 真流式：设置 `stream: true`，验证逐 delta yield
- SSE 累积文本 → delta 计算正确（`choices[0].text` 累积格式）
- 非 SSE 响应回退：yield 完整文本一次
- `AbortSignal` 中断后正确返回已收集文本
- `[DONE]` 信号正确结束流

### 8.3 工具函数测试

- `renderCompletionPrompt` 正确替换 `{system}` 和 `{user}`
- 空字符串输入处理
- `{system}` / `{user}` 字面量出现在 content 中的边界情况（已知限制，确保不崩溃）

### 8.4 分支逻辑 Mock 测试（通过 DI 注入）

```typescript
test('NesWorkflow uses completion adapter when supportedEndpoint=completions', async () => {
    const mockConfig = mock<INesConfigProvider>({
        supportedEndpoint: 'completions',
        promptTemplate: '<|im_start|>system\n{system}<|im_end|>\n...',
    });
    const mockLlmManager = mock<ILLMAdapterManager>();
    mockLlmManager.getAdapter.withArgs('completions').returns(mockAdapter);

    const workflow = new NesWorkflow(mockConfig, mockLlmManager, ...);
    await workflow.execute(document, position, true);

    expect(mockLlmManager.getAdapter).toHaveBeenCalledWith('completions');
    expect(mockAdapter.sendStream).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: expect.any(String) }),
        expect.any(AbortSignal),
    );
});
```

### 8.5 集成回归测试

- `supportedEndpoint='chat/completions'` 时行为与现有完全一致
- `supportedEndpoint='completions'` 时 `LLMRequest` 含 `prompt` 不含 `messages`/`capabilities`

---

## 9. 向后兼容

- 默认 `supportedEndpoint = 'chat/completions'`，现有行为**完全不变**
- `NesSupportedEndpoint` 扩展为联合类型（新增 `'completions'`），TypeScript 编译时自动覆盖
- `OpenAICompletionAdapter.send()` 不改动，`sendStream()` 改造为真流式——Ghost 侧（`send()` 调用方）零影响
- 所有现有测试无需修改
