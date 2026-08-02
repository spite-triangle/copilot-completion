# NES Completion Adapter 支持 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 NES 的 `NesWorkflow` 和 `NextCursorPredictor` 新增 `/completions` 端点支持，通过 `supportedEndpoint === 'completions'` 切换。

**Architecture:** 扩展现有 `NesSupportedEndpoint` 类型新增 `'completions'` 值；修复 `OpenAICompletionAdapter.sendStream()` 为真 SSE 流式；在 `NesWorkflow` 和 `NextCursorPredictor` 中添加分支——当 `supportedEndpoint === 'completions'` 时，用 `renderCompletionPrompt()` 将 messages 渲染为 prompt 字符串，并通过 `'completions'` adapter 发送。

**Tech Stack:** TypeScript, VS Code Extension API, `fetch()`, SSE streaming, Node.js `assert` test framework

## Global Constraints

- `NesSupportedEndpoint` 类型: `'chat/completions' | 'responses' | 'messages' | 'completions'`
- 默认 `supportedEndpoint`: `'chat/completions'`（现有行为完全不变）
- `cc-completion.nes.promptTemplate` 默认值:
```
<|im_start|>system
{system}<|im_end|>
<|im_start|>user
{user}<|im_end|>
<|im_start|>assistant

```
- `renderCompletionPrompt()` 是简单字符串替换，`{system}` 和 `{user}` 分别替换
- `sendStream()` 必须实现真正的逐 token SSE 流式（非伪流式）
- `completions` 模式下不传 `messages`、`capabilities`
- `NextCursorPredictor` 使用 `send()`（非流式），两种模式一致

---

### Task 1: Config — 扩展 `NesSupportedEndpoint` 类型 & 新增 `promptTemplate` 键

**Files:**
- Modify: `src/config/configKeys.ts:19-19`
- Modify: `src/config/nesConfig.ts:5-5`
- Modify: `src/config/nesConfig.ts:20-41`（接口新增 getter）
- Modify: `src/config/nesConfig.ts:80-120`（实现新增 getter）

**Interfaces:**
- Produces: `NesSupportedEndpoint = 'chat/completions' | 'responses' | 'messages' | 'completions'`
- Produces: `ConfigKeys.Nes.promptTemplate = 'cc-completion.nes.promptTemplate'`
- Produces: `INesConfigProvider.promptTemplate: string` getter
- Produces: `VSCodeNesConfigProvider.promptTemplate` getter（`_cached<string>`，默认值见全局约束）

- [ ] **Step 1: 修改 `configKeys.ts`**

在 `Nes` 对象末尾 `mimicGhostTextBehavior` 之后添加逗号并新增：
```typescript
        promptTemplate: 'cc-completion.nes.promptTemplate',
```

- [ ] **Step 2: 修改 `nesConfig.ts` — 扩展类型**

```typescript
// 改前:
export type NesSupportedEndpoint = 'chat/completions' | 'responses' | 'messages';
// 改后:
export type NesSupportedEndpoint = 'chat/completions' | 'responses' | 'messages' | 'completions';
```

- [ ] **Step 3: 修改 `nesConfig.ts` — 接口新增 getter**

在 `INesConfigProvider` 接口中，`mimicGhostTextBehavior` getter 之后新增：
```typescript
    get promptTemplate(): string;
```

- [ ] **Step 4: 修改 `nesConfig.ts` — 实现**

在 `VSCodeNesConfigProvider` 类中，`mimicGhostTextBehavior` getter 之后新增：
```typescript
    get promptTemplate(): string {
        return this._cached<string>(
            ConfigKeys.Nes.promptTemplate,
            '<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n\n',
        );
    }
```

- [ ] **Step 5: 编译验证**

Run: `npm run compile`
Expected: 无编译错误

- [ ] **Step 6: 提交**

```bash
git add src/config/configKeys.ts src/config/nesConfig.ts
git commit -m "feat: extend NesSupportedEndpoint with 'completions', add promptTemplate config"
```

---

### Task 2: Adapter — 修复 `OpenAICompletionAdapter.sendStream()` 为真 SSE 流式

**Files:**
- Modify: `src/completions/shared/llm/openaiCompletionAdapter.ts:10-14`（替换 `sendStream`）

**Interfaces:**
- Consumes: `ILLMAdapter`, `LLMRequest`, `LLMResponse`, `LLMError`, `normalizeBody` from `llmRequest.ts`
- Consumes: `splitChunk`, `SSEChunk` from `sseStream.ts`
- Produces: `OpenAICompletionAdapter.sendStream()` — 真正的 SSE 流式，逐 token yield

- [ ] **Step 1: 替换 `sendStream()` 方法**

将 `sendStream` 方法（第 10-14 行）替换为：

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
            stream: true,
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
        if (!ct.includes('text/event-stream')) {
            const jsonResponse = this._parseJSON(await response.text());
            yield jsonResponse.text;
            return jsonResponse;
        }

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

