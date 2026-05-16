import * as assert from 'assert';
import { TerseBlockTrimmer, VerboseBlockTrimmer } from '../../completions/ghost/blockTrimmer';

suite('BlockTrimmer', () => {
    test('TerseBlockTrimmer should stop at blank line', () => {
        const trimmer = new TerseBlockTrimmer();
        const input = 'line1\n\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11';
        const result = trimmer.trim(input);
        assert.ok(!result.includes('line3'));
    });

    test('TerseBlockTrimmer should allow text shorter than max', () => {
        const trimmer = new TerseBlockTrimmer();
        const result = trimmer.trim('line1\nline2');
        assert.strictEqual(result, 'line1\nline2');
    });

    test('VerboseBlockTrimmer should allow more lines', () => {
        const trimmer = new VerboseBlockTrimmer();
        const lines = Array.from({ length: 50 }, (_, i) => `line${i}`);
        const result = trimmer.trim(lines.join('\n'));
        assert.ok(result.split('\n').length <= 40);
    });
});
