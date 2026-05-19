## ADDED Requirements

### Requirement: NextCursorPredictor uses shared prompt pipeline

`NextCursorPredictor` SHALL reuse the `PromptPieces` / `constructTaggedFile` / `getUserPrompt` pipeline for prompt construction, consistent with the main NES workflow.

- SHALL accept `PromptPieces` from the main NES workflow as input.
- SHALL call `constructTaggedFile` with cursor-prediction-specific options: `includeLineNumbers: WithSpaceAfter`, `includeTags: false`, and dedicated `CurrentFile.maxTokens`.
- SHALL use the cursor prediction system message: the default instruction string for predicting next edit line numbers.
- SHALL send the request via `ILLMAdapter.send()` with a configurable model.

#### Scenario: Cursor prediction prompt built from PromptPieces

- **WHEN** NES main workflow has built `PromptPieces` and NES returns no suggestions
- **THEN** `NextCursorPredictor` constructs its prompt using the same `constructTaggedFile` → `getUserPrompt` pipeline with cursor-specific options

### Requirement: NextCursorPredictor determines enablement

`NextCursorPredictor` SHALL provide a `determineEnablement()` method that checks whether cursor prediction is active.

- SHALL return `true` when the configuration key `nextCursorPrediction.enabled` is `true` and the session-level `isDisabled` flag is `false`.
- SHALL return `false` when either the config key is `false` or the session has been disabled (e.g., after a 404 from the endpoint).
- The `isDisabled` flag SHALL be set to `true` for the remainder of the session on endpoint-not-found errors.

#### Scenario: Cursor prediction enabled

- **WHEN** config `nextCursorPrediction.enabled` is true and session is not disabled
- **THEN** `determineEnablement()` returns `true`

#### Scenario: Cursor prediction disabled by config

- **WHEN** config `nextCursorPrediction.enabled` is false
- **THEN** `determineEnablement()` returns `false`

#### Scenario: Cursor prediction disabled for session after endpoint error

- **WHEN** cursor prediction endpoint returns 404 (Not Found)
- **THEN** `isDisabled` is set to `true` and `determineEnablement()` returns `false` for the remainder of the session

### Requirement: NextCursorPredictor parses response with keptRange validation

`NextCursorPredictor` SHALL parse the LLM response to extract a cursor jump prediction and validate it against the prompt's kept range.

- A plain line number SHALL be parsed as a same-file jump. The line number MUST be non-negative and within the `clippedTaggedCurrentDoc.keptRange` (the model must have seen that line in the prompt).
- A `filepath:lineNumber` format SHALL be parsed as a cross-file jump. Both filePath and lineNumber MUST be non-empty/valid.
- Invalid or out-of-range predictions SHALL return an error `Result`.

#### Scenario: Valid same-file prediction

- **WHEN** response is a line number `"42"` and line 42 is within `keptRange`
- **THEN** returns `{ kind: 'sameFile', lineNumber: 42 }`

#### Scenario: Line number outside keptRange

- **WHEN** response is a line number `"500"` but line 500 is outside `keptRange`
- **THEN** returns an error Result with reason `modelNotSeenLineNumber`

#### Scenario: Valid cross-file prediction

- **WHEN** response is `"src/utils.ts:15"`
- **THEN** returns `{ kind: 'differentFile', filePath: 'src/utils.ts', lineNumber: 15 }`

#### Scenario: Invalid response

- **WHEN** response contains non-numeric text that is not a file:line format
- **THEN** returns an error Result with reason `gotNaN`
