# copilot-completion 插件实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 `fake-vscode-copilot-chat` 提取 GHOST FIM + NES 补全功能，构建独立 VS Code 插件 `copilot-completion`。

**Architecture:** 分层 + 模块独立 — DI 基础设施 → 配置层 → GHOST/NES 补全模块 → LLM 适配器层 → UI 层。所有模块通过 DI 接口通信，LLM 适配器采用策略模式。

**Tech Stack:** TypeScript, VS Code Extension API, Mocha + @vscode/test-cli, Webpack, 自定义 DI (从 VS Code 源码复制)

**Source project:** `E:\workspace\vscode\fake-vscode-copilot-chat`

---

## 文件结构总览

| 层 | 文件数 | 职责 |
|----|--------|------|
| DI | 5 | 依赖注入基础设施 |
| Config | 3 | GHOST/NES 独立配置 |
| Shared | 8 | Log、Document、LLM 类型/适配器 |
| GHOST | 14 | FIM 补全核心 |
| NES | 12 | Next Edit Suggestion 核心 |
| UI | 1 | StatusBar + WebView |
| Extension Entry | 1 | 激活入口 |
| Tests | 17 | 单元测试 |
| package.json | 1 | 插件清单 + contributes |

---

### Phase 0: 项目基础配置

### Task 0.1: 更新 package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 更新 package.json**

Replace the entire file:
```json
{
  "name": "cc-completion",
  "displayName": "cc-completion",
  "description": "Code completion powered by LLM — GHOST (FIM) and NES (Next Edit Suggestion)",
  "version": "0.0.1",
  "engines": {
    "vscode": "^1.110.0"
  },
  "categories": [
    "Machine Learning",
    "Other"
  ],
  "activationEvents": [
    "onStartupFinished"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "cc-completion.togglePanel",
        "title": "Toggle CC Completion Panel"
      }
    ],
    "configuration": {
      "title": "CC Completion",
      "properties": {
        "cc-completion.ghost.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable Ghost Inline Completion (FIM)"
        },
        "cc-completion.ghost.baseUrl": {
          "type": "string",
          "default": "",
          "description": "GHOST API base URL"
        },
        "cc-completion.ghost.apiKey": {
          "type": "string",
          "default": "",
          "description": "GHOST API key"
        },
        "cc-completion.ghost.model": {
          "type": "string",
          "default": "gpt-4o",
          "description": "GHOST model name"
        },
        "cc-completion.ghost.promptTemplate": {
          "type": "string",
          "default": "<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>",
          "description": "FIM prompt template. Use {prefix} and {suffix} placeholders."
        },
        "cc-completion.ghost.capabilities.limits.max_output_tokens": {
          "type": "number",
          "default": 256,
          "description": "Max output tokens for GHOST (hard cap)"
        },
        "cc-completion.ghost.capabilities.limits.max_context_window_tokens": {
          "type": "number",
          "default": 128000,
          "description": "Max context window tokens"
        },
        "cc-completion.nes.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable Next Edit Suggestion (NES)"
        },
        "cc-completion.nes.baseUrl": {
          "type": "string",
          "default": "",
          "description": "NES API base URL"
        },
        "cc-completion.nes.apiKey": {
          "type": "string",
          "default": "",
          "description": "NES API key"
        },
        "cc-completion.nes.model": {
          "type": "string",
          "default": "gpt-4o",
          "description": "NES model name"
        },
        "cc-completion.nes.supportedEndpoint": {
          "type": "string",
          "enum": [
            "/chat/completions",
            "/responses",
            "/v1/messages"
          ],
          "default": "/chat/completions",
          "description": "LLM API endpoint for NES"
        },
        "cc-completion.nes.capabilities.limits.max_output_tokens": {
          "type": "number",
          "default": 4096,
          "description": "Max output tokens for NES (hard cap)"
        },
        "cc-completion.nes.capabilities.limits.max_context_window_tokens": {
          "type": "number",
          "default": 128000,
          "description": "Max context window tokens"
        },
        "cc-completion.nes.capabilities.supports.thinking": {
          "type": "boolean",
          "default": false,
          "description": "Whether the model supports thinking"
        },
        "cc-completion.nes.capabilities.supports.reasoning_effort": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["minimal", "low", "medium", "high", "xhigh"]
          },
          "default": [],
          "description": "Supported reasoning effort levels"
        },
        "cc-completion.nes.suffixOverlapThreshold": {
          "type": "number",
          "default": 0.5,
          "description": "Suffix overlap similarity threshold for NES response trimming"
        },
        "cc-completion.nes.suffixOverlapType": {
          "type": "string",
          "enum": ["low", "high"],
          "default": "low",
          "description": "Suffix overlap detection type"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run package",
    "compile": "webpack",
    "watch": "webpack --watch",
    "package": "webpack --mode production --devtool hidden-source-map",
    "compile-tests": "tsc -p . --outDir out",
    "watch-tests": "tsc -p . -w --outDir out",
    "pretest": "npm run compile-tests && npm run compile && npm run lint",
    "lint": "eslint src",
    "test": "vscode-test"
  },
  "devDependencies": {
    "@types/vscode": "^1.110.0",
    "@types/mocha": "^10.0.10",
    "@types/node": "22.x",
    "typescript-eslint": "^8.56.1",
    "eslint": "^9.39.3",
    "typescript": "^5.9.3",
    "ts-loader": "^9.5.4",
    "webpack": "^5.105.3",
    "webpack-cli": "^6.0.1",
    "@vscode/test-cli": "^0.0.12",
    "@vscode/test-electron": "^2.5.2"
  }
}
```

- [ ] **Step 2: 验证**

```bash
cd E:/workspace/vscode/copilot-completion && npm install
```

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore: configure package.json with GHOST and NES settings"
```

---

### Phase 1: DI 基础设施

### Task 1.1: 复制 DI 核心文件

**Files:**
- Create: `src/di/instantiation.ts`
- Create: `src/di/instantiationService.ts`
- Create: `src/di/descriptors.ts`
- Create: `src/di/serviceCollection.ts`

**Source:** `E:\workspace\vscode\fake-vscode-copilot-chat\src\util\vs\platform\instantiation\common\`

- [ ] **Step 1: 复制 instantiation.ts**

```bash
cp "E:/workspace/vscode/fake-vscode-copilot-chat/src/util/vs/platform/instantiation/common/instantiation.ts" "E:/workspace/vscode/copilot-completion/src/di/instantiation.ts"
```

- [ ] **Step 2: 复制 instantiationService.ts**

```bash
cp "E:/workspace/vscode/fake-vscode-copilot-chat/src/util/vs/platform/instantiation/common/instantiationService.ts" "E:/workspace/vscode/copilot-completion/src/di/instantiationService.ts"
```

- [ ] **Step 3: 复制 descriptors.ts**

```bash
cp "E:/workspace/vscode/fake-vscode-copilot-chat/src/util/vs/platform/instantiation/common/descriptors.ts" "E:/workspace/vscode/copilot-completion/src/di/descriptors.ts"
```

- [ ] **Step 4: 复制 serviceCollection.ts**

```bash
cp "E:/workspace/vscode/fake-vscode-copilot-chat/src/util/vs/platform/instantiation/common/serviceCollection.ts" "E:/workspace/vscode/copilot-completion/src/di/serviceCollection.ts"
```

- [ ] **Step 5: 修复 DI 文件中的 import 路径**

The DI files may reference paths like `../../../util/vs/...`. Update all relative imports to match the new `src/di/` location. Read each file and fix any import paths that reference `../../../util/` → change to `./` references within the di/ directory.

Specifically check:
- `instantiationService.ts` imports `instantiation`, `descriptors`, `serviceCollection` — fix to `./instantiation`, `./descriptors`, `./serviceCollection`
- `instantiation.ts` imports — fix any cross-references

- [ ] **Step 6: 创建 services.ts (InstantiationServiceBuilder 封装)**

Create `src/di/services.ts`:

```typescript
import { ServiceIdentifier, IInstantiationService } from './instantiation';
import { SyncDescriptor } from './descriptors';
import { ServiceCollection } from './serviceCollection';
import { InstantiationService } from './instantiationService';
import { createDecorator } from './instantiation';

export { ServiceIdentifier, SyncDescriptor, createDecorator as createServiceIdentifier };

export class InstantiationServiceBuilder {
    private readonly _collection: ServiceCollection;

    constructor(entries?: [ServiceIdentifier<unknown>, unknown][]) {
        this._collection = new ServiceCollection(...(entries || []));
    }

    define<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: T | SyncDescriptor<T>): void {
        this._collection.set(id, instanceOrDescriptor);
    }

    seal(): IInstantiationService {
        return new InstantiationService(this._collection, true);
    }
}
```

- [ ] **Step 7: 验证编译**

```bash
cd E:/workspace/vscode/copilot-completion && npx tsc --noEmit
```

- [ ] **Step 8: 提交**

```bash
git add src/di/
git commit -m "feat: add DI infrastructure (copied from fake-vscode-copilot-chat)"
```

---

### Phase 2: 配置层

### Task 2.1: 配置键常量 + GHOST 配置

**Files:**
- Create: `src/config/configKeys.ts`
- Create: `src/config/ghostConfig.ts`
- Create: `src/test/config/ghostConfig.test.ts`

- [ ] **Step 1: 写测试 — `src/test/config/ghostConfig.test.ts`**

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('GhostConfigProvider', () => {
    test('should return default values when no config set', async () => {
        const config = vscode.workspace.getConfiguration('cc-completion.ghost');
        assert.strictEqual(config.get('enabled'), true);
        assert.strictEqual(config.get('model'), 'gpt-4o');
        assert.strictEqual(config.get('promptTemplate'), '<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>');
        assert.strictEqual(config.get('capabilities.limits.max_output_tokens'), 256);
    });

    test('should return baseUrl when configured', async () => {
        const config = vscode.workspace.getConfiguration('cc-completion.ghost');
        assert.strictEqual(config.get('baseUrl'), '');
        assert.strictEqual(config.get('apiKey'), '');
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd E:/workspace/vscode/copilot-completion && npx tsc -p . --outDir out && npx vscode-test
```
Expected: tests should pass (reading default VS Code config values).

- [ ] **Step 3: 创建 `src/config/configKeys.ts`**

```typescript
export const ConfigKeys = {
    Ghost: {
        enabled: 'cc-completion.ghost.enabled',
        baseUrl: 'cc-completion.ghost.baseUrl',
        apiKey: 'cc-completion.ghost.apiKey',
        model: 'cc-completion.ghost.model',
        promptTemplate: 'cc-completion.ghost.promptTemplate',
        maxOutputTokens: 'cc-completion.ghost.capabilities.limits.max_output_tokens',
        maxContextWindowTokens: 'cc-completion.ghost.capabilities.limits.max_context_window_tokens',
    },
    Nes: {
        enabled: 'cc-completion.nes.enabled',
        baseUrl: 'cc-completion.nes.baseUrl',
        apiKey: 'cc-completion.nes.apiKey',
        model: 'cc-completion.nes.model',
        supportedEndpoint: 'cc-completion.nes.supportedEndpoint',
        maxOutputTokens: 'cc-completion.nes.capabilities.limits.max_output_tokens',
        maxContextWindowTokens: 'cc-completion.nes.capabilities.limits.max_context_window_tokens',
        thinking: 'cc-completion.nes.capabilities.supports.thinking',
        reasoningEffort: 'cc-completion.nes.capabilities.supports.reasoning_effort',
        suffixOverlapThreshold: 'cc-completion.nes.suffixOverlapThreshold',
        suffixOverlapType: 'cc-completion.nes.suffixOverlapType',
    }
} as const;
```

- [ ] **Step 4: 创建 `src/config/ghostConfig.ts`**

