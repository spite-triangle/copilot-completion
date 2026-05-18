import * as vscode from 'vscode';

export { PromptingStrategy } from './stubs/types';

export enum ResponseFormat {
    EditWindowOnly = 'EditWindowOnly',
}

export interface NextEditResult {
    /** The full edit text (content of edit window after modification) */
    edit: string;
    /** Range in the document to replace with edit text */
    range: vscode.Range;
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
