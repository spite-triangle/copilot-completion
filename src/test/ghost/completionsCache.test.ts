import * as assert from 'assert';
import { GhostCompletionsCache } from '../../completions/ghost/completionsCache';

suite('GhostCompletionsCache', () => {
    test('should find cached completion by exact prefix+suffix', () => {
        const cache = new GhostCompletionsCache();
        cache.append('function hello()', '{', { text: '  console.log("hi");', finishReason: 'stop' });
        const results = cache.findAll('function hello()', '{');
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].text, '  console.log("hi");');
    });

    test('should hit cache when prefix grows (remainingKey sliced off)', () => {
        const cache = new GhostCompletionsCache();
        // Simulate: user cached completion at prefix "function add(a,b) {"
        cache.append('function add(a,b) {', '', { text: '\n  return a + b;\n}', finishReason: 'stop' });
        // User has now typed more: newline + indent. Prefix is longer.
        const results = cache.findAll('function add(a,b) {\n  ', '');
        assert.strictEqual(results.length, 1);
        // remainingKey="\n  " should be sliced off
        assert.strictEqual(results[0].text, 'return a + b;\n}');
    });

    test('should miss when remainingKey not matched by completion start', () => {
        const cache = new GhostCompletionsCache();
        cache.append('function foo()', '', { text: 'bar', finishReason: 'stop' });
        // User typed extra chars that don't match the completion start
        const results = cache.findAll('function foo()xyz', '');
        assert.strictEqual(results.length, 0);
    });

    test('should filter by suffix', () => {
        const cache = new GhostCompletionsCache();
        cache.append('prefix', 'suffixA', { text: 'completion', finishReason: 'stop' });
        cache.append('prefix', 'suffixB', { text: 'completion', finishReason: 'stop' });
        const resultsA = cache.findAll('prefix', 'suffixA');
        assert.strictEqual(resultsA.length, 1);
        const resultsB = cache.findAll('prefix', 'suffixB');
        assert.strictEqual(resultsB.length, 1);
        const resultsC = cache.findAll('prefix', 'suffixC');
        assert.strictEqual(resultsC.length, 0);
    });

    test('should return empty for cache miss (different prefix)', () => {
        const cache = new GhostCompletionsCache();
        cache.append('function a()', '{', { text: 'x', finishReason: 'stop' });
        const results = cache.findAll('function b()', '{');
        assert.strictEqual(results.length, 0);
    });

    test('should clear cache', () => {
        const cache = new GhostCompletionsCache();
        cache.append('p', 's', { text: 't', finishReason: 'stop' });
        assert.strictEqual(cache.findAll('p', 's').length, 1);
        cache.clear();
        assert.strictEqual(cache.findAll('p', 's').length, 0);
    });

    test('should evict oldest entries when capacity exceeded', () => {
        const cache = new GhostCompletionsCache(2);
        cache.append('a', '', { text: '1', finishReason: 'stop' });
        cache.append('b', '', { text: '2', finishReason: 'stop' });
        cache.append('c', '', { text: '3', finishReason: 'stop' });
        assert.strictEqual(cache.findAll('a', '').length, 0);
        assert.strictEqual(cache.findAll('b', '').length, 1);
        assert.strictEqual(cache.findAll('c', '').length, 1);
    });

    test('should accumulate multiple choices for same key', () => {
        const cache = new GhostCompletionsCache(10);
        cache.append('p', 's', { text: 'a', finishReason: 'stop' });
        cache.append('p', 's', { text: 'b', finishReason: 'stop' });
        assert.strictEqual(cache.findAll('p', 's').length, 2);
    });
});
