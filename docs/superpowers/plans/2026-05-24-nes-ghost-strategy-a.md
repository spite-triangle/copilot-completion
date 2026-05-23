# NES + Ghost Strategy A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two performance issues: (1) Ghost severely delayed when NES is enabled, (2) NES ~300ms slower than reference project. Strictly aligned with reference `fake-vscode-copilot-chat` implementation.

**Architecture:** Strategy A consists of two independent workstreams. A1 fixes Ghost by making `CurrentGhostText`/`LastGhostText` DI singletons (aligned with reference `current.ts`/`last.ts`), enabling the typing-as-suggested fast path and reducing redundant LLM requests when NES is also active. A2 fixes NES by adding `sendStream()` to the adapter interface and returning the first usable edit as soon as it appears in the SSE stream (aligned with reference `AsyncGenerator<StreamedEdit>`), eliminating ~300ms of streaming tail latency.

**Tech Stack:** TypeScript, VS Code Extension API, SSE streaming, custom DI container

---

### Task 1: Extend CurrentGhostText with full state tracking

**Files:**
- Modify: `src/completions/ghost/ghostTextState.ts`

- [ ] **Step 1: Add TrackedCompletion interface and extend CurrentGhostText**

Add import at top of `src/completions/ghost/ghostTextState.ts`:
```typescript
import { GhostCompletion, ResultType } from './types';
```

Replace the stub `CurrentGhostText` class with the full implementation:

```typescript
// In src/completions/ghost/ghostTextState.ts, inside CurrentGhostText:

interface TrackedCompletion {
    completionText: string;
    finishReason?: string;
}

export class CurrentGhostText {
    private _state: CurrentGhostTextState | undefined;

    /** The document prefix when the completion was shown. */
    private _prefix?: string;

    /** The document suffix when the completion was shown. */
    private _suffix?: string;

    /** The original completions shown to the user. */
    private _choices: TrackedCompletion[] = [];

    /** The currently shown completion text. */
    get clientCompletionId(): string | undefined {
        return this._choices[0]?.completionText;
    }

    /** The most recent inline completion request id, excluding speculative requests. */
    currentRequestId: string | undefined;

    setGhostText(prefix: string, suffix: string, completions: GhostCompletion[], resultType: ResultType, finishReason?: string): void {
        if (resultType === ResultType.TypingAsSuggested) { return; }
        this._prefix = prefix;
        this._suffix = suffix;
        this._choices = completions.map(c => ({ completionText: c.completionText, finishReason }));
    }

    getCompletionsForUserTyping(prefix: string, suffix: string): GhostCompletion[] | undefined {
        const remainingPrefix = this._getRemainingPrefix(prefix, suffix);
        if (remainingPrefix === undefined) { return; }
        if (!this._startsWithAndExceeds(this._choices[0]?.completionText || '', remainingPrefix)) { return; }
        return this._adjustChoicesStart(remainingPrefix);
    }

    hasAcceptedCurrentCompletion(prefix: string, suffix: string): boolean {
        const remainingPrefix = this._getRemainingPrefix(prefix, suffix);
        if (remainingPrefix === undefined) { return false; }
        const exactMatch = remainingPrefix === this._choices[0]?.completionText;
        const finishReason = this._choices[0]?.finishReason;
        return exactMatch && finishReason === 'stop';
    }

    getCompletionsForUserTyping_original(
        uri: vscode.Uri,
        version: number,
    ): string | undefined {
        if (!this._state) return undefined;
        if (this._state.uri.toString() !== uri.toString()) return undefined;
        if (this._state.version !== version) return undefined;
        return this._state.completionText;
    }

    private _getRemainingPrefix(prefix: string, suffix: string): string | undefined {
        if (this._prefix === undefined || this._suffix === undefined || this._choices.length === 0) { return; }
        if (this._suffix !== suffix) { return; }
        if (!prefix.startsWith(this._prefix)) { return; }
        return prefix.substring(this._prefix.length);
    }

    private _startsWithAndExceeds(text: string, prefix: string): boolean {
        return text.startsWith(prefix) && text.length > prefix.length;
    }

    private _adjustChoicesStart(remainingPrefix: string): GhostCompletion[] {
        return this._choices
            .filter(c => this._startsWithAndExceeds(c.completionText, remainingPrefix))
            .map((c, i) => ({
                completionIndex: i,
                completionText: c.completionText.substring(remainingPrefix.length),
                displayText: c.completionText.substring(remainingPrefix.length),
                displayNeedsWsOffset: false,
                isMiddleOfTheLine: false,
            }));
    }
}
```

