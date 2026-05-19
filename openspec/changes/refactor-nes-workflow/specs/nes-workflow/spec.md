## ADDED Requirements

### Requirement: EditWindowResolver computes edit window range

`EditWindowResolver` SHALL compute the edit window line range from a document and cursor position.

- The start line SHALL be `max(0, cursorLine - nLinesAbove)`, where `nLinesAbove` defaults to 2.
- The end line (exclusive) SHALL be `min(lineCount, cursorLine + nLinesBelow + 1)`, where `nLinesBelow` defaults to 5.
- Merge conflict markers (`<<<<<<<` ... `>>>>>>>`) within a configurable `maxMergeConflictLines` SHALL expand the window to encompass the merge boundaries.

#### Scenario: Normal edit window

- **WHEN** cursor is at line 10 in a 100-line document
- **THEN** edit window is lines 8 through 15 (exclusive: 16)

#### Scenario: Cursor near document start

- **WHEN** cursor is at line 0
- **THEN** edit window start line is clamped to 0

#### Scenario: Merge conflict markers detected

- **WHEN** edit window contains `<<<<<<<` at line 5 and `>>>>>>>` at line 12
- **THEN** edit window end line is expanded to at least line 13 (inclusive of merge conflict end)

### Requirement: ResponsePipeline processes LLM response text

`ResponsePipeline` SHALL process raw LLM response text through an ordered chain of stages.

- `BoundaryMarkerParser` SHALL extract lines between `###remain edit start boundary line###` and `###remain edit end boundary line###` markers. Lines outside these markers SHALL be discarded.
- `CursorTagStripper` SHALL remove all occurrences of `<|cursor|>` from parsed lines when the original edit window did not contain the cursor tag.
- `SuffixOverlapTrimmer` SHALL trim trailing lines that overlap with the document suffix, using a configurable overlap threshold and type (low/high).

#### Scenario: Valid boundary markers

- **WHEN** response contains lines before `###remain edit start boundary line###`, edit content, and lines after `###remain edit end boundary line###`
- **THEN** only the edit content lines are returned

#### Scenario: Missing boundary markers

- **WHEN** response does not contain either boundary marker
- **THEN** all non-empty lines of the response are returned as edit content

#### Scenario: Cursor tag removal

- **WHEN** original edit window did not contain `<|cursor|>` and response lines contain `<|cursor|>`
- **THEN** all `<|cursor|>` occurrences are removed from the result

#### Scenario: Suffix overlap detected

- **WHEN** trailing lines of parsed edit match the document lines after cursor position beyond threshold
- **THEN** matching trailing lines are trimmed from the result

### Requirement: EditFilterChain rejects invalid edits

`EditFilterChain` SHALL apply an ordered chain of filters to reject invalid edit results.

- `EmptyEditFilter` SHALL reject edits containing only whitespace or empty content.
- `NoopEditFilter` SHALL reject edits where the output exactly matches the original edit window content.
- `WhitespaceOnlyFilter` SHALL reject edits where non-whitespace content is identical to the original.
- `CommentOnlyFilter` SHALL reject edits where all changed lines are comments (starting with `//`, `#`, or `/*`).

#### Scenario: Empty edit rejected

- **WHEN** edit text is empty or contains only whitespace
- **THEN** the edit is rejected

#### Scenario: Noop edit rejected

- **WHEN** edit text exactly matches the original edit window lines
- **THEN** the edit is rejected

#### Scenario: Whitespace-only change rejected

- **WHEN** the only difference between edit and original is whitespace
- **THEN** the edit is rejected

#### Scenario: Comment-only change rejected

- **WHEN** all changed lines are comments (starting with `//`, `#`, or `/*`)
- **THEN** the edit is rejected

#### Scenario: Valid edit passes all filters

- **WHEN** edit text is non-empty, differs from original beyond whitespace, and contains non-comment changes
- **THEN** the edit passes the filter chain and is returned

### Requirement: NesWorkflow orchestrates single NES request

`NesWorkflow` SHALL orchestrate a single NES request using the Template Method pattern.

- SHALL delegate edit window computation to `EditWindowResolver` (unless a pre-computed cursor-predicted position is provided).
- SHALL build the prompt using the existing `constructTaggedFile` → `getUserPrompt` pipeline with Xtab275 strategy.
- SHALL send the request via `ILLMAdapter.send()`.
- SHALL delegate response processing to `ResponsePipeline`.
- SHALL delegate edit filtering to `EditFilterChain`.
- SHALL update the cache on successful edit.
- SHALL return `NextEditResult` on success, `undefined` on no result.

#### Scenario: Full workflow produces valid edit

- **WHEN** a valid document and position are provided
- **THEN** the pipeline executes edit window → prompt → LLM → parse → filter and returns `NextEditResult`

#### Scenario: LLM returns no valid edit content

- **WHEN** `ResponsePipeline` returns empty content or `EditFilterChain` rejects the edit
- **THEN** `NesWorkflow` returns `undefined`

#### Scenario: Cache hit skips LLM call

- **WHEN** the cache contains a valid entry for the document URI
- **THEN** the LLM call is skipped and the cached edit is returned directly
