# Copilot Completion

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 LLM 的 VS Code 代码补全插件 — 同时支持 **GHOST** FIM 内联补全和 **NES** 预测性编辑。

[English](README.md)

## 启动 NES

>[!note]
> 在最新版的 `vscode` 中，已经将 `NES` 的 `API` 接口彻底关闭，只允许内部插件访问。**因此，需要手动开启 `NES` 需要的 [Proposal API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)。**

1. `ctrl + shift + p` 运行 `Preferences: Configure Runtime Arguments` 命令
2. 将下列配置添加到 `argv.json` 中
    ```json
    {
        "enable-proposed-api": ["young-triangle.copilot-completions"]
    }
    ```
3. 重启 `vscode`


## 功能特性

### GHOST — FIM (Fill in the Middle) Inline Completion

- 在编辑器中以幽灵文本形式呈现内联补全建议
- 通过可配置的 FIM 提示模板将前缀/后缀上下文发送给模型
- 基于 Tree-sitter 的代码块解析，实现智能补全边界
- 可配置相似度阈值的后缀重叠裁剪
- 缓存与防抖机制，确保流畅的用户体验

### NES — Next Edit Suggestion

- 预测开发者在当前文件中**下一步的编辑位置和内容**（不限于光标位置）
- 围绕光标进行**编辑窗口**解析，支持合并冲突标记感知
- **光标跳转预测**：预测开发者下一步导航位置，**目前可用，但是预测会引入两次额外的请求。**
- **编辑意图分类**：高/中/低积极性过滤
- 响应后处理管道：边界标记解析 → 光标标签清除 → 行级差异 → 后缀重叠裁剪
- 多种响应格式处理器：编辑窗口、代码块、编辑意图、统一 XML、自定义差异补丁

### 支持的 LLM 后端

| 模式 | API 端点 | 
|---|---|
| NES | `/chat/completions, /completions` | 
| GHOST | `/completions, /fim/completions` | 


> [!tip]
> - `GHOST` 可使用 `Qwen2.5 coder`，具有较好的性能且资源占用较低
> - `Qwen3.5 9B MIT` 对于 `GHOST` 与 `NES` 都不错
> - `Qwen3.6 35B A3B` 与 `Qwen3.6 27B` 对于 `NES` 效果较好，但本地运行资源占用较大

## 配置项

所有设置均使用 `cc-completion` 前缀。

### wordPattern

通过 `cc-completion.wordPatterns` 可以配置语言的 `wordPatterns`，影响 `GHOST` 的 `ctrl + rightarrow` 单词接收功能
- `wordPattern` 是一个正则表达式，用于匹配单词边界，即控制 `ctrl + rightarrow` 单词接收功能的边界
- 要向 `wordPattern` 中添加 `flags` 使用 `/.../g` 格式，**通常不要添加`flags`，除非语言需要全局匹配**
- `ctrl + shit + p` 输入 `change language mode` 查看当前语言 `id`, **且使用`*`代表替换所有**
- **配置 `cc-completion.wordPatterns` 会覆盖语言默认的 `wordPattern`，影响代码补全、建议等高级功能，请谨慎修改默认配置**

官方内置的默认配置如下

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

**案例**: 实现中文的逐字确认

