import * as assert from 'assert';
import { TrimNESResponseSuffixOverlap } from '../../common/suffixOverlapTrim';

suite('_trimLineSuffixOverlap', () => {
    /**
     * Helper: mirrors GhostTextComputer._trimLineSuffixOverlap logic exactly,
     * using the real TrimNESResponseSuffixOverlap class directly (no DI / VSCode runtime needed).
     */
    function trimLineSuffixOverlap(
        text: string,
        suffix: string,
        similarityThreshold: number,
        type: 'low' | 'high',
    ): string {
        const completionLines = text.split('\n');
        const suffixLines = suffix.split('\n');
        const trimmer = new TrimNESResponseSuffixOverlap(similarityThreshold, type);
        const overlapCount = trimmer.calculateOverlap(completionLines, suffixLines);
        if (overlapCount > 0 && overlapCount < completionLines.length) {
            return completionLines.slice(0, completionLines.length - overlapCount).join('\n');
        }
        if (overlapCount >= completionLines.length) {
            return '';
        }
        return text;
    }

    test('no overlap — returns text unchanged', () => {
        const result = trimLineSuffixOverlap('line1\nline2\nline3', 'other1\nother2', 0.5, 'low');
        assert.strictEqual(result, 'line1\nline2\nline3');
    });

    test('partial overlap — trims overlapping lines', () => {
        const result = trimLineSuffixOverlap('hello\nworld\nfoo', 'world\nfoo\nbar', 0.5, 'low');
        assert.strictEqual(result, 'hello');
    });

    test('full overlap — returns empty string', () => {
        const result = trimLineSuffixOverlap('hello\nworld', 'hello\nworld', 0.5, 'low');
        assert.strictEqual(result, '');
    });

    test('empty input text — returns empty', () => {
        const result = trimLineSuffixOverlap('', 'suffix', 0.5, 'low');
        assert.strictEqual(result, '');
    });

    test('empty suffix — returns text unchanged', () => {
        const result = trimLineSuffixOverlap('hello\nworld', '', 0.5, 'low');
        assert.strictEqual(result, 'hello\nworld');
    });

    test('single line no overlap — unchanged', () => {
        const result = trimLineSuffixOverlap('hello', 'world', 0.5, 'low');
        assert.strictEqual(result, 'hello');
    });

    test('fuzzy match with high similarity — trims similar lines', () => {
        const result = trimLineSuffixOverlap('prefix\nmyFunction', 'myFuncion\nrest', 0.3, 'high');
        // "myFunction" vs "myFuncion" — Levenshtein distance ~2, len 10, similarity ~0.8 > threshold 0.3
        assert.strictEqual(result, 'prefix');
    });
});
