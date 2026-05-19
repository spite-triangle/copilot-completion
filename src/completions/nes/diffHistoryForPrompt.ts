import { DocumentId, DiffHistoryOptions, StatelessNextEditDocument, IXtabHistoryEntry } from './stubs/types';

const _lastDocLines = new Map<string, string[]>();

/**
 * Records the current document state for edit-diff tracking.
 * Call after a successful NES execution so the next invocation
 * can show what the user changed in between.
 */
export function recordDocumentForDiffHistory(docId: string, lines: string[]): void {
    _lastDocLines.set(docId, lines);
}

export interface EditDiffHistoryResult {
    readonly promptPiece: string;
    readonly nDiffs: number;
    readonly totalTokens: number;
}

export function getEditDiffHistory(
    activeDoc: StatelessNextEditDocument,
    _xtabHistory: readonly IXtabHistoryEntry[],
    _docsInPrompt: Set<DocumentId>,
    computeTokens: (s: string) => number,
    _opts: DiffHistoryOptions,
): EditDiffHistoryResult {
    const currentLines = activeDoc.documentAfterEditsLines;
    if (!currentLines || currentLines.length === 0) {
        return { promptPiece: '', nDiffs: 0, totalTokens: 0 };
    }

    const lastLines = _lastDocLines.get(activeDoc.id.path);
    if (!lastLines) {
        return { promptPiece: '', nDiffs: 0, totalTokens: 0 };
    }

    const diffText = computeLineDiff(lastLines, currentLines, activeDoc.id.path);
    if (!diffText) {
        return { promptPiece: '', nDiffs: 0, totalTokens: 0 };
    }

    const tokenCount = computeTokens(diffText);
    return { promptPiece: diffText + '\n', nDiffs: 1, totalTokens: tokenCount };
}

function computeLineDiff(prevLines: string[], currLines: string[], filePath: string): string | undefined {
    // Find first differing line
    let head = 0;
    const minLen = Math.min(prevLines.length, currLines.length);
    while (head < minLen && prevLines[head] === currLines[head]) {
        head++;
    }

    // Find last differing line (non-overlapping with head)
    let tail = 0;
    while (tail < minLen - head) {
        const pi = prevLines.length - 1 - tail;
        const ci = currLines.length - 1 - tail;
        if (prevLines[pi] === currLines[ci]) {
            tail++;
        } else {
            break;
        }
    }

    const prevStart = head;
    const prevEnd = prevLines.length - tail;
    const currStart = head;
    const currEnd = currLines.length - tail;

    const oldLines = prevLines.slice(prevStart, prevEnd);
    const newLines = currLines.slice(currStart, currEnd);

    if (oldLines.length === 0 && newLines.length === 0) {
        return undefined;
    }

    // Skip diffs where all removed/added lines are empty
    if (oldLines.every(l => l.trim().length === 0) && newLines.every(l => l.trim().length === 0)) {
        return undefined;
    }

    const hunk = [
        `--- ${filePath}`,
        `+++ ${filePath}`,
        `@@ -${prevStart + 1},${oldLines.length} +${currStart + 1},${newLines.length} @@`,
        ...oldLines.map(l => `-${l}`),
        ...newLines.map(l => `+${l}`),
    ];

    return hunk.join('\n');
}
