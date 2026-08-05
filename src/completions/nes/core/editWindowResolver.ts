import { OffsetRange } from '../stubs/offsetRange';

/**
 * Lightweight line source — avoids materializing the entire document as a string array.
 * Accepts both real documents (vscode.TextDocument via lineAt) and in-memory arrays.
 */
export interface LineSource {
    readonly lineCount: number;
    lineText(index: number): string;
}

/**
 * Computes the edit window line range around the cursor position,
 * with optional merge conflict marker expansion.
 */
export class EditWindowResolver {
    constructor(
        public nLinesAbove: number = 2,
        public nLinesBelow: number = 5,
        public maxMergeConflictLines: number = 50,
    ) {}

    resolve(lines: LineSource, cursorLine: number): OffsetRange {
        let start = Math.max(0, cursorLine - this.nLinesAbove);
        let endExcl = Math.min(lines.lineCount, cursorLine + this.nLinesBelow + 1);

        const conflictRange = findMergeConflictMarkersRange(
            lines,
            new OffsetRange(start, endExcl),
            this.maxMergeConflictLines,
        );

        if (conflictRange) {
            endExcl = Math.max(endExcl, conflictRange.endExclusive);
        }

        return new OffsetRange(start, endExcl);
    }
}

export function findMergeConflictMarkersRange(
    lines: LineSource,
    editWindowRange: OffsetRange,
    maxMergeConflictLines: number,
): OffsetRange | undefined {
    for (let i = editWindowRange.start; i < Math.min(lines.lineCount, editWindowRange.endExclusive); i++) {
        if (!lines.lineText(i).startsWith('<<<<<<<')) {
            continue;
        }
        for (let j = i + 1; j < lines.lineCount && (j - i) < maxMergeConflictLines; j++) {
            if (lines.lineText(j).startsWith('>>>>>>>')) {
                return new OffsetRange(i, j + 1);
            }
        }
    }
    return undefined;
}