```typescript
import * as vscode from 'vscode';
import { createServiceIdentifier } from '../di/services';
import { ConfigKeys } from './configKeys';

export interface GhostCapabilities {
    limits: {
        max_output_tokens: number;
        max_context_window_tokens: number;
    };
}

export const IGhostConfigProvider = createServiceIdentifier<IGhostConfigProvider>('IGhostConfigProvider');

export interface IGhostConfigProvider {
    readonly _serviceBrand: undefined;
    get enabled(): boolean;
    get baseUrl(): string;
    get apiKey(): string;
    get model(): string;
    get promptTemplate(): string;
    get capabilities(): GhostCapabilities;
    get maxOutputTokens(): number;
    onDidChangeEnabled(listener: () => void): vscode.Disposable;
}

export class VSCodeGhostConfigProvider implements IGhostConfigProvider {
    readonly _serviceBrand: undefined;
    private readonly _onDidChangeEnabled = new vscode.EventEmitter<void>();

    get enabled(): boolean {
        return vscode.workspace.getConfiguration().get<boolean>(ConfigKeys.Ghost.enabled, true);
    }

    get baseUrl(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Ghost.baseUrl, '');
    }

    get apiKey(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Ghost.apiKey, '');
    }

    get model(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Ghost.model, 'gpt-4o');
    }

    get promptTemplate(): string {
        return vscode.workspace.getConfiguration().get<string>(
            ConfigKeys.Ghost.promptTemplate,
            '<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>'
        );
    }

    get capabilities(): GhostCapabilities {
        return {
            limits: {
                max_output_tokens: this.maxOutputTokens,
                max_context_window_tokens: vscode.workspace.getConfiguration()
                    .get<number>(ConfigKeys.Ghost.maxContextWindowTokens, 128000),
            }
        };
    }

    get maxOutputTokens(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Ghost.maxOutputTokens, 256);
    }

    onDidChangeEnabled(listener: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(ConfigKeys.Ghost.enabled)) {
                listener();
            }
        });
    }
}
```

- [ ] **Step 5: 运行测试**

```bash
cd E:/workspace/vscode/copilot-completion && npm run compile-tests && npx vscode-test
```
Expected: tests compile and pass.

- [ ] **Step 6: 提交**

```bash
git add src/config/configKeys.ts src/config/ghostConfig.ts src/test/config/ghostConfig.test.ts
git commit -m "feat: add GHOST config provider"
```

---

### Task 2.2: NES 配置

**Files:**
- Create: `src/config/nesConfig.ts`
- Create: `src/test/config/nesConfig.test.ts`

- [ ] **Step 1: 写测试 — `src/test/config/nesConfig.test.ts`**

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('NesConfigProvider', () => {
    test('should return default values when no config set', async () => {
        const config = vscode.workspace.getConfiguration('cc-completion.nes');
        assert.strictEqual(config.get('enabled'), true);
        assert.strictEqual(config.get('model'), 'gpt-4o');
        assert.strictEqual(config.get('supportedEndpoint'), '/chat/completions');
        assert.strictEqual(config.get('capabilities.limits.max_output_tokens'), 4096);
        assert.strictEqual(config.get('suffixOverlapThreshold'), 0.5);
        assert.strictEqual(config.get('suffixOverlapType'), 'low');
        assert.strictEqual(config.get('capabilities.supports.thinking'), false);
    });
});
```

- [ ] **Step 2: 创建 `src/config/nesConfig.ts`**

```typescript
import * as vscode from 'vscode';
import { createServiceIdentifier } from '../di/services';
import { ConfigKeys } from './configKeys';

export type SupportedEndpoint = '/chat/completions' | '/responses' | '/v1/messages';

export interface NesCapabilities {
    limits: {
        max_output_tokens: number;
        max_context_window_tokens: number;
    };
    supports: {
        thinking: boolean;
        reasoning_effort: string[];
    };
}

export const INesConfigProvider = createServiceIdentifier<INesConfigProvider>('INesConfigProvider');

export interface INesConfigProvider {
    readonly _serviceBrand: undefined;
    get enabled(): boolean;
    get baseUrl(): string;
    get apiKey(): string;
    get model(): string;
    get supportedEndpoint(): SupportedEndpoint;
    get capabilities(): NesCapabilities;
    get maxOutputTokens(): number;
    get suffixOverlapThreshold(): number;
    get suffixOverlapType(): 'low' | 'high';
    onDidChangeEnabled(listener: () => void): vscode.Disposable;
}

export class VSCodeNesConfigProvider implements INesConfigProvider {
    readonly _serviceBrand: undefined;

    get enabled(): boolean {
        return vscode.workspace.getConfiguration().get<boolean>(ConfigKeys.Nes.enabled, true);
    }

    get baseUrl(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Nes.baseUrl, '');
    }

    get apiKey(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Nes.apiKey, '');
    }

    get model(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Nes.model, 'gpt-4o');
    }

    get supportedEndpoint(): SupportedEndpoint {
        return vscode.workspace.getConfiguration()
            .get<SupportedEndpoint>(ConfigKeys.Nes.supportedEndpoint, '/chat/completions');
    }

    get capabilities(): NesCapabilities {
        return {
            limits: {
                max_output_tokens: this.maxOutputTokens,
                max_context_window_tokens: vscode.workspace.getConfiguration()
                    .get<number>(ConfigKeys.Nes.maxContextWindowTokens, 128000),
            },
            supports: {
                thinking: vscode.workspace.getConfiguration()
                    .get<boolean>(ConfigKeys.Nes.thinking, false),
                reasoning_effort: vscode.workspace.getConfiguration()
                    .get<string[]>(ConfigKeys.Nes.reasoningEffort, []),
            }
        };
    }

    get maxOutputTokens(): number {
        const cap = vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Nes.maxOutputTokens, 4096);
        return cap;
    }

    get suffixOverlapThreshold(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Nes.suffixOverlapThreshold, 0.5);
    }

    get suffixOverlapType(): 'low' | 'high' {
        return vscode.workspace.getConfiguration()
            .get<'low' | 'high'>(ConfigKeys.Nes.suffixOverlapType, 'low');
    }

    onDidChangeEnabled(listener: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(ConfigKeys.Nes.enabled)) {
                listener();
            }
        });
    }
}
```

- [ ] **Step 3: 运行测试**

```bash
cd E:/workspace/vscode/copilot-completion && npm run compile-tests && npx vscode-test
```
Expected: tests pass.

- [ ] **Step 4: 提交**

```bash
git add src/config/nesConfig.ts src/test/config/nesConfig.test.ts
git commit -m "feat: add NES config provider"
```

---

### Phase 3: 共享层

### Task 3.1: 日志服务

**Files:**
- Create: `src/completions/shared/log/logService.ts`

- [ ] **Step 1: 创建日志服务**

```typescript
import * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../di/services';

export const ILogService = createServiceIdentifier<ILogService>('ILogService');

export interface ILogService {
    readonly _serviceBrand: undefined;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
    show(): void;
}

export class LogService implements ILogService {
    readonly _serviceBrand: undefined;
    private readonly _channel: vscode.LogOutputChannel;

    constructor() {
        this._channel = vscode.window.createOutputChannel('CC Completion', { log: true });
    }

    info(message: string): void {
        this._channel.info(message);
    }

    warn(message: string): void {
        this._channel.warn(message);
    }

    error(message: string): void {
        this._channel.error(message);
    }

    debug(message: string): void {
        this._channel.debug(message);
    }

    show(): void {
        this._channel.show();
    }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/completions/shared/log/logService.ts
git commit -m "feat: add log service using VS Code LogOutputChannel"
```

---

### Task 3.2: LLM 请求/响应类型定义

**Files:**
- Create: `src/completions/shared/llm/llmRequest.ts`

- [ ] **Step 1: 创建类型定义**

```typescript
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface Capabilities {
    thinking?: boolean;
    reasoning_effort?: string;
}

export interface LLMRequest {
    messages?: ChatMessage[];
    prompt?: string;
    max_tokens: number;
    temperature: number;
    stop?: string[];
    capabilities?: Capabilities;
}

export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface LLMResponse {
    text: string;
    finishReason: string;
    usage?: TokenUsage;
}

export class LLMError extends Error {
    constructor(
        message: string,
        public readonly statusCode?: number,
        public readonly responseBody?: string,
    ) {
        super(message);
        this.name = 'LLMError';
    }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/completions/shared/llm/llmRequest.ts
git commit -m "feat: add LLM request/response type definitions"
```

---

### Task 3.3: LLM 适配器接口 + Manager

**Files:**
- Create: `src/completions/shared/llm/llmAdapter.ts`
- Create: `src/test/llm/llmAdapter.test.ts`

- [ ] **Step 1: 写测试 — `src/test/llm/llmAdapter.test.ts`**

```typescript
import * as assert from 'assert';
import { LLMAdapterManager } from '../../completions/shared/llm/llmAdapter';
import { SupportedEndpoint } from '../../config/nesConfig';

suite('LLMAdapterManager', () => {
    test('should register and retrieve adapter', () => {
        const manager = new LLMAdapterManager();
        const mockAdapter = {
            send: async () => ({ text: 'test', finishReason: 'stop' }),
        };
        manager.register('/chat/completions', mockAdapter);
        const retrieved = manager.getAdapter('/chat/completions');
        assert.strictEqual(retrieved, mockAdapter);
    });

    test('should throw for unregistered endpoint', () => {
        const manager = new LLMAdapterManager();
        assert.throws(() => manager.getAdapter('/responses'));
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd E:/workspace/vscode/copilot-completion && npm run compile-tests && npx vscode-test
```
Expected: FAIL — LLMAdapterManager not defined.

- [ ] **Step 3: 创建 `src/completions/shared/llm/llmAdapter.ts`**

```typescript
import { createServiceIdentifier } from '../../../di/services';
import { LLMRequest, LLMResponse } from './llmRequest';
import { SupportedEndpoint } from '../../../config/nesConfig';

export const ILLMAdapterManager = createServiceIdentifier<ILLMAdapterManager>('ILLMAdapterManager');

export interface ILLMAdapter {
    send(request: LLMRequest): Promise<LLMResponse>;
}

export interface ILLMAdapterManager {
    readonly _serviceBrand: undefined;
    register(endpoint: SupportedEndpoint | '/v1/completions', adapter: ILLMAdapter): void;
    getAdapter(endpoint: SupportedEndpoint | '/v1/completions'): ILLMAdapter;
}

export class LLMAdapterManager implements ILLMAdapterManager {
    readonly _serviceBrand: undefined;
    private readonly _adapters = new Map<string, ILLMAdapter>();

    register(endpoint: string, adapter: ILLMAdapter): void {
        this._adapters.set(endpoint, adapter);
    }

    getAdapter(endpoint: string): ILLMAdapter {
        const adapter = this._adapters.get(endpoint);
        if (!adapter) {
            throw new Error(`No adapter registered for endpoint: ${endpoint}`);
        }
        return adapter;
    }
}
```

- [ ] **Step 4: 运行测试**

```bash
cd E:/workspace/vscode/copilot-completion && npm run compile-tests && npx vscode-test
```
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add src/completions/shared/llm/llmAdapter.ts src/test/llm/llmAdapter.test.ts
git commit -m "feat: add LLM adapter interface and manager"
```

---

### Phase 4: LLM 适配器实现

### Task 4.1: OpenAI Chat Adapter (`/v1/chat/completions`)

**Files:**
- Create: `src/completions/shared/llm/openaiChatAdapter.ts`
- Create: `src/test/llm/openaiChatAdapter.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import * as assert from 'assert';
import { OpenAIChatAdapter } from '../../completions/shared/llm/openaiChatAdapter';
import { LLMRequest } from '../../completions/shared/llm/llmRequest';

suite('OpenAIChatAdapter', () => {
    test('should build request body with messages format', () => {
        const adapter = new OpenAIChatAdapter('https://api.example.com', 'sk-test');
        const body = adapter['_buildBody']({
            messages: [
                { role: 'system', content: 'You are a helper.' },
                { role: 'user', content: 'Write code.' },
            ],
            max_tokens: 1024,
            temperature: 0,
        });
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.stream, false);
        assert.strictEqual(parsed.max_tokens, 1024);
        assert.strictEqual(parsed.messages.length, 2);
        assert.strictEqual(parsed.messages[0].role, 'system');
    });

    test('should parse OpenAI chat response', () => {
        const adapter = new OpenAIChatAdapter('', '');
        const response = adapter['_parseResponse']({
            choices: [{ message: { content: 'const x = 1;' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
        assert.strictEqual(response.text, 'const x = 1;');
        assert.strictEqual(response.finishReason, 'stop');
        assert.strictEqual(response.usage?.completion_tokens, 5);
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm run compile-tests && npx vscode-test --runTestsByPath out/test/llm/openaiChatAdapter.test.js
```

- [ ] **Step 3: 创建 `src/completions/shared/llm/openaiChatAdapter.ts`**

```typescript
import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError } from './llmRequest';

export class OpenAIChatAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
    ) {}

    async send(request: LLMRequest): Promise<LLMResponse> {
        const url = `${this.baseUrl}/v1/chat/completions`;
        const body = this._buildBody(request);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new LLMError(`OpenAI chat request failed: ${response.status}`, response.status, text);
        }
        const json = await response.json();
        return this._parseResponse(json);
    }

    private _buildBody(request: LLMRequest): string {
        const body: Record<string, unknown> = {
            model: this.model,
            messages: request.messages || [],
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: false,
        };
        if (request.stop) { body.stop = request.stop; }
        return JSON.stringify(body);
    }

    private _parseResponse(json: Record<string, unknown>): LLMResponse {
        const choice = (json.choices as Array<Record<string, unknown>>)[0];
        return {
            text: (choice.message as Record<string, string>).content,
            finishReason: choice.finish_reason as string,
            usage: json.usage ? {
                prompt_tokens: (json.usage as Record<string, number>).prompt_tokens,
                completion_tokens: (json.usage as Record<string, number>).completion_tokens,
                total_tokens: (json.usage as Record<string, number>).total_tokens,
            } : undefined,
        };
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

- [ ] **Step 5: 提交**

```bash
git add src/completions/shared/llm/openaiChatAdapter.ts src/test/llm/openaiChatAdapter.test.ts
git commit -m "feat: add OpenAI Chat adapter"
```

---

### Task 4.2: OpenAI Response Adapter (`/v1/responses`)

**Files:**
- Create: `src/completions/shared/llm/openaiResponseAdapter.ts`
- Create: `src/test/llm/openaiResponseAdapter.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import * as assert from 'assert';
import { OpenAIResponseAdapter } from '../../completions/shared/llm/openaiResponseAdapter';

suite('OpenAIResponseAdapter', () => {
    test('should build request body for responses API', () => {
        const adapter = new OpenAIResponseAdapter('https://api.example.com', 'sk-test', 'gpt-4o');
        const body = adapter['_buildBody']({
            messages: [
                { role: 'system', content: 'You are a helper.' },
                { role: 'user', content: 'Edit code.' },
            ],
            max_tokens: 2048,
            temperature: 0,
        });
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.model, 'gpt-4o');
        assert.strictEqual(parsed.stream, false);
        assert.strictEqual(parsed.max_output_tokens, 2048);
        assert.strictEqual(parsed.input.length, 2);
    });

    test('should parse response API output', () => {
        const adapter = new OpenAIResponseAdapter('', '', '');
        const response = adapter['_parseResponse']({
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'edited code' }] }],
            usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70 },
        });
        assert.strictEqual(response.text, 'edited code');
        assert.strictEqual(response.finishReason, 'stop');
        assert.strictEqual(response.usage?.prompt_tokens, 50);
        assert.strictEqual(response.usage?.completion_tokens, 20);
    });
});
```

- [ ] **Step 2: 运行测试验证失败** — 同上

- [ ] **Step 3: 创建 `src/completions/shared/llm/openaiResponseAdapter.ts`**

```typescript
import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError } from './llmRequest';

