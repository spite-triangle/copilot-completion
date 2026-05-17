import * as vscode from 'vscode';
import { IMultilineDetector, DetectionResult, MultilineContext } from './types';
import { isEmptyBlockStart } from './treeSitter/blockParser';
import { isSupportedLanguageId } from './treeSitter/parse';

export class EmptyBlockDetector implements IMultilineDetector {
    get name(): string { return 'EmptyBlock'; }

    async detect(ctx: MultilineContext): Promise<DetectionResult> {
        if (!isSupportedLanguageId(ctx.languageId)) {
            return { decision: 'defer' };
        }

        const text = ctx.document.getText();

        // Check current cursor position
        if (await isEmptyBlockStart(ctx.languageId, text, ctx.document.offsetAt(ctx.position))) {
            return { decision: 'multiline' };
        }

        // If inline (mid-line), also check end-of-line position
        if (ctx.isMiddleOfTheLine) {
            const eol = ctx.document.lineAt(ctx.position.line).range.end;
            if (await isEmptyBlockStart(ctx.languageId, text, ctx.document.offsetAt(eol))) {
                return { decision: 'multiline' };
            }
        }

        return { decision: 'defer' };
    }
}
