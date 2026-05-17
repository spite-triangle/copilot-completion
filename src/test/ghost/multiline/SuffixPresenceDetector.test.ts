import * as assert from 'assert';
import { SuffixPresenceDetector } from '../../../completions/ghost/multiline/SuffixPresenceDetector';
import { createMockContext } from './helpers';

suite('SuffixPresenceDetector', () => {
    const detector = new SuffixPresenceDetector();

    test('name returns SuffixPresenceDetector', () => {
        assert.strictEqual(detector.name, 'SuffixPresenceDetector');
    });

    test('multiline when at line end with non-empty suffix', async () => {
        const ctx = createMockContext({
            lines: ['function foo() {', '  // TODO', '}'],
            cursorLine: 0,
            cursorChar: 19,
            languageId: 'cpp',
            isMiddleOfTheLine: false,
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'multiline');
    });

    test('defer for inline (mid-line) even with non-empty suffix', async () => {
        const ctx = createMockContext({
            lines: ['function foo() {', '  // TODO', '}'],
            cursorLine: 0,
            cursorChar: 9,
            languageId: 'cpp',
            isMiddleOfTheLine: true,
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });

    test('defer when suffix is empty (EOF)', async () => {
        const ctx = createMockContext({
            lines: ['function foo() {', '  return 1;', '}'],
            cursorLine: 2,
            cursorChar: 1,
            languageId: 'cpp',
            isMiddleOfTheLine: false,
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });

    test('multiline for Go file at line end with suffix', async () => {
        const ctx = createMockContext({
            lines: ['package main', '', 'func main() {', '    fmt.Println("hello")', '}'],
            cursorLine: 2,
            cursorChar: 14,
            languageId: 'go',
            isMiddleOfTheLine: false,
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'multiline');
    });
});
