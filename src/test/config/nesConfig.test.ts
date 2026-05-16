import * as assert from 'assert';
import * as vscode from 'vscode';

suite('NesConfigProvider', () => {
    test('should return default values when no config set', () => {
        const config = vscode.workspace.getConfiguration('cc-completion.nes');
        assert.strictEqual(config.get('enabled'), true);
        assert.strictEqual(config.get('model'), 'gpt-4o');
        assert.strictEqual(config.get('supportedEndpoint'), '/chat/completions');
        assert.strictEqual(config.get('capabilities.limits.max_output_tokens'), 4096);
        assert.strictEqual(config.get('suffixOverlapThreshold'), 0.5);
        assert.strictEqual(config.get('suffixOverlapType'), 'low');
        assert.strictEqual(config.get('capabilities.supports.thinking'), false);
    });

    test('should have reasoning_effort as empty array by default', () => {
        const config = vscode.workspace.getConfiguration('cc-completion.nes');
        const efforts = config.get<string[]>('capabilities.supports.reasoning_effort');
        assert.deepStrictEqual(efforts, []);
    });
});
