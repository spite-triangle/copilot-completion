import { PromptTags } from '../tags';

export interface IResponseStage {
    readonly name: string;
    process(lines: string[], context: ResponsePipelineContext): string[];
}

export interface ResponsePipelineContext {
    /** Whether the original edit window contained the cursor tag */
    readonly editWindowHadCursorTag: boolean;
}

/**
 * Extracts lines between ###remain edit start boundary line### and
 * ###remain edit end boundary line### markers.
 */
export class BoundaryMarkerParser implements IResponseStage {
    readonly name = 'BoundaryMarkerParser';

    process(lines: string[], _context: ResponsePipelineContext): string[] {
        const startMarker = '###remain edit start boundary line###';
        const endMarker = '###remain edit end boundary line###';

        const startIdx = lines.findIndex(l => l.trim() === startMarker);
        const endIdx = lines.findIndex(l => l.trim() === endMarker);

        if (startIdx === -1 && endIdx === -1) {
            return lines.filter(l => l.trim() !== '');
        }

        const begin = startIdx === -1 ? 0 : startIdx + 1;
        const end = endIdx === -1 ? lines.length : endIdx;
        return lines.slice(begin, end);
    }
}

/**
 * Removes cursor tags from response lines when the original
 * edit window did not contain the cursor tag.
 */
export class CursorTagStripper implements IResponseStage {
    readonly name = 'CursorTagStripper';

    process(lines: string[], context: ResponsePipelineContext): string[] {
        if (context.editWindowHadCursorTag) {
            return lines;
        }
        return lines.map(l => l.replaceAll(PromptTags.CURSOR, ''));
    }
}

export class ResponsePipeline {
    private readonly _stages: IResponseStage[];

    constructor(stages?: IResponseStage[]) {
        this._stages = stages ?? [
            new BoundaryMarkerParser(),
            new CursorTagStripper(),
        ];
    }

    get stages(): readonly IResponseStage[] {
        return this._stages;
    }

    process(rawText: string, context: ResponsePipelineContext): string[] {
        let lines = rawText.split('\n');
        for (const stage of this._stages) {
            lines = stage.process(lines, context);
        }
        // Trim trailing blank lines
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
            lines.pop();
        }
        return lines;
    }
}