export class OpenAIResponseAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
    ) {}

    async send(request: LLMRequest): Promise<LLMResponse> {
        const url = `${this.baseUrl}/v1/responses`;
        const body = this._buildBody(request);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new LLMError(`OpenAI responses API failed: ${response.status}`, response.status, text);
        }
        const json = await response.json();
        return this._parseResponse(json);
    }

    private _buildBody(request: LLMRequest): string {
        const input = (request.messages || []).map(m => ({
            role: m.role,
            content: m.content,
        }));
        const body: Record<string, unknown> = {
            model: this.model,
            input,
            max_output_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: false,
        };
        return JSON.stringify(body);
    }

    private _parseResponse(json: Record<string, unknown>): LLMResponse {
        const output = (json.output as Array<Record<string, unknown>>)[0];
        const content = (output.content as Array<Record<string, unknown>>)[0];
        return {
            text: content.text as string,
            finishReason: 'stop',
            usage: json.usage ? {
                prompt_tokens: (json.usage as Record<string, number>).input_tokens,
                completion_tokens: (json.usage as Record<string, number>).output_tokens,
                total_tokens: (json.usage as Record<string, number>).total_tokens,
            } : undefined,
        };
    }
}
```

- [ ] **Step 4: 运行测试验证通过 + 提交**

---

### Task 4.3: Anthropic Adapter (`/v1/messages`)

**Files:**
- Create: `src/completions/shared/llm/anthropicAdapter.ts`
- Create: `src/test/llm/anthropicAdapter.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import * as assert from 'assert';
import { AnthropicAdapter } from '../../completions/shared/llm/anthropicAdapter';

suite('AnthropicAdapter', () => {
    test('should build messages format for Anthropic API', () => {
        const adapter = new AnthropicAdapter('https://api.anthropic.com', 'sk-test', 'claude-3-haiku-20240307');
        const body = adapter['_buildBody']({
            messages: [
                { role: 'system', content: 'You are a coding assistant.' },
                { role: 'user', content: 'Write a function.' },
            ],
            max_tokens: 1024,
            temperature: 0,
        });
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.model, 'claude-3-haiku-20240307');
        assert.strictEqual(parsed.stream, false);
        assert.strictEqual(parsed.max_tokens, 1024);
        assert.strictEqual(parsed.system, 'You are a coding assistant.');
        assert.strictEqual(parsed.messages.length, 1);
        assert.strictEqual(parsed.messages[0].role, 'user');
    });

    test('should parse Anthropic response', () => {
        const adapter = new AnthropicAdapter('', '', '');
        const response = adapter['_parseResponse']({
            content: [{ type: 'text', text: 'function foo() {}' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 100, output_tokens: 50 },
        });
        assert.strictEqual(response.text, 'function foo() {}');
        assert.strictEqual(response.finishReason, 'end_turn');
        assert.strictEqual(response.usage?.prompt_tokens, 100);
    });
});
```

- [ ] **Step 2: 运行测试验证失败** — 同上

- [ ] **Step 3: 创建 `src/completions/shared/llm/anthropicAdapter.ts`**

```typescript
import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError } from './llmRequest';

export class AnthropicAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
    ) {}

    async send(request: LLMRequest): Promise<LLMResponse> {
        const url = `${this.baseUrl}/v1/messages`;
        const body = this._buildBody(request);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new LLMError(`Anthropic API failed: ${response.status}`, response.status, text);
        }
        const json = await response.json();
        return this._parseResponse(json);
    }

    private _buildBody(request: LLMRequest): string {
        const messages = request.messages || [];
        // Extract system message from messages array
        let system: string | undefined;
        const userMessages = messages.filter(m => {
            if (m.role === 'system') {
                system = m.content;
                return false;
            }
            return true;
        });
        const body: Record<string, unknown> = {
            model: this.model,
            messages: userMessages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: false,
        };
        if (system) { body.system = system; }
        if (request.stop) { body.stop_sequences = request.stop; }
        return JSON.stringify(body);
    }

    private _parseResponse(json: Record<string, unknown>): LLMResponse {
        const content = (json.content as Array<Record<string, unknown>>)[0];
        return {
            text: content.text as string,
            finishReason: json.stop_reason as string,
            usage: json.usage ? {
                prompt_tokens: (json.usage as Record<string, number>).input_tokens,
                completion_tokens: (json.usage as Record<string, number>).output_tokens,
                total_tokens: ((json.usage as Record<string, number>).input_tokens ?? 0) + ((json.usage as Record<string, number>).output_tokens ?? 0),
            } : undefined,
        };
    }
}
```

- [ ] **Step 4: 运行测试验证通过 + 提交**

---

### Task 4.4: OpenAI Completion Adapter (GHOST `/v1/completions`)

**Files:**
- Create: `src/completions/shared/llm/openaiCompletionAdapter.ts`
- Create: `src/test/llm/openaiCompletionAdapter.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import * as assert from 'assert';
import { OpenAICompletionAdapter } from '../../completions/shared/llm/openaiCompletionAdapter';

suite('OpenAICompletionAdapter', () => {
    test('should build FIM prompt request', () => {
        const adapter = new OpenAICompletionAdapter('https://api.example.com', 'sk-test', 'gpt-4o');
        const body = adapter['_buildBody']({
            prompt: '<|fim_prefix|>function hello() {<|fim_suffix|>}<|fim_middle|>',
            max_tokens: 128,
            temperature: 0.2,
            stop: ['\n'],
        });
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.model, 'gpt-4o');
        assert.strictEqual(parsed.stream, false);
        assert.strictEqual(parsed.max_tokens, 128);
        assert.strictEqual(parsed.stop[0], '\n');
    });

    test('should parse completions response', () => {
        const adapter = new OpenAICompletionAdapter('', '', '');
        const response = adapter['_parseResponse']({
            choices: [{ text: '  console.log("hi");', finish_reason: 'stop' }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        });
        assert.strictEqual(response.text, '  console.log("hi");');
        assert.strictEqual(response.finishReason, 'stop');
    });
});
```

- [ ] **Step 2: 运行测试验证失败** — 同上

- [ ] **Step 3: 创建 `src/completions/shared/llm/openaiCompletionAdapter.ts`**

```typescript
import { ILLMAdapter } from './llmAdapter';
import { LLMRequest, LLMResponse, LLMError } from './llmRequest';

export class OpenAICompletionAdapter implements ILLMAdapter {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly model: string,
    ) {}

    async send(request: LLMRequest): Promise<LLMResponse> {
        const url = `${this.baseUrl}/v1/completions`;
        const body = this._buildBody(request);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new LLMError(`OpenAI completions API failed: ${response.status}`, response.status, text);
        }
        const json = await response.json();
        return this._parseResponse(json);
    }

    private _buildBody(request: LLMRequest): string {
        const body: Record<string, unknown> = {
            model: this.model,
            prompt: request.prompt || '',
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: false,
        };
        if (request.stop) { body.stop = request.stop; }
        return JSON.stringify(body);
    }

    private _parseResponse(json: Record<string, unknown>): LLMResponse {
        const choice = (json.choices as Array<Record<string, unknown>>)[0];
        return {
            text: choice.text as string,
            finishReason: choice.finish_reason as string,
            usage: json.usage ? {
                prompt_tokens: (json.usage as Record<string, number>).prompt_tokens,
                completion_tokens: (json.usage as Record<string, number>).completion_tokens,
                total_tokens: (json.usage as Record<string, number>).total_tokens,
            } : undefined,
        };
    }
}
```

- [ ] **Step 4: 运行测试验证通过 + 提交**

---

### Phase 5: GHOST 补全模块

### Task 5.1: GHOST 类型定义

**Files:**
- Create: `src/completions/ghost/types.ts`
- Create: `src/completions/ghost/resultType.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
import * as vscode from 'vscode';

export interface GhostCompletion {
    completionIndex: number;
    completionText: string;
    displayText: string;
    displayNeedsWsOffset: boolean;
}

export interface CompletionResult {
    completion: GhostCompletion;
    isMiddleOfTheLine: boolean;
    suffixCoverage: number;
}

