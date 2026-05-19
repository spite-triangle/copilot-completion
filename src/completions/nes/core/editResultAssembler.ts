import * as vscode from 'vscode';
import { NextEditResult } from '../types';
import { CachedEdit } from '../nextEditCache';
import { ResponseDiffer } from '../response/responseDiffer';
import { LineReplacement } from '../response/lineReplacement';
import { EditWindowResolver } from './editWindowResolver';
import { TrimNESResponseSuffixOverlap } from '../suffixOverlapTrim';

export class EditResultAssembler {
    private readonly _responseDiffer = new ResponseDiffer();

    constructor(
        private readonly _editWindowResolver: EditWindowResolver,
    ) {}

    /**
     * Phase 3-6: ResponseProcessor.diff() → post-process → suffix overlap → build result.
     *
     * @param responseLines Clean response lines (after boundary marker parsing + cursor tag stripping)
     * @param document      The VS Code text document
     * @param position      Current cursor position
     * @param cacheEntry    Optional cache entry for the result reference
     * @param overlapThreshold Similarity threshold for suffix overlap trimming (Phase 6)
     * @param overlapType      Overlap detection type: "low" or "high" (Phase 6)
     */
    assemble(
        responseLines: string[],
        document: vscode.TextDocument,
        position: vscode.Position,
        cacheEntry?: CachedEdit,
        overlapThreshold: number = 0.85,
        overlapType: 'low' | 'high' = 'high',
    ): NextEditResult {
        const documentText = document.getText().replaceAll("\r\n","\n");
        const documentLines = documentText.split('\n');
        const ewRange = this._editWindowResolver.resolve(documentLines, position.line);
        const originalLines = documentLines.slice(ewRange.start, ewRange.endExclusive);

        // Phase 3: ResponseProcessor.diff() equivalent — line-level diff
        const lineEdits = this._responseDiffer.compute(originalLines, responseLines);

        if (lineEdits.length === 0) {
            // No changes — this shouldn't normally happen (filter chain catches it)
            return this._emptyEditResult(document, position, ewRange, originalLines.join('\n'), cacheEntry);
        }

        // Use the first edit (most common case: single change region)
        let edit = lineEdits[0];

        // Phase 4: Post-process — convert to document-absolute line numbers
        const docLineRange = {
            startLineNumber: ewRange.start + edit.lineRange.startLineNumber - 1,
            endLineNumberExclusive: ewRange.start + edit.lineRange.endLineNumberExclusive - 1,
        };
        edit = new LineReplacement(docLineRange, edit.newLines);

        // Phase 6: TrimNESResponseSuffixOverlap — trim suffix overlap using LineReplacement end line
        const fullEditText = edit.newLines.join('\n');
        const documentBeforeEdits = originalLines.join('\n');

        // Suffix starts from AFTER the line replacement range in the document
        const suffixStartLine = docLineRange.endLineNumberExclusive;
        const suffixLines = suffixStartLine < documentLines.length
            ? documentLines.slice(suffixStartLine)
            : [];

        const trimmer = new TrimNESResponseSuffixOverlap(overlapThreshold, overlapType);
        const overlapCount = trimmer.calculateOverlap(edit.newLines, suffixLines);
        if (overlapCount > 0) {
            const trimmedNewLines = edit.newLines.slice(0, edit.newLines.length - overlapCount);
            const trimmedEnd = docLineRange.startLineNumber + trimmedNewLines.length;

            const trimmedReplacement = new LineReplacement(
                {
                    startLineNumber: docLineRange.startLineNumber,
                    endLineNumberExclusive: trimmedEnd,
                },
                trimmedNewLines,
            );

            edit = trimmedReplacement;
        }

        // Build final result: convert LineReplacement to vscode.Range
        const range = lineReplacementToRange(edit, document);

        // Compute character-level edit text for single-line edits
        let editText: string;
        if (edit.isSingleLineEdit) {
            const lineIdx = Math.max(0, edit.lineRange.startLineNumber);
            const origLine = document.lineAt(lineIdx).text;
            const newLine = edit.newLines[0];
            let charHead = 0;
            while (charHead < origLine.length && charHead < newLine.length
                && origLine[charHead] === newLine[charHead]) {
                charHead++;
            }
            editText = newLine.substring(charHead);
        } else {
            editText = edit.newLines.join('\n');
        }

        // cursorAfterEdit: end of last line in the edit
        const cursorLine = edit.lineRange.startLineNumber + edit.newLines.length - 1;
        const lastLine = edit.newLines[edit.newLines.length - 1] || '';
        const cursorChar = lastLine.length;
        const cursorAfterEdit = new vscode.Position(
            Math.min(Math.max(cursorLine, 0), document.lineCount - 1),
            cursorChar,
        );

        // const displayLabel = `L${range.start.line + 1}-L${range.end.line + 1}`;

        return {
            range,
            edit: editText,
            documentBeforeEdits,
            fullEditText,
            edits: [{ replaceRange: range, newText: editText }],
            cursorAfterEdit,
            // displayLocation: {
            //     range,
            //     label: "",
            // },
            cacheEntry,
            isFromCursorJump: false,
        };
    }

    private _emptyEditResult(
        document: vscode.TextDocument,
        position: vscode.Position,
        _ewRange: { start: number; endExclusive: number },
        documentBeforeEdits: string,
        cacheEntry?: CachedEdit,
    ): NextEditResult {
        const emptyRange = new vscode.Range(position, position);
        return {
            range: emptyRange,
            edit: '',
            documentBeforeEdits,
            fullEditText: '',
            edits: [],
            cursorAfterEdit: position,
            displayLocation: { range: emptyRange, label: '' },
            cacheEntry,
            isFromCursorJump: false,
        };
    }
}

function lineReplacementToRange(edit: LineReplacement, document: vscode.TextDocument): vscode.Range {
    if (edit.isInsertion) {
        const line = Math.min(edit.lineRange.startLineNumber, document.lineCount - 1);
        const lineText = document.lineAt(line).text;
        const pos = new vscode.Position(line, lineText.length);
        return new vscode.Range(pos, pos);
    }
    if (edit.isDeletion) {
        const startLine = Math.max(0, edit.lineRange.startLineNumber);
        const endLine = Math.min(edit.lineRange.endLineNumberExclusive, document.lineCount);
        return new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLine, 0),
        );
    }
    // Standard replacement — include character-level precision for single-line edits
    if (edit.isSingleLineEdit) {
        const lineIdx = Math.max(0, edit.lineRange.startLineNumber);
        const origLine = document.lineAt(lineIdx).text;
        const newLine = edit.newLines[0];

        let charHead = 0;
        while (charHead < origLine.length && charHead < newLine.length
            && origLine[charHead] === newLine[charHead]) {
            charHead++;
        }

        return new vscode.Range(
            new vscode.Position(lineIdx, charHead),
            new vscode.Position(lineIdx, origLine.length),
        );
    }
    // Multi-line replacement — full line range
    const startLine = Math.max(0, edit.lineRange.startLineNumber);
    const endLine = Math.min(edit.lineRange.endLineNumberExclusive - 1, document.lineCount - 1);
    const endLineText = document.lineAt(endLine).text;
    return new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, endLineText.length),
    );
}
