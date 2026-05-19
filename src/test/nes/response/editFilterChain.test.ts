import * as assert from 'assert';
import {
    EmptyEditFilter,
    NoopEditFilter,
    WhitespaceOnlyFilter,
    CommentOnlyFilter,
    EditFilterChain,
} from '../../../completions/nes/response/editFilterChain';

suite('EmptyEditFilter', () => {
    test('rejects empty edit', () => {
        const filter = new EmptyEditFilter();
        assert.strictEqual(filter.shouldReject([''], ['a']), true);
    });

    test('rejects whitespace-only edit', () => {
        const filter = new EmptyEditFilter();
        assert.strictEqual(filter.shouldReject(['  ', '\t'], ['a']), true);
    });

    test('accepts non-empty edit', () => {
        const filter = new EmptyEditFilter();
        assert.strictEqual(filter.shouldReject(['code'], ['a']), false);
    });
});

suite('NoopEditFilter', () => {
    test('rejects identical edit', () => {
        const filter = new NoopEditFilter();
        assert.strictEqual(filter.shouldReject(['a', 'b'], ['a', 'b']), true);
    });

    test('accepts different content', () => {
        const filter = new NoopEditFilter();
        assert.strictEqual(filter.shouldReject(['a', 'changed'], ['a', 'b']), false);
    });

    test('accepts different length', () => {
        const filter = new NoopEditFilter();
        assert.strictEqual(filter.shouldReject(['a'], ['a', 'b']), false);
    });
});

suite('WhitespaceOnlyFilter', () => {
    test('rejects whitespace-only change', () => {
        const filter = new WhitespaceOnlyFilter();
        assert.strictEqual(
            filter.shouldReject(['  hello  '], ['hello']),
            true,
        );
    });

    test('accepts actual content change', () => {
        const filter = new WhitespaceOnlyFilter();
        assert.strictEqual(
            filter.shouldReject(['new code'], ['old code']),
            false,
        );
    });
});

suite('CommentOnlyFilter', () => {
    test('rejects comment-only edit', () => {
        const filter = new CommentOnlyFilter();
        assert.strictEqual(
            filter.shouldReject(['// comment', '# also comment', '/* block */'], ['old']),
            true,
        );
    });

    test('accepts edit with non-comment lines', () => {
        const filter = new CommentOnlyFilter();
        assert.strictEqual(
            filter.shouldReject(['realCode();', '// comment'], ['old']),
            false,
        );
    });
});

suite('EditFilterChain', () => {
    test('returns edit text when all filters pass', () => {
        const chain = new EditFilterChain();
        const result = chain.apply(['new code'], ['old code']);
        assert.strictEqual(result, 'new code');
    });

    test('returns undefined when empty edit', () => {
        const chain = new EditFilterChain();
        const result = chain.apply(['  '], ['old code']);
        assert.strictEqual(result, undefined);
    });

    test('returns undefined on noop edit', () => {
        const chain = new EditFilterChain();
        const result = chain.apply(['same'], ['same']);
        assert.strictEqual(result, undefined);
    });

    test('returns undefined on whitespace-only change', () => {
        const chain = new EditFilterChain();
        const result = chain.apply(['  hello  '], ['hello']);
        assert.strictEqual(result, undefined);
    });

    test('returns undefined on comment-only change', () => {
        const chain = new EditFilterChain();
        const result = chain.apply(['// todo'], ['old']);
        assert.strictEqual(result, undefined);
    });

    test('custom filters can be injected', () => {
        let called = false;
        const customFilter = {
            name: 'test',
            shouldReject: () => { called = true; return false; },
        };
        const chain = new EditFilterChain([customFilter]);
        chain.apply(['code'], ['old']);
        assert.strictEqual(called, true);
    });
});
