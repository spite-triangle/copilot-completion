import * as assert from 'assert';
import { NextEditCache, CachedEdit } from '../../completions/nes/nextEditCache';
import { DocumentId } from '../../completions/nes/stubs/types';

suite('NextEditCache', () => {
    const atLine0 = { line: 0, character: 0 };

    function makeEdit(docId: DocumentId, docText: string, edit: string, editWindow?: { startLine: number; endLineExclusive: number }): CachedEdit {
        return {
            docId,
            documentBeforeEdit: docText,
            editWindow: editWindow || { startLine: 0, endLineExclusive: 5 },
            edit,
            cacheTime: Date.now(),
        };
    }

    test('should cache and retrieve edit when cursor is within edit window', () => {
        const cache = new NextEditCache();
        const docId = DocumentId.create('test.ts');
        const docText = 'line1\nline2';
        const edit = makeEdit(docId, docText, 'new content');
        cache.setKthNextEdit(docId, edit);

        const found = cache.lookupNextEdit(docId, { getText: () => docText }, atLine0);
        assert.ok(found);
        assert.strictEqual(found!.edit, 'new content');
    });

    test('should return undefined when cursor is outside edit window', () => {
        const cache = new NextEditCache();
        const docId = DocumentId.create('test.ts');
        const docText = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8';
        // Cache an edit for cursor around line 2-7
        const edit = makeEdit(docId, docText, 'new content', { startLine: 2, endLineExclusive: 7 });
        cache.setKthNextEdit(docId, edit);

        // Cursor at line 0 — outside window
        const found = cache.lookupNextEdit(docId, { getText: () => docText }, { line: 0 });
        assert.strictEqual(found, undefined);
    });

    test('should return undefined for cache miss (different doc)', () => {
        const cache = new NextEditCache();
        const f1 = DocumentId.create('f1');
        const f2 = DocumentId.create('f2');
        cache.setKthNextEdit(f1, makeEdit(f1, 'text1', 'edit1'));
        const found = cache.lookupNextEdit(f2, { getText: () => 'text1' }, atLine0);
        assert.strictEqual(found, undefined);
    });

    test('should clear cache for specific doc', () => {
        const cache = new NextEditCache();
        const f1 = DocumentId.create('f1');
        cache.setKthNextEdit(f1, makeEdit(f1, 'text', 'edit1'));
        cache.clear(f1);
        assert.strictEqual(cache.lookupNextEdit(f1, { getText: () => 'text' }, atLine0), undefined);
    });

    test('should evict oldest entry when total limit exceeded', () => {
        const cache = new NextEditCache();
        const firstEntry = makeEdit(DocumentId.create('doc0'), 'text000', 'edit0');
        const firstKey = JSON.stringify([firstEntry.docId.uri, 'text000']);
        // Insert 51 entries — first should be evicted
        // Manually set at first position by inserting first entry first
        cache.setKthNextEdit(firstEntry.docId, firstEntry);
        for (let i = 1; i <= 50; i++) {
            const docId = DocumentId.create(`doc${i}`);
            cache.setKthNextEdit(docId, makeEdit(docId, `text${i}`, `edit${i}`));
        }
        // First entry should be evicted
        const foundOld = cache.lookupNextEdit(firstEntry.docId, { getText: () => 'text000' }, atLine0);
        assert.strictEqual(foundOld, undefined);
        // Last entry should still exist
        const lastDocId = DocumentId.create('doc50');
        const foundNew = cache.lookupNextEdit(lastDocId, { getText: () => 'text50' }, atLine0);
        assert.ok(foundNew);
    });
});
