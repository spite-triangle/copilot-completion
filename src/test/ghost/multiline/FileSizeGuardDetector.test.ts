import * as assert from 'assert';
import { FileSizeGuardDetector } from '../../../completions/ghost/multiline/FileSizeGuardDetector';
import { createMockContext } from './helpers';

suite('FileSizeGuardDetector', () => {
    const detector = new FileSizeGuardDetector(8000);

    test('name returns FileSizeGuard', () => {
        assert.strictEqual(detector.name, 'FileSizeGuard');
    });

    test('defer when lineCount < threshold', async () => {
        const ctx = createMockContext({ lines: Array.from({ length: 100 }, (_, i) => `line${i}`) });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });

    test('singleline when lineCount >= threshold', async () => {
        const ctx = createMockContext({ lines: Array.from({ length: 8000 }, (_, i) => `line${i}`) });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'singleline');
    });

    test('custom threshold', async () => {
        const customDetector = new FileSizeGuardDetector(10);
        const ctx = createMockContext({ lines: Array.from({ length: 10 }, (_, i) => `line${i}`) });
        const result = await customDetector.detect(ctx);
        assert.strictEqual(result.decision, 'singleline');
    });
});