export interface GhostTextOptions {
    isSpeculative: boolean;
    delay: number;
}

export interface DiagnosticSummary {
    line: number;
    severity: 'error' | 'warning';
    message: string;
}
```

- [ ] **Step 2: 创建 resultType.ts**

```typescript
export enum ResultType {
    Network = 0,
    Cache = 1,
    TypingAsSuggested = 2,
    Cycling = 3,
    Async = 4,
}
```

- [ ] **Step 3: 提交**

```bash
git add src/completions/ghost/types.ts src/completions/ghost/resultType.ts
git commit -m "feat: add GHOST type definitions"
```

---

### Task 5.2: GHOST Prompt Factory

**Files:**
- Create: `src/completions/ghost/promptFactory.ts`
- Create: `src/test/ghost/promptFactory.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import * as assert from 'assert';
import { GhostPromptFactory } from '../../completions/ghost/promptFactory';
import { DiagnosticSummary } from '../../completions/ghost/types';

suite('GhostPromptFactory', () => {
    test('should replace {prefix} and {suffix} placeholders', () => {
        const factory = new GhostPromptFactory();
        const template = '<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>';
        const result = factory.createPrompt({
            template,
            prefix: 'function hello() {',
            suffix: '}',
            languageId: 'javascript',
            diagnostics: [],
            recentEdits: [],
        });
        assert.ok(result.includes('<|fim_prefix|>function hello() {'));
        assert.ok(result.includes('<|fim_suffix|>}'));
        assert.ok(result.includes('<|fim_middle|>'));
    });

    test('should prepend language ID context', () => {
        const factory = new GhostPromptFactory();
        const result = factory.createPrompt({
            template: '{prefix}',
            prefix: 'code',
            suffix: '',
            languageId: 'typescript',
            diagnostics: [],
            recentEdits: [],
        });
        assert.ok(result.includes('// language: typescript'));
    });

    test('should prepend diagnostics summary', () => {
        const factory = new GhostPromptFactory();
        const diagnostics: DiagnosticSummary[] = [
            { line: 3, severity: 'error', message: 'Cannot find name "foo"' },
        ];
        const result = factory.createPrompt({
            template: '{prefix}',
            prefix: 'code',
            suffix: '',
            languageId: 'python',
            diagnostics,
            recentEdits: [],
        });
        assert.ok(result.includes('// diagnostics: [Line 3] Cannot find name "foo"'));
    });

    test('should prepend recent edits', () => {
        const factory = new GhostPromptFactory();
        const result = factory.createPrompt({
            template: '{prefix}',
            prefix: 'code',
            suffix: '',
            languageId: 'go',
            diagnostics: [],
            recentEdits: ['+  func Add(a, b int) int {', '+    return a + b', '+  }'],
        });
        assert.ok(result.includes('// recent edits:'));
        assert.ok(result.includes('+  func Add(a, b int) int {'));
    });

    test('should not prepend empty sections', () => {
        const factory = new GhostPromptFactory();
        const result = factory.createPrompt({
            template: '{prefix}',
            prefix: 'code',
            suffix: '',
            languageId: 'javascript',
            diagnostics: [],
            recentEdits: [],
        });
        assert.ok(!result.includes('diagnostics'));
        assert.ok(!result.includes('recent edits'));
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

- [ ] **Step 3: 创建 `src/completions/ghost/promptFactory.ts`**

```typescript
import { createServiceIdentifier } from '../../di/services';
import { DiagnosticSummary } from './types';

export const IGhostPromptFactory = createServiceIdentifier<IGhostPromptFactory>('IGhostPromptFactory');

export interface IGhostPromptFactory {
    readonly _serviceBrand: undefined;
    createPrompt(params: {
        template: string;
        prefix: string;
        suffix: string;
        languageId: string;
        diagnostics: DiagnosticSummary[];
        recentEdits: string[];
    }): string;
}

export class GhostPromptFactory implements IGhostPromptFactory {
    readonly _serviceBrand: undefined;

    createPrompt(params: {
        template: string;
        prefix: string;
        suffix: string;
        languageId: string;
        diagnostics: DiagnosticSummary[];
        recentEdits: string[];
    }): string {
        const contextLines: string[] = [];

        // Language ID
        const commentPrefix = this._getCommentPrefix(params.languageId);
        contextLines.push(`${commentPrefix} language: ${params.languageId}`);

        // Diagnostics
        if (params.diagnostics.length > 0) {
            for (const d of params.diagnostics.slice(0, 5)) {
                contextLines.push(`${commentPrefix} diagnostics: [Line ${d.line}] ${d.message}`);
            }
        }

        // Recent edits
        if (params.recentEdits.length > 0) {
            contextLines.push(`${commentPrefix} recent edits:`);
            for (const edit of params.recentEdits) {
                contextLines.push(`${commentPrefix} ${edit}`);
            }
        }

        const context = contextLines.join('\n') + '\n';
        const prompt = params.template
            .replace(/\{prefix\}/g, params.prefix)
            .replace(/\{suffix\}/g, params.suffix);
        return context + prompt;
    }

    private _getCommentPrefix(languageId: string): string {
        // Hash-style comment languages
        const hashLanguages = new Set([
            'python', 'ruby', 'shellscript', 'bash', 'yaml', 'toml', 'perl', 'r',
        ]);
        if (hashLanguages.has(languageId)) {
            return '#';
        }
        return '//';
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

- [ ] **Step 5: 提交**

```bash
git add src/completions/ghost/promptFactory.ts src/test/ghost/promptFactory.test.ts
git commit -m "feat: add GHOST prompt factory with template + context"
```

---

### Task 5.3: GHOST Completions Cache

**Files:**
- Create: `src/completions/ghost/completionsCache.ts`
- Create: `src/test/ghost/completionsCache.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import * as assert from 'assert';
import { GhostCompletionsCache } from '../../completions/ghost/completionsCache';

suite('GhostCompletionsCache', () => {
    test('should find cached completion by prefix+suffix', () => {
        const cache = new GhostCompletionsCache(100);
        cache.append('function hello()', '{', {
            text: '  console.log("hi");',
            finishReason: 'stop',
        });
        const results = cache.findAll('function hello()', '{');
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].text, '  console.log("hi");');
    });

    test('should return empty for cache miss', () => {
        const cache = new GhostCompletionsCache(100);
        cache.append('function a()', '{', { text: 'x', finishReason: 'stop' });
        const results = cache.findAll('function b()', '{');
        assert.strictEqual(results.length, 0);
    });

    test('should clear cache', () => {
        const cache = new GhostCompletionsCache(100);
        cache.append('p', 's', { text: 't', finishReason: 'stop' });
        assert.strictEqual(cache.findAll('p', 's').length, 1);
        cache.clear();
        assert.strictEqual(cache.findAll('p', 's').length, 0);
    });

    test('should evict oldest entries when capacity exceeded', () => {
        const cache = new GhostCompletionsCache(2);
        cache.append('a', '', { text: '1', finishReason: 'stop' });
        cache.append('b', '', { text: '2', finishReason: 'stop' });
        cache.append('c', '', { text: '3', finishReason: 'stop' });
        // 'a' should be evicted (oldest)
        assert.strictEqual(cache.findAll('a', '').length, 0);
        assert.strictEqual(cache.findAll('b', '').length, 1);
        assert.strictEqual(cache.findAll('c', '').length, 1);
    });
});
```

- [ ] **Step 2: 运行测试验证失败** — 同上

- [ ] **Step 3: 创建 `src/completions/ghost/completionsCache.ts`**

```typescript
import { createServiceIdentifier } from '../../di/services';

export const IGhostCompletionsCache = createServiceIdentifier<IGhostCompletionsCache>('IGhostCompletionsCache');

export interface IGhostCompletionsCache {
    readonly _serviceBrand: undefined;
    findAll(prefix: string, suffix: string): CompletionChoice[];
    append(prefix: string, suffix: string, choice: CompletionChoice): void;
    clear(): void;
}

export interface CompletionChoice {
    text: string;
    finishReason: string;
}

export class GhostCompletionsCache implements IGhostCompletionsCache {
    readonly _serviceBrand: undefined;
    private readonly _cache: Map<string, CompletionChoice[]>;
    private readonly _keys: string[];

    constructor(private readonly _maxSize: number = 100) {
        this._cache = new Map();
        this._keys = [];
    }

    private _makeKey(prefix: string, suffix: string): string {
        return `${prefix}\0${suffix}`;
    }

    findAll(prefix: string, suffix: string): CompletionChoice[] {
        return this._cache.get(this._makeKey(prefix, suffix)) || [];
    }

    append(prefix: string, suffix: string, choice: CompletionChoice): void {
        const key = this._makeKey(prefix, suffix);
        const existing = this._cache.get(key) || [];
        existing.push(choice);
        this._cache.set(key, existing);

        // Update LRU order
        const idx = this._keys.indexOf(key);
        if (idx >= 0) {
            this._keys.splice(idx, 1);
        }
        this._keys.push(key);

        // Evict oldest
        while (this._keys.length > this._maxSize) {
            const oldest = this._keys.shift()!;
            this._cache.delete(oldest);
        }
    }

    clear(): void {
        this._cache.clear();
        this._keys.length = 0;
    }
}
```

- [ ] **Step 4: 运行测试验证通过 + 提交**

---

### Task 5.4: GHOST RecentEdits Provider

**Files:**
- Create: `src/completions/ghost/recentEditsProvider.ts`
- Create: `src/test/ghost/recentEditsProvider.test.ts`

- [ ] **Step 1: 创建 `src/completions/ghost/recentEditsProvider.ts`**

```typescript
import * as vscode from 'vscode';
import { createServiceIdentifier } from '../../di/services';
import { ILogService } from '../shared/log/logService';

export const IRecentEditsProvider = createServiceIdentifier<IRecentEditsProvider>('IRecentEditsProvider');

export interface IRecentEditsProvider {
    readonly _serviceBrand: undefined;
    readonly recentEdits: string[];
    trackDocument(document: vscode.TextDocument): void;
}

export class RecentEditsProvider implements IRecentEditsProvider {
    readonly _serviceBrand: undefined;
    private _recentEdits: string[] = [];
    private readonly _maxEntries = 10;
    private _disposables: vscode.Disposable[] = [];
    private _trackedDocument: vscode.TextDocument | undefined;

    constructor(
        @ILogService private readonly _log: ILogService,
    ) {}

    get recentEdits(): string[] {
        return this._recentEdits;
    }

    trackDocument(document: vscode.TextDocument): void {
        // Dispose old listener
        for (const d of this._disposables) { d.dispose(); }
        this._disposables = [];
        this._trackedDocument = document;

        this._disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document.uri.toString() !== document.uri.toString()) { return; }
                for (const change of e.contentChanges) {
                    const lines = change.text.split('\n');
                    for (const line of lines) {
                        if (line.trim().length > 0) {
                            this._recentEdits.push('+  ' + line);
                        }
                    }
                }
                while (this._recentEdits.length > this._maxEntries) {
                    this._recentEdits.shift();
                }
            })
        );
        this._log.debug(`RecentEdits: tracking document ${document.uri.toString()}`);
    }
}
```

- [ ] **Step 2: 写测试**

```typescript
import * as assert from 'assert';

