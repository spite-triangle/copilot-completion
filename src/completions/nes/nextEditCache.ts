import { createServiceIdentifier } from '../../di/services';
import { DocumentId } from './stubs/types';

export const INextEditCache = createServiceIdentifier<INextEditCache>('INextEditCache');

export interface CachedEdit {
    docId: DocumentId;
    documentBeforeEdit: string;
    editWindow: { startLine: number; endLineExclusive: number };
    edit: string;
    cacheTime: number;
    /** Set when this edit was returned as an inline (ghost text) suggestion */
    wasRenderedAsInlineSuggestion?: boolean;
}

export interface CachedOrRebasedEdit extends CachedEdit {
    rebasedEdit?: string;
    isFromSpeculativeRequest?: boolean;
}

export interface INextEditCache {
    readonly _serviceBrand: undefined;
    setKthNextEdit(docId: DocumentId, edit: CachedEdit): void;
    /**
     * Look up a cached edit for the given document and cursor position.
     * The position is validated against the cached edit's editWindow
     * to prevent serving edits cached for a different cursor location.
     */
    lookupNextEdit(docId: DocumentId, document: { getText(): string }, position: { line: number }): CachedOrRebasedEdit | undefined;
    clear(docId: DocumentId): void;
    clearAll(): void;
}

export class NextEditCache implements INextEditCache {
    readonly _serviceBrand: undefined;
    private readonly _cache = new Map<string, CachedEdit>();
    private readonly _maxEntries = 50;

    setKthNextEdit(docId: DocumentId, edit: CachedEdit): void {
        const key = this._getKey(docId.uri, edit.documentBeforeEdit);
        const existing = this._cache.get(key);
        if (existing) {
            this._cache.delete(key);
        }
        this._cache.set(key, edit);
        // Enforce max entries: evict first inserted (simple FIFO eviction)
        if (this._cache.size > this._maxEntries) {
            const firstKey = this._cache.keys().next().value;
            if (firstKey !== undefined) {
                this._cache.delete(firstKey);
            }
        }
    }

    lookupNextEdit(docId: DocumentId, document: { getText(): string }, position: { line: number }): CachedOrRebasedEdit | undefined {
        const docText = document.getText();
        const key = this._getKey(docId.uri, docText);
        const cached = this._cache.get(key);
        if (cached) {
            // Validate that the cursor is still within the edit window.
            // Without this check a cached edit from line 5 would be
            // incorrectly served when the user moves to line 100 without
            // changing the document text.
            const { startLine, endLineExclusive } = cached.editWindow;
            if (position.line < startLine || position.line >= endLineExclusive) {
                return undefined;
            }
            return cached;
        }
        return undefined;
    }

    clear(docId: DocumentId): void {
        for (const [key, entry] of this._cache) {
            if (entry.docId === docId) {
                this._cache.delete(key);
            }
        }
    }

    clearAll(): void {
        this._cache.clear();
    }

    private _getKey(docUri: string, content: string): string {
        return JSON.stringify([docUri, content]);
    }
}