`send()` 方法完全不动。

- [ ] **Step 2: 编译验证**

Run: `npm run compile`
Expected: 无编译错误

- [ ] **Step 3: 提交**

```bash
git add src/completions/shared/llm/openaiCompletionAdapter.ts
git commit -m "fix: make OpenAICompletionAdapter.sendStream truly streaming (SSE with cumulative-to-delta)"
```

---

### Task 3: Prompt 渲染工具函数

**Files:**
- Modify: `src/completions/nes/promptCraftingUtils.ts:1-15`（文件末尾新增）

**Interfaces:**
- Produces: `renderCompletionPrompt(template: string, system: string, user: string): string`

- [ ] **Step 1: 在 `promptCraftingUtils.ts` 末尾新增函数**

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

- [ ] **Step 2: 编译验证**

Run: `npm run compile`
Expected: 无编译错误

- [ ] **Step 3: 编写单元测试**

Create: `src/test/nes/promptCraftingUtils.test.ts`

```typescript
import * as assert from 'assert';
import { renderCompletionPrompt } from '../../completions/nes/promptCraftingUtils';

suite('renderCompletionPrompt', () => {

    const DEFAULT_TEMPLATE = [
        '<|im_start|>system',
        '{system}<|im_end|>',
        '<|im_start|>user',
        '{user}<|im_end|>',
        '<|im_start|>assistant',
        '',
        '',
    ].join('\n');

    test('replaces system and user placeholders', () => {
        const result = renderCompletionPrompt(DEFAULT_TEMPLATE, 'You are helpful', 'Hello');
        assert.ok(result.includes('You are helpful'));
        assert.ok(result.includes('Hello'));
        assert.ok(!result.includes('{system}'));
        assert.ok(!result.includes('{user}'));
    });

    test('returns template unchanged when no placeholders present', () => {
        const template = 'plain text with no placeholders';
        const result = renderCompletionPrompt(template, 'sys', 'usr');
        assert.strictEqual(result, template);
    });

    test('handles empty system and user', () => {
        const result = renderCompletionPrompt(DEFAULT_TEMPLATE, '', '');
        assert.ok(!result.includes('{system}'));
        assert.ok(!result.includes('{user}'));
    });

    test('handles literal {system} in content (known limitation)', () => {
        // 已知限制：content 中的 {system} 会被替换
        const result = renderCompletionPrompt(DEFAULT_TEMPLATE, 'literal {user}', 'literal {system}');
        assert.ok(!result.includes('{system}'));
        assert.ok(!result.includes('{user}'));
    });

    test('preserves trailing newlines from template', () => {
        const template = '{system}\n{user}\n\n';
        const result = renderCompletionPrompt(template, 'S', 'U');
        assert.strictEqual(result, 'S\nU\n\n');
    });
});
```

- [ ] **Step 4: 运行测试**

Run: `npm test -- --grep "renderCompletionPrompt"`
Expected: 5 通过

- [ ] **Step 5: 提交**

```bash
git add src/completions/nes/promptCraftingUtils.ts src/test/nes/promptCraftingUtils.test.ts
git commit -m "feat: add renderCompletionPrompt utility for NES completion mode"
```

---

### Task 4: `NesWorkflow` — 新增 `completions` 分支

**Files:**
- Modify: `src/completions/nes/core/nesWorkflow.ts:4-4`（新增 import）
- Modify: `src/completions/nes/core/nesWorkflow.ts:162-225`（请求构建分支逻辑）

**Interfaces:**
- Consumes: `renderCompletionPrompt` from `../promptCraftingUtils`

- [ ] **Step 1: 新增 import**

在 `nesWorkflow.ts` 顶部现有 import 区域新增：
```typescript
import { renderCompletionPrompt } from '../promptCraftingUtils';
```

- [ ] **Step 2: 修改请求构建逻辑**

将第 162-224 行的现有代码：
```typescript
        const endpoint = this._config.supportedEndpoint;
        const adapter = this._llmManager.getAdapter(endpoint);
        // ...abort controller setup...
        this._log.debug(`[NES]  endpoint=${endpoint} model=...`);
        // ...
            const stream = adapter.sendStream(
                {
                    baseUrl: this._config.baseUrl,
                    apiKey: this._config.apiKey,
                    model: this._config.model,
                    family: this._config.family,
                    messages: [
                        { role: 'system', content: promptAssembly.systemPrompt },
                        { role: 'user', content: promptAssembly.userPrompt },
                    ],
                    max_tokens: this._config.maxOutputTokens,
                    temperature: 0,
                    top_p: 1,
                    n: 1,
                    stream: this._config.stream,
                    presence_penalty: this._config.presencePenalty,
                    frequency_penalty: this._config.frequencyPenalty,
                    capabilities: {
                        thinking: this._config.capabilities.supports.thinking,
                        reasoning_effort: this._config.capabilities.supports.reasoning_effort,
                    },
                },
                abortController.signal,
            );
```

