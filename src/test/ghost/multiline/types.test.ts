import * as assert from 'assert';
import { MultilineContextBuilder } from '../../../completions/ghost/multiline/MultilineContextBuilder';
import { createMockContext } from './helpers';

suite('MultilineContextBuilder', () => {
    test('build assembles full context from raw params', () => {
        const ctx = createMockContext({
            lines: ['a', 'b'],
            cursorLine: 0,
            cursorChar: 1,
            languageId: 'cpp',
            isMiddleOfTheLine: true,
            afterAccept: true,
        });
        assert.strictEqual(ctx.languageId, 'cpp');
        assert.strictEqual(ctx.isMiddleOfTheLine, true);
        assert.strictEqual(ctx.afterAccept, true);
        assert.strictEqual(ctx.position.line, 0);
        assert.strictEqual(ctx.position.character, 1);
    });

    test('builder produces context with all fields', () => {
        const doc = createMockContext({ lines: ['hello'], cursorChar: 5 }).document;
        const builder = new MultilineContextBuilder();
        const ctx = builder.build({
            document: doc,
            position: new (require('vscode').Position)(0, 5),
            prefix: 'hello',
            suffix: '',
            languageId: 'python',
            isMiddleOfTheLine: false,
            afterAccept: false,
        });
        assert.strictEqual(ctx.languageId, 'python');
        assert.strictEqual(ctx.prefix, 'hello');
        assert.strictEqual(ctx.suffix, '');
    });
});
