import * as assert from 'assert';
import { NewLineDetector } from '../../../completions/ghost/multiline/NewLineDetector';
import { createMockContext } from './helpers';

suite('NewLineDetector', () => {
    const detector = new NewLineDetector();

    test('name returns NewLine', () => {
        assert.strictEqual(detector.name, 'NewLine');
    });

    test('multiline for typescript empty line', async () => {
        const ctx = createMockContext({
            lines: ['function foo() {', '    ', '}'],
            cursorLine: 1,
            cursorChar: 4,
            languageId: 'typescript',
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'multiline');
    });

    test('multiline for typescriptreact empty line', async () => {
        const ctx = createMockContext({
            lines: ['const App = () => {', '    ', '};'],
            cursorLine: 1,
            cursorChar: 4,
            languageId: 'typescriptreact',
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'multiline');
    });

    test('defer for typescript non-empty line', async () => {
        const ctx = createMockContext({
            lines: ['function foo() {', '    return 1;', '}'],
            cursorLine: 1,
            cursorChar: 13,
            languageId: 'typescript',
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });

    test('defer for non-target language empty line', async () => {
        const ctx = createMockContext({
            lines: ['def foo():', '    ', '    pass'],
            cursorLine: 1,
            cursorChar: 4,
            languageId: 'python',
        });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });
});
