import * as assert from 'assert';
import * as vscode from 'vscode';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NextEditProvider } = require('../../../completions/nes/nextEditProvider');

/**
 * 模拟用户环境的多 provider 并行 + 真实输入触发。
 *
 * 用户环境：GHOST provider（disabled→undefined）+ NES provider（跨行 item）
 * + 官方 Copilot provider。验证多 provider 和真实输入是否影响跨行 item 显示。
 */
suite('NES multi-provider & real typing', () => {
    const CONTENT = [
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

    function buildLocalItemList(doc: vscode.TextDocument, cursorPos: vscode.Position) {
        const log: any = { info: () => {}, debug: () => {}, error: () => {} };
        const config: any = {
            enabled: true,
            mimicGhostTextBehavior: false,
            onDidChangeEnabled: () => ({ dispose: () => {} }),
        };
        const instantiation: any = { createInstance: () => ({}) };
        const provider: any = new NextEditProvider(instantiation, config, log);
        const line7 = doc.lineAt(7);
        const result = {
            range: new vscode.Range(6, 0, 7, line7.text.length),
            edit: '    int a = add_test(10,11);\n    int b = add_test(10,1);',
            fullEditText: '    int a = add_test(10,11);\n    int b = add_test(10,1);',
            cursorAfterEdit: new vscode.Position(7, 27),
        };
        return provider._toInlineItems(result, doc, cursorPos, 'multi-provider-test');
    }

    test('E1: GHOST(undefined) + NES(跨行 item) 双 provider 并行', async function () {
        this.timeout(60000);
        const doc = await vscode.workspace.openTextDocument({ language: 'c', content: CONTENT });
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const cursorPos = new vscode.Position(7, doc.lineAt(7).text.length);
        editor.selection = new vscode.Selection(cursorPos, cursorPos);
        editor.revealRange(editor.selection);

        // GHOST-like provider（disabled → undefined）
        const ghostProvider: any = {
            provideInlineCompletionItems() {
                return undefined;
            },
        };
        // NES provider（返回本地构建的跨行 item）
        const list = buildLocalItemList(doc, cursorPos);
        let shown = false;
        const nesProvider: any = {
            provideInlineCompletionItems() {
                return list;
            },
            handleDidShowCompletionItem() {
                shown = true;
            },
        };

        const d1 = vscode.languages.registerInlineCompletionItemProvider({ scheme: 'untitled', language: 'c' }, ghostProvider);
        const d2 = vscode.languages.registerInlineCompletionItemProvider({ scheme: 'untitled', language: 'c' }, nesProvider);

        try {
            await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
            await new Promise(r => setTimeout(r, 400));
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
            await new Promise(r => setTimeout(r, 4000));
            console.log(`[test] E1 双 provider shown=${shown}`);
            assert.ok(shown, '双 provider 并行时跨行 item 未显示');
        } finally {
            d1.dispose();
            d2.dispose();
        }
    });

    test('E2: 真实输入触发（模拟用户打字）', async function () {
        this.timeout(60000);
        const doc = await vscode.workspace.openTextDocument({ language: 'c', content: CONTENT });
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const cursorPos = new vscode.Position(7, doc.lineAt(7).text.length);
        editor.selection = new vscode.Selection(cursorPos, cursorPos);
        editor.revealRange(editor.selection);

        // 注册 NES provider：动态根据当前文档构建跨行 item
        let providerCallCount = 0;
        let shown = false;
        const nesProvider: any = {
            provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                providerCallCount++;
                const line = document.lineAt(position.line);
                const range = new vscode.Range(6, 0, position.line, line.text.length);
                const item: any = {
                    insertText: '    int a = add_test(10,11);\n    int b = add_test(10,1);',
                    range,
                    isInlineEdit: true,
                    isInlineCompletion: false,
                    showInlineEditMenu: true,
                    supportsRename: false,
                    correlationId: 'e2-real-typing',
                };
                return { items: [item] };
            },
            handleDidShowCompletionItem() {
                shown = true;
            },
        };
        const d2 = vscode.languages.registerInlineCompletionItemProvider({ scheme: 'untitled', language: 'c' }, nesProvider);

        try {
            // 模拟用户真实输入：在光标处插入字符（触发文本变更 → inline completion 自动触发）
            await editor.edit(eb => eb.insert(cursorPos, 'x'));
            // 等待 inline completion 触发并渲染
            await new Promise(r => setTimeout(r, 5000));

            console.log(`[test] E2 真实输入触发: providerCallCount=${providerCallCount}, shown=${shown}`);
            assert.ok(providerCallCount > 0, '真实输入未触发 provider');
            assert.ok(shown, '真实输入触发的跨行 item 未显示');
        } finally {
            d2.dispose();
        }
    });
});
