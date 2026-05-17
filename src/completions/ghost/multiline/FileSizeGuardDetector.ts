import { IMultilineDetector, DetectionResult, MultilineContext } from './types';

export class FileSizeGuardDetector implements IMultilineDetector {
    constructor(private readonly maxLines: number = 8000) {}

    get name(): string { return 'FileSizeGuard'; }

    async detect(ctx: MultilineContext): Promise<DetectionResult> {
        if (ctx.document.lineCount >= this.maxLines) {
            return { decision: 'singleline' };
        }
        return { decision: 'defer' };
    }
}
