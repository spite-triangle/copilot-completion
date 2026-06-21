# Ghost: 统一所有返回路径的 TrimNESResponseSuffixOverlap 处理

## 问题

`getGhostText()` 有 4 个返回路径，只有 **Network** 路径做了 `TrimNESResponseSuffixOverlap`（行级后缀重叠裁剪）。另外三条路径缺失：

| 返回路径 | 有 TrimNESResponseSuffixOverlap? |
|---------|---------------------------------|
| TypingAsSuggested | ❌ |
| Cache | ❌ |
| Async | ❌ |
| Network | ✅ |

这导致前三条路径可能返回与文档 suffix 重叠的补全文本，产生重复内容。

## 方案

### 1. 抽取私有方法 `_trimLineSuffixOverlap`

将 Network 路径中的 inline 逻辑抽取为可复用方法：

```typescript
private _trimLineSuffixOverlap(text: string, suffix: string): string {
    const completionLines = text.split('\n');
    const suffixLines = suffix.split('\n');
    const trimmer = new TrimNESResponseSuffixOverlap(
        this._config.suffixOverlapThreshold,
        this._config.suffixOverlapType,
    );
    const overlapCount = trimmer.calculateOverlap(completionLines, suffixLines);
    if (overlapCount > 0 && overlapCount < completionLines.length) {
        this._log.info(`[GHOST] line_trim overlap=${overlapCount} lines`);
        return completionLines.slice(0, completionLines.length - overlapCount).join('\n');
    }
    if (overlapCount >= completionLines.length) {
        this._log.info(`[GHOST] line_trim ALL_LINES overlap=${overlapCount} >= ${completionLines.length} — returning empty`);
        return '';
    }
    return text;
}
```

**注意**：`TrimNESResponseSuffixOverlap` 实例化开销很小（两个数字字段），每次调用都新建，无需缓存实例。

### 2. 四条路径的处理流程

每条路径中，`_trimLineSuffixOverlap` 的调用位置遵循与 Network 一致的顺序：
`line trim` → `_postProcessChoiceInContext` → `_toGhostCompletion`

| 路径 | 处理流程 | 备注 |
|------|---------|------|
| **TypingAsSuggested** | 对每条 `c`：取 `c.completionText` → `_trimLineSuffixOverlap` → 过滤空字符串 → `_toGhostCompletion` → 重算 `suffixCoverage`（取首个非空条目） | 无 `_postProcessChoiceInContext`（存储时已处理）。trim 后可能全空，见 3.4 |
| **Cache** | 取 `cached[0].text` → `_trimLineSuffixOverlap` → `_postProcessChoiceInContext` → `_toGhostCompletion` → 重算 `suffixCoverage` | |
| **Async** | 取 `asyncResult.completionText` → `_trimCharOverlap` → `_trimLineSuffixOverlap` → `_postProcessChoiceInContext` → `_toGhostCompletion` → 重算 `suffixCoverage` | char trim + line trim 后再 postProcess，与 Network 完全一致 |
| **Network** | 行为等价，仅替换 inline 代码为 `_trimLineSuffixOverlap` 调用（新方法增加了全行重叠 `ALL_LINES` 显式日志分支） | |

### 3. 关键设计决策

#### 3.1 顺序：line trim 在 postProcess 之前

`_postProcessChoiceInContext` 会调整续行缩进以匹配 `baseIndent`。如果先调它再 line trim，缩进调整可能让原本不匹配的行变得匹配（suffix 也带缩进），导致过度裁剪。因此必须先 line trim 再 postProcess，保持与 Network 路径一致。

#### 3.2 char trim 处理

- **Cache** 路径：缓存中存储的文本已过 Network 路径的 `_trimCharOverlap`，无需重复。
- **Async** 路径：`queueCompletionRequest` 存储的是原始 LLM 响应文本（`response.text`），未经 char trim。因此 Async 路径必须与 Network 保持一致，先执行 `_trimCharOverlap`，再执行 `_trimLineSuffixOverlap`。顺序：char trim → line trim → postProcess。

#### 3.3 empty 保护

`overlapCount >= completionLines.length` 时返回空字符串 `''`，避免产生一个全空补全。

#### 3.4 TypingAsSuggested 空补全过滤

`_trimLineSuffixOverlap` 在极端情况下可能返回 `''`（suffix 变化后完全覆盖补全内容）。TypingAsSuggested 路径遍历 `typingSuggested` 数组时，需要对 trim 后的结果过滤空字符串：trim 后 `completionText === ''` 的条目直接丢弃。如果过滤后数组为空，整个路径返回 `undefined`（相当于无匹配），而非展示空 ghost text。

`suffixCoverage` 使用过滤后数组中**首个条目**的 `completionText` 计算（与存量行为一致：始终取 `[0]`）。

## 影响范围

- 文件：`src/completions/ghost/ghostTextComputer.ts`
- 新增：`_trimLineSuffixOverlap()` 私有方法
- 修改：TypingAsSuggested、Cache、Async 三个返回路径的代码块
- 替换：Network 路径中的 inline 逻辑

## 不涉及

- `TrimNESResponseSuffixOverlap` 类本身不改动
- `_trimCharOverlap` 不改动
- 日志格式保持一致
