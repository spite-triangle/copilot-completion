import * as vscode from 'vscode';
import { NextEditResult } from '../types';
import { CachedEdit } from '../nextEditCache';
import { ResponseDiffer } from '../response/responseDiffer';
import { LineReplacement } from '../response/lineReplacement';
import { EditWindowResolver, LineSource } from './editWindowResolver';
import { TrimCompletionSuffixOverlap } from '../../../common/suffixOverlapTrim';
import { ILogService } from '../../shared/log/logService';

/** Maximum suffix lines to read for fuzzy overlap detection (avoids reading entire file). */
const MAX_SUFFIX_LINES_FOR_OVERLAP = 100;

/** Read a slice of lines from a LineSource into an array. */
function readLineSlice(source: LineSource, start: number, endExclusive: number): string[] {
    const lines: string[] = [];
    for (let i = start; i < endExclusive; i++) {
        lines.push(source.lineText(i));
    }
    return lines;
}


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
     * @param logger
     */
    assemble(
        responseLines: string[],
        document: vscode.TextDocument,
        position: vscode.Position,
        cacheEntry?: CachedEdit,
        overlapThreshold: number = 0.85,
        overlapType: 'low' | 'high' = 'high',
        logger?: ILogService
    ): NextEditResult {
        // Use lightweight LineSource — avoids O(N) document.getText() for large files
        const docSource: LineSource = {
            lineCount: document.lineCount,
            lineText: (i: number) => document.lineAt(i).text,
        };
        const ewRange = this._editWindowResolver.resolve(docSource, position.line);
        const originalLines = readLineSlice(docSource, ewRange.start, ewRange.endExclusive);

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

        // Phase 6: TrimNESResponseSuffixOverlap — trim suffix overlap
        const documentBeforeEdits = originalLines.join('\n');

        // Suffix starts from AFTER the line replacement range in the document
        const suffixStartLine = docLineRange.endLineNumberExclusive;
        const suffixEnd = Math.min(suffixStartLine + MAX_SUFFIX_LINES_FOR_OVERLAP, docSource.lineCount);
        const suffixLines = readLineSlice(docSource, suffixStartLine, suffixEnd);
        const trimmer = new TrimCompletionSuffixOverlap(overlapThreshold, overlapType);
        const overlapCount = trimmer.calculateOverlap(edit.newLines, suffixLines);

        logger?.info(`overlap count : ${overlapCount}`)
        if (overlapCount > 0) {
            const trimmedNewLines = edit.newLines.slice(0, edit.newLines.length - overlapCount);

            // When the entire edit was suffix duplication, treat as no-op
            if (trimmedNewLines.length > 0) {
                const trimmedEnd = docLineRange.startLineNumber + trimmedNewLines.length;
                const trimmedReplacement = new LineReplacement(
                    {
                        startLineNumber: docLineRange.startLineNumber,
                        endLineNumberExclusive: trimmedEnd,
                    },
                    trimmedNewLines,
                );
                edit = trimmedReplacement;
            } else {
                return this._emptyEditResult(document, position, ewRange, originalLines.join('\n'), cacheEntry);
            }
        }

        // Build final result: convert LineReplacement to vscode.Range
        const range = lineReplacementToRange(edit, document);

        // Compute character-level edit text for single-line edits
        let editText: string;
        if (edit.isInsertion) {
            if (edit.lineRange.startLineNumber >= document.lineCount) {
                // Insert at end of document: prepend newline so lines start on their own line
                editText = '\n' + edit.newLines.join('\n');
            } else {
                // Insert between lines: append newline so following line stays separate
                editText = edit.newLines.join('\n') + '\n';
            }
        } else if (edit.isSingleLineEdit) {
            const newLine = edit.newLines[0];
            editText = newLine.substring(range.start.character);
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
            fullEditText: edit.newLines.join('\n'),
            edits: [{ replaceRange: range, newText: editText }],
            cursorAfterEdit,
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
        const insertLine = edit.lineRange.startLineNumber;
        if (insertLine >= document.lineCount) {
            // Insert at end of document — position after last line
            const lastLine = document.lineCount - 1;
            const lastLineLen = document.lineAt(lastLine).text.length;
            const pos = new vscode.Position(lastLine, lastLineLen);
            return new vscode.Range(pos, pos);
        }
        // Insert between lines — position at start of the line at insertLine
        const pos = new vscode.Position(insertLine, 0);
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