替换为：
```typescript
        const endpoint = this._config.supportedEndpoint;
        const adapter = this._llmManager.getAdapter(endpoint);
        // ...abort controller setup（保持不变）...
        this._log.debug(`[NES]  endpoint=${endpoint} model=${this._config.model} max_tokens=${this._config.maxOutputTokens}`);

        try {
            this._log.info(`[NES]  REQUEST sent [${Date.now() - t4}ms] requestId=${headerRequestId} endpoint=${endpoint} model=${this._config.model} max_tokens=${this._config.maxOutputTokens}`);

            let stream: AsyncGenerator<string, LLMResponse>;
            if (endpoint === 'completions') {
                const prompt = renderCompletionPrompt(
                    this._config.promptTemplate,
                    promptAssembly.systemPrompt,
                    promptAssembly.userPrompt,
                );
                stream = adapter.sendStream(
                    {
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
                    },
                    abortController.signal,
                );
            } else {
                stream = adapter.sendStream(
                    {
                        baseUrl: this._config.baseUrl,
                        apiKey: this._config.apiKey,
                        model: this._config.model,
                        family: this._config.family,
                        messages: [
                            { role: 'system', content: promptAssembly.systemPrompt },
                            { role: 'user', content: promptAssembly.userPrompt },
                        ],
                        max_tokens: this._config.maxOutputTokens,
                        temperature: 0,
                        top_p: 1,
                        n: 1,
                        stream: this._config.stream,
                        presence_penalty: this._config.presencePenalty,
                        frequency_penalty: this._config.frequencyPenalty,
                        capabilities: {
                            thinking: this._config.capabilities.supports.thinking,
                            reasoning_effort: this._config.capabilities.supports.reasoning_effort,
                        },
                    },
                    abortController.signal,
                );
            }
```

> 注意：`let stream` 声明替换原有的 `const stream = adapter.sendStream(...)`，后续 `for await (const delta of stream)` 循环不变。

- [ ] **Step 3: 编译验证**

Run: `npm run compile`
Expected: 无编译错误

- [ ] **Step 4: 提交**

```bash
git add src/completions/nes/core/nesWorkflow.ts
git commit -m "feat: add completions endpoint branch in NesWorkflow"
```

---

### Task 5: `NextCursorPredictor` — 新增 `completions` 分支 & 提取系统提示常量

**Files:**
- Modify: `src/completions/nes/nextCursorPredictor.ts:4-5`（新增 import）
- Modify: `src/completions/nes/nextCursorPredictor.ts:17-18`（新增常量）
- Modify: `src/completions/nes/nextCursorPredictor.ts:98-130`（请求构建分支）

**Interfaces:**
- Consumes: `renderCompletionPrompt` from `./promptCraftingUtils`
- Produces: `NCP_SYSTEM_PROMPT` 私有静态常量

- [ ] **Step 1: 新增 import**

```typescript
import { renderCompletionPrompt } from './promptCraftingUtils';
```

- [ ] **Step 2: 提取 `NCP_SYSTEM_PROMPT` 常量**

在 `NextCursorPredictor` 类 `_isDisabled` 之后新增：
```typescript
    private static readonly NCP_SYSTEM_PROMPT =
        'Your task is to predict the line number where the developer is most likely to make their next edit. If you jump in the current file, just output the line number. If you don\'t think anywhere is a good next line jump target, just output the current line number of the cursor. Make sure to output no explanation, reasoning, extra spaces, etc.';
```

- [ ] **Step 3: 修改请求构建逻辑**

将第 98-130 行的现有代码：
```typescript
            const endpoint = this._config.supportedEndpoint;
            const adapter = this._llmManager.getAdapter(endpoint);
            const abortController = new AbortController();
            const cancelListener = token?.onCancellationRequested(() => abortController.abort());

            const response = await adapter.send(
                {
                    baseUrl: this._config.baseUrl,
                    apiKey: this._config.apiKey,
                    model: this._config.model,
                    family: this._config.family,
                    messages: [
                        { 
                            role: 'system', 
                            content:  'Your task is to...'
                        },
                        { role: 'user', content: userMessage + '\n\n **just output the line int number where the developer will make their next edit.**' },
                    ],
                    max_tokens: this._config.maxOutputTokens,
                    temperature: 0,
                    n:1,
                    presence_penalty: this._config.presencePenalty,
                    frequency_penalty: this._config.frequencyPenalty
                },
                abortController.signal,
            );
```

