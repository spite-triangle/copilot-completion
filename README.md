# Copilot Completion

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Code completion VS Code extension powered by LLMs — supporting both **GHOST** FIM inline completions and **NES** (Next Edit Suggestion) predictive edits.

[中文文档](README.zh-CN.md)

## Enable NES

>[!note]
> Because latest VS Code has tightened its permission controls, the `NES` feature APIs are restricted to internal extensions only; hence, **you must manually enable the [Proposals API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)**.

1. `ctrl + shift + p` and type `Preferences: Configure Runtime Arguments`
2. Add the following line to the `argv.json` file:
    ```json
    {
        "enable-proposed-api": ["young-triangle.copilot-completions"]
    }
    ```
3. Restart VS Code to apply the changes.

## Features

### GHOST — FIM (Fill in the Middle) Inline Completion

- Ghost-text inline suggestions displayed directly in the editor as you type
- Prefix/suffix context sent to the model via configurable FIM prompt template
- **Multi-line detection chain**: ML model scoring, empty block detection, suffix presence, file size guard, and newline detection
- Tree-sitter powered block parsing for intelligent completion boundaries
- Suffix overlap trimming with configurable similarity thresholds
- Caching and debouncing for responsive UX

### NES — Next Edit Suggestion

- Predicts the developer's **next edit** anywhere in the current file (not just at the cursor)
- **Edit window** resolution around the cursor with merge conflict marker awareness
- **Cursor jump prediction**: anticipates where the developer will navigate next. **This feature is available, but predication will lead to extra twice request.**
- **Edit intent classification**: high / medium / low aggressiveness filtering
- Response post-processing pipeline: boundary marker parsing → cursor tag stripping → line-level diff → suffix overlap trimming
- Multiple response format handlers: edit-window, code-block, edit-intent, unified XML, custom diff-patch

### Supported LLM Backends

| Mode | API Endpoint | 
|---|---|
| NES | `/chat/completions, /completions` |
| GHOST | `/completions, /fim/completions` |

> [!tip]
> - `Qwen2.5 coder` is good performance for `GHOST`, which can run in local and provide better suggestion.
> - `Qwen3.5 9B MIT` performs well for `GHOST` and `NES` individually. 
> - `Qwen3.6 35B A3B` and `Qwen3.6 27B` are good for `NES`.

## Configuration

All settings are under the `cc-completion` prefix.

### wordPattern

Through `cc-completion.wordPatterns`, you can configure the wordPatterns for a language, which affects the word recognition behavior of `ctrl + rightarrow` in `GHOST`.
- wordPattern is a regular expression used to match word boundaries — that is, it controls the boundaries for the `ctrl + rightarrow` word recognition feature.
- To add flags to wordPattern, use the `/.../ug` format. **Usually, do not add flags unless the language requires global matching.**
- Press `ctrl + shift + p`, type `change language mode` to check the current language id, and **use `*` to represent replacing all languages**.
- Configuring `cc-completion.wordPatterns` will override the language's default wordPattern, affecting advanced features such as code completion and suggestions. **Please modify the default configuration with caution**.

The official built-in default configuration is as follows:

