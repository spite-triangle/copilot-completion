export interface GhostCompletion {
    completionIndex: number;
    completionText: string;
    displayText: string;
    displayNeedsWsOffset: boolean;
    isMiddleOfTheLine: boolean;
}

export interface CompletionResult {
    completion: GhostCompletion;
    isMiddleOfTheLine: boolean;
    suffixCoverage: number;
}

export interface GhostTextOptions {
    isSpeculative: boolean;
    delay: number;
}

export interface DiagnosticSummary {
    line: number;
    severity: 'error' | 'warning';
    message: string;
}

export enum ResultType {
    Network = 0,
    Cache = 1,
    TypingAsSuggested = 2,
    Cycling = 3,
    Async = 4,
}
