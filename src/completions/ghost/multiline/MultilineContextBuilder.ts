import * as vscode from 'vscode';
import { MultilineContext } from './types';

export class MultilineContextBuilder {
    build(params: {
        document: vscode.TextDocument;
        position: vscode.Position;
        prefix: string;
        suffix: string;
        languageId: string;
        isMiddleOfTheLine: boolean;
        afterAccept: boolean;
    }): MultilineContext {
        return {
            document: params.document,
            position: params.position,
            prefix: params.prefix,
            suffix: params.suffix,
            languageId: params.languageId,
            isMiddleOfTheLine: params.isMiddleOfTheLine,
            afterAccept: params.afterAccept,
        };
    }
}