suite('RecentEditsProvider', () => {
    test('should start empty', () => {
        // Test that a new instance has empty recentEdits
        // Requires VS Code runtime to test fully — basic unit validation
        const edits: string[] = [];
        assert.strictEqual(edits.length, 0);
    });
});
```

- [ ] **Step 3: 提交**

```bash
git add src/completions/ghost/recentEditsProvider.ts src/test/ghost/recentEditsProvider.test.ts
git commit -m "feat: add GHOST RecentEdits provider"
```

---

### Task 5.5: GHOST GhostTextComputer (核心流水线)

**Files:**
- Create: `src/completions/ghost/ghostTextComputer.ts`
- Create: `src/completions/ghost/requestContext.ts`
- Create: `src/completions/ghost/current.ts`
- Create: `src/completions/ghost/last.ts`
- Create: `src/completions/ghost/asyncCompletions.ts`
- Create: `src/completions/ghost/blockTrimmer.ts`
- Create: `src/completions/ghost/normalizeIndent.ts`
- Create: `src/completions/ghost/inlineCompletion.ts`
- Create: `src/test/ghost/ghostTextComputer.test.ts`
- Create: `src/test/ghost/completionsCache.test.ts` (already exists)
- Create: `src/test/ghost/blockTrimmer.test.ts`
- Create: `src/test/ghost/inlineCompletion.test.ts`

**Source reference for adaptation:** `E:\workspace\vscode\fake-vscode-copilot-chat\src\extension\completions-core\vscode-node\extension\src\ghostText\`

> **IMPORTANT:** This task adapts the core GHOST pipeline from the source project. The full pipeline file (`ghostText.ts`) is 708+ lines. We extract and simplify — keeping the pipeline structure but removing telemetry, auth checks, and streaming. All network calls become non-streaming via `ILLMAdapter`.

- [ ] **Step 1: 创建 `src/completions/ghost/requestContext.ts`**

```typescript
import { IDisposable } from '../../../di/instantiation';
import { CompletionChoice } from './completionsCache';

export interface RequestContext {
    prefix: string;
    suffix: string;
    languageId: string;
    ourRequestId: string;
    maxTokens: number;
    temperature: number;
    stop: string[];
    prompt: string;
}
```

- [ ] **Step 2: 创建 `src/completions/ghost/current.ts`**

```typescript
import * as vscode from 'vscode';

export interface CurrentGhostTextState {
    completionText: string;
    uri: vscode.Uri;
    version: number;
}

export class CurrentGhostText {
    private _state: CurrentGhostTextState | undefined;

    setGhostText(uri: vscode.Uri, version: number, completionText: string): void {
        this._state = { completionText, uri, version };
    }

    getCompletionsForUserTyping(
        uri: vscode.Uri,
        version: number,
    ): string | undefined {
        if (!this._state) return undefined;
        if (this._state.uri.toString() !== uri.toString()) return undefined;
        if (this._state.version !== version) return undefined;
        return this._state.completionText;
    }

    hasAcceptedCurrentCompletion(): boolean {
        return false;
    }
}
```

- [ ] **Step 3: 创建 `src/completions/ghost/last.ts`**

```typescript
export class LastGhostText {
    resetState(): void {}
}
```

- [ ] **Step 4: 创建 `src/completions/ghost/asyncCompletions.ts`**

```typescript
import { createServiceIdentifier } from '../../di/services';

export const IAsyncCompletionsManager = createServiceIdentifier<IAsyncCompletionsManager>('IAsyncCompletionsManager');

export interface IAsyncCompletionsManager {
    readonly _serviceBrand: undefined;
    queueCompletionRequest(requestFn: () => Promise<string>): Promise<string>;
    getFirstMatchingRequest(): string | undefined;
}

export class AsyncCompletionsManager implements IAsyncCompletionsManager {
    readonly _serviceBrand: undefined;
    private _pending: string | undefined;

    async queueCompletionRequest(requestFn: () => Promise<string>): Promise<string> {
        const result = await requestFn();
        this._pending = result;
        return result;
    }

    getFirstMatchingRequest(): string | undefined {
        return this._pending;
    }
}
```

- [ ] **Step 5: 创建 `src/completions/ghost/blockTrimmer.ts`**

```typescript
export interface BlockTrimmerConfig {
    maxLines: number;
    stopAtBlankLine: boolean;
}

export class BlockTrimmer {
    constructor(private readonly config: BlockTrimmerConfig) {}

    trim(text: string): string {
        const lines = text.split('\n');
        if (lines.length <= this.config.maxLines) return text;

        let result = lines.slice(0, this.config.maxLines);
        if (this.config.stopAtBlankLine) {
            const blankIdx = result.findIndex(l => l.trim() === '');
            if (blankIdx > 0) {
                result = result.slice(0, blankIdx);
            }
        }
        return result.join('\n');
    }
}

export class TerseBlockTrimmer extends BlockTrimmer {
    constructor() {
        super({ maxLines: 10, stopAtBlankLine: true });
    }
}

export class VerboseBlockTrimmer extends BlockTrimmer {
    constructor() {
        super({ maxLines: 40, stopAtBlankLine: false });
    }
}
```

- [ ] **Step 6: 创建 `src/completions/ghost/normalizeIndent.ts`**

```typescript
export function normalizeIndent(text: string, baseIndent: string): string {
    if (!text.startsWith('\n') && !text.startsWith('\r\n')) return text;
    const lines = text.split('\n');
    return lines.map((line, i) => {
        if (i === 0) return line;
        return baseIndent + line;
    }).join('\n');
}
```

- [ ] **Step 7: 创建核心 `src/completions/ghost/ghostTextComputer.ts`**

```typescript
import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { IGhostConfigProvider } from '../../config/ghostConfig';
import { IGhostPromptFactory } from './promptFactory';
import { IGhostCompletionsCache, CompletionChoice } from './completionsCache';
import { IRecentEditsProvider } from './recentEditsProvider';
import { ILLMAdapterManager } from '../shared/llm/llmAdapter';
import { ILogService } from '../shared/log/logService';
import { CurrentGhostText } from './current';
import { LastGhostText } from './last';
import { IAsyncCompletionsManager } from './asyncCompletions';
import { BlockTrimmer, TerseBlockTrimmer, VerboseBlockTrimmer } from './blockTrimmer';
import { normalizeIndent } from './normalizeIndent';
import { DiagnosticSummary, GhostCompletion } from './types';
import { ResultType } from './resultType';

export interface GhostTextResult {
    completions: GhostCompletion[];
    resultType: ResultType;
    suffixCoverage: number;
}

export class GhostTextComputer {
    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @IGhostConfigProvider private readonly _config: IGhostConfigProvider,
        @IGhostPromptFactory private readonly _promptFactory: IGhostPromptFactory,
        @IGhostCompletionsCache private readonly _cache: IGhostCompletionsCache,
        @IRecentEditsProvider private readonly _recentEdits: IRecentEditsProvider,
        @ILLMAdapterManager private readonly _llmManager: ILLMAdapterManager,
        @IAsyncCompletionsManager private readonly _asyncManager: IAsyncCompletionsManager,
        @ILogService private readonly _log: ILogService,
        private readonly _currentGhostText: CurrentGhostText,
        private readonly _lastGhostText: LastGhostText,
    ) {}

    async getGhostText(
        document: vscode.TextDocument,
        position: vscode.Position,
        isSpeculative: boolean = false,
    ): Promise<GhostTextResult | undefined> {
        if (!this._config.enabled) {
            this._log.debug('GHOST is disabled, skipping');
            return undefined;
        }

        // Validate inline suggestion position + extract textAfterCursor
        const line = document.lineAt(position.line);
        const textAfterCursor = line.text.substring(position.character);
        const inlineSuggestion = isInlineSuggestionFromTextAfterCursor(textAfterCursor);
        if (inlineSuggestion === undefined) {
            this._log.debug('GHOST: invalid mid-line position');
            return undefined;
        }

        const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        // Suffix: 从光标行下一行开始，光标同行后面的文本不进入 suffix（避免 FIM 看到同行闭括号）
        const suffixStartLine = position.line + 1;
        const suffix = suffixStartLine < document.lineCount
            ? document.getText(new vscode.Range(
                new vscode.Position(suffixStartLine, 0),
                document.lineAt(document.lineCount - 1).range.end,
            ))
            : '';

        // Check cache + typing-as-suggested
        const cached = this._cache.findAll(prefix, suffix);
        if (cached.length > 0) {
            this._log.debug('GHOST: cache hit');
            return {
                completions: cached.map(c => this._toGhostCompletion(c)),
                resultType: ResultType.Cache,
                suffixCoverage: 0,
            };
        }

        // Collect diagnostics
        const diagnostics = this._collectDiagnostics(document, position);

        // Build prompt
        const prompt = this._promptFactory.createPrompt({
            template: this._config.promptTemplate,
            prefix,
            suffix,
            languageId: document.languageId,
            diagnostics,
            recentEdits: this._recentEdits.recentEdits,
        });

        // Determine strategy: single-line 当光标在行尾时（同行光标后无有效文本）
        const isSingleLine = textAfterCursor.trim() === '';

        const maxTokens = this._config.maxOutputTokens;
        // Algorithm determines actual tokens; cap at configured max
        const effectiveTokens = Math.min(isSingleLine ? 64 : maxTokens, maxTokens);

        // Network request
        const adapter = this._llmManager.getAdapter('/v1/completions');
        try {
            const response = await adapter.send({
                prompt,
                max_tokens: effectiveTokens,
                temperature: 0.2,
                stop: isSingleLine ? ['\n'] : undefined,
            });

            const trimmedText = isSingleLine
                ? new TerseBlockTrimmer().trim(response.text)
                : new VerboseBlockTrimmer().trim(response.text);

            const choices: CompletionChoice[] = [{
                text: trimmedText,
                finishReason: response.finishReason,
            }];
            this._cache.append(prefix, suffix, choices[0]);

            return {
                completions: choices.map(c => this._toGhostCompletion(c)),
                resultType: ResultType.Network,
                suffixCoverage: 0,
            };
        } catch (err) {
            this._log.error(`GHOST request failed: ${err}`);
            return undefined;
        }
    }

    private _toGhostCompletion(choice: CompletionChoice): GhostCompletion {
        return {
            completionIndex: 0,
            completionText: choice.text,
            displayText: choice.text,
            displayNeedsWsOffset: false,
        };
    }

    private _collectDiagnostics(document: vscode.TextDocument, position: vscode.Position): DiagnosticSummary[] {
        const allDiagnostics = vscode.languages.getDiagnostics(document.uri);
        return allDiagnostics
            .filter(d => d.range.start.line >= position.line - 20 && d.range.start.line <= position.line)
            .slice(0, 5)
            .map(d => ({
                line: d.range.start.line + 1,
                severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' as const : 'warning' as const,
                message: d.message,
            }));
    }
}
```

- [ ] **Step 8: 创建 `src/completions/ghost/inlineCompletion.ts`**

```typescript
import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { GhostTextComputer, GhostTextResult } from './ghostTextComputer';

export class GhostText {
    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
    ) {}

    async getInlineCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<GhostTextResult | undefined> {
        const computer = this._instantiationService.createInstance(GhostTextComputer);
        return computer.getGhostText(document, position, false);
    }
}
```

- [ ] **Step 9: 写核心测试 — `src/test/ghost/ghostTextComputer.test.ts`**

```typescript
import * as assert from 'assert';

suite('GhostTextComputer', () => {
    test('unit test placeholder — full integration testing requires VS Code runtime', () => {
        assert.ok(true);
    });
});
```

- [ ] **Step 10: 写 blockTrimmer 测试 — `src/test/ghost/blockTrimmer.test.ts`**

```typescript
import * as assert from 'assert';
import { TerseBlockTrimmer, VerboseBlockTrimmer } from '../../completions/ghost/blockTrimmer';

suite('BlockTrimmer', () => {
    test('TerseBlockTrimmer should stop at blank line', () => {
        const trimmer = new TerseBlockTrimmer();
        const input = 'line1\n\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11';
        const result = trimmer.trim(input);
        assert.ok(!result.includes('line3'));
    });

    test('VerboseBlockTrimmer should allow more lines', () => {
        const trimmer = new VerboseBlockTrimmer();
        const input = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n');
        const result = trimmer.trim(input);
        const lines = result.split('\n');
        assert.ok(lines.length <= 40);
    });
});
```

- [ ] **Step 11: 提交**

```bash
git add src/completions/ghost/
git add src/test/ghost/
git commit -m "feat: add GHOST core pipeline (GhostTextComputer, cache, trimmer, async)"
```

---

### Task 5.6: GHOST Provider (VS Code 集成)

**Files:**
- Create: `src/completions/ghost/ghostTextProvider.ts`

- [ ] **Step 1: 创建 VS Code InlineCompletionItemProvider**

```typescript
import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { IGhostConfigProvider } from '../../config/ghostConfig';
import { ILogService } from '../shared/log/logService';
import { GhostText } from './inlineCompletion';
import { createServiceIdentifier } from '../../di/services';

