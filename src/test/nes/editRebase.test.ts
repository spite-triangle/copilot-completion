import * as assert from 'assert';
import { tryRebase } from '../../completions/nes/editRebase';

suite('EditRebase', () => {
    test('should return same edit when documents are identical', () => {
        const doc = 'line1\nline2\nline3';
        const result = tryRebase(doc, doc, 'edited line');
        assert.strictEqual(result, 'edited line');
    });

    test('should return undefined when documents differ', () => {
        const original = 'line1\nline2\nline3';
        const current = 'line1\nline2_modified\nline3';
        const result = tryRebase(original, current, 'edit');
        assert.strictEqual(result, undefined);
    });

    test('should return same edit when only additions after end', () => {
        const original = 'line1\nline2';
        const current = 'line1\nline2';
        const result = tryRebase(original, current, 'edit');
        assert.strictEqual(result, 'edit');
    });
});
