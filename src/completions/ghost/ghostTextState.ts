import * as vscode from 'vscode';

export interface CurrentGhostTextState {
    completionText: string;
    uri: vscode.Uri;
    version: number;
}

export class CurrentGhostText {
    private _state: CurrentGhostTextState | undefined;

    setGhostText(uri: vscode.Uri, version: number, completionText: string): void {
        this._state = { completionText, uri, version };
    }

    getCompletionsForUserTyping(
        uri: vscode.Uri,
        version: number,
    ): string | undefined {
        if (!this._state) return undefined;
        if (this._state.uri.toString() !== uri.toString()) return undefined;
        if (this._state.version !== version) return undefined;
        return this._state.completionText;
    }

    hasAcceptedCurrentCompletion(): boolean {
        return false;
    }
}

export class LastGhostText {
    resetState(): void {}
}