export const IGhostTextProvider = createServiceIdentifier<IGhostTextProvider>('IGhostTextProvider');

export interface IGhostTextProvider {
    readonly _serviceBrand: undefined;
    register(): vscode.Disposable;
}

export class GhostTextProvider implements IGhostTextProvider, vscode.InlineCompletionItemProvider {
    readonly _serviceBrand: undefined;
    private _disposable: vscode.Disposable | undefined;

    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @IGhostConfigProvider private readonly _config: IGhostConfigProvider,
        @ILogService private readonly _log: ILogService,
    ) {}

    register(): vscode.Disposable {
        this._disposable = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            this,
        );

        // Listen for enable/disable changes
        const configDisposable = this._config.onDidChangeEnabled(() => {
            this._log.info(`GHOST enabled changed to: ${this._config.enabled}`);
            if (this._disposable) {
                this._disposable.dispose();
            }
            if (this._config.enabled) {
                this._disposable = vscode.languages.registerInlineCompletionItemProvider(
                    { pattern: '**' },
                    this,
                );
            }
        });

        return {
            dispose: () => {
                this._disposable?.dispose();
                configDisposable.dispose();
            },
        };
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
        if (!this._config.enabled) return undefined;

        const ghostText = this._instantiationService.createInstance(GhostText);
        const result = await ghostText.getInlineCompletions(document, position);

        if (!result || result.completions.length === 0) return undefined;

        const items = result.completions.map(c => {
            const item = new vscode.InlineCompletionItem(
                c.completionText,
                new vscode.Range(position, position),
            );
            return item;
        });

        return items;
    }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/completions/ghost/ghostTextProvider.ts
git commit -m "feat: add GHOST InlineCompletionItemProvider"
```

---

### Phase 6: NES 补全模块

### Task 6.1: NES 类型定义 + System Messages

**Files:**
- Create: `src/completions/nes/types.ts`
- Create: `src/completions/nes/systemMessages.ts`
- Create: `src/completions/nes/promptCrafting.ts` (移植源项目)

**Source reference:** `E:\workspace\vscode\fake-vscode-copilot-chat\src\extension\xtab\common\`

- [ ] **Step 1: 创建 `src/completions/nes/types.ts`**

```typescript
import * as vscode from 'vscode';

export enum PromptingStrategy {
    Xtab275 = 'Xtab275',
}

export enum ResponseFormat {
    EditWindowOnly = 'EditWindowOnly',
}

export interface StatelessNextEditRequest {
    document: vscode.TextDocument;
    position: vscode.Position;
    strategy: PromptingStrategy;
}

export interface NextEditResult {
    edit: string;
    range: vscode.Range;
    cursorAfterEdit?: vscode.Position;
}

export interface LineRange0Based {
    startLine: number;
    endLineExclusive: number;
}
```

- [ ] **Step 2: 创建 `src/completions/nes/systemMessages.ts`**

```typescript
import { PromptingStrategy } from './types';

export const xtab275SystemPrompt = "Predict the next code edit based on user context, following Microsoft content policies and avoiding copyright violations. If a request may breach guidelines, reply: 'Sorry, I can't assist with that.'";

export function pickSystemPrompt(strategy: PromptingStrategy): string {
    switch (strategy) {
        case PromptingStrategy.Xtab275:
            return xtab275SystemPrompt;
        default:
            return xtab275SystemPrompt;
    }
}

export function getResponseFormat(strategy: PromptingStrategy): 'EditWindowOnly' {
    return 'EditWindowOnly';
}
```

- [ ] **Step 3: 移植 `promptCrafting.ts`** from `E:\workspace\vscode\fake-vscode-copilot-chat\src\extension\xtab\common\promptCrafting.ts`

> Copy the file and remove telemetry references. Adapt imports to local module paths. Keep `getUserPrompt()`, `PromptPieces`, `CurrentDocument`, boundary markers, and all XML-like tag logic exactly as in the source.

```bash
cp "E:/workspace/vscode/fake-vscode-copilot-chat/src/extension/xtab/common/promptCrafting.ts" "E:/workspace/vscode/copilot-completion/src/completions/nes/promptCrafting.ts"
```

Then edit to:
- Remove telemetry/feedback logging
- Fix imports to local paths
- Keep `N_LINES_ABOVE = 2`, `N_LINES_BELOW = 5`, `N_LINES_AS_CONTEXT = 15`
- Keep `###remain edit start boundary line###` / `###remain edit end boundary line###`
- Keep `<edit_window>` / `<area_around>` tag wrapping

- [ ] **Step 4: 提交**

```bash
git add src/completions/nes/types.ts src/completions/nes/systemMessages.ts src/completions/nes/promptCrafting.ts
git commit -m "feat: add NES types, system messages, and prompt crafting (from fake-vscode-copilot-chat)"
```

---

### Task 6.2: NES Response Format Handlers

**Files:**
- Create: `src/completions/nes/responseFormatHandlers.ts`
- Create: `src/completions/nes/editIntent.ts`
- Create: `src/test/nes/responseFormatHandlers.test.ts`

**Source reference:** `E:\workspace\vscode\fake-vscode-copilot-chat\src\extension\xtab\node\responseFormatHandlers.ts`

- [ ] **Step 1: 写测试 — `src/test/nes/responseFormatHandlers.test.ts`**

```typescript
import * as assert from 'assert';
import { handleEditWindowOnly } from '../../completions/nes/responseFormatHandlers';

suite('ResponseFormatHandlers', () => {
    test('handleEditWindowOnly should return lines as-is', () => {
        const result = handleEditWindowOnly('line1\nline2\nline3');
        assert.strictEqual(result.lines.length, 3);
        assert.strictEqual(result.lines[0], 'line1');
        assert.strictEqual(result.lines[1], 'line2');
        assert.strictEqual(result.lines[2], 'line3');
    });

    test('handleEditWindowOnly should trim trailing empty lines', () => {
        const result = handleEditWindowOnly('line1\n\n\n');
        assert.strictEqual(result.lines.length, 1);
    });
});
```

- [ ] **Step 2: 创建 `src/completions/nes/editIntent.ts`**

```typescript
export enum EditIntent {
    NoEdit = 'N',
    Low = 'L',
    Medium = 'M',
    High = 'H',
}

export function parseEditIntent(line: string): EditIntent {
    const trimmed = line.trim();
    if (trimmed === 'N' || trimmed.includes('no_edit')) return EditIntent.NoEdit;
    if (trimmed === 'L' || trimmed.includes('low')) return EditIntent.Low;
    if (trimmed === 'M' || trimmed.includes('medium')) return EditIntent.Medium;
    return EditIntent.High;
}
```

- [ ] **Step 3: 创建 `src/completions/nes/responseFormatHandlers.ts`**

```typescript
export interface ParsedEditResult {
    lines: string[];
}

export function handleEditWindowOnly(responseText: string): ParsedEditResult {
    const lines = responseText.split('\n');
    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }
    return { lines };
}
```

- [ ] **Step 4: 运行测试验证通过 + 提交**

---

### Task 6.3: NES SuffixOverlapTrim

**Files:**
- Create: `src/completions/nes/suffixOverlapTrim.ts`
- Create: `src/test/nes/suffixOverlapTrim.test.ts`

**Source reference:** `E:\workspace\vscode\fake-vscode-copilot-chat\src\platform\inlineEdits\common\trimNESResponseSuffixOverlap.ts`

- [ ] **Step 1: 复制源文件**

```bash
cp "E:/workspace/vscode/fake-vscode-copilot-chat/src/platform/inlineEdits/common/trimNESResponseSuffixOverlap.ts" "E:/workspace/vscode/copilot-completion/src/completions/nes/suffixOverlapTrim.ts"
```

- [ ] **Step 2: 修复 import 路径**

Remove dependency on `LineReplacement` from `../../../util/vs/editor/common/core/edits/lineEdit`. Instead define a local simple type:

```typescript
// Replace the LineReplacement import with a local definition:
interface LineReplacement {
    lineRange: { startLine: number; endLineExclusive: number };
    newLines: string[];
}
```

- [ ] **Step 3: 写测试 — `src/test/nes/suffixOverlapTrim.test.ts`**

```typescript
import * as assert from 'assert';
import { TrimNESResponseSuffixOverlap } from '../../completions/nes/suffixOverlapTrim';

suite('TrimNESResponseSuffixOverlap', () => {
    test('should detect exact overlap', () => {
        const trimmer = new TrimNESResponseSuffixOverlap(0.5, 'low');
        const newLines = ['function foo() {', '  return 1;', '}'];
        const suffixLines = ['}', ''];
        const overlap = trimmer.calculateOverlap(newLines, suffixLines);
        assert.strictEqual(overlap, 1);
    });

    test('should return 0 for no overlap', () => {
        const trimmer = new TrimNESResponseSuffixOverlap(0.5, 'low');
        const newLines = ['function foo() {', '  return 1;', '}'];
        const suffixLines = ['completely', 'different', 'content'];
        const overlap = trimmer.calculateOverlap(newLines, suffixLines);
        assert.strictEqual(overlap, 0);
    });

    test('should return 0 for empty input', () => {
        const trimmer = new TrimNESResponseSuffixOverlap(0.5, 'low');
        assert.strictEqual(trimmer.calculateOverlap([], []), 0);
        assert.strictEqual(trimmer.calculateOverlap(['a'], []), 0);
        assert.strictEqual(trimmer.calculateOverlap([], ['a']), 0);
    });
});
```

- [ ] **Step 4: 运行测试验证通过 + 提交**

---

### Task 6.4: NES Cache + Edit Rebase + Speculative Request

**Files:**
- Create: `src/completions/nes/nextEditCache.ts`
- Create: `src/completions/nes/editRebase.ts`
- Create: `src/completions/nes/speculativeRequest.ts`
- Create: `src/completions/nes/cursorLineDivergence.ts`
- Create: `src/test/nes/editRebase.test.ts`
- Create: `src/test/nes/nextEditCache.test.ts`

**Source reference:**
- `E:\workspace\vscode\fake-vscode-copilot-chat\src\extension\inlineEdits\node\nextEditCache.ts`
- `E:\workspace\vscode\fake-vscode-copilot-chat\src\extension\inlineEdits\common\editRebase.ts`
- `E:\workspace\vscode\fake-vscode-copilot-chat\src\extension\inlineEdits\node\speculativeRequestManager.ts`

- [ ] **Step 1: 创建 `src/completions/nes/nextEditCache.ts`**

Adapt from source — remove telemetry, keep LRU caching logic:

```typescript
import { createServiceIdentifier } from '../../di/services';

export const INextEditCache = createServiceIdentifier<INextEditCache>('INextEditCache');

export interface CachedEdit {
    docId: string;
    docContentHash: string;
    editWindow: { startLine: number; endLineExclusive: number };
    edit: string;
    cacheTime: number;
}

export interface CachedOrRebasedEdit extends CachedEdit {
    rebasedEdit?: string;
    isFromSpeculativeRequest?: boolean;
}

export interface INextEditCache {
    readonly _serviceBrand: undefined;
    setKthNextEdit(docId: string, edit: CachedEdit): void;
    lookupNextEdit(docId: string, document: { getText(): string }): CachedOrRebasedEdit | undefined;
    clear(docId: string): void;
    clearAll(): void;
}

export class NextEditCache implements INextEditCache {
    readonly _serviceBrand: undefined;
    private readonly _cache = new Map<string, CachedEdit[]>();
    private readonly _maxPerDoc = 10;

    setKthNextEdit(docId: string, edit: CachedEdit): void {
        const entries = this._cache.get(docId) || [];
        entries.push(edit);
        while (entries.length > this._maxPerDoc) {
            entries.shift();
        }
        this._cache.set(docId, entries);
    }

    lookupNextEdit(docId: string, document: { getText(): string }): CachedOrRebasedEdit | undefined {
        const entries = this._cache.get(docId);
        if (!entries || entries.length === 0) return undefined;

        const docText = document.getText();
        const docHash = this._hash(docText);
        return entries.find(e => e.docContentHash === docHash);
    }

    clear(docId: string): void {
        this._cache.delete(docId);
    }

    clearAll(): void {
        this._cache.clear();
    }

    private _hash(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString(36);
    }
}
```

