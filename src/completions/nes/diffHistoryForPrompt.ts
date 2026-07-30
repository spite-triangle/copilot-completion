import { DocumentId, DiffHistoryOptions, StatelessNextEditDocument, IXtabHistoryEntry, IXtabHistoryEditEntry } from './stubs/types';
import { StringText } from './stubs/abstractText';
import { StringEdit } from './stubs/stringEdit';
import { OffsetRange } from './stubs/offsetRange';
import { Position } from './stubs/position';
import { PositionOffsetTransformer } from './stubs/positionToOffsetImpl';
import { groupAdjacentBy, pushMany } from '../../common/arrays';
import { toUniquePath } from './promptCraftingUtils';

export interface EditDiffHistoryResult {
    readonly promptPiece: string;
    readonly nDiffs: number;
    readonly totalTokens: number;
}

interface LineReplacement {
    lineRange: { startLineNumber: number; endLineNumberExclusive: number };
    newLines: string[];
}

export function getEditDiffHistory(
    activeDoc: StatelessNextEditDocument,
    xtabHistory: readonly IXtabHistoryEntry[],
    docsInPrompt: Set<DocumentId>,
    computeTokens: (s: string) => number,
    { onlyForDocsInPrompt, maxTokens, nEntries, useRelativePaths }: DiffHistoryOptions,
): EditDiffHistoryResult {
    const workspacePath = useRelativePaths ? activeDoc.workspaceRoot?.path : undefined;

    let tokenBudget = maxTokens;
    let totalTokensConsumed = 0;
    const allDiffs: string[] = [];

    for (const entry of xtabHistory) {
        if (allDiffs.length >= nEntries) {
            break;
        }

        if (entry.kind === 'visibleRanges') {
            continue;
        }

        if (onlyForDocsInPrompt && !docsInPrompt.has(entry.docId)) {
            continue;
        }

        const docDiff = generateDocDiff(entry, workspacePath);
        if (docDiff === null) {
            continue;
        }

        const tokenCount = computeTokens(docDiff);
        tokenBudget -= tokenCount;
        if (tokenBudget < 0) {
            break;
        }
        totalTokensConsumed += tokenCount;
        allDiffs.push(docDiff);
    }

    const totalDiffs = allDiffs.length;
    const numberedDiffs = allDiffs.reverse().map(
        (diff, i) => `# Edit ${i + 1}/${totalDiffs}\n${diff}`,
    );
    let promptPiece = numberedDiffs.join('\n\n');
    if (numberedDiffs.length > 0) {
        promptPiece = '# From Oldest To Newest\n' + promptPiece;
        promptPiece += '\n';
    }

    return { promptPiece, nDiffs: allDiffs.length, totalTokens: totalTokensConsumed };
}

function generateDocDiff(entry: IXtabHistoryEditEntry, workspacePath: string | undefined): string | null {
    const lineEdits = stringEditToLineReplacements(entry.edit.base, entry.edit.edit);
    const baseLines = entry.edit.base.getLines();

    const docDiffLines: string[] = [];

    for (const lineEditGroup of groupAdjacentBy(
        lineEdits,
        (left, right) => left.lineRange.endLineNumberExclusive >= right.lineRange.startLineNumber,
    )) {
        const oldLines: string[] = [];
        const newLines: string[] = [];

        let previousEndLineNumberExclusive = lineEditGroup[0].lineRange.startLineNumber;

        for (const singleLineEdit of lineEditGroup) {
            if (previousEndLineNumberExclusive < singleLineEdit.lineRange.startLineNumber) {
                const unchangedLines = baseLines.slice(
                    previousEndLineNumberExclusive - 1,
                    singleLineEdit.lineRange.startLineNumber - 1,
                );
                pushMany(oldLines, unchangedLines);
                pushMany(newLines, unchangedLines);
            }

            const replacedOldLines = baseLines.slice(
                singleLineEdit.lineRange.startLineNumber - 1,
                singleLineEdit.lineRange.endLineNumberExclusive - 1,
            );
            pushMany(oldLines, replacedOldLines);
            pushMany(newLines, singleLineEdit.newLines);

            previousEndLineNumberExclusive = singleLineEdit.lineRange.endLineNumberExclusive;
        }

        if (oldLines.every(line => line.trim().length === 0) && newLines.every(line => line.trim().length === 0)) {
            continue;
        }

        if (oldLines.length === newLines.length && oldLines.every((line, i) => line === newLines[i])) {
            continue;
        }

        const startLineNumber = lineEditGroup[0].lineRange.startLineNumber - 1;

        docDiffLines.push(`@@ -${startLineNumber},${oldLines.length} +${startLineNumber},${newLines.length} @@`);
        pushMany(docDiffLines, oldLines.map(x => `-${x}`));
        pushMany(docDiffLines, newLines.map(x => `+${x}`));
    }

    if (docDiffLines.length === 0) {
        return null;
    }

    const uniquePath = toUniquePath(entry.docId, workspacePath);
    const docDiffArr = [`--- ${uniquePath}`, `+++ ${uniquePath}`];
    pushMany(docDiffArr, docDiffLines);
    return docDiffArr.join('\n');
}

