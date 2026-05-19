/**
 * LineRange and LineReplacement — intermediate representation for edits,
 * corresponding to the reference's ResponseProcessor.diff() output.
 * Line numbers are 1-based (matching the reference convention).
 */
export interface LineRange {
    /** 1-based, inclusive */
    readonly startLineNumber: number;
    /** 1-based, exclusive */
    readonly endLineNumberExclusive: number;
}

export class LineReplacement {
    constructor(
        public readonly lineRange: LineRange,
        public readonly newLines: string[],
    ) {}

    /** Number of original lines replaced by this edit. */
    get replacedLineCount(): number {
        return this.lineRange.endLineNumberExclusive - this.lineRange.startLineNumber;
    }

    /** True if this is a pure insertion (zero original lines replaced). */
    get isInsertion(): boolean {
        return this.lineRange.startLineNumber === this.lineRange.endLineNumberExclusive;
    }

    /** True if this is a pure deletion (no new lines). */
    get isDeletion(): boolean {
        return this.newLines.length === 0;
    }

    /** True if this replaces exactly one line with one line. */
    get isSingleLineEdit(): boolean {
        return this.replacedLineCount === 1 && this.newLines.length === 1;
    }

    toString(): string {
        return `[${this.lineRange.startLineNumber},${this.lineRange.endLineNumberExclusive})->${JSON.stringify(this.newLines)}`;
    }
}
