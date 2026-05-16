export interface BlockTrimmerConfig {
    maxLines: number;
    stopAtBlankLine: boolean;
}

export class BlockTrimmer {
    constructor(private readonly config: BlockTrimmerConfig) {}

    trim(text: string): string {
        const lines = text.split('\n');
        if (lines.length <= this.config.maxLines) return text;

        let result = lines.slice(0, this.config.maxLines);
        if (this.config.stopAtBlankLine) {
            const blankIdx = result.findIndex(l => l.trim() === '');
            if (blankIdx > 0) {
                result = result.slice(0, blankIdx);
            }
        }
        return result.join('\n');
    }
}

export class TerseBlockTrimmer extends BlockTrimmer {
    constructor() {
        super({ maxLines: 10, stopAtBlankLine: true });
    }
}

export class VerboseBlockTrimmer extends BlockTrimmer {
    constructor() {
        super({ maxLines: 40, stopAtBlankLine: false });
    }
}
