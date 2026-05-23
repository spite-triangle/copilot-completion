# NES + Ghost 性能优化设计

## 背景

对比参考项目 `fake-vscode-copilot-chat`，当前 `copilot-completion` 存在两个性能问题：

1. **Ghost + NES 同时启用时，Ghost 补全严重延迟**（> 1 秒）
2. **同一 LLM 模型下，NES 处理速度比参考项目慢约 300ms**

根因分析详见对话记录。以下设计严格对齐参考项目实现模式。

---

## 策略 A：核心修复（第一优先级）

### A1 — Ghost CurrentGhostText/LastGhostText 生命周期修复

**对齐目标：** 参考项目 `completions-core/.../ghostText/current.ts` 的 `ICompletionsCurrentGhostText`

**当前问题：** `inlineCompletion.ts:16` 每次击键 `new CurrentGhostText()` → 无状态保留 → typing-as-suggested 路径不可能命中。

**改动：**

**1) `src/completions/ghost/ghostTextState.ts` — 扩展 CurrentGhostText**

对齐参考 `current.ts:27-97`，新增：

- `prefix?: string` — typing-as-suggested 流程开始时的文档前缀
- `suffix?: string` — typing-as-suggested 流程开始时的 prompt 后缀
- `choices: APIChoice[]` — 原始补全选项数组
- `clientCompletionId` getter — 返回 choices[0]?.clientCompletionId
- `currentRequestId: string | undefined` — 最近一次非推测性请求 ID
- `setGhostText(prefix, suffix, choices, resultType)` — 非 TypingAsSuggested 时更新状态
- `getCompletionsForUserTyping(prefix, suffix)` — 匹配逻辑：
  1. suffix 精确匹配
  2. prefix.startsWith(this.prefix)
  3. choices[0].completionText.startsWith(remainingPrefix) 且更长
  4. 返回 `adjustChoicesStart(choices, remainingPrefix)`
- `hasAcceptedCurrentCompletion(prefix, suffix)` — 完全匹配且 finishReason === 'stop'

**2) `src/completions/ghost/ghostTextState.ts` — 扩展 LastGhostText**

对齐参考 `last.ts`，新增用于 rejected/accept 跟踪的最小状态。

**3) `src/di/services.ts` — 注册服务标识符**

```typescript
export const ICurrentGhostText = createServiceIdentifier<ICurrentGhostText>('ICurrentGhostText');
export const ILastGhostText = createServiceIdentifier<ILastGhostText>('ILastGhostText');
```

**4) `src/extension.ts` — 注册 DI 单例**

```typescript
builder.define(ICurrentGhostText, new SyncDescriptor(CurrentGhostText));
builder.define(ILastGhostText, new SyncDescriptor(LastGhostText));
```

**5) `src/completions/ghost/inlineCompletion.ts` — 注入而非 new**

从：
```typescript
const computer = this._instantiationService.createInstance(
    GhostTextComputer, new CurrentGhostText(), new LastGhostText()
);
```
改为：`GhostTextComputer` 构造函数注入 `ICurrentGhostText`/`ILastGhostText`，`GhostText` 也注入。

**6) `src/completions/ghost/ghostTextComputer.ts` — getGhostText 末尾调用 setGhostText**

在返回结果前调用 `this._currentGhostText.setGhostText(prefix, suffix, choices, resultType)`，条件：`resultType !== ResultType.TypingAsSuggested`。

**不改：** `delayMs` 限流等待逻辑完整保留。

---

### A2 — NES 流式即时响应

**对齐目标：** 参考项目 `nextEditProvider.ts:_executeNewNextEditRequest()` 的 `AsyncGenerator<StreamedEdit>` 模式

**当前问题：** `nesWorkflow.execute()` 中 `await adapter.send()` 阻塞等待全部 token，首个可用 edit 可能在 stream 前半段已完整。

**改动：**

**1) `src/completions/shared/llm/llmAdapter.ts` — 新增 sendStream 方法**

```typescript
export interface ILLMAdapter {
    send(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse>;
    sendStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<string, LLMResponse>;
}
```
- 每次 `yield` 一个 delta 文本 chunk
- 最终 `return` 完整 `LLMResponse` (finishReason, usage 等)

**2) `src/completions/shared/llm/openaiChatCompletionAdapter.ts` — 实现 sendStream**

