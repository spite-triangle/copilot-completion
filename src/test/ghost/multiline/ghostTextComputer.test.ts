import * as assert from 'assert';
import { MultilineContextBuilder } from '../../../completions/ghost/multiline/MultilineContextBuilder';
import { DefaultMultilineStrategy } from '../../../completions/ghost/multiline/DefaultMultilineStrategy';

suite('Multiline integration — FIM regression', () => {
    test('C++ FIM: line-end + non-empty suffix → multiline=true (SuffixPresenceDetector)', async () => {
        // SuffixPresenceDetector fires for non-TS/JS/Python languages
        // when cursor is at end of line and suffix has content.
        const strategy = new DefaultMultilineStrategy();
        const builder = new MultilineContextBuilder();

        const doc = {
            lineCount: 20,
            lineAt: (line: number) => ({
                text: [
                    '// language: cpp',
                    '',
                    '#include <iostream>',
                    '',
                    'int add(int a, int b) {',
                    '    return a + b;',
                    '}',
                    '',
                    '// 实现快速排序算法',
                    '',
                    'int main() {',
                    '    // 不然，就是这样',
                    '    // 测试 add(1, 2);',
                    '}',
                ][line] ?? '',
                range: { start: { line }, end: { line, character: 100 } },
                lineNumber: line,
                rangeIncludingLineBreak: null,
                firstNonWhitespaceCharacterIndex: 0,
                isEmptyOrWhitespace: false,
            }),
            offsetAt: () => 0,
            positionAt: () => null,
            getText: () => '',
            uri: { toString: () => 'file:///test.cpp' },
            fileName: '/test.cpp',
            isUntitled: false,
            languageId: 'cpp',
            version: 1,
            isDirty: false,
            isClosed: false,
            save: () => Promise.resolve(true),
            eol: 1,
        } as any;

        const ctx = builder.build({
            document: doc,
            position: new (require('vscode').Position)(8, '// 实现快速排序算法'.length),
            prefix: '// language: cpp\n\n#include <iostream>\n\nint add(int a, int b) {\n    return a + b;\n}\n\n// 实现快速排序算法\n',
            suffix: '\n\nint main() {\n    // 不然，就是这样\n    // 测试 add(1, 2);\n}',
            languageId: 'cpp',
            isMiddleOfTheLine: false,
            afterAccept: false,
        });

        const result = await strategy.determineMultiline(ctx);
        // SuffixPresenceDetector: !isMiddleOfTheLine && suffix.trim() !== '' → multiline
        assert.strictEqual(result, true);
    });

    test('builder correctly handles FIM-like suffix with cursor at end of line', () => {
        const builder = new MultilineContextBuilder();
        const doc = {
            lineCount: 3,
            lineAt: (line: number) => ({
                text: ['int add() {', '    return 0;', '}'][line] ?? '',
                range: { start: { line, character: 0 }, end: { line, character: 100 } },
                lineNumber: line,
                rangeIncludingLineBreak: null,
                firstNonWhitespaceCharacterIndex: 0,
                isEmptyOrWhitespace: false,
            }),
            offsetAt: () => 0,
            positionAt: () => null,
            getText: () => 'int add() {\n    return 0;\n}',
            uri: { toString: () => 'file:///test.cpp' },
            fileName: '/test.cpp',
            isUntitled: false,
            languageId: 'cpp',
            version: 1,
            isDirty: false,
            isClosed: false,
            save: () => Promise.resolve(true),
            eol: 1,
        } as any;

        const ctx = builder.build({
            document: doc,
            position: new (require('vscode').Position)(0, 'int add() {'.length),
            prefix: 'int add() {\n',
            suffix: '\n    return 0;\n}',
            languageId: 'cpp',
            isMiddleOfTheLine: false,
            afterAccept: false,
        });

        assert.strictEqual(ctx.isMiddleOfTheLine, false);
        assert.strictEqual(ctx.afterAccept, false);
        assert.strictEqual(ctx.suffix.includes('return 0;'), true);
    });
});
