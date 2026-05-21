// Minimal stub: provides only what the DI code needs

export function illegalState(name?: string): Error {
	if (name) {
		return new Error(`Illegal state: ${name}`);
	} else {
		return new Error('Illegal state');
	}
}

export class BugIndicatingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BugIndicatingError';
    }
}

export function illegalArgument(message: string): Error {
    return new Error(`Illegal argument: ${message}`);
}
