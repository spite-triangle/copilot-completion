import * as vscode from 'vscode';
import { createServiceIdentifier } from '../../di/services';
import { ILogService } from '../shared/log/logService';

export const IRecentEditsProvider = createServiceIdentifier<IRecentEditsProvider>('IRecentEditsProvider');

export interface IRecentEditsProvider {
    readonly _serviceBrand: undefined;
    readonly recentEdits: string[];
    trackDocument(document: vscode.TextDocument): void;
}

export class RecentEditsProvider implements IRecentEditsProvider {
    readonly _serviceBrand: undefined;
    private _recentEdits: string[] = [];
    private readonly _maxEntries = 10;
    private _disposables: vscode.Disposable[] = [];

    constructor(
        @ILogService private readonly _log: ILogService,
    ) {}

    get recentEdits(): string[] {
        return this._recentEdits;
    }

    trackDocument(document: vscode.TextDocument): void {
        for (const d of this._disposables) { d.dispose(); }
        this._disposables = [];

        this._disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document.uri.toString() !== document.uri.toString()) { return; }
                for (const change of e.contentChanges) {
                    const lines = change.text.split('\n');
                    for (const line of lines) {
                        if (line.trim().length > 0) {
                            this._recentEdits.push('+  ' + line);
                        }
                    }
                }
                while (this._recentEdits.length > this._maxEntries) {
                    this._recentEdits.shift();
                }
            })
        );
        this._log.debug(`RecentEdits: tracking document ${document.uri.toString()}`);
    }
}
