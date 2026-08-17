import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * 决定性实验：VS Code 1.133 对各类 inline completion item 的渲染行为。
 *
 * 模拟本地 NES 多行编辑场景（日志 2026-08-17 23:09）：
 * - 编辑 range 跨 2 行
 * - insertText 为 2 行新文本
 * - isInlineEdit = true（无法作为 ghost text 时的回退）
 *
 * 对照组：
 * A. 普通单行 ghost text（无 isInlineEdit）——验证触发机制
 * B. 单行 isInlineEdit item —— 验证 isInlineEdit 传递
 * C. 跨行 isInlineEdit item —— 待验证的目标
 *
 * 通过 handleDidShowCompletionItem 回调验证 VS Code 是否真正显示了 item。
 */
suite('NES inline edit rendering', () => {
    async function setupEditor(content: string, cursorLine: number): Promise<vscode.TextEditor> {
        const doc = await vscode.workspace.openTextDocument({
            language: 'c',
            content,
        });
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const line = doc.lineAt(cursorLine);
        const cursorPos = new vscode.Position(cursorLine, line.text.length);
        editor.selection = new vscode.Selection(cursorPos, cursorPos);
        editor.revealRange(editor.selection);
        return editor;
    }

    async function runExperiment(
        item: any,
        label: string,
    ): Promise<{ providerCalled: boolean; shown: boolean; shownItemInfo: any }> {
        let providerCalled = false;
        let shown = false;
        let shownItemInfo: any = null;

        const provider: any = {
            provideInlineCompletionItems() {
                providerCalled = true;
                return { items: [item] };
            },
            handleDidShowCompletionItem(shownItem: any) {
                shown = true;
                shownItemInfo = {
                    isInlineEdit: shownItem.isInlineEdit,
                    range: shownItem.range
                        ? `${shownItem.range.start.line}:${shownItem.range.start.character} - ${shownItem.range.end.line}:${shownItem.range.end.character}`
                        : 'none',
                    insertText:
                        typeof shownItem.insertText === 'string'
                            ? shownItem.insertText.replace(/\n/g, '\\n').substring(0, 80)
                            : 'non-string',
                };
            },
        };
        const disp = vscode.languages.registerInlineCompletionItemProvider(
            { scheme: 'untitled', language: 'c' },
            provider,
        );

        try {
            // 先隐藏任何已有 suggestion
            await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
            await new Promise(r => setTimeout(r, 400));

            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
            await new Promise(r => setTimeout(r, 3500));

            console.log(`[test] ${label}: providerCalled=${providerCalled}, shown=${shown}`);
            if (shownItemInfo) {
                console.log(`[test] ${label} shown item: ${JSON.stringify(shownItemInfo)}`);
            }
            return { providerCalled, shown, shownItemInfo };
        } finally {
            disp.dispose();
        }
    }

    test('A: 普通单行 ghost text（无 isInlineEdit）', async function () {
        this.timeout(60000);
        await setupEditor(['int main() {', '    int a = ad_t(10,11);', '    int b = ad_test(10,1);', '}', ''].join('\n'), 1);
        const result = await runExperiment(
            {
                insertText: 'add_test',
                range: new vscode.Range(1, 16, 1, 19),
            },
            'A-ghost-single-line',
        );
        assert.ok(result.providerCalled, 'provider 未被调用');
        assert.ok(result.shown, '普通单行 ghost text 未显示（触发机制有问题）');
    });

    test('B: 单行 isInlineEdit item', async function () {
        this.timeout(60000);
        await setupEditor(['int main() {', '    int a = ad_t(10,11);', '    int b = ad_test(10,1);', '}', ''].join('\n'), 1);
        const result = await runExperiment(
            {
                insertText: 'add_test',
                range: new vscode.Range(1, 16, 1, 19),
                isInlineEdit: true,
                isInlineCompletion: false,
                showInlineEditMenu: true,
                supportsRename: false,
                correlationId: 'diag-single-line',
            },
            'B-isInlineEdit-single-line',
        );
        assert.ok(result.providerCalled, 'provider 未被调用');
        console.log(`[test] B 单行 isInlineEdit shown=${result.shown}`);
    });

    test('C: 跨行 isInlineEdit item（本地 NES 多行编辑场景）', async function () {
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
        const editor = await setupEditor(content, 7);
        const line7Len = editor.document.lineAt(7).text.length;

        // 完整复刻本地 _toInlineItems 构建的 item（含所有额外字段）
        const result: any = {
            range: new vscode.Range(6, 0, 7, line7Len),
            edit: '    int a = add_test(10,11);\n    int b = add_test(10,1);',
            fullEditText: '    int a = add_test(10,11);\n    int b = add_test(10,1);',
            cursorAfterEdit: new vscode.Position(7, 27),
        };
        const info: any = {
            suggestion: result,
            documentId: 'test-doc',
            document: editor.document,
            requestUuid: 'diag-cross-line',
            source: 'provider',
        };

        const item: any = {
            insertText: result.edit,
            range: result.range,
            isInlineEdit: true,
            isInlineCompletion: false,
            showInlineEditMenu: true,
            showInlinedDiff: true,
            shouldBeInlineEdit: true,
            info,
            action: undefined,
            supportsRename: false,
            correlationId: 'diag-cross-line',
        };

        const exp = await runExperiment(item, 'C-local-item-full-fields');
        assert.ok(exp.providerCalled, 'provider 未被调用');
        console.log(`[test] C 完整本地 item shown=${exp.shown}`);
        if (!exp.shown) {
            // 再试去掉 info 字段，定位是否为 info 导致
            delete item.info;
            const exp2 = await runExperiment(item, 'C-local-item-no-info');
            console.log(`[test] C 去掉 info 后 shown=${exp2.shown}`);
        }
    });

    test('C2: 跨行 isInlineEdit item（仅 VS Code 标准字段）', async function () {
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
        const editor = await setupEditor(content, 7);
        const line7Len = editor.document.lineAt(7).text.length;

        const result = await runExperiment(
            {
                insertText: '    int a = add_test(10,11);\n    int b = add_test(10,1);',
                range: new vscode.Range(6, 0, 7, line7Len),
                isInlineEdit: true,
                isInlineCompletion: false,
                showInlineEditMenu: true,
                supportsRename: false,
                correlationId: 'diag-cross-line',
            },
            'C2-standard-fields',
        );
        assert.ok(result.providerCalled, 'provider 未被调用');
        console.log(`[test] C2 标准字段跨行 isInlineEdit shown=${result.shown}`);
    });

    test('D: editor.inlineSuggest.edits.enabled=false 时 isInlineEdit 是否被过滤', async function () {
        this.timeout(60000);
        await setupEditor(['int main() {', '    int a = ad_t(10,11);', '    int b = ad_test(10,1);', '}', ''].join('\n'), 1);

        // 记录当前值并在测试后恢复
        const cfg = vscode.workspace.getConfiguration('editor.inlineSuggest');
        const original = cfg.get<boolean>('edits.enabled');
        console.log(`[test] D: original editor.inlineSuggest.edits.enabled = ${original}`);
        await cfg.update('edits.enabled', false, vscode.ConfigurationTarget.Global);
        await new Promise(r => setTimeout(r, 500));

        try {
            const result = await runExperiment(
                {
                    insertText: 'add_test',
                    range: new vscode.Range(1, 16, 1, 19),
                    isInlineEdit: true,
                    isInlineCompletion: false,
                    showInlineEditMenu: true,
                    supportsRename: false,
                    correlationId: 'diag-single-line',
                },
                'D-edits-disabled',
            );
            console.log(`[test] D: edits.enabled=false 时单行 isInlineEdit shown=${result.shown}`);
        } finally {
            await cfg.update('edits.enabled', original, vscode.ConfigurationTarget.Global);
        }
    });
});
