import * as assert from 'assert';
import * as vscode from 'vscode';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NextEditProvider } = require('../../../completions/nes/nextEditProvider');

/**
 * 使用本地扩展真实 _toInlineItems 代码构建 item，返回给 VS Code 验证显示。
 *
 * 模拟用户日志 2026-08-17 23:09 场景：
 * - 文档含 add_test 函数 + main（第 6-7 行是 ad_t/ad_test）
 * - 光标在第 7 行行尾 [7,26]
 * - result.range = [6,0]-[7,26]（跨行替换）
 * - result.edit = 2 行 add_test 文本
 */
suite('NES real _toInlineItems rendering', () => {
    test('本地 _toInlineItems 构建的跨行 item 是否被 VS Code 显示', async function () {
        this.timeout(60000);

        const content = [
            'int add_test(int a, int b){',
            '    return a + b;',
            '}',
            '',
            'int main(int argc, char const *argv[])',
            '{',
            '    int a = ad_t(10,11);',
            '    int b = ad_test(10,1);',
            '',
            '',
            '    return 0;',
            '}',
        ].join('\n');
        const doc = await vscode.workspace.openTextDocument({ language: 'c', content });
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const line7 = doc.lineAt(7);
        const cursorPos = new vscode.Position(7, line7.text.length); // [7,26]
        editor.selection = new vscode.Selection(cursorPos, cursorPos);
        editor.revealRange(editor.selection);

        // mock DI 服务
        const log: any = {
            info: (...args: any[]) => console.log('[mock-log]', ...args),
            debug: (...args: any[]) => console.log('[mock-log]', ...args),
            error: (...args: any[]) => console.log('[mock-log]', ...args),
        };
        const config: any = {
            enabled: true,
            mimicGhostTextBehavior: false,
            onDidChangeEnabled: () => ({ dispose: () => {} }),
        };
        const instantiation: any = { createInstance: () => ({}) };

        const provider: any = new NextEditProvider(instantiation, config, log);

        // 构造与用户日志一致的 result（assemble 的输出）
        const result = {
            range: new vscode.Range(6, 0, 7, line7.text.length),
            edit: '    int a = add_test(10,11);\n    int b = add_test(10,1);',
            fullEditText: '    int a = add_test(10,11);\n    int b = add_test(10,1);',
            cursorAfterEdit: new vscode.Position(7, 27),
        };

        const list = provider._toInlineItems(result, doc, cursorPos, 'real-test-1');
        assert.ok(list && list.items.length > 0, '_toInlineItems 应返回 1 个 item');
        const item: any = list.items[0];
        console.log(`[test] item: isInlineEdit=${item.isInlineEdit}, isInlineCompletion=${item.isInlineCompletion}, range=${item.range}`);
        assert.strictEqual(item.isInlineEdit, true, '跨行编辑应降级为 isInlineEdit');

        // 把本地构建的 list 原样返回给 VS Code
        let shown = false;
        let shownInfo: any = null;
        const wrappingProvider: any = {
            provideInlineCompletionItems() {
                return list;
            },
            handleDidShowCompletionItem(shownItem: any) {
                shown = true;
                shownInfo = {
                    isInlineEdit: shownItem.isInlineEdit,
                    range: shownItem.range
                        ? `${shownItem.range.start.line}:${shownItem.range.start.character} - ${shownItem.range.end.line}:${shownItem.range.end.character}`
                        : 'none',
                };
            },
        };
        const disp = vscode.languages.registerInlineCompletionItemProvider(
            { scheme: 'untitled', language: 'c' },
            wrappingProvider,
        );

        try {
            await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
            await new Promise(r => setTimeout(r, 400));
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
            await new Promise(r => setTimeout(r, 4000));

            console.log(`[test] 本地 _toInlineItems item shown=${shown}, info=${JSON.stringify(shownInfo)}`);
            assert.ok(shown, '本地 _toInlineItems 构建的 item 未被 VS Code 显示');
        } finally {
            disp.dispose();
        }
    });
});
