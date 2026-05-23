import * as vscode from 'vscode';
import { GhostCompletion, ResultType } from './types';

export interface CurrentGhostTextState {
    completionText: string;
    uri: vscode.Uri;
    version: number;
}

interface TrackedCompletion {
    completionText: string;
    finishReason?: string;
}

export class CurrentGhostText {
    private _state: CurrentGhostTextState | undefined;

    /** The document prefix when the completion was shown. */
    private _prefix?: string;

    /** The document suffix when the completion was shown. */
    private _suffix?: string;

    /** The original completions shown to the user. */
    private _choices: TrackedCompletion[] = [];

    /** The currently shown completion text. */
    get clientCompletionId(): string | undefined {
        return this._choices[0]?.completionText;
    }

    /** The most recent inline completion request id, excluding speculative requests. */
    currentRequestId: string | undefined;

    setGhostText(prefix: string, suffix: string, completions: GhostCompletion[], resultType: ResultType, finishReason?: string): void {
        if (resultType === ResultType.TypingAsSuggested) { return; }
        this._prefix = prefix;
        this._suffix = suffix;
        this._choices = completions.map(c => ({ completionText: c.completionText, finishReason }));
    }

    getCompletionsForUserTyping(prefix: string, suffix: string): GhostCompletion[] | undefined {
        const remainingPrefix = this._getRemainingPrefix(prefix, suffix);
        if (remainingPrefix === undefined) { return; }
        if (!this._startsWithAndExceeds(this._choices[0]?.completionText || '', remainingPrefix)) { return; }
        return this._adjustChoicesStart(remainingPrefix);
    }

    hasAcceptedCurrentCompletion(prefix: string, suffix: string): boolean {
        const remainingPrefix = this._getRemainingPrefix(prefix, suffix);
        if (remainingPrefix === undefined) { return false; }
        const exactMatch = remainingPrefix === this._choices[0]?.completionText;
        const finishReason = this._choices[0]?.finishReason;
        return exactMatch && finishReason === 'stop';
    }

    // Keep the original URI-based methods for compatibility
    setGhostText_original(uri: vscode.Uri, version: number, completionText: string): void {
        this._state = { completionText, uri, version };
    }

    getCompletionsForUserTyping_original(
        uri: vscode.Uri,
        version: number,
    ): string | undefined {
        if (!this._state) return undefined;
        if (this._state.uri.toString() !== uri.toString()) return undefined;
        if (this._state.version !== version) return undefined;
        return this._state.completionText;
    }

    hasAcceptedCurrentCompletion_original(): boolean {
        return false;
    }

    private _getRemainingPrefix(prefix: string, suffix: string): string | undefined {
        if (this._prefix === undefined || this._suffix === undefined || this._choices.length === 0) { return; }
        if (this._suffix !== suffix) { return; }
        if (!prefix.startsWith(this._prefix)) { return; }
        return prefix.substring(this._prefix.length);
    }

    private _startsWithAndExceeds(text: string, prefix: string): boolean {
        return text.startsWith(prefix) && text.length > prefix.length;
    }

    private _adjustChoicesStart(remainingPrefix: string): GhostCompletion[] {
        return this._choices
            .filter(c => this._startsWithAndExceeds(c.completionText, remainingPrefix))
            .map((c, i) => ({
                completionIndex: i,
                completionText: c.completionText.substring(remainingPrefix.length),
                displayText: c.completionText.substring(remainingPrefix.length),
                displayNeedsWsOffset: false,
                isMiddleOfTheLine: false,
            }));
    }
}

export class LastGhostText {
    resetState(): void {}
}
