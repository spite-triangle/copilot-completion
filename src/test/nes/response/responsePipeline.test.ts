import * as assert from 'assert';
import {
    BoundaryMarkerParser,
    CursorTagStripper,
    ResponsePipeline,
    ResponsePipelineContext,
} from '../../../completions/nes/response/responsePipeline';

function makeContext(overrides?: Partial<ResponsePipelineContext>): ResponsePipelineContext {
    return {
        editWindowHadCursorTag: false,
        ...overrides,
    };
}

suite('BoundaryMarkerParser', () => {
    test('extracts lines between boundary markers', () => {
        const parser = new BoundaryMarkerParser();
        const input = [
            'some prefix',
            '###remain edit start boundary line###',
            'line1',
            'line2',
            '###remain edit end boundary line###',
            'some suffix',
        ];
        const result = parser.process(input, makeContext());
        assert.deepStrictEqual(result, ['line1', 'line2']);
    });

    test('returns all non-empty lines when no markers present', () => {
        const parser = new BoundaryMarkerParser();
        const input = ['line1', 'line2', '', 'line3'];
        const result = parser.process(input, makeContext());
        assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
    });

    test('handles missing start marker', () => {
        const parser = new BoundaryMarkerParser();
        const input = [
            'line1',
            '###remain edit end boundary line###',
            'line2',
        ];
        const result = parser.process(input, makeContext());
        assert.deepStrictEqual(result, ['line1']);
    });

    test('handles missing end marker', () => {
        const parser = new BoundaryMarkerParser();
        const input = [
            '###remain edit start boundary line###',
            'line1',
            'line2',
        ];
        const result = parser.process(input, makeContext());
        assert.deepStrictEqual(result, ['line1', 'line2']);
    });

    test('marker matching trims whitespace', () => {
        const parser = new BoundaryMarkerParser();
        const input = [
            '  ###remain edit start boundary line###  ',
            'line1',
            '  ###remain edit end boundary line###  ',
        ];
        const result = parser.process(input, makeContext());
        assert.deepStrictEqual(result, ['line1']);
    });
});

suite('CursorTagStripper', () => {
    test('removes cursor tags when edit window had no tag', () => {
        const stripper = new CursorTagStripper();
        const input = ['  line<|cursor|>here', '<|cursor|>start'];
        const result = stripper.process(input, makeContext({ editWindowHadCursorTag: false }));
        assert.deepStrictEqual(result, ['  linehere', 'start']);
    });

    test('preserves cursor tags when edit window had tag', () => {
        const stripper = new CursorTagStripper();
        const input = ['  line<|cursor|>here'];
        const result = stripper.process(input, makeContext({ editWindowHadCursorTag: true }));
        assert.deepStrictEqual(result, ['  line<|cursor|>here']);
    });
});

suite('ResponsePipeline', () => {
    test('full pipeline: boundary parse → cursor strip', () => {
        const pipeline = new ResponsePipeline();
        const raw = [
            'prefix',
            '###remain edit start boundary line###',
            '  const<|cursor|> x = 1;',
            '  suffix A',
            '###remain edit end boundary line###',
            'extra',
        ].join('\n');

        const ctx = makeContext({ editWindowHadCursorTag: false });
        const result = pipeline.process(raw, ctx);
        // Cursor tag stripped: '  const x = 1;', '  suffix A'
        assert.deepStrictEqual(result, ['  const x = 1;', '  suffix A']);
    });

    test('trailing blank lines are trimmed', () => {
        const pipeline = new ResponsePipeline();
        const raw = [
            '###remain edit start boundary line###',
            'line',
            '###remain edit end boundary line###',
            '',
            '',
        ].join('\n');

        const result = pipeline.process(raw, makeContext());
        assert.deepStrictEqual(result, ['line']);
    });

    test('custom stages can be injected', () => {
        let processed = false;
        const customStage = {
            name: 'test',
            process(lines: string[]) { processed = true; return lines; },
        };
        const pipeline = new ResponsePipeline([customStage as any]);
        pipeline.process('hello', makeContext());
        assert.strictEqual(processed, true);
    });
});
