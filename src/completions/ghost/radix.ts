/**
 * A data structure for efficiently finding all values that are indexed by a key
 * that is a prefix of a given key, using a radix trie representation.
 *
 * An overarching goal of the implementation is to minimize storing and handling
 * the full keys since in the case of completions, the keys are the full text of
 * the document before the cursor which can be large.
 */
export class LRURadixTrie<T> {
    /** Singular, empty root node for the trie. */
    private readonly root = new LRURadixNode<T>();

    /** Set of all leaf nodes with values, tracked for evicting LRU values. */
    private readonly leafNodes: Set<LRURadixNode<T>> = new Set();

    constructor(private readonly maxSize: number) { }

    /**
     * Traverses the trie to insert a new value. If an existing exact match is
     * found the value is added to a list of values at that node. Otherwise a
     * new node is created.
     *
     * As a side effect, the least recently used node is evicted if the max size
     * is exceeded.
     */
    set(key: string, value: T): void {
        let { node, remainingKey } = this.findClosestNode(key);
        if (remainingKey.length > 0) {
            for (const [edge, child] of node.children) {
                if (edge.startsWith(remainingKey)) {
                    const commonPrefix = edge.slice(0, remainingKey.length);
                    const intermediate = new LRURadixNode<T>();
                    node.removeChild(edge);
                    node.addChild(commonPrefix, intermediate);
                    intermediate.addChild(edge.slice(commonPrefix.length), child);
                    node = intermediate;
                    remainingKey = remainingKey.slice(commonPrefix.length);
                    break;
                }
            }
            if (remainingKey.length > 0) {
                const newNode = new LRURadixNode<T>();
                node.addChild(remainingKey, newNode);
                node = newNode;
            }
        }
        node.value = value;
        this.leafNodes.add(node);
        if (this.leafNodes.size > this.maxSize) {
            this.evictLeastRecentlyUsed();
        }
    }

    /**
     * Traverses the trie and returns all values whose keys are a prefix of the
     * given key. Returns them in order of longest prefix first.
     */
    findAll(key: string): Array<{ remainingKey: string; value: T }> {
        const results: Array<{ remainingKey: string; value: T }> = [];
        for (const { node, remainingKey } of this.findClosestNode(key).stack) {
            const value = node.value;
            if (value !== undefined) {
                results.push({ remainingKey, value });
            }
        }
        return results;
    }

    /** Removes the value at a given key if any from the trie. */
    delete(key: string): void {
        const { node, remainingKey } = this.findClosestNode(key);
        if (remainingKey.length > 0) { return; }
        this.deleteNode(node);
    }

    private findClosestNode(key: string) {
        let hasNext = true;
        let node: LRURadixNode<T> = this.root;
        const stack: { node: LRURadixNode<T>; remainingKey: string }[] = [{ node, remainingKey: key }];
        while (key.length > 0 && hasNext) {
            hasNext = false;
            for (const [edge, child] of node.children) {
                if (key.startsWith(edge)) {
                    key = key.slice(edge.length);
                    stack.unshift({ node: child, remainingKey: key });
                    node = child;
                    hasNext = true;
                    break;
                }
            }
        }
        return { node, remainingKey: key, stack };
    }

    private deleteNode(node: LRURadixNode<T>): void {
        node.value = undefined;
        this.leafNodes.delete(node);
        if (node.parent === undefined) { return; }
        if (node.childCount > 1) { return; }
        const { node: parent, edge } = node.parent;
        if (node.childCount === 1) {
            const [childEdge, childNode] = Array.from(node.children)[0];
            node.removeChild(childEdge);
            parent.removeChild(edge);
            parent.addChild(edge + childEdge, childNode);
            return;
        }
        parent.removeChild(edge);
        if (parent.parent === undefined) { return; }
        const grandparent = parent.parent;
        if (parent.value === undefined && parent.childCount === 1) {
            const [childEdge, childNode] = Array.from(parent.children)[0];
            const newEdge = grandparent.edge + childEdge;
            parent.removeChild(childEdge);
            grandparent.node.removeChild(grandparent.edge);
            grandparent.node.addChild(newEdge, childNode);
        }
    }

    private evictLeastRecentlyUsed(): void {
        const node = this.findLeastRecentlyUsed();
        if (node) { this.deleteNode(node); }
    }

    private findLeastRecentlyUsed(): LRURadixNode<T> | undefined {
        let least: LRURadixNode<T> | undefined;
        for (const node of this.leafNodes) {
            if (least === undefined || node.touched < least.touched) {
                least = node;
            }
        }
        return least;
    }
}

class LRURadixNode<T> {
    private readonly _children: Map<string, LRURadixNode<T>> = new Map();
    private _touched = performance.now();
    private _value: T | undefined;

    parent: { node: LRURadixNode<T>; edge: string } | undefined;

    get children() {
        return this._children.entries();
    }

    get childCount() {
        return this._children.size;
    }

    addChild(edge: string, child: LRURadixNode<T>): void {
        this._children.set(edge, child);
        child.parent = { node: this, edge };
    }

    removeChild(edge: string): void {
        const child = this._children.get(edge);
        if (child) { child.parent = undefined; }
        this._children.delete(edge);
    }

    get value(): T | undefined {
        this.touch();
        return this._value;
    }

    set value(value: T | undefined) {
        this.touch();
        this._value = value;
    }

    get touched(): number {
        return this._touched;
    }

    private touch(): void {
        this._touched = performance.now();
    }
}