```json
{
    "cc-completion.wordPatterns": {
        "*": "(-?\\d*\\.\\d\\w*)|(-?[\u4e00-\u9fa5])|([^\\；\\，\\、\\’\\‘\\：\u4e00-\u9fa5\\“\\”\\【\\】\\？\\`\\~\\!\\@\\#\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)"
    },
}
```

### GHOST 设置

| 键 | 类型 | 默认值 | 描述 |
|---|---|---|---|
| `ghost.baseUrl` | `string` | `""` | API 基础 URL |
| `ghost.apiKey` | `string` | `""` | API 密钥 |
| `ghost.model` | `string` | `"gpt-4o"` | 模型名称 |
| `ghost.stops` | `string[]` | `[]` | 响应生成的停止序列 |
| `ghost.promptTemplate` | `string` | `<\|fim_prefix\|>{prefix}<\|fim_suffix\|>{suffix}<\|fim_middle\|>` | FIM 提示模板 |
| `ghost.capabilities.limits.max_output_tokens` | `number` | `512` | 最大输出 token 数（硬上限） |
| `ghost.capabilities.limits.max_context_window_tokens` | `number` | `128000` | 最大上下文窗口 token 数 |
| `ghost.capabilities.limits.delay` | `number` | `150` | 网络请求最小间隔（毫秒） |
| `ghost.suffixOverlapThreshold` | `number` | `0.6` | 后缀重叠相似度阈值 |
| `ghost.suffixOverlapType` | `"low"` \| `"high"` | `"low"` | 重叠检测模式 |
| `ghost.presencePenalty` | `number` | `1` | 存在惩罚 (-2 到 2) |
| `ghost.frequencyPenalty` | `number` | `0.2` | 频率惩罚 (-2 到 2) |
| `ghost.stream` | `boolean` | `true` | 启用 SSE 流式传输 |

### NES 设置

| 键 | 类型 | 默认值 | 描述 |
|---|---|---|---|
| `nes.baseUrl` | `string` | `""` | API 基础 URL |
| `nes.apiKey` | `string` | `""` | API 密钥 |
| `nes.model` | `string` | `"gpt-4o"` | 模型名称 |
| `nes.supportedEndpoint` | `"chat/completions"` | `"chat/completions"` | LLM API 端点 |
| `nes.family` | `"standard"` \| `"openai-o"` \| `"openai-gpt5"` \| `"deepseek"` \| `"qwen"` | `"standard"` | NES 思维模式对应的模型家族 |
| `nes.capabilities.limits.max_output_tokens` | `number` | `8192` | 最大输出 token 数（硬上限） |
| `nes.capabilities.limits.max_context_window_tokens` | `number` | `128000` | 最大上下文窗口 token 数 |
| `nes.capabilities.supports.thinking` | `boolean` | `false` | 模型支持思考/推理 |
| `nes.capabilities.supports.reasoning_effort` | `"minimal"` \| `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` | — | 支持的推理强度级别 |
| `nes.suffixOverlapThreshold` | `number` | `0.9` | 后缀重叠相似度阈值 |
| `nes.suffixOverlapType` | `"low"` \| `"high"` | `"high"` | 重叠检测模式 |
| `nes.presencePenalty` | `number` | `1` | 存在惩罚 (-2 到 2) |
| `nes.frequencyPenalty` | `number` | `0.2` | 频率惩罚 (-2 到 2) |
| `nes.stream` | `boolean` | `true` | 启用 SSE 流式传输 |
| `nes.promptTemplate` | `string` | `<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n` | `/v1/completions` 的提示词模板 |

## 命令

| 命令 | 描述 |
|---|---|
| `CC Completion: Toggle Panel` | 切换状态栏面板可见性 |

## 系统要求

- VS Code `^1.110.0`

## 开发指南

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监视模式
npm run watch

# 生产构建
npm run package

# 代码检查
npm run lint
```

## 项目架构

```
src/
├── completions/
│   ├── ghost/          # GHOST: FIM 内联补全
│   │   └── multiline/  # 多行检测链 + tree-sitter
│   ├── nes/            # NES: 下一步编辑建议
│   │   ├── core/       # 工作流、历史、编辑窗口、结果组装
│   │   ├── response/   # 响应管道、差异对比、过滤器链
│   │   └── stubs/      # 数据类型桩
│   └── shared/         # 共享 LLM 适配器和日志服务
├── common/             # 通用工具（数组、Result 类型、后缀裁剪）
├── config/             # 配置提供者（GHOST + NES）
├── di/                 # 依赖注入容器
├── test/               # 测试套件
└── ui/                 # 状态栏面板
```

## 参考

- [github copilot chat](https://github.com/microsoft/vscode-copilot-chat)

## 许可证

[MIT](LICENSE.txt)