- [ ] **Step 2: Keep existing methods on CurrentGhostText**

Ensure these methods remain unchanged (they serve the `GhostTextState._state`-based path):

```typescript
// Keep existing:
setGhostText(uri, version, completionText): void  // overloaded — keep both signatures
getCompletionsForUserTyping(uri, version): string | undefined  // uri-based lookup
```

- [ ] **Step 3: Run existing tests to verify no regressions**

```bash
cd E:/workspace/vscode/copilot-completion && npx mocha --require ts-node/register src/test/ghost/ghostTextComputer.test.ts --timeout 10000
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/completions/ghost/ghostTextState.ts
git commit -m "feat: extend CurrentGhostText with full typing-as-suggested state tracking"
```

---

### Task 2: Register CurrentGhostText and LastGhostText as DI singletons

**Files:**
- Modify: `src/di/services.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Add service identifiers in services.ts**

```typescript
// In src/di/services.ts, add after existing exports:

import { CurrentGhostText } from '../completions/ghost/ghostTextState';
import { LastGhostText } from '../completions/ghost/ghostTextState';

export const ICurrentGhostText = createServiceIdentifier<CurrentGhostText>('ICurrentGhostText');
export const ILastGhostText = createServiceIdentifier<LastGhostText>('ILastGhostText');
```

- [ ] **Step 2: Register singletons in extension.ts**

```typescript
// In src/extension.ts, inside activate(), after GHOST services section:

builder.define(ICurrentGhostText, new SyncDescriptor(CurrentGhostText));
builder.define(ILastGhostText, new SyncDescriptor(LastGhostText));
```

- [ ] **Step 3: Commit**

```bash
git add src/di/services.ts src/extension.ts
git commit -m "feat: register CurrentGhostText and LastGhostText as DI singletons"
```

---

### Task 3: Update GhostText and GhostTextComputer to inject singletons

**Files:**
- Modify: `src/completions/ghost/inlineCompletion.ts`
- Modify: `src/completions/ghost/ghostTextComputer.ts`

- [ ] **Step 1: Update GhostText to inject CurrentGhostText/LastGhostText**

In `src/completions/ghost/inlineCompletion.ts`:

```typescript
import { CurrentGhostText, LastGhostText, ICurrentGhostText, ILastGhostText } from './ghostTextState';

