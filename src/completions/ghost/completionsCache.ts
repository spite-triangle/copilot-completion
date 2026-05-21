import { createServiceIdentifier } from '../../di/services';
import { LRURadixTrie } from './radix';

export const IGhostCompletionsCache = createServiceIdentifier<IGhostCompletionsCache>('IGhostCompletionsCache');

export interface IGhostCompletionsCache {
    readonly _serviceBrand: undefined;
    findAll(prefix: string, suffix: string): CompletionChoice[];
    append(prefix: string, suffix: string, choice: CompletionChoice): void;
    clear(): void;
}

export interface CompletionChoice {
    text: string;
    finishReason: string;
}

interface CacheContent{
    suffix: string;
    choice: CompletionChoice;
};

interface CacheContents {
    content: CacheContent[];
}

/** Caches recent completions by document prefix using a radix trie for prefix-aware matching. */
export class GhostCompletionsCache implements IGhostCompletionsCache {
    readonly _serviceBrand: undefined;

    private cache: LRURadixTrie<CacheContents>;
    private readonly _maxSize: number;

    constructor(maxSize: number = 100) {
        this._maxSize = maxSize;
        this.cache = new LRURadixTrie<CacheContents>(maxSize);
    }

    /** Given a document prefix and suffix, return all of the completions that match. */
    findAll(prefix: string, suffix: string): CompletionChoice[] {
        return this.cache.findAll(prefix).flatMap(({ remainingKey, value }) =>
            value.content
                .filter((c: CacheContent)  =>
                    c.suffix === suffix &&
                    c.choice.text.startsWith(remainingKey) &&
                    c.choice.text.length > remainingKey.length
                )
                .map((c:CacheContent) => ({
                    ...c.choice,
                    text: c.choice.text.slice(remainingKey.length),
                }))
        );
    }

    /** Add cached completions for a given prefix. */
    append(prefix: string, suffix: string, choice: CompletionChoice): void {
        const existing = this.cache.findAll(prefix);
        // Append to an existing array if there is an exact match.
        if (existing.length > 0 && existing[0].remainingKey === '') {
            const content = existing[0].value.content;
            this.cache.set(prefix, { content: [...content, { suffix, choice }] });
        } else {
            // Otherwise, add a new value.
            this.cache.set(prefix, { content: [{ suffix, choice }] });
        }
    }

    clear(): void {
        this.cache = new LRURadixTrie<CacheContents>(this._maxSize);
    }
}
