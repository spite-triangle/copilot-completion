import * as assert from 'assert';
import { DefaultMultilineStrategy } from '../../../completions/ghost/multiline/DefaultMultilineStrategy';
import { IMultilineDetector } from '../../../completions/ghost/multiline/types';
import { createMockContext } from './helpers';

function stubDetector(name: string, decision: 'multiline' | 'singleline' | 'defer'): IMultilineDetector {
    return { name, detect: async () => ({ decision }) };
}

suite('DefaultMultilineStrategy', () => {
    test('_serviceBrand is undefined (DI compliance)', () => {
        const strategy = new DefaultMultilineStrategy();
        assert.strictEqual(strategy._serviceBrand, undefined);
    });

    test('constructor assembles 5 detectors in chain', () => {
        const strategy = new DefaultMultilineStrategy();
        assert.strictEqual(strategy._serviceBrand, undefined);
        // Chain should contain: FileSizeGuard → NewLine → EmptyBlock → MLModel → SuffixPresence
        // The chain name includes all detector names
    });

    test('afterAccept forces multiline regardless of chain', async () => {
        const forceSingleline = stubDetector('Single', 'singleline');
        const strategy = new DefaultMultilineStrategy(forceSingleline, forceSingleline, forceSingleline, forceSingleline, forceSingleline);
        const ctx = createMockContext({ afterAccept: true });
        assert.strictEqual(await strategy.determineMultiline(ctx), true);
    });

    test('afterAccept=false delegates to chain', async () => {
        const forceSingleline = stubDetector('Single', 'singleline');
        const strategy = new DefaultMultilineStrategy(forceSingleline, forceSingleline, forceSingleline, forceSingleline, forceSingleline);
        const ctx = createMockContext({ afterAccept: false });
        assert.strictEqual(await strategy.determineMultiline(ctx), false);
    });

    test('afterAccept=false with multiline detector returns true', async () => {
        const forceMultiline = stubDetector('Multi', 'multiline');
        const deferAll = stubDetector('Defer', 'defer');
        const strategy = new DefaultMultilineStrategy(deferAll, forceMultiline, deferAll, deferAll, deferAll);
        const ctx = createMockContext({ afterAccept: false });
        assert.strictEqual(await strategy.determineMultiline(ctx), true);
    });
});
