import * as assert from 'assert';
import { MLModelDetector } from '../../../completions/ghost/multiline/MLModelDetector';
import { createMockContext } from './helpers';

suite('MLModelDetector', () => {
    const detector = new MLModelDetector(0.5);

    test('name returns MLModel', () => {
        assert.strictEqual(detector.name, 'MLModel');
    });

    test('defer for non-target language (cpp)', async () => {
        const ctx = createMockContext({ languageId: 'cpp' });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });

    test('defer for non-target language (typescript)', async () => {
        const ctx = createMockContext({ languageId: 'typescript' });
        const result = await detector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });

    test('produce decision for javascript (target language)', async () => {
        const ctx = createMockContext({
            lines: ['function foo() {', '    ', '}'],
            languageId: 'javascript',
        });
        const result = await detector.detect(ctx);
        assert.ok(['multiline', 'defer'].includes(result.decision));
    });

    test('produce decision for python (target language)', async () => {
        const ctx = createMockContext({
            lines: ['def foo():', '    pass'],
            languageId: 'python',
        });
        const result = await detector.detect(ctx);
        assert.ok(['multiline', 'defer'].includes(result.decision));
    });

    test('threshold 0 always returns multiline', async () => {
        const lenientDetector = new MLModelDetector(0);
        const ctx = createMockContext({ languageId: 'javascript' });
        const result = await lenientDetector.detect(ctx);
        assert.strictEqual(result.decision, 'multiline');
    });

    test('threshold 1 always returns defer', async () => {
        const strictDetector = new MLModelDetector(1);
        const ctx = createMockContext({ languageId: 'javascript' });
        const result = await strictDetector.detect(ctx);
        assert.strictEqual(result.decision, 'defer');
    });
});
