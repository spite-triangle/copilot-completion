/**
 * Ported from fake-vscode-copilot-chat/src/extension/xtab/common/inlineSuggestion.ts
 *
 * Determines if a cursor position is valid for inline (ghost text) completion.
 *
 * Three-valued return:
 *   false     = cursor is at end of line — normal completion allowed
 *   true      = cursor is mid-line but only closing brackets/quotes follow — inline completion allowed
 *   undefined = cursor is mid-line with real code after it — ABORT, no completion
 */

/** True if there is anything other than whitespace after the cursor on the current line. */
function isMiddleOfTheLineFromTextAfterCursor(textAfterCursor: string): boolean {
    return textAfterCursor.trim().length !== 0;
}

/**
 * True only when the text after the cursor consists solely of:
 *   closing brackets: ) > ] }
 *   quotes: " ' `
 *   line-end punctuation: : { ; ,
 *   HTML/XML tag end: </tag> -->
 *   Markdown formatting: ** ~~ $
 *   and surrounding whitespace
 */
function isValidMiddleOfTheLineFromTextAfterCursor(textAfterCursor: string): boolean {
    const endOfLine = textAfterCursor.trim();
    const isLineEnd = /^\s*[)>}\]"'`]*\s*[:{;,]?\s*$/;
    const isTagEnd = /^\s*(<\/.*?>|-->)\s*$/;
    const isMarkdown = /^\s*(\*\*|~~|\$)\s*[:;,]?\s*$/;

    return isLineEnd.test(endOfLine) || 
            isTagEnd.test(endOfLine) || 
            isMarkdown.test(endOfLine);
}

/**
 * Returns false for end-of-line, true for valid inline, undefined for invalid mid-line.
 */
export function isInlineSuggestionFromTextAfterCursor(textAfterCursor: string): boolean | undefined {
    const isMiddleOfLine = isMiddleOfTheLineFromTextAfterCursor(textAfterCursor);
    const isValidMiddleOfLine = isValidMiddleOfTheLineFromTextAfterCursor(textAfterCursor);

    if (isMiddleOfLine && !isValidMiddleOfLine) {
        return undefined; // abort — real code after cursor
    }

    return isMiddleOfLine && isValidMiddleOfLine;
}
