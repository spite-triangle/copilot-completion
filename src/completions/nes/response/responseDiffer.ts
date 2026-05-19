import { LineRange, LineReplacement } from './lineReplacement';

/**
 * Equivalent of the reference's ResponseProcessor.diff().
 *
 * Algorithm (synchronous adaptation of the reference streaming diff):
 * 1. Walk both arrays position-by-position.
 * 2. When lines match: advance both pointers.
 * 3. When mismatch: find the re-alignment point where lines match again.
 *    The change region covers original lines from mismatch to re-alignment,
 *    replaced by the response lines accumulated during the divergence.
 * 4. If no re-alignment found (end of one array), emit the remaining divergence.
 */
export class ResponseDiffer {

    compute(originalLines: string[], responseLines: string[]): LineReplacement[] {
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

            // Divergence: find the re-alignment point
            const divergenceStart = origIdx;
            const newLines: string[] = [];

            // Accumulate response lines from the divergence point
            while (respIdx < responseLines.length) {
                newLines.push(responseLines[respIdx]);
                respIdx++;

                // Check if this response line re-aligns with any upcoming original line
                const reAlignOrig = findReAlignment(originalLines, origIdx, responseLines, respIdx);
                if (reAlignOrig !== undefined) {
                    // Found re-alignment: response[respIdx] matches original[reAlignOrig]
                    // The change covers original[divergenceStart..reAlignOrig)
                    const origEnd = reAlignOrig;
                    edits.push(new LineReplacement(
                        {
                            startLineNumber: divergenceStart + 1, // 1-based
                            endLineNumberExclusive: origEnd + 1,
                        },
                        newLines,
                    ));
                    origIdx = origEnd;
                    break;
                }
            }

            // If we exhausted responseLines without finding re-alignment,
            // emit a replacement covering remaining original lines
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
            }
        }

        return edits;
    }
}

/**
 * Find a re-alignment point: look for a position `i` in originalLines (i >= origIdx)
 * where originalLines[i] matches the NEXT response line (at respIdx).
 * Returns the original index where alignment resumes, or undefined.
 */
function findReAlignment(
    originalLines: string[],
    origIdx: number,
    responseLines: string[],
    respIdx: number,
): number | undefined {
    if (respIdx >= responseLines.length) {
        return undefined;
    }

    const nextRespLine = responseLines[respIdx];
    for (let i = origIdx; i < originalLines.length; i++) {
        if (originalLines[i].trimEnd() === nextRespLine.trimEnd()) {
            return i;
        }
    }
    return undefined;
}
