## ADDED Requirements

### Requirement: Detector pipeline architecture

The system SHALL determine multiline eligibility through a chain of independent detectors, each with a single responsibility. Each detector SHALL return one of: multiline, singleline, or defer (pass to next). The chain SHALL short-circuit on the first non-defer result.

#### Scenario: Detector short-circuits chain

- **WHEN** a detector returns `multiline` or `singleline`
- **THEN** subsequent detectors in the chain SHALL NOT be invoked

#### Scenario: All detectors defer

- **WHEN** every detector in the chain returns `defer`
- **THEN** the system SHALL default to single-line

### Requirement: FileSizeGuard detector

The system SHALL include a FileSizeGuard detector that forces single-line for files exceeding the configured line count threshold (default 8000), regardless of other detection signals.

#### Scenario: Large file forces single-line

- **WHEN** document line count ≥ 8000
- **THEN** the system SHALL return single-line without invoking downstream detectors

#### Scenario: Normal file defers

- **WHEN** document line count < 8000
- **THEN** the system SHALL defer to the next detector

### Requirement: NewLine detector

The system SHALL include a NewLine detector that determines multiline eligibility based on whether the cursor line is whitespace-only in TypeScript/TSX files.

#### Scenario: TypeScript empty line triggers multiline

- **WHEN** language is `typescript` or `typescriptreact` AND cursor line contains only whitespace
- **THEN** the system SHALL return multiline

#### Scenario: Non-TypeScript language defers

- **WHEN** language is not `typescript` or `typescriptreact`
- **THEN** the system SHALL defer to the next detector

### Requirement: EmptyBlock detector

The system SHALL include an EmptyBlock detector that uses tree-sitter WASM AST analysis to determine if the cursor is at the start of an empty code block (e.g., empty function body, empty if/for block). For supported languages (11 total), it SHALL check the current cursor position via `isEmptyBlockStart`. In inline-suggestion mode, it SHALL additionally check the end-of-line position. For unsupported languages, it SHALL defer.

#### Scenario: Cursor at empty function body start

- **WHEN** cursor position is at the start of an empty block (e.g., after `{` on a new line) in a supported language
- **THEN** the system SHALL return multiline

#### Scenario: Inline cursor with empty block at end of line

- **WHEN** cursor is mid-line (inline suggestion mode) AND the end-of-line position would be an empty block start
- **THEN** the system SHALL return multiline

#### Scenario: Unsupported language defers

- **WHEN** document language is not supported by the AST parser
- **THEN** the system SHALL defer to the next detector

### Requirement: MLModel detector

The system SHALL include an MLModel detector that computes a multiline score from 14 features extracted from prefix/suffix text for JavaScript, JSX, and Python files. A score exceeding the configured threshold (default 0.5) SHALL trigger multiline.

#### Scenario: ML score above threshold

- **WHEN** language is javascript, javascriptreact, or python AND the ML model score exceeds the threshold
- **THEN** the system SHALL return multiline

#### Scenario: ML score below threshold

- **WHEN** language is javascript, javascriptreact, or python AND the ML model score is below or equal to the threshold
- **THEN** the system SHALL defer to the next detector

#### Scenario: Non-target language defers

- **WHEN** language is not javascript, javascriptreact, or python
- **THEN** the system SHALL defer to the next detector

### Requirement: SuffixPresence detector

The system SHALL include a SuffixPresence detector as a language-agnostic fallback. When the cursor is at end of line (not inline) and the FIM suffix contains non-whitespace content, the detector SHALL return multiline.

#### Scenario: FIM scenario with non-empty suffix

- **WHEN** cursor is at end of line AND suffix has non-whitespace content AND all previous detectors deferred
- **THEN** the system SHALL return multiline

#### Scenario: End-of-file with empty suffix

- **WHEN** suffix is empty or whitespace-only
- **THEN** the system SHALL defer to the default (singleline)

#### Scenario: Inline cursor defers

- **WHEN** `isMiddleOfTheLine` is true (mid-line inline suggestion)
- **THEN** the system SHALL defer regardless of suffix content

### Requirement: Tree-sitter WASM integration

The system SHALL integrate tree-sitter WASM parsers for 11 languages to enable AST-level empty block detection. WASM files SHALL be loaded lazily on first use and cached per language.

#### Scenario: Supported language triggers AST parse

- **WHEN** document language is in the supported language mapping (python, javascript, typescript, typescriptreact, go, ruby, csharp, java, php, c, cpp)
- **THEN** the system SHALL load the corresponding tree-sitter WASM on demand and perform AST parsing

#### Scenario: WASM load failure degrades gracefully

- **WHEN** a tree-sitter WASM file fails to load
- **THEN** the system SHALL throw a typed error (CopilotPromptLoadFailure) and the EmptyBlockDetector SHALL defer

#### Scenario: Web-tree-sitter Parser.init called once

- **WHEN** the first tree-sitter parse is requested
- **THEN** `Parser.init({ locateFile })` SHALL be called once and the WASM locate path SHALL resolve to `dist/wasm/`

### Requirement: afterAccept multiline override

The strategy SHALL force multiline mode when the user has just accepted a previous completion, regardless of all detector outcomes.

#### Scenario: After accepting a completion

- **WHEN** `hasAcceptedCurrentCompletion` is true
- **THEN** the system SHALL return multiline without invoking the detector chain

### Requirement: MultilineStrategy context builder

The system SHALL provide a context builder that assembles the `MultilineContext` from raw parameters (document, position, prefix, suffix, languageId, isMiddleOfTheLine, afterAccept).

#### Scenario: Context construction

- **WHEN** provided with all required raw parameters
- **THEN** the builder SHALL produce a complete `MultilineContext` with all fields populated

### Requirement: Suffix extraction from cursor position

The system SHALL extract the FIM suffix starting from the cursor position (not the next line), preserving the cursor-line remainder after the cursor. The system SHALL use `document.offsetAt(position)` to compute the offset on the original document text, then strip `\r` characters after substring extraction to avoid offset drift.

#### Scenario: Suffix at mid-file cursor

- **WHEN** cursor is at column 10 of line 5 in a multi-line file
- **THEN** suffix SHALL begin with the text on line 5 after column 10, followed by lines 6 onward

#### Scenario: CRLF document offset correctness

- **WHEN** document uses `\r\n` line endings AND cursor is at end of a line
- **THEN** `substring(offset)` SHALL be applied on the original text BEFORE stripping `\r`, preserving exact cursor position alignment

### Requirement: Line-ending normalization deferred to final prompt

The system SHALL NOT normalize `\r\n` → `\n` during prefix or suffix extraction. Normalization SHALL occur only once on the fully assembled prompt immediately before the LLM request.

#### Scenario: Prompt normalization only at end

- **WHEN** the FIM prompt is assembled from template + prefix + suffix
- **THEN** `\r\n` → `\n` normalization SHALL be applied only to the final prompt string, not to intermediate prefix/suffix values

### Requirement: Stop token and trimmer selection by multiline flag

The system SHALL select stop tokens and block trimmer based on the multiline strategy result.

#### Scenario: Multiline mode selects verbose settings

- **WHEN** strategy returns multiline
- **THEN** stop tokens SHALL be multi-line delimiters and the VerboseBlockTrimmer SHALL be used

#### Scenario: Single-line mode selects terse settings

- **WHEN** strategy returns singleline
- **THEN** stop tokens SHALL include the single newline terminator and the TerseBlockTrimmer SHALL be used
