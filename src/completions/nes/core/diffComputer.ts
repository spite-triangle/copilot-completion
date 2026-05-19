import * as vscode from 'vscode';
import { DiffResult } from '../types';

/**
 * Computes precise character-level diff between original edit window lines
 * and the LLM response lines. Uses line-level head/tail matching followed
 * by character-level refinement to produce an exact replace range.
 */
export class DiffComputer {

    compute(
        originalLines: string[],
        responseLines: string[],
        editWindowStartLine: number,
    ): DiffResult {
        const documentBeforeEdits = originalLines.join('\n');
        const fullEditText = responseLines.join('\n');

        const len = Math.min(originalLines.length, responseLines.length);

        // 1. Line-level common prefix
        let headLines = 0;
        while (headLines < len && originalLines[headLines] === responseLines[headLines]) {
            headLines++;
        }

        // 2. Line-level common suffix (non-overlapping with prefix)
        let tailLines = 0;
        while (tailLines < len - headLines) {
            const oi = originalLines.length - 1 - tailLines;
            const ri = responseLines.length - 1 - tailLines;
            if (originalLines[oi] === responseLines[ri]) {
                tailLines++;
            } else {
                break;
            }
        }

        const firstOrig = headLines;
        const firstResp = headLines;
        const lastOrig = originalLines.length - 1 - tailLines;
        const lastResp = responseLines.length - 1 - tailLines;

        // 3. Character-level common prefix on first changed line
        let charHead = 0;
        if (firstOrig < originalLines.length && firstResp < responseLines.length) {
            const ol = originalLines[firstOrig];
            const rl = responseLines[firstResp];
            while (charHead < ol.length && charHead < rl.length && ol[charHead] === rl[charHead]) {
                charHead++;
            }
        }

        // 4. Character-level common suffix on last changed line.
        // For single-line changes, cap at the remaining length after prefix to
        // prevent suffix from overlapping with prefix (which causes backwards ranges).
        let charTail = 0;
        if (lastOrig >= headLines && lastResp >= headLines) {
            const ol = originalLines[lastOrig];
            const rl = responseLines[lastResp];
            if (lastOrig === firstOrig) {
                // Single-line: cap charTail to avoid overlap with charHead
                const maxTail = Math.min(ol.length - charHead, rl.length - charHead);
                while (charTail < maxTail
                    && ol[ol.length - 1 - charTail] === rl[rl.length - 1 - charTail]) {
                    charTail++;
                }
            } else {
                // Multi-line: full line suffix matching
                while (charTail < ol.length && charTail < rl.length
                    && ol[ol.length - 1 - charTail] === rl[rl.length - 1 - charTail]) {
                    charTail++;
                }
            }
        }

        // 5. Build precise replace range
        const replaceStartLine = editWindowStartLine + headLines;
        const replaceStartChar = (headLines < originalLines.length && firstOrig === headLines) ? charHead : 0;

        const replaceEndLine = firstResp > lastResp
            ? replaceStartLine
            : editWindowStartLine + lastOrig;
        const replaceEndChar = firstResp > lastResp
            ? replaceStartChar
            : (lastOrig >= headLines && lastOrig < originalLines.length
                ? Math.max(0, originalLines[lastOrig].length - charTail)
                : 0);

        const replaceRange = new vscode.Range(
            new vscode.Position(replaceStartLine, replaceStartChar),
            new vscode.Position(replaceEndLine, replaceEndChar),
        );

        // 6. Build newText (the changed portion)
        let newText: string;
        if (firstResp > lastResp) {
            newText = '';
        } else if (firstResp === lastResp) {
            newText = responseLines[firstResp].substring(charHead, responseLines[firstResp].length - charTail);
        } else {
            const first = responseLines[firstResp].substring(charHead);
            const middle = responseLines.slice(firstResp + 1, lastResp);
            const last = responseLines[lastResp].substring(0, responseLines[lastResp].length - charTail);
            newText = [first, ...middle, last].join('\n');
        }

        return { replaceRange, newText, documentBeforeEdits, fullEditText };
    }
}
