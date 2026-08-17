import * as assert from 'assert';
import { ResponseDiffer } from '../../../completions/nes/response/responseDiffer';

suite('ResponseDiffer', () => {
    const differ = new ResponseDiffer();

    suite('pure replacement convergence (regression: log scenario)', () => {
        test('single-line fix re-emitted with trailing lines converges to a single-line edit', () => {
            // 用户日志场景：光标在 `    retn 0;` 行，模型修复为 `    return 0;` 并重发尾部 `}`。
            // 官方 ResponseProcessor 在"divergence 与 match 之间行数恰好对应"时，
            // 即使向后逐行匹配失败也以锚点行收敛 → 单行编辑。
            const originalLines = [
                'int main(int argc, char const *argv[])',
                '{',
                '    retn 0;',
                '}',
                '',
                '',
                '',
                '',
            ];
            const responseLines = [
                'int main(int argc, char const *argv[])',
                '{',
                '    return 0;',
                '}',
            ];

            const edits = differ.compute(originalLines, responseLines);

            // 第一个编辑必须是单行替换（修复 retn→return），而不是把 `}` 和尾部空行
            // 一并吞入的多行替换。
            assert.strictEqual(edits.length, 2);
            const first = edits[0];
            assert.strictEqual(first.lineRange.startLineNumber, 3);
            assert.strictEqual(first.lineRange.endLineNumberExclusive, 4);
            assert.deepStrictEqual(first.newLines, ['    return 0;']);
        });

        test('single-line fix at end of response (no following lines to help converge)', () => {
            const originalLines = ['a', 'b', 'c', 'd'];
            const responseLines = ['a', 'b', 'x', 'd'];

            const edits = differ.compute(originalLines, responseLines);

            assert.strictEqual(edits.length, 1);
            const edit = edits[0];
            assert.strictEqual(edit.lineRange.startLineNumber, 3);
            assert.strictEqual(edit.lineRange.endLineNumberExclusive, 4);
            assert.deepStrictEqual(edit.newLines, ['x']);
        });
    });

    suite('in stream middle diffs', () => {
        test('1 line diff', () => {
            const originalLines = ['a', 'b', 'c', 'd', 'e'];
            const responseLines = ['a', 'b', 'x', 'd', 'e'];

            const edits = differ.compute(originalLines, responseLines);

            assert.strictEqual(edits.length, 1);
            const edit = edits[0];
            assert.strictEqual(edit.lineRange.startLineNumber, 3);
            assert.strictEqual(edit.lineRange.endLineNumberExclusive, 4);
            assert.deepStrictEqual(edit.newLines, ['x']);
        });

        test('2 consecutive lines diff', () => {
            const originalLines = ['a', 'b', 'c', 'd', 'e'];
            const responseLines = ['a', 'b', 'x', 'y', 'd', 'e'];

            const edits = differ.compute(originalLines, responseLines);

            assert.strictEqual(edits.length, 1);
            const edit = edits[0];
            assert.strictEqual(edit.lineRange.startLineNumber, 3);
            assert.strictEqual(edit.lineRange.endLineNumberExclusive, 4);
            assert.deepStrictEqual(edit.newLines, ['x', 'y']);
        });
    });

    suite('exhaustion fallbacks', () => {
        test('response shorter than original — remaining original lines deleted', () => {
            const originalLines = ['a', 'b', 'c', 'd'];
            const responseLines = ['a', 'b', 'c'];

            const edits = differ.compute(originalLines, responseLines);

            assert.strictEqual(edits.length, 1);
            const edit = edits[0];
            assert.strictEqual(edit.lineRange.startLineNumber, 4);
            assert.strictEqual(edit.lineRange.endLineNumberExclusive, 5);
            assert.deepStrictEqual(edit.newLines, []);
        });

        test('pure insertion at end', () => {
            const originalLines = ['a', 'b'];
            const responseLines = ['a', 'b', 'c', 'd'];

            const edits = differ.compute(originalLines, responseLines);

            assert.strictEqual(edits.length, 1);
            const edit = edits[0];
            assert.strictEqual(edit.lineRange.startLineNumber, 3);
            assert.strictEqual(edit.lineRange.endLineNumberExclusive, 3);
            assert.deepStrictEqual(edit.newLines, ['c', 'd']);
        });

        test('no changes → no edits', () => {
            const originalLines = ['a', 'b', 'c'];
            const responseLines = ['a', 'b', 'c'];

            const edits = differ.compute(originalLines, responseLines);

            assert.strictEqual(edits.length, 0);
        });
    });
});
