export class CopilotPromptLoadFailure extends Error {
    readonly code = 'CopilotPromptLoadFailure';
    constructor(message: string, cause?: unknown) {
        super(message, { cause });
    }
}
