import * as assert from 'assert';
import * as vscode from 'vscode';
import { VSCodeNesConfigProvider } from '../../config/nesConfig';

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

suite('VSCodeNesConfigProvider', () => {

    test('returns default model when no config set', () => {
        const provider = new VSCodeNesConfigProvider(mockContext());
        assert.strictEqual(provider.model, 'gpt-4o');
    });

    test('returns updated value after config change invalidates cache', async () => {
        const provider = new VSCodeNesConfigProvider(mockContext());
        const config = vscode.workspace.getConfiguration('cc-completion.nes');

        // Prime the cache
        assert.strictEqual(provider.model, 'gpt-4o');

        // Change config — VS Code fires onDidChangeConfiguration internally,
        // which clears the cache
        await config.update('model', 'claude-4', vscode.ConfigurationTarget.Global);

        // Cache was cleared, next read gets new value
        assert.strictEqual(provider.model, 'claude-4');

        // Cleanup
        await config.update('model', undefined, vscode.ConfigurationTarget.Global);
    });

    test('enabled is independent of settings.json cache', () => {
        const provider = new VSCodeNesConfigProvider(mockContext());

        const initialEnabled = provider.enabled;
        provider.enabled = false;
        assert.strictEqual(provider.enabled, false);

        // model still works (separate storage)
        assert.strictEqual(provider.model, 'gpt-4o');

        provider.enabled = initialEnabled;
    });

    test('nextCursorPredictionEnabled uses workspaceState', () => {
        const provider = new VSCodeNesConfigProvider(mockContext());

        assert.strictEqual(provider.nextCursorPredictionEnabled, false);
        provider.nextCursorPredictionEnabled = true;
        assert.strictEqual(provider.nextCursorPredictionEnabled, true);
    });

    test('family defaults to standard', () => {
        const provider = new VSCodeNesConfigProvider(mockContext());
        assert.strictEqual(provider.family, 'standard');
    });
});
