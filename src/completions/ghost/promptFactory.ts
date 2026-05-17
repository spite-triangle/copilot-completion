import { createServiceIdentifier } from '../../di/services';
import { DiagnosticSummary } from './types';

export const IGhostPromptFactory = createServiceIdentifier<IGhostPromptFactory>('IGhostPromptFactory');

export interface IGhostPromptFactory {
    readonly _serviceBrand: undefined;
    createPrompt(params: {
        template: string;
        prefix: string;
        suffix: string;
        languageId: string;
        diagnostics: DiagnosticSummary[];
        recentEdits: string[];
    }): string;
}

export class GhostPromptFactory implements IGhostPromptFactory {
    readonly _serviceBrand: undefined;

    createPrompt(params: {
        template: string;
        prefix: string;
        suffix: string;
        languageId: string;
        diagnostics: DiagnosticSummary[];
        recentEdits: string[];
    }): string {
        const contextLines: string[] = [];

        // Language ID
        const commentPrefix = this._getCommentPrefix(params.languageId);
        contextLines.push(`${commentPrefix} language: ${params.languageId}`);

        // Diagnostics (cap at 5)
        if (params.diagnostics.length > 0) {
            for (const d of params.diagnostics.slice(0, 5)) {
                contextLines.push(`${commentPrefix} diagnostics: [Line ${d.line}] ${d.message}`);
            }
        }

        // Recent edits
        if (params.recentEdits.length > 0) {
            contextLines.push(`${commentPrefix} recent edits:`);
            for (const edit of params.recentEdits) {
                contextLines.push(`${commentPrefix} ${edit}`);
            }
        }

        const context = contextLines.join('\n') + '\n';
        return params.template
            .replace(/\{prefix\}/g, '\n' + context + params.prefix)
            .replace(/\{suffix\}/g, '\n' + params.suffix + '\n');
    }

    private _getCommentPrefix(languageId: string): string {
        const hashLanguages = new Set([
            'python', 'ruby', 'shellscript', 'bash', 'yaml', 'toml', 'perl', 'r',
        ]);
        if (hashLanguages.has(languageId)) {
            return '#';
        }
        return '//';
    }
}
