# Copilot Completion

> [github copilot chat](https://github.com/microsoft/vscode-copilot-chat)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Code completion VS Code extension powered by LLMs — supporting both **GHOST** (Fill-in-the-Middle) inline completions and **NES** (Next Edit Suggestion) predictive edits.

[中文文档](README.zh-CN.md)

## Features

### GHOST — Fill-in-the-Middle (FIM) Inline Completion

- Ghost-text inline suggestions displayed directly in the editor as you type
- Prefix/suffix context sent to the model via configurable FIM prompt template
- **Multi-line detection chain**: ML model scoring, empty block detection, suffix presence, file size guard, and newline detection
- Tree-sitter powered block parsing for intelligent completion boundaries
- Suffix overlap trimming with configurable similarity thresholds
- Caching and debouncing for responsive UX

### NES — Next Edit Suggestion

- Predicts the developer's **next edit** anywhere in the current file (not just at the cursor)
- **Edit window** resolution around the cursor with merge conflict marker awareness
- **Cursor jump prediction**: anticipates where the developer will navigate next, including cross-file jumps
- **Edit intent classification**: high / medium / low aggressiveness filtering
- Response post-processing pipeline: boundary marker parsing → cursor tag stripping → line-level diff → suffix overlap trimming
- Multiple response format handlers: edit-window, code-block, edit-intent, unified XML, custom diff-patch

### Supported LLM Backends

| Adapter | API Endpoint | Best For |
|---|---|---|
| `OpenAIChatAdapter` | `/chat/completions` | General-purpose NES + GHOST |
| `OpenAICompletionAdapter` | `/completions` | Native FIM (GHOST) |

> [!tip]
> `qwen2.5 coder` is better for `GHOST`, which can run in local and provide better suggestion.

## Configuration

All settings are under the `cc-completion` prefix.

### GHOST Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `ghost.baseUrl` | `string` | `""` | API base URL |
| `ghost.apiKey` | `string` | `""` | API key |
| `ghost.model` | `string` | `"gpt-4o"` | Model name |
| `ghost.promptTemplate` | `string` | `<\|fim_prefix\|>{prefix}<\|fim_suffix\|>{suffix}<\|fim_middle\|>` | FIM prompt template |
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
| `nes.supportedEndpoint` |  `"chat/completions"` | `"chat/completions"` | LLM API endpoint |
| `nes.suffixOverlapThreshold` | `number` | `0.85` | Suffix overlap similarity threshold |
| `nes.suffixOverlapType` | `"low"` \| `"high"` | `"high"` | Overlap detection mode |
| `nes.presencePenalty` | `number` | `1` | Presence penalty (-2 to 2) |
| `nes.frequencyPenalty` | `number` | `0.2` | Frequency penalty (-2 to 2) |
| `nes.stream` | `boolean` | `true` | Enable SSE streaming |
| `nes.capabilities.supports.thinking` | `boolean` | `false` | Model supports thinking/reasoning |
| `nes.capabilities.supports.reasoning_effort` | `string[]` | `[]` | Supported reasoning levels |

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

## License

[MIT](LICENSE.txt)
