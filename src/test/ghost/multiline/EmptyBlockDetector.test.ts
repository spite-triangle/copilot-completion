import * as assert from 'assert';
import { EmptyBlockDetector } from '../../../completions/ghost/multiline/EmptyBlockDetector';
import { createMockContext } from './helpers';

suite('EmptyBlockDetector', () => {
    const detector = new EmptyBlockDetector();

    test('name returns EmptyBlock', () => {
        assert.strictEqual(detector.name, 'EmptyBlock');
    });

    test('defer when tree-sitter unavailable', async () => {
        const ctx = createMockContext({
            lines: ['function foo() {', '    ', '}'],
            cursorLine: 1,
            cursorChar: 4,
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });

    test('defer for inline mode', async () => {
        const ctx = createMockContext({
            lines: ['const x = (', '    ', ')'],
            cursorLine: 0,
            cursorChar: 10,
            isMiddleOfTheLine: true,
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });

    test('defer for non-inline empty block start', async () => {
        const ctx = createMockContext({
            lines: ['if (true) {', '    ', '} else {'],
            cursorLine: 1,
            cursorChar: 4,
            isMiddleOfTheLine: false,
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });
});