替换为：
```typescript
            const endpoint = this._config.supportedEndpoint;
            const adapter = this._llmManager.getAdapter(endpoint);
            const abortController = new AbortController();
            const cancelListener = token?.onCancellationRequested(() => abortController.abort());

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

            let response: LLMResponse;
            if (endpoint === 'completions') {
                const prompt = renderCompletionPrompt(
                    this._config.promptTemplate,
                    NextCursorPredictor.NCP_SYSTEM_PROMPT,
                    userMessage + '\n\n **just output the line int number where the developer will make their next edit.**',
                );
                response = await adapter.send(
                    { ...requestBase, prompt },
                    abortController.signal,
                );
            } else {
                response = await adapter.send(
                    {
                        ...requestBase,
                        messages: [
                            { role: 'system', content: NextCursorPredictor.NCP_SYSTEM_PROMPT },
                            { role: 'user', content: userMessage + '\n\n **just output the line int number where the developer will make their next edit.**' },
                        ],
                    },
                    abortController.signal,
                );
            }
```

注意：需要新增 `LLMResponse` import：
```typescript
import { LLMResponse } from '../shared/llm/llmRequest';
```

同时将原来 `const response = await adapter.send(...)` 声明改为 `let response: LLMResponse;`。

- [ ] **Step 4: 编译验证**

Run: `npm run compile`
Expected: 无编译错误

- [ ] **Step 5: 提交**

```bash
git add src/completions/nes/nextCursorPredictor.ts
git commit -m "feat: add completions endpoint branch in NextCursorPredictor, extract NCP_SYSTEM_PROMPT"
```

---

### Task 6: 配置测试 — 新增 `promptTemplate` 和 `supportedEndpoint` 测试

**Files:**
- Modify: `src/test/config/nesConfig.test.ts:70-73`（文件末尾新增测试）

**Interfaces:**
- Consumes: `VSCodeNesConfigProvider`, `NesSupportedEndpoint`

- [ ] **Step 1: 在 `nesConfig.test.ts` 末尾新增测试**

```typescript
    test('supportedEndpoint defaults to chat/completions', () => {
        const provider = new VSCodeNesConfigProvider(mockContext());
        assert.strictEqual(provider.supportedEndpoint, 'chat/completions');
    });

    test('promptTemplate has expected default', () => {
        const provider = new VSCodeNesConfigProvider(mockContext());
        const tmpl = provider.promptTemplate;
        assert.ok(tmpl.includes('{system}'));
        assert.ok(tmpl.includes('{user}'));
        assert.ok(tmpl.includes('<|im_start|>'));
        assert.ok(tmpl.includes('<|im_end|>'));
        assert.ok(tmpl.endsWith('\n\n'));
    });

    test('promptTemplate cache is cleared on config change', async () => {
        const provider = new VSCodeNesConfigProvider(mockContext());
        const config = vscode.workspace.getConfiguration('cc-completion.nes');

        const before = provider.promptTemplate;
        assert.ok(before.includes('{system}'));

        await config.update('promptTemplate', 'custom: {system} | {user}', vscode.ConfigurationTarget.Global);
        // Cache cleared by onDidChangeConfiguration → next read gets new value
        assert.strictEqual(provider.promptTemplate, 'custom: {system} | {user}');

        await config.update('promptTemplate', undefined, vscode.ConfigurationTarget.Global);
    });
```

- [ ] **Step 2: 运行测试**

Run: `npm test -- --grep "VSCodeNesConfigProvider"`
Expected: 所有测试通过（包含新增 3 个）

- [ ] **Step 3: 提交**

```bash
git add src/test/config/nesConfig.test.ts
git commit -m "test: add promptTemplate and supportedEndpoint config tests"
```

---

### Task 7: 集成验证

**Files:**
- 无新增/修改文件

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全部通过，无回归

- [ ] **Step 2: 全量编译**

Run: `npm run compile`
Expected: 零错误

- [ ] **Step 3: 最终提交（如有遗漏变更）**

```bash
git status
# 确认无未提交变更后：
git log --oneline -6
```

---

## 文件变更总览

| 文件 | 任务 | 变更类型 |
|------|------|----------|
| `src/config/configKeys.ts` | Task 1 | +1 行 |
| `src/config/nesConfig.ts` | Task 1 | 类型扩展 +2 getter |
| `src/completions/shared/llm/openaiCompletionAdapter.ts` | Task 2 | `sendStream()` 重写 |
| `src/completions/nes/promptCraftingUtils.ts` | Task 3 | +~10 行 |
| `src/completions/nes/core/nesWorkflow.ts` | Task 4 | +1 import, if/else 分支 |
| `src/completions/nes/nextCursorPredictor.ts` | Task 5 | +2 import, +常量, if/else 分支 |
| `src/test/nes/promptCraftingUtils.test.ts` | Task 3 | 新建，5 个测试 |
| `src/test/config/nesConfig.test.ts` | Task 6 | +3 个测试 |