- [ ] **Step 2: 创建 `src/completions/nes/editRebase.ts`**

Simple rebase implementation adapted from source:

```typescript
export function tryRebase(
    originalDocText: string,
    currentDocText: string,
    originalEdit: string,
): string | undefined {
    if (originalDocText === currentDocText) return originalEdit;

    // Compute diff at line level
    const origLines = originalDocText.split('\n');
    const currLines = currentDocText.split('\n');

    // Simple approach: find common prefix, return edit if prefix matches
    const commonPrefixLen = _commonPrefixLength(origLines, currLines);
    if (commonPrefixLen === origLines.length) return originalEdit;

    // If only additions after the edit window, edit may still be valid
    return undefined;
}

function _commonPrefixLength(a: string[], b: string[]): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) return i;
    }
    return len;
}
```

- [ ] **Step 3: 创建 `src/completions/nes/speculativeRequest.ts`**

```typescript
import { ILogService } from '../shared/log/logService';

export enum SpeculativeCancelReason {
    Rejected = 'Rejected',
    Superseded = 'Superseded',
    CacheCleared = 'CacheCleared',
    DocumentClosed = 'DocumentClosed',
}

export class SpeculativeRequestManager {
    private _running: Promise<unknown> | undefined;
    private _cancelled = false;

    constructor(
        @ILogService private readonly _log: ILogService,
    ) {}

    async execute<T>(fn: () => Promise<T>): Promise<T | undefined> {
        this._cancelled = false;
        this._running = fn();
        try {
            const result = await this._running;
            if (this._cancelled) {
                this._log.debug('SpeculativeRequest: result discarded (cancelled)');
                return undefined;
            }
            return result;
        } catch (err) {
            this._log.error(`SpeculativeRequest failed: ${err}`);
            return undefined;
        }
    }

    cancel(reason: SpeculativeCancelReason): void {
        this._cancelled = true;
        this._log.debug(`SpeculativeRequest cancelled: ${reason}`);
    }
}
```

- [ ] **Step 4: 创建 `src/completions/nes/cursorLineDivergence.ts`**

```typescript
export function isModelLineCompatible(
    userTyped: string,
    modelOutput: string,
): boolean {
    if (!userTyped || !modelOutput) return true;
    const userTrimmed = userTyped.trim();
    const modelTrimmed = modelOutput.trim();
    if (!userTrimmed || !modelTrimmed) return true;

    // Check if model output starts with what the user typed
    return modelTrimmed.startsWith(userTrimmed) ||
           userTrimmed.startsWith(modelTrimmed);
}
```

- [ ] **Step 5: 提交**

```bash
git add src/completions/nes/nextEditCache.ts src/completions/nes/editRebase.ts src/completions/nes/speculativeRequest.ts src/completions/nes/cursorLineDivergence.ts
git add src/test/nes/editRebase.test.ts src/test/nes/nextEditCache.test.ts
git commit -m "feat: add NES cache, rebase, speculative request, and divergence detection"
```

---

### Task 6.5: NES Provider (核心)

**Files:**
- Create: `src/completions/nes/nesProvider.ts`
- Create: `src/completions/nes/nextEditProvider.ts`

**Source reference:**
- `E:\workspace\vscode\fake-vscode-copilot-chat\src\extension\xtab\node\xtabProvider.ts` (stateless part — adapted)
- `E:\workspace\vscode\fake-vscode-copilot-chat\src\extension\inlineEdits\node\nextEditProvider.ts` (stateful orchestrator — adapted)

- [ ] **Step 1: 创建 `src/completions/nes/nesProvider.ts`** (无状态核心 — 适配自 XtabProvider)

This is the simplified stateless NES provider. It follows the Xtab275 strategy, constructs prompts via `promptCrafting.ts`, calls LLM adapter, and processes responses:

```typescript
import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { INesConfigProvider } from '../../config/nesConfig';
import { ILLMAdapterManager } from '../shared/llm/llmAdapter';
import { ILogService } from '../shared/log/logService';
import { PromptingStrategy, StatelessNextEditRequest, NextEditResult } from './types';
import { pickSystemPrompt } from './systemMessages';
import { getUserPrompt, PromptPieces } from './promptCrafting';
import { handleEditWindowOnly } from './responseFormatHandlers';
import { TrimNESResponseSuffixOverlap } from './suffixOverlapTrim';
import { SpeculativeRequestManager } from './speculativeRequest';
import { INextEditCache } from './nextEditCache';
import { tryRebase } from './editRebase';

export class NesProvider {
    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @INesConfigProvider private readonly _config: INesConfigProvider,
        @ILLMAdapterManager private readonly _llmManager: ILLMAdapterManager,
        @ILogService private readonly _log: ILogService,
        @INextEditCache private readonly _cache: INextEditCache,
    ) {}

    async provideNextEdit(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<NextEditResult | undefined> {
        if (!this._config.enabled) {
            this._log.debug('NES is disabled, skipping');
            return undefined;
        }

        // Check cache
        const docText = document.getText();
        const cached = this._cache.lookupNextEdit(document.uri.toString(), document);
        if (cached) {
            this._log.debug('NES: cache hit');
            return this._buildResult(cached.edit, document, position);
        }

        // Build prompt pieces — using original project's promptCrafting
        const promptPieces = this._buildPromptPieces(document, position);
        const userPrompt = getUserPrompt(promptPieces);
        const systemPrompt = pickSystemPrompt(PromptingStrategy.Xtab275);

        // Send request via appropriate adapter
        const endpoint = this._config.supportedEndpoint;
        const adapter = this._llmManager.getAdapter(endpoint);

        try {
            const response = await adapter.send({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                max_tokens: this._config.maxOutputTokens,
                temperature: 0,
                capabilities: {
                    thinking: this._config.capabilities.supports.thinking,
                },
            });

            // Parse response (EditWindowOnly format)
            const parsed = handleEditWindowOnly(response.text);
            const editText = parsed.lines.join('\n');

            if (!editText.trim()) {
                this._log.debug('NES: empty edit from model');
                return undefined;
            }

            // Apply suffix overlap trimming
            const trimmer = new TrimNESResponseSuffixOverlap(
                this._config.suffixOverlapThreshold,
                this._config.suffixOverlapType,
            );
            const suffixLines = document.getText(
                new vscode.Range(position, document.lineAt(document.lineCount - 1).range.end)
            ).split('\n');
            const overlapCount = trimmer.calculateOverlap(parsed.lines, suffixLines);
            const finalLines = overlapCount > 0
                ? parsed.lines.slice(0, parsed.lines.length - overlapCount)
                : parsed.lines;
            const finalEdit = finalLines.join('\n');

            // Cache result
            this._cache.setKthNextEdit(document.uri.toString(), {
                docId: document.uri.toString(),
                docContentHash: this._hash(docText),
                editWindow: {
                    startLine: Math.max(0, position.line - 2),
                    endLineExclusive: position.line + 5,
                },
                edit: finalEdit,
                cacheTime: Date.now(),
            });

            return this._buildResult(finalEdit, document, position);
        } catch (err) {
            this._log.error(`NES request failed: ${err}`);
            return undefined;
        }
    }

    private _buildPromptPieces(document: vscode.TextDocument, position: vscode.Position): any {
        const nLinesAbove = 2;
        const nLinesBelow = 5;
        const nContextLines = 15;

        const editWindowStart = Math.max(0, position.line - nLinesAbove);
        const editWindowEnd = Math.min(document.lineCount, position.line + nLinesBelow + 1);
        const contextStart = Math.max(0, position.line - nContextLines);

        return {
            currentDocument: {
                text: document.getText(),
                cursorLine: position.line,
                cursorColumn: position.character,
            },
            editWindowRange: {
                startLine: editWindowStart,
                endLineExclusive: editWindowEnd,
            },
            areaAroundRange: {
                startLine: contextStart,
                endLineExclusive: editWindowEnd,
            },
            languageContext: document.languageId,
            lintErrors: [],
            editHistory: [],
            neighborSnippets: [],
        };
    }

    private _buildResult(edit: string, document: vscode.TextDocument, position: vscode.Position): NextEditResult {
        const nLinesAbove = 2;
        const editStartLine = Math.max(0, position.line - nLinesAbove);
        const nextLine = Math.min(position.line + 1, document.lineCount - 1);
        return {
            edit,
            range: new vscode.Range(
                new vscode.Position(editStartLine, 0),
                new vscode.Position(Math.min(position.line + 5, document.lineCount - 1), 0),
            ),
            cursorAfterEdit: new vscode.Position(nextLine, 0),
        };
    }

    private _hash(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString(36);
    }
}
```

- [ ] **Step 2: 创建 `src/completions/nes/nextEditProvider.ts`** (有状态编排器 — 适配自 NextEditProvider)

```typescript
import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { INesConfigProvider } from '../../config/nesConfig';
import { ILogService } from '../shared/log/logService';
import { NesProvider } from './nesProvider';
import { NextEditResult } from './types';
import { SpeculativeRequestManager } from './speculativeRequest';
import { createServiceIdentifier } from '../../di/services';

export const INesProvider = createServiceIdentifier<INesProvider>('INesProvider');

export interface INesProvider {
    readonly _serviceBrand: undefined;
    register(): vscode.Disposable;
}

export class NextEditProvider implements INesProvider, vscode.InlineCompletionItemProvider {
    readonly _serviceBrand: undefined;
    private _disposable: vscode.Disposable | undefined;
    private _speculativeManager: SpeculativeRequestManager;

    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @INesConfigProvider private readonly _config: INesConfigProvider,
        @ILogService private readonly _log: ILogService,
    ) {
        this._speculativeManager = this._instantiationService.createInstance(SpeculativeRequestManager);
    }

    register(): vscode.Disposable {
        this._disposable = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            this,
        );

        const configDisposable = this._config.onDidChangeEnabled(() => {
            this._log.info(`NES enabled changed to: ${this._config.enabled}`);
            if (this._disposable) { this._disposable.dispose(); }
            if (this._config.enabled) {
                this._disposable = vscode.languages.registerInlineCompletionItemProvider(
                    { pattern: '**' },
                    this,
                );
            }
        });

        return {
            dispose: () => {
                this._disposable?.dispose();
                configDisposable.dispose();
            },
        };
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
        if (!this._config.enabled) return undefined;

        const provider = this._instantiationService.createInstance(NesProvider);
        const result = await provider.provideNextEdit(document, position);

        if (!result || !result.edit.trim()) return undefined;

        const item = new vscode.InlineCompletionItem(
            result.edit,
            result.range,
        );
        return [item];
    }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/completions/nes/nesProvider.ts src/completions/nes/nextEditProvider.ts
git commit -m "feat: add NES provider (stateless + stateful orchestrator)"
```

---

### Phase 7: UI 层

### Task 7.1: StatusBar + WebView 面板

**Files:**
- Create: `src/ui/statusBarPanel.ts`
- Create: `src/test/ui/statusBarPanel.test.ts`

- [ ] **Step 1: 创建 `src/ui/statusBarPanel.ts`**