export class GhostText {
    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @ICurrentGhostText private readonly _currentGhostText: CurrentGhostText,
        @ILastGhostText private readonly _lastGhostText: LastGhostText,
    ) {}

    async getInlineCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        token?: vscode.CancellationToken,
    ): Promise<GhostTextResult | undefined> {
        const computer = this._instantiationService.createInstance(
            GhostTextComputer,
            this._currentGhostText,
            this._lastGhostText,
        );
        return computer.getGhostText(document, position, token, false);
    }
}
```

- [ ] **Step 2: Remove new CurrentGhostText()/LastGhostText() from GhostTextComputer constructor**

In `src/completions/ghost/ghostTextComputer.ts`, the constructor already accepts `CurrentGhostText` and `LastGhostText` as first two parameters. No change needed to the constructor signature — only the call site in `GhostText` changes.

- [ ] **Step 3: Run existing tests**

```bash
cd E:/workspace/vscode/copilot-completion && npx mocha --require ts-node/register src/test/ghost/ghostTextComputer.test.ts --timeout 10000
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/completions/ghost/inlineCompletion.ts src/completions/ghost/ghostTextComputer.ts
git commit -m "feat: inject CurrentGhostText/LastGhostText as DI singletons into GhostText"
```

---

### Task 4: Add typing-as-suggested check and setGhostText call in GhostTextComputer

**Files:**
- Modify: `src/completions/ghost/ghostTextComputer.ts`

- [ ] **Step 1: Add typing-as-suggested check before cache lookup**

In `getGhostText()`, after Step 3 (extract prefix/suffix) and before Step 4 (cache lookup), insert:

```typescript
// Step 3.5: Typing-as-suggested check (via CurrentGhostText singleton)
const typingSuggested = this._currentGhostText.getCompletionsForUserTyping(prefix, suffix);
if (typingSuggested && typingSuggested.length > 0) {
    this._log.info(`[GHOST] TYPING_AS_SUGGESTED count=${typingSuggested.length} total=${Date.now() - t0}ms`);
    return {
        completions: typingSuggested.map((c, i) => this._toGhostCompletion(
            { text: c.completionText, finishReason: 'stop' },
            document, position, isMiddleOfTheLine,
        )),
        resultType: ResultType.TypingAsSuggested,
        suffixCoverage: this._calcSuffixCoverage(typingSuggested[0].completionText, suffix),
    };
}
```

- [ ] **Step 2: Call setGhostText at the Network result return point**

In the Network result return (after step 13, before the return statement ~line 250), add:

```typescript
// Store for typing-as-suggested on next keystroke
this._currentGhostText.setGhostText(prefix, suffix, [/* the GhostCompletion */], ResultType.Network, response.finishReason);
```

Insert right before:
```typescript
return {
    completions: [...],
    resultType: ResultType.Network,
    suffixCoverage,
};
```

- [ ] **Step 3: Also call setGhostText at the Cache result return point**

At the Cache return (~line 92), add:

```typescript
this._currentGhostText.setGhostText(prefix, suffix, [/* cached GhostCompletion */], ResultType.Cache);
```

- [ ] **Step 4: Run tests to verify**

```bash
cd E:/workspace/vscode/copilot-completion && npx mocha --require ts-node/register src/test/ghost/ghostTextComputer.test.ts --timeout 10000
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/completions/ghost/ghostTextComputer.ts
git commit -m "feat: add typing-as-suggested check and setGhostText in GhostTextComputer"
```

---

### Task 5: Add sendStream method to ILLMAdapter interface

**Files:**
- Modify: `src/completions/shared/llm/llmAdapter.ts`

- [ ] **Step 1: Add sendStream to the interface**

```typescript
export interface ILLMAdapter {
    send(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse>;
    /** Streaming variant: yields text deltas, returns the completed LLMResponse. */
    sendStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<string, LLMResponse>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/completions/shared/llm/llmAdapter.ts
git commit -m "feat: add sendStream async generator method to ILLMAdapter interface"
```

---

### Task 6: Implement sendStream in OpenAIChatCompletionAdapter

**Files:**
- Modify: `src/completions/shared/llm/openaiChatCompletionAdapter.ts`

- [ ] **Step 1: Implement sendStream**

Add the following method to `OpenAIChatCompletionAdapter`:

```typescript
async *sendStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<string, LLMResponse> {
    const url = `${request.baseUrl}/chat/completions`;
    const bodyObj: Record<string, unknown> = {
        model: request.model,
        messages: request.messages || [],
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        presence_penalty: request.presence_penalty,
        frequency_penalty: request.frequency_penalty,
        stream: request.stream,
        stop: request.stop,
        top_p: request.top_p,
        n: request.n,
    };

    applyThinkingParams(bodyObj, request.capabilities, request.family);

    const body = JSON.stringify(bodyObj);

    const response = await fetch(url, {
        method: 'POST',
        signal,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${request.apiKey}`,
        },
        body: normalizeBody(body),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new LLMError(`OpenAI chat request failed: ${response.status}`, response.status, text + body);
    }

    const ct = response.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) {
        let text = '';
        let finishReason = 'stop';
        const stream = response.body!.pipeThrough(new TextDecoderStream());
        const reader = stream.getReader();
        let extra = '';
        try {
            while (true) {
                if (signal?.aborted) {
                    return { text, finishReason };
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
                        return { text, finishReason };
                    }
                    try {
                        const json = JSON.parse(data) as SSEChunk;
                        const choice = json.choices?.[0];
                        if (choice?.delta?.content) {
                            text += choice.delta.content;
                            yield choice.delta.content;
                        }
                        if (choice?.finish_reason) finishReason = choice.finish_reason;
                    } catch { /* skip malformed JSON */ }
                }
            }
        } finally {
            try { await reader.cancel(); } catch { /* ignore */ }
            try { await response.body?.cancel(); } catch { /* ignore */ }
        }
        return { text, finishReason };
    }
    // Non-streaming fallback
    return this._parseJSON(await response.text());
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd E:/workspace/vscode/copilot-completion && npx tsc --noEmit
```

Expected: no compilation errors.

- [ ] **Step 3: Commit**

```bash
git add src/completions/shared/llm/openaiChatCompletionAdapter.ts
git commit -m "feat: implement sendStream async generator in OpenAIChatCompletionAdapter"
```

---

### Task 7: Stream-aware NES execute() with first-edit early return

**Files:**
- Modify: `src/completions/nes/core/nesWorkflow.ts`

- [ ] **Step 1: Refactor the network request section in execute()**

Replace the `await adapter.send()` block (lines 101-201, the try-catch wrapping the network request + pipeline + filter + assembly) with the streaming approach:

```typescript
// Step 3: Network request (streaming)
const t4 = Date.now();
const endpoint = this._config.supportedEndpoint;
const adapter = this._llmManager.getAdapter(endpoint);
const abortController = new AbortController();
const cancelListener = token?.onCancellationRequested(() => {
    this._log.info(`[NES]  ABORT — CancellationToken triggered`);
    abortController.abort();
});

this._log.debug(`[NES]  endpoint=${endpoint} model=${this._config.model} max_tokens=${this._config.maxOutputTokens}`);

try {
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

    let accumulated = '';
    let firstEditResolved = false;
    let firstResult: NextEditResult | undefined;
    const editWindowHadCursorTag = promptAssembly.editWindowLines.some(l => l.includes('<|cursor|>'));
    const pipelineContext: ResponsePipelineContext = { editWindowHadCursorTag };

    for await (const delta of stream) {
        if (abortController.signal.aborted) break;

        accumulated += delta;

        if (!firstEditResolved) {
            const parsedLines = this._responsePipeline.process(accumulated, pipelineContext);
            if (parsedLines && parsedLines.length > 0 && !parsedLines.every(l => l.trim() === '')) {
                const finalEdit = this._editFilterChain.apply(parsedLines, promptAssembly.editWindowLines);
                if (finalEdit) {
                    const result = this._resultAssembler.assemble(
                        parsedLines,
                        document,
                        position,
                        undefined,
                        this._config.suffixOverlapThreshold,
                        this._config.suffixOverlapType,
                        this._log
                    );
                    firstResult = result;
                    firstEditResolved = true;

                    const networkMs = Date.now() - t4;
                    this._log.info(`[NES]  FIRST_EDIT network=${networkMs}ms edit=${result.edit.length}ch`);

                    // Background: continue consuming stream to populate cache
                    this._consumeRemainingStream(stream, accumulated, document, position, promptAssembly, pipelineContext, abortController.signal)
                        .catch(err => this._log.error(`[NES]  background_stream error: ${err}`));
                    break;
                }
            }
        }
    }

    // If first edit was found during streaming, return it immediately
    if (firstResult) {
        const totalMs = Date.now() - t0;
        this._log.info(`[NES]  RESULT (streaming) edit=${firstResult.edit.length}ch total=${totalMs}ms`);
        this._log.info(`edit = '${firstResult.edit}', editfull = '${firstResult.fullEditText}'\n range = (start = ${firstResult.range.start}, end =${firstResult.range.end}), cursorAfterEdit = ${firstResult.cursorAfterEdit}\njump = ${firstResult.isFromCursorJump}, ${firstResult.jumpToPosition}`);
        return { editResult: firstResult, promptPieces: promptAssembly.promptPieces };
    }

    // Fallback: stream completed without finding an edit
    const networkMs = Date.now() - t4;
    this._log.info(`[NES]  NETWORK finish (no first edit) [${networkMs}ms]`);
    this._log.info('\n' + accumulated);

    const parsedLines = this._responsePipeline.process(accumulated, pipelineContext);
    if (!parsedLines || parsedLines.length === 0 || parsedLines.every(l => l.trim() === '')) {
        this._log.info(`[NES]  EMPTY_EDIT — pipeline returned no content total=${Date.now() - t0}ms`);
        return { editResult: undefined, promptPieces: promptAssembly.promptPieces };
    }

    const finalEdit = this._editFilterChain.apply(parsedLines, promptAssembly.editWindowLines);
    if (!finalEdit) {
        this._log.info(`[NES]  FILTERED — edit rejected by filter chain total=${Date.now() - t0}ms`);
        return { editResult: undefined, promptPieces: promptAssembly.promptPieces };
    }

    const result = this._resultAssembler.assemble(
        parsedLines, document, position, undefined,
        this._config.suffixOverlapThreshold, this._config.suffixOverlapType, this._log
    );

    const totalMs = Date.now() - t0;
    this._log.info(`[NES]  RESULT (fallback) edit=${result.edit.length}ch total=${totalMs}ms`);
    this._log.info(`edit = '${result.edit}', editfull = '${result.fullEditText}'\n range = (start = ${result.range.start}, end =${result.range.end}), cursorAfterEdit = ${result.cursorAfterEdit}\njump = ${result.isFromCursorJump}, ${result.jumpToPosition}`);

    return { editResult: result, promptPieces: promptAssembly.promptPieces };

} catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
        this._log.info(`[NES]  ABORTED after ${Date.now() - t0}ms`);
        return { editResult: undefined };
    }
    this._log.error(`[NES]  ERROR after ${Date.now() - t0}ms: ${err}`);
    return { editResult: undefined };
} finally {
    cancelListener?.dispose();
}
```

- [ ] **Step 2: Add LLMResponse import and _consumeRemainingStream helper method**

Add import at top of `nesWorkflow.ts`:
```typescript
import { LLMResponse } from '../../shared/llm/llmRequest';
```

Add a private method to `NesWorkflow`:

```typescript
private async _consumeRemainingStream(
    stream: AsyncGenerator<string, LLMResponse>,
    accumulated: string,
    document: vscode.TextDocument,
    position: vscode.Position,
    promptAssembly: { promptPieces: PromptPieces; editWindowLines: string[] },
    pipelineContext: ResponsePipelineContext,
    signal: AbortSignal,
): Promise<void> {
    try {
        let text = accumulated;
        for await (const delta of stream) {
            if (signal.aborted) return;
            text += delta;
        }
        // Cache any additional results from the complete response
        const parsedLines = this._responsePipeline.process(text, pipelineContext);
        if (parsedLines && parsedLines.length > 0 && !parsedLines.every(l => l.trim() === '')) {
            const finalEdit = this._editFilterChain.apply(parsedLines, promptAssembly.editWindowLines);
            if (finalEdit) {
                const docId = DocumentId.create(document.uri.toString());
                const docText = document.getText();
                const cacheEntry: CachedEdit = {
                    docId,
                    documentBeforeEdit: docText,
                    editWindow: {
                        startLine: Math.max(0, position.line - 2),
                        endLineExclusive: position.line + 6,
                    },
                    edit: finalEdit,
                    cacheTime: Date.now(),
                };
                this._cache.setKthNextEdit(docId, cacheEntry);
                this._log.debug(`[NES]  background_stream cached edit=${finalEdit.length}ch`);
            }
        }
    } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
            this._log.error(`[NES]  background_stream error: ${err}`);
        }
    }
}
```

- [ ] **Step 3: Remove the old cache-writing code from the main flow**

The old `setKthNextEdit` call in the main execute() flow (lines 170-184) should be kept only in the fallback path (when no first edit was found). In the early-return path, caching is handled by `_consumeRemainingStream`.

- [ ] **Step 4: Verify the build compiles**

```bash
cd E:/workspace/vscode/copilot-completion && npx tsc --noEmit
```

Expected: no compilation errors.

- [ ] **Step 5: Run existing NES tests**

```bash
cd E:/workspace/vscode/copilot-completion && npx mocha --require ts-node/register src/test/nes/**/*.test.ts --timeout 10000
```

Expected: all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/completions/nes/core/nesWorkflow.ts
git commit -m "feat: NES streaming first-edit early return with background stream consumption"
```

---

### Task 8: Integration test — verify no regressions

**Files:**
- Run: `src/test/ghost/**/*.test.ts`
- Run: `src/test/nes/**/*.test.ts`

- [ ] **Step 1: Run all Ghost tests**

```bash
cd E:/workspace/vscode/copilot-completion && npx mocha --require ts-node/register "src/test/ghost/**/*.test.ts" --timeout 10000
```

Expected: all tests pass.

- [ ] **Step 2: Run all NES tests**

```bash
cd E:/workspace/vscode/copilot-completion && npx mocha --require ts-node/register "src/test/nes/**/*.test.ts" --timeout 10000
```

Expected: all tests pass.

- [ ] **Step 3: Run full build**

```bash
cd E:/workspace/vscode/copilot-completion && npx tsc --noEmit
```

Expected: no compilation errors.

- [ ] **Step 4: Commit (if any fixes needed)**

```bash
git add <fixed-files>
git commit -m "test: verify no regressions after Strategy A changes"
```
