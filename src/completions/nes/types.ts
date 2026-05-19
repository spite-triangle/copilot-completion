import * as vscode from 'vscode';

export { PromptingStrategy } from './stubs/types';

export enum ResponseFormat {
    EditWindowOnly = 'EditWindowOnly',
}

/** Precise character-level diff result between original edit window and LLM response. */
export interface DiffResult {
    /** Precise character range in the document to replace */
    replaceRange: vscode.Range;
    /** New text to insert at that range */
    newText: string;
    /** Original text of the edit window area before edits */
    documentBeforeEdits: string;
    /** Complete edit window text after modification */
    fullEditText: string;
}

export interface NextEditResult {
    /** Precise changed range in the document (e.g. (7:10, 7:14)), not the entire edit window */
    range: vscode.Range;
    /** Replacement text for the precise range */
    edit: string;
    /** Snapshot of the edit window original text before edits */
    documentBeforeEdits: string;
    /** Complete edit window text after modification (for inline suggestion resolution) */
    fullEditText: string;
    /** Per-edit detail: precise range and replacement text */
    edits: Array<{ replaceRange: vscode.Range; newText: string }>;
    /** Predicted cursor position after accepting the edit */
    cursorAfterEdit?: vscode.Position;
    /** Display location for VS Code rendering */
    displayLocation?: {
        range: vscode.Range;
        label: string;
    };
    /** Reference to cache entry, for wasRenderedAsInlineSuggestion write-back */
    cacheEntry?: import('./nextEditCache').CachedEdit;
    /** Whether this result came from a cursor jump request */
    isFromCursorJump?: boolean;
    /** If set, this is a cursor-jump-only suggestion with no text edit */
    jumpToPosition?: vscode.Position;
    /** Cursor prediction metadata (for predict-retry flow) */
    cursorPrediction?: CursorJumpPrediction;
}

export type CursorJumpPrediction =
    | { readonly kind: 'sameFile'; readonly lineNumber: number }
    | { readonly kind: 'differentFile'; readonly filePath: string; readonly lineNumber: number };

export interface LineRange0Based {
    startLine: number;
    endLineExclusive: number;
}

/** VSCode-compatible inline completion list with forward stability enabled. */
export class NesCompletionList extends vscode.InlineCompletionList {
    /** VS Code runtime reads this property. Not declared on base type. */
    public readonly enableForwardStability = true;

    constructor(
        public readonly requestUuid: string,
        items: NesCompletionItem[],
    ) {
        super(items);
    }
}

/** Wraps NextEditResult with document context and source metadata. */
export class NesCompletionInfo {
    constructor(
        public readonly suggestion: NextEditResult,
        public readonly documentId: string,
        public readonly document: vscode.TextDocument,
        public readonly requestUuid: string,
        public readonly source: 'provider' = 'provider',
    ) {}
}

/** NES-specific InlineCompletionItem properties recognized by VS Code at runtime. */
export interface NesCompletionItem extends vscode.InlineCompletionItem {
    isInlineEdit?: boolean;
    isInlineCompletion?: boolean;
    showInlineEditMenu?: boolean;
    /** VS Code runtime: renders the suggestion as a diff between original and new text */
    showInlinedDiff?: boolean;
    /** VS Code runtime: indicates this suggestion can be rendered as an inline edit */
    shouldBeInlineEdit?: boolean;
    jumpToPosition?: vscode.Position;
    displayLocation?: {
        range: vscode.Range;
        label: string;
    };
    info?: NesCompletionInfo;
    wasShown?: boolean;
    isEditInAnotherDocument?: boolean;
    /** Default action command shown with the suggestion */
    command?: vscode.Command;
}
