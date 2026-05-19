## ADDED Requirements

### Requirement: NextEditProvider performs retry on no-suggestions

`NextEditProvider` SHALL act as an orchestrator that triggers a cursor-prediction-based retry when NES returns no edit suggestions.

- SHALL first execute `NesWorkflow.execute()` for the current document and cursor position.
- SHALL return the result immediately if a valid edit is produced.
- If no edit is produced, SHALL check `NextCursorPredictor.isEnabled()`.
- If prediction is enabled, SHALL call `NextCursorPredictor.predict()` using the `PromptPieces` from the original NES request.
- SHALL NOT trigger prediction if the user has typed during the original request (check `token.isCancellationRequested`).
- On same-file prediction success, SHALL call `NesWorkflow.execute()` again at the predicted line number.
- SHALL return the retry result or `undefined` if retry also fails.

#### Scenario: Primary NES succeeds

- **WHEN** `NesWorkflow.execute()` returns a valid `NextEditResult`
- **THEN** the result is returned as an `InlineCompletionItem`; cursor prediction is NOT invoked

#### Scenario: Primary NES fails, cursor prediction succeeds same-file

- **WHEN** `NesWorkflow.execute()` returns `undefined` and `NextCursorPredictor` predicts line 25 (same file) and retry `NesWorkflow.execute()` at line 25 succeeds
- **THEN** the retry result is returned as an `InlineCompletionItem`

#### Scenario: Primary NES fails, cursor prediction disabled

- **WHEN** `NesWorkflow.execute()` returns `undefined` and `NextCursorPredictor.isEnabled()` returns `false`
- **THEN** no retry is performed; `undefined` is returned

#### Scenario: User cancelled during retry

- **WHEN** `NesWorkflow.execute()` returns `undefined` and the cancellation token is triggered before cursor prediction completes
- **THEN** cursor prediction is skipped; `undefined` is returned

### Requirement: Status bar displays Next Cursor Prediction toggle

The status bar panel SHALL display a toggle for Next Cursor Prediction alongside GHOST and NES toggles.

- The status bar text SHALL include the cursor prediction state: `CC [G/N/C]` where `C` indicates cursor prediction is enabled. If cursor prediction is disabled, the `C` SHALL be omitted.
- The QuickPick menu SHALL include a third option: `Next Cursor Prediction (NCP): ON/OFF`.
- Selecting the NCP toggle SHALL update `cc-completion.nes.nextCursorPrediction.enabled` in VS Code configuration.

#### Scenario: All features enabled

- **WHEN** GHOST, NES, and Next Cursor Prediction are all enabled
- **THEN** status bar shows `$(sparkle) CC [G/N/C]`

#### Scenario: Cursor prediction disabled

- **WHEN** GHOST and NES are enabled, Next Cursor Prediction is disabled
- **THEN** status bar shows `$(sparkle) CC [G/N]`

#### Scenario: Toggle via QuickPick

- **WHEN** user clicks status bar and selects "Next Cursor Prediction (NCP)" option
- **THEN** the configuration is toggled and status bar updates immediately