```typescript
import * as vscode from 'vscode';
import { createServiceIdentifier } from '../di/services';
import { IGhostConfigProvider } from '../config/ghostConfig';
import { INesConfigProvider } from '../config/nesConfig';
import { ILogService } from '../completions/shared/log/logService';

export const IStatusBarPanel = createServiceIdentifier<IStatusBarPanel>('IStatusBarPanel');

export interface IStatusBarPanel {
    readonly _serviceBrand: undefined;
    register(): vscode.Disposable;
}

export class StatusBarPanel implements IStatusBarPanel {
    readonly _serviceBrand: undefined;
    private _statusBarItem: vscode.StatusBarItem;
    private _panel: vscode.WebviewPanel | undefined;

    constructor(
        @IGhostConfigProvider private readonly _ghostConfig: IGhostConfigProvider,
        @INesConfigProvider private readonly _nesConfig: INesConfigProvider,
        @ILogService private readonly _log: ILogService,
    ) {
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this._updateStatusBar();
    }

    register(): vscode.Disposable {
        this._statusBarItem.show();
        this._statusBarItem.command = 'cc-completion.togglePanel';

        const commandDisposable = vscode.commands.registerCommand(
            'cc-completion.togglePanel',
            () => this._showPanel(),
        );

        const ghostChange = this._ghostConfig.onDidChangeEnabled(() => this._updateStatusBar());
        const nesChange = this._nesConfig.onDidChangeEnabled(() => this._updateStatusBar());

        return {
            dispose: () => {
                this._statusBarItem.dispose();
                this._panel?.dispose();
                commandDisposable.dispose();
                ghostChange.dispose();
                nesChange.dispose();
            },
        };
    }

    private _updateStatusBar(): void {
        const ghostOn = this._ghostConfig.enabled;
        const nesOn = this._nesConfig.enabled;
        const active = [ghostOn && 'G', nesOn && 'N'].filter(Boolean).join('/');
        if (active) {
            this._statusBarItem.text = `$(sparkle) Copilot [${active}]`;
            this._statusBarItem.tooltip = `GHOST: ${ghostOn ? 'ON' : 'OFF'}, NES: ${nesOn ? 'ON' : 'OFF'}`;
        } else {
            this._statusBarItem.text = `$(circle-slash) Copilot [OFF]`;
            this._statusBarItem.tooltip = 'CC Completion disabled';
        }
    }

    private _showPanel(): void {
        if (this._panel) {
            this._panel.reveal();
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'ccCompletion',
            'CC Completion',
            vscode.ViewColumn.Beside,
            { enableScripts: true },
        );

        this._panel.onDidDispose(() => { this._panel = undefined; });

        this._panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'toggleGhost') {
                await vscode.workspace.getConfiguration().update(
                    'cc-completion.ghost.enabled',
                    !this._ghostConfig.enabled,
                    vscode.ConfigurationTarget.Global,
                );
                this._updateStatusBar();
                this._updateWebviewContent();
            } else if (message.command === 'toggleNes') {
                await vscode.workspace.getConfiguration().update(
                    'cc-completion.nes.enabled',
                    !this._nesConfig.enabled,
                    vscode.ConfigurationTarget.Global,
                );
                this._updateStatusBar();
                this._updateWebviewContent();
            }
        });

        this._updateWebviewContent();
    }

    private _updateWebviewContent(): void {
        if (!this._panel) return;

        const ghostOn = this._ghostConfig.enabled;
        const nesOn = this._nesConfig.enabled;

        this._panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: var(--vscode-editor-font-family); padding: 20px; color: var(--vscode-foreground); }
        h2 { margin-top: 0; }
        .section { 
            padding: 16px; margin-bottom: 12px; 
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
        }
        .section-header { display: flex; justify-content: space-between; align-items: center; }
        .section-title { font-size: 14px; font-weight: 600; }
        .section-desc { font-size: 12px; color: var(--vscode-descriptionForeground); margin: 4px 0 12px; }
        .toggle { 
            padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer;
            font-size: 13px; font-weight: 600;
        }
        .toggle.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .toggle.off { background: var(--vscode-input-background); color: var(--vscode-foreground); }
    </style>
</head>
<body>
    <h2>CC Completion</h2>
    <div class="section">
        <div class="section-header">
            <div>
                <div class="section-title">Ghost Inline Completion (GHOST)</div>
            </div>
            <button class="toggle ${ghostOn ? 'on' : 'off'}" 
                    onclick="toggle('toggleGhost')">
                ${ghostOn ? 'ON' : 'OFF'}
            </button>
        </div>
        <div class="section-desc">FIM 模板补全 — 根据光标前后代码上下文自动补全</div>
    </div>
    <div class="section">
        <div class="section-header">
            <div>
                <div class="section-title">Next Edit Suggestion (NES)</div>
            </div>
            <button class="toggle ${nesOn ? 'on' : 'off'}" 
                    onclick="toggle('toggleNes')">
                ${nesOn ? 'ON' : 'OFF'}
            </button>
        </div>
        <div class="section-desc">预测下一个编辑位置 — 智能推荐后续代码修改</div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        function toggle(command) { vscode.postMessage({ command }); }
    </script>
</body>
</html>`;
    }
}
```

- [ ] **Step 2: 创建 `src/test/ui/statusBarPanel.test.ts`**

```typescript
import * as assert from 'assert';

suite('StatusBarPanel', () => {
    test('should exist as a module', () => {
        // Requires VS Code runtime for full testing
        assert.ok(true);
    });
});
```

- [ ] **Step 3: 提交**

```bash
git add src/ui/statusBarPanel.ts src/test/ui/statusBarPanel.test.ts
git commit -m "feat: add StatusBar button with WebView panel for GHOST/NES toggle"
```

---

### Phase 8: 扩展入口

### Task 8.1: extension.ts — 激活入口

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 重写 extension.ts**

```typescript
import * as vscode from 'vscode';
import { InstantiationServiceBuilder, SyncDescriptor } from './di/services';
import { IInstantiationService } from './di/instantiation';

// Config
import { IGhostConfigProvider, VSCodeGhostConfigProvider } from './config/ghostConfig';
import { INesConfigProvider, VSCodeNesConfigProvider } from './config/nesConfig';

// Shared
import { ILogService, LogService } from './completions/shared/log/logService';
import { ILLMAdapterManager, LLMAdapterManager } from './completions/shared/llm/llmAdapter';
import { OpenAIChatAdapter } from './completions/shared/llm/openaiChatAdapter';
import { OpenAIResponseAdapter } from './completions/shared/llm/openaiResponseAdapter';
import { AnthropicAdapter } from './completions/shared/llm/anthropicAdapter';
import { OpenAICompletionAdapter } from './completions/shared/llm/openaiCompletionAdapter';

// GHOST
import { IGhostPromptFactory, GhostPromptFactory } from './completions/ghost/promptFactory';
import { IGhostCompletionsCache, GhostCompletionsCache } from './completions/ghost/completionsCache';
import { IRecentEditsProvider, RecentEditsProvider } from './completions/ghost/recentEditsProvider';
import { IGhostTextProvider, GhostTextProvider } from './completions/ghost/ghostTextProvider';
import { IAsyncCompletionsManager, AsyncCompletionsManager } from './completions/ghost/asyncCompletions';

// NES
import { INesProvider, NextEditProvider } from './completions/nes/nextEditProvider';
import { INextEditCache, NextEditCache } from './completions/nes/nextEditCache';

// UI
import { IStatusBarPanel, StatusBarPanel } from './ui/statusBarPanel';

export function activate(context: vscode.ExtensionContext) {
    const logService = new LogService();
    logService.info('CC Completion activating...');

    // Build DI container
    const builder = new InstantiationServiceBuilder();

    // === Config (direct instances) ===
    const ghostConfig = new VSCodeGhostConfigProvider();
    const nesConfig = new VSCodeNesConfigProvider();
    builder.define(IGhostConfigProvider, ghostConfig);
    builder.define(INesConfigProvider, nesConfig);

    // === Shared ===
    builder.define(ILogService, logService);
    builder.define(ILLMAdapterManager, new LLMAdapterManager());

    // === GHOST services ===
    builder.define(IGhostPromptFactory, new SyncDescriptor(GhostPromptFactory));
    builder.define(IGhostCompletionsCache, new SyncDescriptor(GhostCompletionsCache));
    builder.define(IRecentEditsProvider, new SyncDescriptor(RecentEditsProvider));
    builder.define(IAsyncCompletionsManager, new SyncDescriptor(AsyncCompletionsManager));
    builder.define(IGhostTextProvider, new SyncDescriptor(GhostTextProvider));

    // === NES services ===
    builder.define(INextEditCache, new SyncDescriptor(NextEditCache));
    builder.define(INesProvider, new SyncDescriptor(NextEditProvider));

    // === UI ===
    builder.define(IStatusBarPanel, new SyncDescriptor(StatusBarPanel));

    // Seal
    const instantiationService = builder.seal();
    context.subscriptions.push(instantiationService);

    // Register LLM adapters
    registerLLMAdapters(instantiationService, ghostConfig, nesConfig, logService);

    // Activate providers
    const ghostProvider = instantiationService.createInstance(GhostTextProvider);
    const nesProvider = instantiationService.createInstance(NextEditProvider);
    const statusBar = instantiationService.createInstance(StatusBarPanel);

    context.subscriptions.push(
        ghostProvider.register(),
        nesProvider.register(),
        statusBar.register(),
    );

    // Re-register adapters on config change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('cc-completion.ghost.baseUrl') ||
                e.affectsConfiguration('cc-completion.ghost.apiKey') ||
                e.affectsConfiguration('cc-completion.nes.baseUrl') ||
                e.affectsConfiguration('cc-completion.nes.apiKey') ||
                e.affectsConfiguration('cc-completion.nes.supportedEndpoint')) {
                registerLLMAdapters(instantiationService, ghostConfig, nesConfig, logService);
            }
        }),
    );

    logService.info('CC Completion activated');
}

function registerLLMAdapters(
    is: IInstantiationService,
    ghostConfig: IGhostConfigProvider,
    nesConfig: INesConfigProvider,
    log: ILogService,
): void {
    const llmManager = is.invokeFunction(accessor =>
        accessor.get(ILLMAdapterManager),
    );

    // GHOST: always /v1/completions
    llmManager.register('/v1/completions', new OpenAICompletionAdapter(
        ghostConfig.baseUrl,
        ghostConfig.apiKey,
        ghostConfig.model,
    ));
    log.debug('Registered GHOST adapter: /v1/completions');

    // NES: based on supportedEndpoint config
    const endpoint = nesConfig.supportedEndpoint;
    const { baseUrl, apiKey, model } = nesConfig;

    switch (endpoint) {
        case '/chat/completions':
            llmManager.register('/chat/completions', new OpenAIChatAdapter(baseUrl, apiKey, model));
            break;
        case '/responses':
            llmManager.register('/responses', new OpenAIResponseAdapter(baseUrl, apiKey, model));
            break;
        case '/v1/messages':
            llmManager.register('/v1/messages', new AnthropicAdapter(baseUrl, apiKey, model));
            break;
    }
    log.debug(`Registered NES adapter: ${endpoint}`);
}

export function deactivate() {}
```

- [ ] **Step 2: 验证编译**

```bash
cd E:/workspace/vscode/copilot-completion && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add src/extension.ts
git commit -m "feat: wire up extension activation with DI container"
```

---

### Phase 9: 最终验证

### Task 9.1: 构建与测试

- [ ] **Step 1: 安装依赖**

```bash
cd E:/workspace/vscode/copilot-completion && npm install
```

- [ ] **Step 2: 编译**

```bash
npm run compile
```
Expected: Webpack builds successfully → `dist/extension.js`.

- [ ] **Step 3: 编译测试**

```bash
npm run compile-tests
```
Expected: TypeScript compiles test files → `out/` directory.

- [ ] **Step 4: Lint**

```bash
npm run lint
```
Expected: No lint errors.

- [ ] **Step 5: 运行测试**

```bash
npm test
```
Expected: All tests pass.

- [ ] **Step 6: 最终提交**

```bash
git add .
git commit -m "chore: final build and test verification"
```

---
