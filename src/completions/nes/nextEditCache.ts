import { createServiceIdentifier } from '../../di/services';

export const INextEditCache = createServiceIdentifier<INextEditCache>('INextEditCache');

export interface CachedEdit {
    docId: string;
    docContentHash: string;
    editWindow: { startLine: number; endLineExclusive: number };
    edit: string;
    cacheTime: number;
}

export interface CachedOrRebasedEdit extends CachedEdit {
    rebasedEdit?: string;
    isFromSpeculativeRequest?: boolean;
}

export interface INextEditCache {
    readonly _serviceBrand: undefined;
    setKthNextEdit(docId: string, edit: CachedEdit): void;
    lookupNextEdit(docId: string, document: { getText(): string }): CachedOrRebasedEdit | undefined;
    clear(docId: string): void;
    clearAll(): void;
}

export class NextEditCache implements INextEditCache {
    readonly _serviceBrand: undefined;
    private readonly _cache = new Map<string, CachedEdit[]>();
    private readonly _maxPerDoc = 10;

    setKthNextEdit(docId: string, edit: CachedEdit): void {
        const entries = this._cache.get(docId) || [];
        entries.push(edit);
        while (entries.length > this._maxPerDoc) {
            entries.shift();
        }
        this._cache.set(docId, entries);
    }

    lookupNextEdit(docId: string, document: { getText(): string }): CachedOrRebasedEdit | undefined {
        const entries = this._cache.get(docId);
        if (!entries || entries.length === 0) return undefined;

        const docText = document.getText();
        const docHash = this._hash(docText);
        return entries.find(e => e.docContentHash === docHash);
    }

    clear(docId: string): void {
        this._cache.delete(docId);
    }

    clearAll(): void {
        this._cache.clear();
    }

    private _hash(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString(36);
    }
}
