import * as assert from 'assert';
import { NextEditCache, CachedEdit } from '../../completions/nes/nextEditCache';

suite('NextEditCache', () => {
    function makeEdit(docId: string, docText: string, edit: string): CachedEdit {
        let hash = 0;
        for (let i = 0; i < docText.length; i++) {
            hash = ((hash << 5) - hash) + docText.charCodeAt(i);
            hash |= 0;
        }
        return {
            docId,
            docContentHash: hash.toString(36),
            editWindow: { startLine: 0, endLineExclusive: 5 },
            edit,
            cacheTime: Date.now(),
        };
    }

    test('should cache and retrieve edit', () => {
        const cache = new NextEditCache();
        const docId = 'test.ts';
        const docText = 'line1\nline2';
        const edit = makeEdit(docId, docText, 'new content');
        cache.setKthNextEdit(docId, edit);

        const found = cache.lookupNextEdit(docId, { getText: () => docText });
        assert.ok(found);
        assert.strictEqual(found!.edit, 'new content');
    });

    test('should return undefined for cache miss', () => {
        const cache = new NextEditCache();
        cache.setKthNextEdit('f1', makeEdit('f1', 'text1', 'edit1'));
        const found = cache.lookupNextEdit('f2', { getText: () => 'text1' });
        assert.strictEqual(found, undefined);
    });

    test('should clear cache for specific doc', () => {
        const cache = new NextEditCache();
        cache.setKthNextEdit('f1', makeEdit('f1', 'text', 'edit1'));
        cache.clear('f1');
        assert.strictEqual(cache.lookupNextEdit('f1', { getText: () => 'text' }), undefined);
    });

    test('should evict oldest entry when per-doc limit exceeded', () => {
        const cache = new NextEditCache();
        const docId = 'doc';
        for (let i = 0; i < 15; i++) {
            cache.setKthNextEdit(docId, makeEdit(docId, `text${i}`, `edit${i}`));
        }
        // Oldest 5 should be gone, keep only latest 10
        // text4 should be gone, text14 should exist
        const foundOld = cache.lookupNextEdit(docId, { getText: () => 'text4' });
        const foundNew = cache.lookupNextEdit(docId, { getText: () => 'text14' });
        assert.strictEqual(foundOld, undefined);
        assert.ok(foundNew);
    });
});
