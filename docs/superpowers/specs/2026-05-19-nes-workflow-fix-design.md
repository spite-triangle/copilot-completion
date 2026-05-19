# NES Workflow Fix — Design Spec

**Date**: 2026-05-19
**Status**: approved
**Reference**: `fake-vscode-copilot-chat/src/extension/inlineEdits/vscode-node/inlineCompletionProvider.ts`

## Scope

Fix missing/incorrect NES workflow logic and restructure for OOP design. Excludes lifecycle tracking (accept/reject/show) and telemetry.

## Architecture

```
NesWorkflow (orchestrator)
├── PromptAssembler          (extract from _buildPrompt)
├── EditWindowResolver       (kept)
├── DiffComputer             (NEW — precise offset-based diff)
├── EditResultAssembler      (NEW — extract from _buildResult)
├── ResponsePipeline         (kept)
├── EditFilterChain          (kept)
├── InlineSuggestionResolver (kept)
└── NextCursorPredictor      (kept)
```

## Type Changes

### NextEditResult

- `range`: changed from full edit window range → precise changed range (e.g. `(7:10, 7:14)`)
- `edit`: changed from full edit window text → replacement text only (e.g. `' add(10,11);'`)
- Added `documentBeforeEdits`: string — snapshot before edit
- Added `fullEditText`: string — complete edit window after modification
- Added `edits`: Array<{replaceRange, newText}> — per-edit detail

### New Types

- `NesCompletionInfo`: wraps NextEditResult with documentId, document, requestUuid, source
- `NesCompletionList`: exported subclass of InlineCompletionList with enableForwardStability, requestUuid
- `NesCompletionItem`: enhanced interface with isInlineEdit, isInlineCompletion, showInlineEditMenu, info, wasShown
- `DiffResult`: { replaceRange, newText, documentBeforeEdits, fullEditText }

## New Classes

### DiffComputer
- Input: original edit window lines, response lines, document, edit window start offset
- Algorithm: line-level head/tail match → character-level head/tail match on changed lines
- Output: precise DiffResult with character-level replaceRange

### PromptAssembler
- Extracted from NesWorkflow._buildPrompt
- Builds system + user prompt, returns PromptAssembly { promptPieces, userPrompt, systemPrompt, editWindowLines, editWindowRange }
- Fixes `code_to_eidt` → `code_to_edit` typo

### EditResultAssembler
- Extracted from NesWorkflow._buildResult
- Depends on DiffComputer
- Assembles NextEditResult with precise range, documentBeforeEdits, fullEditText, edits

## Files Changed

| File | Change |
|------|--------|
| `core/nesWorkflow.ts` | Gut to orchestrator; delegate to new components |
| `core/promptAssembler.ts` | NEW — extracted from _buildPrompt |
| `core/diffComputer.ts` | NEW — precise offset-based diff |
| `core/editResultAssembler.ts` | NEW — extracted from _buildResult |
| `core/inlineSuggestionResolver.ts` | Kept as-is |
| `core/editWindowResolver.ts` | Kept as-is |
| `types.ts` | Add NesCompletionInfo, enhance NextEditResult, NesCompletionItem, NesCompletionList, DiffResult |
| `nextEditProvider.ts` | Use exported types, create NesCompletionInfo, use fullEditText for inline resolution |
| `nesProvider.ts` | Minor update for changed NextEditResult |
