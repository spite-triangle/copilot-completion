import { IMultilineDetector, MultilineContext, DetectionResult } from './types';

/**
 * Language-agnostic FIM fallback detector.
 * When all language-specific detectors defer, this checks if the suffix has
 * substantive content — indicating the cursor is in the middle of a file,
 * not at EOF. In that case, multiline completion is appropriate.
 */
export class SuffixPresenceDetector implements IMultilineDetector {
    readonly name = 'SuffixPresenceDetector';

    async detect(ctx: MultilineContext): Promise<DetectionResult> {
        // Don't force multiline for inline (mid-line) suggestions
        if (ctx.isMiddleOfTheLine) {
            return { decision: 'defer' };
        }
        // At end of line with non-empty suffix → multiline
        if (ctx.suffix.trim() !== '') {
            return { decision: 'multiline' };
        }
        // Empty suffix (EOF) → defer to default (singleline)
        return { decision: 'defer' };
    }
}
