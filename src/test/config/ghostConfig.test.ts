import * as assert from 'assert';
import * as vscode from 'vscode';
import { VSCodeGhostConfigProvider } from '../../config/ghostConfig';

function mockContext(): vscode.ExtensionContext {
    const state = new Map<string, unknown>();
    return {
        workspaceState: {
            get: <T>(key: string, defaultValue: T) => (state.has(key) ? state.get(key) : defaultValue) as T,
            update: (key: string, value: unknown) => { state.set(key, value); return Promise.resolve(); },
        },
        subscriptions: [] as vscode.Disposable[],
    } as unknown as vscode.ExtensionContext;
}

suite('VSCodeGhostConfigProvider', () => {

    test('returns default model when no config set', () => {
        const provider = new VSCodeGhostConfigProvider(mockContext());
        assert.strictEqual(provider.model, 'gpt-4o');
    });

    test('returns updated value after config change invalidates cache', async () => {
        const provider = new VSCodeGhostConfigProvider(mockContext());
        const config = vscode.workspace.getConfiguration('cc-completion.ghost');

        assert.strictEqual(provider.model, 'gpt-4o');

        await config.update('model', 'gpt-4.1', vscode.ConfigurationTarget.Global);
        assert.strictEqual(provider.model, 'gpt-4.1');

        await config.update('model', undefined, vscode.ConfigurationTarget.Global);
    });

    test('returns default promptTemplate when no config set', () => {
        const provider = new VSCodeGhostConfigProvider(mockContext());
        assert.strictEqual(
            provider.promptTemplate,
            '<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>',
        );
    });

    test('returns default endpoint when no config set', () => {
        const provider = new VSCodeGhostConfigProvider(mockContext());
        assert.strictEqual(provider.endpoint, 'completions');
    });

    test('returns updated endpoint after config change invalidates cache', async () => {
        const provider = new VSCodeGhostConfigProvider(mockContext());
        const config = vscode.workspace.getConfiguration('cc-completion.ghost');

        assert.strictEqual(provider.endpoint, 'completions');

        await config.update('endpoint', 'fim/completions', vscode.ConfigurationTarget.Global);
        assert.strictEqual(provider.endpoint, 'fim/completions');

        await config.update('endpoint', undefined, vscode.ConfigurationTarget.Global);
    });

    test('enabled is independent of settings.json cache', () => {
        const provider = new VSCodeGhostConfigProvider(mockContext());

        const initialEnabled = provider.enabled;
        provider.enabled = false;
        assert.strictEqual(provider.enabled, false);

        // model still works (separate storage)
        assert.strictEqual(provider.model, 'gpt-4o');

        provider.enabled = initialEnabled;
    });
});
