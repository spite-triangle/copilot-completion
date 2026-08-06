## 修改文件清单

| # | 文件 | 修改行 |
|---|------|--------|
| 1 | `package.json` | L7, L236 |
| 2 | `src/completions/nes/types.ts` | L59-62, L83-110 |
| 3 | `src/completions/nes/nextEditProvider.ts` | L66, L175-195 |

---

## 1. `package.json`

### L7 — `engines.vscode` 版本升级

```json
"engines": {
    "vscode": "^1.132.0"   // 原: "^1.110.0"
},
```

### L236 — `@types/vscode` 版本升级

```json
"@types/vscode": "^1.125.0",   // 原: "^1.110.0"
```

> `@types/vscode` npm 包最新为 1.125.0，1.132.0 尚未发布。VS Code 1.132 的内部 API（`inlineCompletionsAdditions` 提案）不通过 npm 类型包提供，在代码中手动声明。

---


## 2. `src/completions/nes/types.ts`

### L59-62 — `NesCompletionList.enableForwardStability`

```typescript
// 修改前:
/** VS Code runtime reads this property. Not declared on base type. */
public readonly enableForwardStability = true;

// 修改后:
/** VS Code 1.132+ runtime reads this property. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
public enableForwardStability = true;
```

变更：
- 移除 `readonly`（VS Code 1.132 运行时可能需要写入）
- 移除 "Not declared on base type" 注释（1.132 基类已声明）

### L83-110 — `NesCompletionItem` 接口

```typescript
export interface NesCompletionItem extends vscode.InlineCompletionItem {
    // ... 保留属性 ...

    // === 修改的属性 ===
    /** VS Code 1.132+: display location with kind for rendering */
    displayLocation?: {
        range: vscode.Range;
        label: string;
        /** VS Code 1.132+ InlineCompletionDisplayLocationKind */
        kind?: number;                              // 新增字段
    };

    // === 移除的属性 ===
    // command?: vscode.Command;                    // 移除（基类已有）

    // === 新增的属性 ===
    /** VS Code 1.132+: default action shown with the suggestion (replaces command) */
    action?: vscode.Command;
    /** VS Code 1.132+: whether F2 rename should update this suggestion */
    supportsRename?: boolean;
    /** VS Code 1.132+: correlation ID for telemetry */
    correlationId?: string;
    /** VS Code 1.132+: display range for cross-file NES */
    showRange?: vscode.Range;
}
```


变更说明：

| 操作 | 属性 | 原因 |
|------|------|------|
| 移除 | `command` | `InlineCompletionItem` 基类已有，避免重复声明 |
| 修改 | `displayLocation` | 新增 `kind` 字段，对齐 `InlineCompletionDisplayLocation` 类型 |
| 新增 | `action` | VS Code 1.132 新增，补全项默认操作按钮 |
| 新增 | `supportsRename` | VS Code 1.132 新增，F2 重命名联动 |
| 新增 | `correlationId` | VS Code 1.132 新增，遥测关联 ID |
| 新增 | `showRange` | VS Code 1.132 新增，跨文件编辑显示范围 |

---

## 3. `src/completions/nes/nextEditProvider.ts`

### L66 — 返回类型精确化

```typescript
// 修改前:
): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {

// 修改后:
): Promise<NesCompletionList | undefined> {
```


### L175-195 — `_toInlineItems` 中 `NesCompletionItem` 构建

```typescript
// 修改前:
const item: NesCompletionItem = {
    insertText,
    range,
    isInlineEdit: !isInlineCompletion,
    isInlineCompletion,
    showInlineEditMenu: !isInlineCompletion,
    showInlinedDiff: !isInlineCompletion,
    shouldBeInlineEdit: true,
    info,
};

if (result.displayLocation) {
    item.displayLocation = result.displayLocation;
}

// 修改后:
const item: NesCompletionItem = {
    insertText,
    range,
    isInlineEdit: !isInlineCompletion,
    isInlineCompletion,
    showInlineEditMenu: !isInlineCompletion,
    showInlinedDiff: !isInlineCompletion,
    shouldBeInlineEdit: true,
    info,
    action: undefined,           // 新增
    supportsRename: false,       // 新增
    correlationId: requestUuid,  // 新增
};

if (result.displayLocation) {
    item.displayLocation = {
        range: result.displayLocation.range,
        label: result.displayLocation.label,
        kind: 1,                 // 新增: InlineCompletionDisplayLocationKind.Code
    };
}
```

新增赋值说明：

| 属性 | 值 | 说明 |
|------|-----|------|
| `action` | `undefined` | 当前无额外操作按钮 |
| `supportsRename` | `false` | 当前不支持重命名建议 |
| `correlationId` | `requestUuid` | 用请求 UUID 作为关联 ID |
| `displayLocation.kind` | `1` | `InlineCompletionDisplayLocationKind.Code`（代码内标记） |

---

