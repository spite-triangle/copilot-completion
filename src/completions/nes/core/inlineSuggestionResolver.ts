import * as vscode from 'vscode';

export interface InlineSuggestionEdit {
    readonly range: vscode.Range;
    readonly newText: string;
}

/** Normalize document text: replace CRLF → LF for consistent comparison. */
function getTextNormalized(doc: vscode.TextDocument, range: vscode.Range): string {
    return doc.getText(range).replace(/\r\n/g, '\n');
}

/**
 * Determines whether an edit can be displayed as an inline (ghost text) suggestion
 * at the cursor position. If so, returns the possibly-adjusted range and text.
 */
export class InlineSuggestionResolver {

    resolve(
        cursorPos: vscode.Position,
        doc: vscode.TextDocument,
        range: vscode.Range,
        newText: string,
    ): InlineSuggestionEdit | undefined {
        const nextLineInsertion = this._tryAdjustNextLineInsertion(cursorPos, doc, range, newText);
        if (nextLineInsertion) {
            return nextLineInsertion;
        }

        let effectiveRange = range;
        let effectiveText = newText;

        if (effectiveRange.start.line !== effectiveRange.end.line) {
            const stripped = this._stripCommonLinePrefix(doc, effectiveRange, effectiveText);
            effectiveRange = stripped.range;
            effectiveText = stripped.newText;
        }

        if (effectiveRange.start.line !== effectiveRange.end.line || effectiveRange.start.line !== cursorPos.line) {
            return undefined;
        }

        return this._validateSameLineGhostText(cursorPos, doc, effectiveRange, effectiveText);
    }

    private _tryAdjustNextLineInsertion(
        cursorPos: vscode.Position,
        doc: vscode.TextDocument,
        range: vscode.Range,
        newText: string,
    ): InlineSuggestionEdit | undefined {
        if (!range.isEmpty) return undefined;
        if (cursorPos.line + 1 !== range.start.line || range.start.character !== 0) return undefined;
        if (doc.lineAt(cursorPos.line).text.length !== cursorPos.character) return undefined;

        const targetLineFullyConsumed = doc.lineAt(range.end.line).text.length === range.end.character;
        const noLeftoverAfterInsertion = newText.endsWith('\n') || (newText.includes('\n') && targetLineFullyConsumed);
        if (!noLeftoverAfterInsertion) return undefined;

        const lineBreak = getTextNormalized(doc, new vscode.Range(cursorPos, range.start));
        const trimmedNewText = newText.replace(/\r?\n$/, '');
        return { range: new vscode.Range(cursorPos, cursorPos), newText: lineBreak + trimmedNewText };
    }

    private _stripCommonLinePrefix(
        doc: vscode.TextDocument,
        range: vscode.Range,
        newText: string,
    ): { range: vscode.Range; newText: string } {
        const replacedText = getTextNormalized(doc, range);
        const maxLen = Math.min(replacedText.length, newText.length);
        let commonLen = 0;
        while (commonLen < maxLen && replacedText[commonLen] === newText[commonLen]) {
            commonLen++;
        }
        if (commonLen === 0) return { range, newText };

        const lastNewline = replacedText.lastIndexOf('\n', commonLen - 1);
        if (lastNewline < 0) return { range, newText };

        const strippedLen = lastNewline + 1;
        const newStart = doc.positionAt(doc.offsetAt(range.start) + strippedLen);
        return { range: new vscode.Range(newStart, range.end), newText: newText.substring(strippedLen) };
    }

    private _validateSameLineGhostText(
        cursorPos: vscode.Position,
        doc: vscode.TextDocument,
        range: vscode.Range,
        newText: string,
    ): InlineSuggestionEdit | undefined {
        const replacedText = getTextNormalized(doc, range);
        const cursorOffsetInReplacedText = cursorPos.character - range.start.character;
        if (cursorOffsetInReplacedText < 0) return undefined;
        if (
            replacedText.substring(0, cursorOffsetInReplacedText) !==
            newText.substring(0, cursorOffsetInReplacedText)
        ) {
            return undefined;
        }
        if (!InlineSuggestionResolver.isSubword(replacedText, newText)) return undefined;
        return { range, newText };
    }

    static isSubword(a: string, b: string): boolean {
        for (let aIdx = 0, bIdx = 0; aIdx < a.length; bIdx++) {
            if (bIdx >= b.length) return false;
            if (a[aIdx] === b[bIdx]) aIdx++;
        }
        return true;
    }
}