```json
{
    "cc-completion.wordPatterns":{
        "c": "(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\@\\#\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)",
        "cpp": "(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\@\\#\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)",
        "cuda-cpp": "(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\@\\#\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)",
        "css": "(#?-?\\d*\\.\\d\\w*%?)|(::?[\\w-]*(?=[^,{;]*[,{]))|(([@#!])? [\\w-?]+%?|[@#!.])",
        "handlebars": "(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\@\\$\\^\\&\\*\\(\\)\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\s]+)",
        "html": "(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\@\\$\\^\\&\\*\\(\\)\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\s]+)",
        "less": "(#?-?\\d*\\.\\d\\w*%?)|(::?[\\w-]*(?=[^,{;]*[,{]))|(([@#!])? [\\w-?]+%?|[@#!.])",
        "markdown": "/(\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark})(((\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark})|[_])?(\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark}))*/ug",
        "php": "(-?\\d*\\.\\d\\w*)|([^\\-\\`\\~\\!\\@\\#\\%\\^\\&\\*\\(\\)\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)",
        "prompt": "/(\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark})(((\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark})|[_])?(\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark}))*/ug",
        "instructions": "/(\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark})(((\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark})|[_])?(\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark}))*/ug",
        "chatagent": "/(\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark})(((\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark})|[_])?(\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark}))*/ug",
        "skill": "/(\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark})(((\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark})|[_])?(\\p{Alphabetic}|\\p{Number}|\\p{Nonspacing_Mark}))*/ug",
        "restructuredtext": "[\\w-]*\\w[\\w-]*",
        "scss": "(#?-?\\d*\\.\\d\\w*%?)|(::?[\\w-]*(?=[^,{;]*[,{]))|(([@$#!.])? [\\w-?]+%?|[@#!$.])",
        "typescript": "(-?\\d*\\.\\d\\w*)|([^\\`\\@\\~\\!\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)",
        "typescriptreact": "(-?\\d*\\.\\d\\w*)|([^\\`\\@\\~\\!\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)",
        "jsonc": "(-?\\d*\\.\\d\\w*)|([^\\`\\@\\~\\!\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)",
        "json": "(-?\\d*\\.\\d\\w*)|([^\\`\\@\\~\\!\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)"
    }
}
```

**example**: Implement character-by-character confirmation for Chinese

```json
{
    "cc-completion.wordPatterns": {
        "*": "(-?\\d*\\.\\d\\w*)|(-?[\u4e00-\u9fa5])|([^\\；\\，\\、\\’\\‘\\：\u4e00-\u9fa5\\“\\”\\【\\】\\？\\`\\~\\!\\@\\#\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)"
    },
}
```

### GHOST Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `ghost.baseUrl` | `string` | `""` | API base URL |
| `ghost.apiKey` | `string` | `""` | API key |
| `ghost.model` | `string` | `"gpt-4o"` | Model name |
| `ghost.stops` | `string[]` | `[]` | Stop sequences for response generation |
| `ghost.promptTemplate` | `string` | `<\|fim_prefix\|>{prefix}<\|fim_suffix\|>{suffix}<\|fim_middle\|>` | FIM prompt template |
| `ghost.capabilities.limits.max_output_tokens` | `number` | `512` | Max output tokens (hard cap) |
| `ghost.capabilities.limits.max_context_window_tokens` | `number` | `128000` | Max context window tokens |
| `ghost.capabilities.limits.delay` | `number` | `150` | Minimum delay (ms) between network requests |
| `ghost.suffixOverlapThreshold` | `number` | `0.6` | Suffix overlap similarity threshold |
| `ghost.suffixOverlapType` | `"low"` \| `"high"` | `"low"` | Overlap detection mode |
| `ghost.presencePenalty` | `number` | `1` | Presence penalty (-2 to 2) |
| `ghost.frequencyPenalty` | `number` | `0.2` | Frequency penalty (-2 to 2) |
| `ghost.stream` | `boolean` | `true` | Enable SSE streaming |

### NES Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `nes.baseUrl` | `string` | `""` | API base URL |
| `nes.apiKey` | `string` | `""` | API key |
| `nes.model` | `string` | `"gpt-4o"` | Model name |
| `nes.supportedEndpoint` | `"chat/completions"` | `"chat/completions"` | LLM API endpoint |
| `nes.family` | `"standard"` \| `"openai-o"` \| `"openai-gpt5"` \| `"deepseek"` \| `"qwen"` | `"standard"` | Model family for NES thinking mode |
| `nes.capabilities.limits.max_output_tokens` | `number` | `8192` | Max output tokens (hard cap) |
| `nes.capabilities.limits.max_context_window_tokens` | `number` | `128000` | Max context window tokens |
| `nes.capabilities.supports.thinking` | `boolean` | `false` | Model supports thinking/reasoning |
| `nes.capabilities.supports.reasoning_effort` | `"minimal"` \| `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` | — | Supported reasoning effort level |
| `nes.suffixOverlapThreshold` | `number` | `0.9` | Suffix overlap similarity threshold |
| `nes.suffixOverlapType` | `"low"` \| `"high"` | `"high"` | Overlap detection mode |
| `nes.presencePenalty` | `number` | `1` | Presence penalty (-2 to 2) |
| `nes.frequencyPenalty` | `number` | `0.2` | Frequency penalty (-2 to 2) |
| `nes.stream` | `boolean` | `true` | Enable SSE streaming |
| `nes.promptTemplate` | `string` | `<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n` | `/v1/completions` prompt template |


## Commands

| Command | Description |
|---|---|
| `CC Completion: Toggle Panel` | Toggle the status bar panel visibility |

## Requirements

- VS Code `^1.110.0`

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Production build
npm run package

# Lint
npm run lint
```

## Architecture

```
src/
├── completions/
│   ├── ghost/          # GHOST: FIM inline completion
│   │   └── multiline/  # Multi-line detection chain + tree-sitter
│   ├── nes/            # NES: Next Edit Suggestion
│   │   ├── core/       # Workflow, history, edit-window, result assembly
│   │   ├── response/   # Response pipeline, differ, filter chain
│   │   └── stubs/      # Data type stubs
│   └── shared/         # Shared LLM adapters and log service
├── common/             # Shared utilities (arrays, result type, suffix trim)
├── config/             # Configuration providers (GHOST + NES)
├── di/                 # Dependency injection container
├── test/               # Test suites
└── ui/                 # Status bar panel
```

## References

-  [github copilot chat](https://github.com/microsoft/vscode-copilot-chat)

## License

[MIT](LICENSE.txt)
