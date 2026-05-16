import * as assert from 'assert';
import { TrimNESResponseSuffixOverlap } from '../../completions/nes/suffixOverlapTrim';

suite('TrimNESResponseSuffixOverlap', () => {
    test('should detect exact overlap', () => {
        const trimmer = new TrimNESResponseSuffixOverlap(0.5, 'low');
        const newLines = ['function foo() {', '  return 1;', '}'];
        const suffixLines = ['}', ''];
        const overlap = trimmer.calculateOverlap(newLines, suffixLines);
        assert.strictEqual(overlap, 1);
    });

    test('should return 0 for no overlap', () => {
        const trimmer = new TrimNESResponseSuffixOverlap(0.5, 'low');
        const newLines = ['function foo() {', '  return 1;', '}'];
        const suffixLines = ['completely', 'different', 'content'];
        const overlap = trimmer.calculateOverlap(newLines, suffixLines);
        assert.strictEqual(overlap, 0);
    });

    test('should return 0 for empty input', () => {
        const trimmer = new TrimNESResponseSuffixOverlap(0.5, 'low');
        assert.strictEqual(trimmer.calculateOverlap([], []), 0);
        assert.strictEqual(trimmer.calculateOverlap(['a'], []), 0);
        assert.strictEqual(trimmer.calculateOverlap([], ['a']), 0);
    });

    test('should handle high mode', () => {
        const trimmer = new TrimNESResponseSuffixOverlap(0.5, 'high');
        const newLines = ['lineA', 'lineB', 'lineC'];
        const suffixLines = ['lineB', 'lineC', 'lineD'];
        const overlap = trimmer.calculateOverlap(newLines, suffixLines);
        assert.ok(overlap >= 0);
    });
});
