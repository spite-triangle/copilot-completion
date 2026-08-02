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

    test('should miss cache when document changed below the edit position', () => {
        // Simulates: edit at line 2 → NES caches → edit at line 4 below → NES at line 2 again
        const cache = new NextEditCache();
        const docId = DocumentId.create('test.ts');

        // Step 1: edit at line 2, cache an edit
        const docBeforeBelowEdit = 'line1\nline2_EDIT\nline3\nline4\nline5';
        const edit = makeEdit(docId, docBeforeBelowEdit, 'suggested fix', { startLine: 1, endLineExclusive: 3 });
        cache.setKthNextEdit(docId, edit);

        // Step 2: user edits below (line 4), document text changes
        const docAfterBelowEdit = 'line1\nline2_EDIT\nline3\nline4_MODIFIED\nline5';

        // Step 3: NES triggered at line 2 again — should MISS cache because document changed below
        const found = cache.lookupNextEdit(docId, { getText: () => docAfterBelowEdit }, { line: 1 });
        assert.strictEqual(found, undefined, 'should miss cache when document changed below');
    });

    test('should miss cache when document changed above the edit position', () => {
        // Simulates: edit at line 4 → NES caches → edit at line 1 above → NES at line 4 again
        const cache = new NextEditCache();
        const docId = DocumentId.create('test.ts');

        const docBefore = 'line1\nline2\nline3\nline4_EDIT\nline5';
        const edit = makeEdit(docId, docBefore, 'suggested fix', { startLine: 3, endLineExclusive: 5 });
        cache.setKthNextEdit(docId, edit);

        const docAfter = 'line1_MODIFIED\nline2\nline3\nline4_EDIT\nline5';

        const found = cache.lookupNextEdit(docId, { getText: () => docAfter }, { line: 3 });
        assert.strictEqual(found, undefined, 'should miss cache when document changed above');
    });

    test('should HIT cache when document text is identical (same position)', () => {
        // When user reverts all changes, document text matches cached state — legitimate hit
        const cache = new NextEditCache();
        const docId = DocumentId.create('test.ts');
        const docText = 'line1\nline2\nline3\nline4\nline5';

        const edit = makeEdit(docId, docText, 'suggested fix', { startLine: 1, endLineExclusive: 3 });
        cache.setKthNextEdit(docId, edit);

        const found = cache.lookupNextEdit(docId, { getText: () => docText }, { line: 1 });
        assert.ok(found, 'should hit cache when document text is identical');
        assert.strictEqual(found!.edit, 'suggested fix');
    });
});
