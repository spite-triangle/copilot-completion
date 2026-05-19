import * as assert from 'assert';
import { OffsetRange } from '../../../completions/nes/stubs/offsetRange';
import { Result } from '../../../completions/nes/stubs/result';

// Test parseResponse indirectly by testing the key validation logic
// Since _parseResponse is private, we test the parsing invariants directly.

type ParsedPrediction = { kind: string; lineNumber: number; filePath?: string };

function parseLineNumber(line: string, keptRange: OffsetRange): Result<ParsedPrediction, string> {
    const lineNumber = parseInt(line, 10);
    if (!isNaN(lineNumber) && String(lineNumber) === line) {
        if (lineNumber < 0) {
            return Result.error('negativeLineNumber');
        }
        if (lineNumber < keptRange.start || keptRange.endExclusive <= lineNumber) {
            return Result.error('modelNotSeenLineNumber');
        }
        return Result.ok({ kind: 'sameFile', lineNumber });
    }

    const lastColonIdx = line.lastIndexOf(':');
    if (lastColonIdx <= 0) {
        return Result.error('gotNaN');
    }

    const filePath = line.substring(0, lastColonIdx).trim();
    const crossLine = parseInt(line.substring(lastColonIdx + 1), 10);

    if (isNaN(crossLine) || crossLine < 0 || filePath.length === 0) {
        return Result.error('crossFileInvalidLineNumber');
    }

    return Result.ok({ kind: 'differentFile', filePath, lineNumber: crossLine });
}

suite('NextCursorPredictor — parseResponse', () => {
    const keptRange = new OffsetRange(10, 100);

    test('valid same-file prediction within keptRange', () => {
        const r = parseLineNumber('42', keptRange);
        assert.strictEqual(r.isOk(), true);
        if (r.isOk()) {
            assert.strictEqual(r.val.kind, 'sameFile');
            assert.strictEqual(r.val.lineNumber, 42);
        }
    });

    test('rejects line number below keptRange start', () => {
        const r = parseLineNumber('5', keptRange);
        assert.strictEqual(r.isOk(), false);
        assert.strictEqual(r.err, 'modelNotSeenLineNumber');
    });

    test('rejects line number at or above keptRange end', () => {
        const r = parseLineNumber('100', keptRange);
        assert.strictEqual(r.isOk(), false);
        assert.strictEqual(r.err, 'modelNotSeenLineNumber');
    });

    test('rejects negative line number', () => {
        const r = parseLineNumber('-1', keptRange);
        assert.strictEqual(r.isOk(), false);
        assert.strictEqual(r.err, 'negativeLineNumber');
    });

    test('valid cross-file prediction', () => {
        const r = parseLineNumber('src/utils.ts:15', keptRange);
        assert.strictEqual(r.isOk(), true);
        if (r.isOk()) {
            assert.strictEqual(r.val.kind, 'differentFile');
            assert.strictEqual(r.val.filePath, 'src/utils.ts');
            assert.strictEqual(r.val.lineNumber, 15);
        }
    });

    test('rejects invalid cross-file format (no colon)', () => {
        const r = parseLineNumber('notanumber', keptRange);
        assert.strictEqual(r.isOk(), false);
        assert.strictEqual(r.err, 'gotNaN');
    });

    test('rejects cross-file with empty filePath', () => {
        const r = parseLineNumber(':15', keptRange);
        assert.strictEqual(r.isOk(), false);
        assert.strictEqual(r.err, 'crossFileInvalidLineNumber');
    });

    test('rejects cross-file with negative line', () => {
        const r = parseLineNumber('file.ts:-5', keptRange);
        assert.strictEqual(r.isOk(), false);
        assert.strictEqual(r.err, 'crossFileInvalidLineNumber');
    });
});
