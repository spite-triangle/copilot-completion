export interface BlockTrimmerConfig {
    maxLines: number;
    stopAtBlankLine: boolean;
}

export class BlockTrimmer {
    static isSupported(_languageId: string): boolean {
        return false; // tree-sitter WASM not yet integrated
    }

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

export enum BlockPositionType {
    NonBlock = 'non-block',
    EmptyBlock = 'empty-block',
    BlockEnd = 'block-end',
    MidBlock = 'mid-block',
}

/** Returns the block position type for a cursor position. Requires tree-sitter WASM for full support. */
export function getBlockPositionType(
    _document: { detectedLanguageId?: string },
    _position: { line: number },
): BlockPositionType {
    return BlockPositionType.NonBlock;
}
