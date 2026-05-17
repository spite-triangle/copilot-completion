import { IMultilineDetector, DetectionResult, MultilineContext } from './types';

const TARGET_LANGUAGES = new Set(['typescript', 'typescriptreact']);

export class NewLineDetector implements IMultilineDetector {
    get name(): string { return 'NewLine'; }

    async detect(ctx: MultilineContext): Promise<DetectionResult> {
        if (!TARGET_LANGUAGES.has(ctx.languageId)) {
            return { decision: 'defer' };
        }
        const line = ctx.document.lineAt(ctx.position.line);
        if (line.text.trim().length === 0) {
            return { decision: 'multiline' };
        }
        return { decision: 'defer' };
    }
}