/**
 * Convert offset-based StringEdit to line-based replacements.
 *
 * Each StringReplacement (character offset range → newText) is mapped to a
 * LineReplacement (1-based line range → new lines). Adjacent replacements
 * that touch or overlap at line boundaries are then merged so the caller
 * can group them into unified hunks without artificial splits.
 */
function stringEditToLineReplacements(base: StringText, edit: StringEdit): LineReplacement[] {
    const transformer = base.getTransformer();
    const replacements = [...edit.replacements].sort((a, b) => a.range.start - b.range.start);
    const result: LineReplacement[] = [];

    for (const repl of replacements) {
        const startPos = transformer.getPosition(repl.range.start);
        const rangeIsEmpty = repl.range.length === 0;
        const endPos = rangeIsEmpty
            ? startPos
            : transformer.getPosition(Math.max(repl.range.start, repl.range.endExclusive - 1));

        let newLines = repl.newText.split(/\r?\n/);

        // Determine 1-based line range
        let startLineNumber: number;
        let endLineNumberExclusive: number;

        if (rangeIsEmpty) {
            // Pure insertion: empty range at the insertion point
            startLineNumber = startPos.lineNumber;
            endLineNumberExclusive = startPos.lineNumber;
        } else {
            startLineNumber = startPos.lineNumber;
            endLineNumberExclusive = endPos.lineNumber + 1;
        }

        // Expand single-line partial edits to full-line context so the diff
        // shows the complete old/new line rather than just the changed fragment.
        if (newLines.length === 1) {
            const baseLines = base.getLines();
            const lineIdx = startPos.lineNumber - 1;
            const originalLine = baseLines[lineIdx] ?? '';
            const lineStartOff = transformer.getOffset(new Position(startPos.lineNumber, 1));
            const lineEndOff = lineStartOff + originalLine.length;

            // Only expand when the replacement doesn't already cover the entire line
            if (repl.range.start > lineStartOff || repl.range.endExclusive < lineEndOff) {
                const col = repl.range.start - lineStartOff;
                const removeLen = rangeIsEmpty ? 0 : repl.range.length;
                const newFullLine =
                    originalLine.slice(0, col) + repl.newText + originalLine.slice(col + removeLen);
                newLines = [newFullLine];
                endLineNumberExclusive = startLineNumber + 1;
            }
        }

        // Merge with previous replacement if line ranges overlap or touch
        if (result.length > 0) {
            const prev = result[result.length - 1];
            if (prev.lineRange.endLineNumberExclusive >= startLineNumber) {
                // Merge: extend the previous replacement
                const mergedNewLines = prev.newLines.slice();
                // Remove overlapping original lines from prev's newLines
                const overlapCount = prev.lineRange.endLineNumberExclusive - startLineNumber;
                if (overlapCount > 0) {
                    mergedNewLines.splice(mergedNewLines.length - overlapCount, overlapCount);
                }
                pushMany(mergedNewLines, newLines);
                result[result.length - 1] = {
                    lineRange: {
                        startLineNumber: prev.lineRange.startLineNumber,
                        endLineNumberExclusive,
                    },
                    newLines: mergedNewLines,
                };
                continue;
            }
        }

        result.push({ lineRange: { startLineNumber, endLineNumberExclusive }, newLines });
    }

    return result;
}
