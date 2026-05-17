## 1. LLM 类型扩展

- [x] 1.1 `llmRequest.ts` — `LLMRequest` 新增 `presence_penalty?`、`frequency_penalty?`、`stream?` optional 字段

## 2. Config 层

- [x] 2.1 `configKeys.ts` — Ghost 新增 `presencePenalty`、`frequencyPenalty`、`stream` 3 个 key；Nes 同样新增 3 个 key
- [x] 2.2 `ghostConfig.ts` — 接口 + 实现：`presencePenalty`(default 1)、`frequencyPenalty`(default 0.2)、`stream`(default true)
- [x] 2.3 `nesConfig.ts` — 接口 + 实现：`presencePenalty`(default 1)、`frequencyPenalty`(default 0.2)、`stream`(default true)

## 3. Adapter 改造

- [x] 3.1 `openaiCompletionAdapter.ts` — 构造注入 `presencePenalty`/`frequencyPenalty`/`stream`，`send()` 中 `request.xxx ?? this._defaultXxx` → body
- [x] 3.2 `openaiChatAdapter.ts` — 同上
- [x] 3.3 `openaiResponseAdapter.ts` — 同上
- [x] 3.4 `anthropicAdapter.ts` — 构造注入 `stream`，`send()` 中 `request.stream ?? this._defaultStream` → body

## 4. DI 装配

- [x] 4.1 `extension.ts` — 构造 4 个 adapter 时传入 config 值

## 5. Settings UI

- [x] 5.1 `package.json` — `contributes.configuration` 注册 6 个属性（Ghost 3 个 + Nes 3 个）

## 6. 测试更新

- [x] 6.1 `openaiCompletionAdapter.test.ts` — 构造参数默认值兼容（不破坏现有测试）
- [x] 6.2 `openaiChatAdapter.test.ts` — 同上
- [x] 6.3 `openaiResponseAdapter.test.ts` — 同上
- [x] 6.4 `anthropicAdapter.test.ts` — 同上