提取 `readSSEStream` 回调逻辑为 async generator：
```typescript
async *sendStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<string, LLMResponse> {
    // ... fetch + content-type 判断
    if (ct.includes('text/event-stream')) {
        let text = '';
        let finishReason = 'stop';
        // 直接消费 readableStream (对齐 readSSEStream 的 reader 模式)
        const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
        // 逐行 SSE 解析，每收到 delta.content 就 yield
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            // SSE 分块解析
            for (const json of parseSSEChunks(value)) {
                const choice = json.choices?.[0];
                if (choice?.delta?.content) {
                    text += choice.delta.content;
                    yield choice.delta.content;
                }
                if (choice?.finish_reason) finishReason = choice.finish_reason;
            }
        }
        return { text, finishReason };
    }
    return this._parseJSON(await response.text());
}
```

**3) `src/completions/nes/core/nesWorkflow.ts` — execute() 流式处理**

```
get adapter.sendStream(...)
let accumulated = ''
let firstEditResolved = false
let firstResult: NextEditResult | undefined

for await (const delta of stream) {
    accumulated += delta
    if (!firstEditResolved) {
        const parsedLines = this._responsePipeline.process(accumulated, ctx)
        if (parsedLines 有效) {
            const finalEdit = this._editFilterChain.apply(parsedLines, ...)
            if (finalEdit 有效) {
                firstResult = this._resultAssembler.assemble(...)
                firstEditResolved = true
                // 启动后台消费（不 await）：继续消费 stream，填充缓存
                backgroundConsume(stream, accumulated).catch(logError)
                break
            }
        }
    }
}
// 若整个 stream 消费完仍未找到有效 edit → 返回 undefined（与当前一致）
```

后台 `backgroundConsume` 负责持续消费 stream 并填充 `NextEditCache`。

**不改：** Ghost 的流式处理、prompt 构建、缓存查找、游标预测重试。

---

## 策略 B：请求复用 + 推测性预取（第二优先级）

### B1 — Ghost AsyncCompletionsManager 真正实现

**对齐目标：** 参考项目 `asyncCompletions.ts` 的 `ICompletionsAsyncManagerService`

**新建文件 `src/common/lruCacheMap.ts`：**

通用 `LRUCacheMap<K, V>` 实现（与现有 `src/common/suffixOverlapTrim.ts` 同级）。

**重写 `src/completions/ghost/asyncCompletions.ts`：**

```
class AsyncCompletionManager:
    requests: LRUCacheMap<string, AsyncCompletionRequest>(100)
    mostRecentRequestId: string  ← 锁，仅最近请求者可取消

AsyncCompletionRequest =
    | PendingRequest  { state: Pending, cts, headerRequestId, prefix, suffix, subject }
    | CompletedRequest { state: Completed, cts, headerRequestId, prefix, suffix, subject, choice, result }

核心方法：
- queueCompletionRequest(id, prefix, suffix, cts, resultPromise)
    → 存入 Pending；resultPromise.then() 后转 Completed 或删除（失败）
- shouldWaitForAsyncCompletions(prefix, suffix)
    → 遍历 requests，任一 isCandidate → true
- getFirstMatchingRequest(headerRequestId, prefix, suffix)
    → 遍历 requests，isCandidate 匹配:
      Completed: 裁剪 remainingPrefix 返回
      Pending: 订阅 subject
- cancelRequest(headerRequestId, request)
    → headerRequestId !== mostRecentRequestId 或 Completed → 不取消
    → 否则取消 cts 并删除
- clear()
```

`isCandidate` 判断（对齐参考）：
1. request.suffix === suffix
2. prefix.startsWith(request.prefix)
3. Completed: choice.completionText.startsWith(remainingPrefix) 且更长
4. Pending: partialCompletionText 不存在或 startsWith(remainingPrefix)

**接入 GhostTextComputer.getGhostText()：**

缓存未命中后、发起网络请求前：
```
if (this._asyncManager.shouldWaitForAsyncCompletions(prefix, suffix)) {
    const result = await this._asyncManager.getFirstMatchingRequest(id, prefix, suffix)
    if (result) return result
}
// 发起新请求
this._asyncManager.queueCompletionRequest(id, prefix, suffix, cts, resultPromise)
```

---

### B2 — NES SpeculativeRequestManager

**对齐目标：** 参考项目 `speculativeRequestManager.ts`

