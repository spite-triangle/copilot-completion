## Why

当前 4 个 LLM adapter 都 hardcode `stream: true`，且不传 `presence_penalty` / `frequency_penalty`。需要将这些参数提升为可配置项，并传入 LLM 请求体。

## What Changes

- `LLMRequest` 新增 `presence_penalty?`、`frequency_penalty?`、`stream?` optional 字段
- Ghost / Nes 配置各新增 3 个 key：`presencePenalty`、`frequencyPenalty`、`stream`
- 4 个 adapter 构造时接收配置默认值，`send()` 中 spread 到请求体
- `extension.ts` 构造 adapter 时传入配置值
- `package.json` 注册 6 个 configuration 属性
- 测试同步更新

## Defaults

- `presencePenalty`: 1（仅 OpenAI adapter）
- `frequencyPenalty`: 0.2（仅 OpenAI adapter）
- `stream`: true（全部 adapter）

## Impact

- `src/config/configKeys.ts` — Ghost/Nes 各 +3 key
- `src/config/ghostConfig.ts` — +3 getter
- `src/config/nesConfig.ts` — +3 getter
- `src/completions/shared/llm/llmRequest.ts` — LLMRequest +3 field
- `src/completions/shared/llm/openaiCompletionAdapter.ts` — 构造注入 + body spread
- `src/completions/shared/llm/openaiChatAdapter.ts` — 同上
- `src/completions/shared/llm/openaiResponseAdapter.ts` — 同上
- `src/completions/shared/llm/anthropicAdapter.ts` — 构造注入 stream
- `src/extension.ts` — 4 个 adapter 构造传参
- `package.json` — contributes.configuration +6
- `src/test/llm/*.test.ts` — 参数验证更新
