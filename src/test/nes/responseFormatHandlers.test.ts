import * as assert from 'assert';
import { handleEditWindowOnly } from '../../completions/nes/responseFormatHandlers';
import { parseEditIntent, EditIntent } from '../../completions/nes/editIntent';

suite('ResponseFormatHandlers', () => {
    test('handleEditWindowOnly should return lines as-is', () => {
        const result = handleEditWindowOnly('line1\nline2\nline3');
        assert.strictEqual(result.lines.length, 3);
        assert.strictEqual(result.lines[0], 'line1');
        assert.strictEqual(result.lines[1], 'line2');
        assert.strictEqual(result.lines[2], 'line3');
    });

    test('handleEditWindowOnly should trim trailing empty lines', () => {
        const result = handleEditWindowOnly('line1\n\n\n');
        assert.strictEqual(result.lines.length, 1);
    });

    test('handleEditWindowOnly should handle single line', () => {
        const result = handleEditWindowOnly('single');
        assert.strictEqual(result.lines.length, 1);
        assert.strictEqual(result.lines[0], 'single');
    });
});

suite('EditIntent', () => {
    test('should parse no_edit', () => {
        assert.strictEqual(parseEditIntent('N'), EditIntent.NoEdit);
        assert.strictEqual(parseEditIntent('no_edit'), EditIntent.NoEdit);
    });

    test('should parse low', () => {
        assert.strictEqual(parseEditIntent('L'), EditIntent.Low);
    });

    test('should parse medium', () => {
        assert.strictEqual(parseEditIntent('M'), EditIntent.Medium);
    });

    test('should default to high', () => {
        assert.strictEqual(parseEditIntent('unknown'), EditIntent.High);
    });
});