**新建文件 `src/completions/nes/speculativeRequestManager.ts`：**

```typescript
class SpeculativeRequestManager extends Disposable {
    private _pending: SpeculativePendingRequest | null;
    private _scheduled: ScheduledSpeculativeRequest | null;

    get pending(): SpeculativePendingRequest | null
    setPending(req): void          // 替换待定推测（取消旧的，Replaced）
    consumePending(): void         // 消费方接管（不取消）
    schedule(s): void              // 延迟推测入队
    clearScheduled(): void
    consumeScheduled(headerRequestId): ScheduledSpeculativeRequest | null
    cancelAll(reason): void
    cancelIfMismatch(docId, postEditContent, reason): void
    onDocumentClosed(docId): void
    onActiveDocumentChanged(docId, currentDocValue): void  // 轨迹检查
    dispose(): void
}
```

**取消原因枚举：**
`Rejected | IgnoredDismissed | Superseded | Replaced | DivergedFromTrajectoryForm | DivergedFromTrajectoryPrefix | DivergedFromTrajectoryMiddle | DivergedFromTrajectorySuffix | DocumentClosed | Disposed`

**轨迹检查（对齐参考 `onActiveDocumentChanged`）：**
```
当前文档 === trajectoryPrefix + middle + trajectorySuffix
middle 必须是 trajectoryNewText 的前缀
```

---

### B3 — NES 请求复用（NextEditProvider 层）

**对齐目标：** 参考项目 `nextEditProvider.ts:fetchNextEdit()` 复用优先级

```
fetchNextEdit(document, position, ...):
  1. Cache 查找（已有）
  2. Speculative pending 匹配 (docId, postEditContent)?
     → 匹配: consumePending(), 使用结果
     → 不匹配: cancelIfMismatch()
  3. 当前 pendingStatelessNextEditRequest 可复用?
     → 匹配 (docId, position): join 请求，liveDependentants++
     → 不匹配: 取消旧的，发起新请求
  4. 发起新 LLM 请求，设置 _pendingStatelessNextEditRequest
```

**handleShown 触发推测：**
```
handleShown(result):
  若 resultType !== TypingAsSuggested:
    计算 postEditContent
    schedule speculative 请求（延迟到 stream 结束后执行）
    若 stream 已结束 → 立即 _triggerSpeculativeRequest()
```

**_hookupCancellation 延迟取消（对齐参考 1000ms）：**
```
hookupCancellation(request, cancellationToken):
  TimeoutTimer.setIfNotSet(() => {
    if (liveDependentants > 0) return
    cts.cancel()
  }, 1000)
  liveDependentants++
```

---

## 改动文件汇总

| 策略 | 文件 | 类型 | 估计行数 |
|------|------|------|----------|
| A1 | `src/completions/ghost/ghostTextState.ts` | 修改 | +100 |
| A1 | `src/di/services.ts` | 修改 | +4 |
| A1 | `src/extension.ts` | 修改 | +6 |
| A1 | `src/completions/ghost/inlineCompletion.ts` | 修改 | ~15 |
| A1 | `src/completions/ghost/ghostTextComputer.ts` | 修改 | +10 |
| A2 | `src/completions/shared/llm/llmAdapter.ts` | 修改 | +3 |
| A2 | `src/completions/shared/llm/openaiChatCompletionAdapter.ts` | 修改 | +50 |
| A2 | `src/completions/nes/core/nesWorkflow.ts` | 修改 | +60 |
| B1 | `src/common/lruCacheMap.ts` | 新建 | ~80 |
| B1 | `src/completions/ghost/asyncCompletions.ts` | 重写 | ~250 |
| B1 | `src/completions/ghost/ghostTextComputer.ts` | 修改 | +30 |
| B2 | `src/completions/nes/speculativeRequestManager.ts` | 新建 | ~200 |
| B3 | `src/completions/nes/nextEditProvider.ts` | 修改 | +200 |
| B3 | `src/completions/nes/nextEditCache.ts` | 修改 | +30 |
| B3 | `src/di/services.ts` | 修改 | +2 |

---

## 约束

- 所有改动严格对齐参考项目 `fake-vscode-copilot-chat` 的实现模式
- Ghost `delayMs` 限流逻辑完整保留
- NES 流式处理仅改 NES 流程，Ghost 不动
- VS Code `CancellationToken` 机制保持现有行为
