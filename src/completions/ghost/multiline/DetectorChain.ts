import { IMultilineDetector, DetectionResult, MultilineContext } from './types';

/**
 * Composite detector that chains multiple detectors in sequence.
 * Short-circuits on the first non-defer result.
 * Defaults to single-line if all detectors defer.
 */
export class DetectorChain implements IMultilineDetector {
    constructor(private readonly detectors: IMultilineDetector[]) {}

    get name(): string {
        return `Chain[${this.detectors.map(d => d.name).join('→')}]`;
    }

    async detect(ctx: MultilineContext): Promise<DetectionResult> {
        for (const detector of this.detectors) {
            const result = await detector.detect(ctx);
            if (result.decision !== 'defer') {
                return result;
            }
        }
        return { decision: 'singleline' };
    }
}
