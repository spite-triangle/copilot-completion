import { OffsetRange } from '../stubs/offsetRange';

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

    resolve(documentLines: string[], cursorLine: number): OffsetRange {
        let start = Math.max(0, cursorLine - this.nLinesAbove);
        let endExcl = Math.min(documentLines.length, cursorLine + this.nLinesBelow + 1);

        const conflictRange = findMergeConflictMarkersRange(
            documentLines,
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
    lines: string[],
    editWindowRange: OffsetRange,
    maxMergeConflictLines: number,
): OffsetRange | undefined {
    for (let i = editWindowRange.start; i < Math.min(lines.length, editWindowRange.endExclusive); i++) {
        if (!lines[i].startsWith('<<<<<<<')) {
            continue;
        }
        for (let j = i + 1; j < lines.length && (j - i) < maxMergeConflictLines; j++) {
            if (lines[j].startsWith('>>>>>>>')) {
                return new OffsetRange(i, j + 1);
            }
        }
    }
    return undefined;
}
