import { MultilineContext, DetectionResult, IMultilineDetector } from './types';
import { requestMultilineScore } from './multilineModel';

const TARGET_LANGUAGES = new Set(['javascript', 'javascriptreact', 'python']);

export class MLModelDetector implements IMultilineDetector {
    constructor(private readonly threshold: number = 0.5) {}

    get name(): string { return 'MLModel'; }

    async detect(ctx: MultilineContext): Promise<DetectionResult> {
        if (!TARGET_LANGUAGES.has(ctx.languageId)) {
            return { decision: 'defer' };
        }
        const score = requestMultilineScore(
            { prefix: ctx.prefix, suffix: ctx.suffix },
            ctx.languageId,
        );
        if (score > this.threshold) {
            return { decision: 'multiline' };
        }
        return { decision: 'defer' };
    }
}
