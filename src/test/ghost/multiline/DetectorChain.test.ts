import * as assert from 'assert';
import { DetectorChain } from '../../../completions/ghost/multiline/DetectorChain';
import { IMultilineDetector, MultilineContext, DetectionResult } from '../../../completions/ghost/multiline/types';
import { createMockContext } from './helpers';

function stubDetector(name: string, decision: DetectionResult['decision']): IMultilineDetector {
    return { name, detect: async () => ({ decision }) };
}

suite('DetectorChain', () => {
    test('name reflects sub-detector names', () => {
        const chain = new DetectorChain([
            stubDetector('A', 'defer'),
            stubDetector('B', 'defer'),
        ]);
        assert.strictEqual(chain.name, 'Chain[A→B]');
    });

    test('short-circuits on first multiline', async () => {
        let bCalled = false;
        const chain = new DetectorChain([
            { name: 'A', detect: async () => ({ decision: 'multiline' }) },
            { name: 'B', detect: async () => { bCalled = true; return { decision: 'defer' }; } },
        ]);
        const ctx = createMockContext();
        const result = await chain.detect(ctx);
        assert.strictEqual(result.decision, 'multiline');
        assert.strictEqual(bCalled, false);
    });

    test('short-circuits on first singleline', async () => {
        let bCalled = false;
        const chain = new DetectorChain([
            { name: 'A', detect: async () => ({ decision: 'singleline' }) },
            { name: 'B', detect: async () => { bCalled = true; return { decision: 'defer' }; } },
        ]);
        const ctx = createMockContext();
        const result = await chain.detect(ctx);
        assert.strictEqual(result.decision, 'singleline');
        assert.strictEqual(bCalled, false);
    });

    test('passes through on defer', async () => {
        const chain = new DetectorChain([
            stubDetector('A', 'defer'),
            stubDetector('B', 'multiline'),
        ]);
        const ctx = createMockContext();
        const result = await chain.detect(ctx);
        assert.strictEqual(result.decision, 'multiline');
    });

    test('defaults to singleline when all defer', async () => {
        const chain = new DetectorChain([
            stubDetector('A', 'defer'),
            stubDetector('B', 'defer'),
        ]);
        const ctx = createMockContext();
        const result = await chain.detect(ctx);
        assert.strictEqual(result.decision, 'singleline');
    });

    test('empty chain defaults to singleline', async () => {
        const chain = new DetectorChain([]);
        const ctx = createMockContext();
        const result = await chain.detect(ctx);
        assert.strictEqual(result.decision, 'singleline');
    });
});
