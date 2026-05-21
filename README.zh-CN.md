# Copilot Completion

> [github copilot chat](https://github.com/microsoft/vscode-copilot-chat)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 LLM 的 VS Code 代码补全插件 — 同时支持 **GHOST**（中间填充）内联补全和 **NES**（下一步编辑建议）预测性编辑。

[English](README.md)

## 功能特性

### GHOST — Fill-in-the-Middle (FIM) 内联补全

- 在编辑器中以幽灵文本形式呈现内联补全建议
- 通过可配置的 FIM 提示模板将前缀/后缀上下文发送给模型
- 基于 Tree-sitter 的代码块解析，实现智能补全边界
- 可配置相似度阈值的后缀重叠裁剪
- 缓存与防抖机制，确保流畅的用户体验

### NES — 下一步编辑建议

- 预测开发者在当前文件中**下一步的编辑位置和内容**（不限于光标位置）
- 围绕光标进行**编辑窗口**解析，支持合并冲突标记感知
- **光标跳转预测**：预测开发者下一步导航位置，支持跨文件跳转
- **编辑意图分类**：高/中/低积极性过滤
- 响应后处理管道：边界标记解析 → 光标标签清除 → 行级差异 → 后缀重叠裁剪
- 多种响应格式处理器：编辑窗口、代码块、编辑意图、统一 XML、自定义差异补丁

### 支持的 LLM 后端

| 适配器 | API 端点 | 适用场景 |
|---|---|---|
| `OpenAIChatAdapter` | `/chat/completions` | 通用 NES + GHOST |
| `OpenAICompletionAdapter` | `/completions` | 原生 FIM (GHOST) |


> [!tip]
> `GHOST` 可使用 `qwen2.5 coder`，可本地部署且有不错质量

## 配置项

所有设置均使用 `cc-completion` 前缀。

### GHOST 设置

| 键 | 类型 | 默认值 | 描述 |
|---|---|---|---|
| `ghost.enabled` | `boolean` | `true` | 启用 GHOST 内联补全 |
| `ghost.baseUrl` | `string` | `""` | API 基础 URL |
| `ghost.apiKey` | `string` | `""` | API 密钥 |
| `ghost.model` | `string` | `"gpt-4o"` | 模型名称 |
| `ghost.promptTemplate` | `string` | `<\|fim_prefix\|>{prefix}<\|fim_suffix\|>{suffix}<\|fim_middle\|>` | FIM 提示模板 |
| `ghost.suffixOverlapThreshold` | `number` | `0.6` | 后缀重叠相似度阈值 |
| `ghost.suffixOverlapType` | `"low"` \| `"high"` | `"low"` | 重叠检测模式 |
| `ghost.presencePenalty` | `number` | `1` | 存在惩罚 (-2 到 2) |
| `ghost.frequencyPenalty` | `number` | `0.2` | 频率惩罚 (-2 到 2) |
| `ghost.stream` | `boolean` | `true` | 启用 SSE 流式传输 |

### NES 设置

| 键 | 类型 | 默认值 | 描述 |
|---|---|---|---|
| `nes.enabled` | `boolean` | `true` | 启用下一步编辑建议 |
| `nes.baseUrl` | `string` | `""` | API 基础 URL |
| `nes.apiKey` | `string` | `""` | API 密钥 |
| `nes.model` | `string` | `"gpt-4o"` | 模型名称 |
| `nes.supportedEndpoint` | `"chat/completions"` | `"chat/completions"` | LLM API 端点 |
| `nes.suffixOverlapThreshold` | `number` | `0.85` | 后缀重叠相似度阈值 |
| `nes.suffixOverlapType` | `"low"` \| `"high"` | `"high"` | 重叠检测模式 |
| `nes.presencePenalty` | `number` | `1` | 存在惩罚 (-2 到 2) |
| `nes.frequencyPenalty` | `number` | `0.2` | 频率惩罚 (-2 到 2) |
| `nes.stream` | `boolean` | `true` | 启用 SSE 流式传输 |
| `nes.capabilities.supports.thinking` | `boolean` | `false` | 模型支持思考/推理 |
| `nes.capabilities.supports.reasoning_effort` | `string[]` | `[]` | 支持的推理强度级别 |

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

## 许可证

[MIT](LICENSE.txt)
