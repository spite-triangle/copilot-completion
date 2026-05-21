import { LineRange, LineReplacement } from './lineReplacement';

/** Minimum number of "significant" (alphanumeric) lines that must match consecutively to converge. */
const N_SIGNIFICANT_LINES_TO_CONVERGE = 2;
/** Minimum total number of lines that must match consecutively to converge. */
const N_LINES_TO_CONVERGE = 3;

/**
 * Equivalent of the reference's ResponseProcessor.diff().
 *
 * Algorithm (synchronous adaptation of the reference streaming diff):
 * 1. Walk both arrays position-by-position.
 * 2. When lines match: advance both pointers.
 * 3. When mismatch: accumulate response lines and check for convergence —
 *    the suffix of accumulated lines must match multiple consecutive original
 *    lines (with at least N_SIGNIFICANT_LINES_TO_CONVERGE significant matches
 *    or N_LINES_TO_CONVERGE total matches) before the divergence is closed.
 * 4. If no convergence found (end of one array), emit the remaining divergence.
 */
export class ResponseDiffer {

    compute(originalLines: string[], responseLines: string[]): LineReplacement[] {
        const lineToIdxs = buildLineIndex(originalLines);
        const edits: LineReplacement[] = [];
        let origIdx = 0;
        let respIdx = 0;

        while (origIdx < originalLines.length || respIdx < responseLines.length) {
            // Both sides have lines and they match → advance
            if (origIdx < originalLines.length && respIdx < responseLines.length
                && originalLines[origIdx] === responseLines[respIdx]) {
                origIdx++;
                respIdx++;
                continue;
            }

            // Divergence: accumulate response lines, checking for convergence
            const divergenceStart = origIdx;
            const newLines: string[] = [];
            let converged = false;

            while (respIdx < responseLines.length) {
                newLines.push(responseLines[respIdx]);
                respIdx++;

                const conv = tryConverge(originalLines, divergenceStart, newLines, lineToIdxs);
                if (conv) {
                    const insertLines = newLines.slice(0, newLines.length - conv.nConvergingLines);
                    edits.push(new LineReplacement(
                        {
                            startLineNumber: divergenceStart + 1, // 1-based
                            endLineNumberExclusive: conv.origConvIdx + 1,
                        },
                        insertLines,
                    ));
                    origIdx = conv.origConvIdx + conv.nConvergingLines;
                    converged = true;
                    break;
                }
            }

            // Handle exhaustion only when convergence was not reached
            if (!converged) {
                if (respIdx >= responseLines.length && origIdx < originalLines.length) {
                    edits.push(new LineReplacement(
                        {
                            startLineNumber: divergenceStart + 1,
                            endLineNumberExclusive: originalLines.length + 1,
                        },
                        newLines,
                    ));
                    origIdx = originalLines.length;
                } else if (origIdx >= originalLines.length && respIdx < responseLines.length) {
                    // Original exhausted but more response lines remain — pure insertion at end
                    const insertLines = responseLines.slice(respIdx);
                    edits.push(new LineReplacement(
                        {
                            startLineNumber: originalLines.length + 1,
                            endLineNumberExclusive: originalLines.length + 1,
                        },
                        insertLines,
                    ));
                    respIdx = responseLines.length;
                } else if (newLines.length > 0) {
                    // Both sides exhausted with accumulated newLines that never converged
                    edits.push(new LineReplacement(
                        {
                            startLineNumber: divergenceStart + 1,
                            endLineNumberExclusive: origIdx + 1,
                        },
                        newLines,
                    ));
                }
            }
        }

        return edits;
    }
}

function isSignificant(s: string): boolean {
    return /[a-zA-Z1-9]+/.test(s);
}

function buildLineIndex(lines: string[]): Map<string, number[]> {
    const map = new Map<string, number[]>();
    for (let i = 0; i < lines.length; i++) {
        const existing = map.get(lines[i]);
        if (existing) {
            existing.push(i);
        } else {
            map.set(lines[i], [i]);
        }
    }
    return map;
}

/**
 * Checks whether the suffix of `newLines` matches consecutive lines in
 * `originalLines` starting from `divergenceStart`. Returns the convergence
 * point (original index where matching region starts) and the number of
 * converging lines, or undefined if convergence criteria aren't met.
 */
function tryConverge(
    originalLines: string[],
    divergenceStart: number,
    newLines: string[],
    lineToIdxs: Map<string, number[]>,
): { origConvIdx: number; nConvergingLines: number } | undefined {
    if (newLines.length === 0) {
        return undefined;
    }

    const lastLine = newLines[newLines.length - 1];
    const matchIdxs = lineToIdxs.get(lastLine);
    if (!matchIdxs || matchIdxs.length === 0) {
        return undefined;
    }

    for (const convEndIdx of matchIdxs) {
        if (convEndIdx < divergenceStart) {
            continue;
        }

        const result = tryConvergeAt(originalLines, divergenceStart, newLines, convEndIdx);
        if (result) {
            return result;
        }
    }

    return undefined;
}

function tryConvergeAt(
    originalLines: string[],
    divergenceStart: number,
    newLines: string[],
    convEndIdx: number,
): { origConvIdx: number; nConvergingLines: number } | undefined {
    const lastNewLine = newLines[newLines.length - 1];
    let nNonSigMatches = 1;
    let nSigMatches = isSignificant(lastNewLine) ? 1 : 0;

    // When every original line from divergence to match is accounted for
    // by the response (pure replacement, no skipping), treat as significant.
    if (nNonSigMatches > 0 && convEndIdx - divergenceStart === newLines.length - 1) {
        nSigMatches = Math.max(nSigMatches, N_SIGNIFICANT_LINES_TO_CONVERGE);
    }

    let newLinesIdx = newLines.length - 2;
    let convIdx = convEndIdx - 1;

    while (newLinesIdx >= 0 && convIdx >= divergenceStart) {
        if (originalLines[convIdx] !== newLines[newLinesIdx]) {
            break;
        }

        nNonSigMatches++;
        if (isSignificant(newLines[newLinesIdx])) {
            nSigMatches++;
        }

        const converged = nSigMatches >= N_SIGNIFICANT_LINES_TO_CONVERGE
            || nNonSigMatches >= N_LINES_TO_CONVERGE;

        if (converged) {
            const nLinesToConverge = convEndIdx - convIdx + 1;
            const nLinesRemoved = convIdx - divergenceStart;
            const linesInserted = newLines.slice(0, newLines.length - nLinesToConverge);
            const nLinesInserted = linesInserted.length;

            // Reject convergence that removes far more original lines than inserted
            if (nLinesRemoved - nLinesInserted > 1 && nLinesInserted > 0) {
                return undefined;
            }

            return { origConvIdx: convIdx, nConvergingLines: nLinesToConverge };
        }

        convIdx--;
        newLinesIdx--;
    }

    return undefined;
}
