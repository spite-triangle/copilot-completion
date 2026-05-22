import * as vscode from 'vscode';
import { createServiceIdentifier } from '../di/services';
import { ConfigKeys } from './configKeys';

export type NesSupportedEndpoint = 'chat/completions' | 'responses' | 'messages';

export interface NesCapabilities {
    limits: {
        max_output_tokens: number;
        max_context_window_tokens: number;
    };
    supports: {
        thinking: boolean;
        reasoning_effort: string[];
    };
}

export const INesConfigProvider = createServiceIdentifier<INesConfigProvider>('INesConfigProvider');

export interface INesConfigProvider {
    readonly _serviceBrand: undefined;
    get enabled(): boolean;
    set enabled(value: boolean);
    get baseUrl(): string;
    get apiKey(): string;
    get model(): string;
    get supportedEndpoint(): NesSupportedEndpoint;
    get capabilities(): NesCapabilities;
    get maxOutputTokens(): number;
    get suffixOverlapThreshold(): number;
    get suffixOverlapType(): 'low' | 'high';
    get presencePenalty(): number;
    get frequencyPenalty(): number;
    get stream(): boolean;
    get nextCursorPredictionEnabled(): boolean;
    set nextCursorPredictionEnabled(value: boolean);
    get mimicGhostTextBehavior(): boolean;
    onDidChangeEnabled(listener: () => void): vscode.Disposable;
}

export class VSCodeNesConfigProvider implements INesConfigProvider {
    readonly _serviceBrand: undefined;

    private readonly _onDidChangeEnabled = new vscode.EventEmitter<void>();
    private readonly _enabledKey = 'nes.enabled';
    private readonly _ncpKey = 'nes.nextCursorPredictionEnabled';
    private readonly _cache = new Map<string, unknown>();

    constructor(private readonly _context: vscode.ExtensionContext) {
        _context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('cc-completion.nes')) {
                    this._cache.clear();
                }
            }),
        );
    }

    private _cached<T>(key: string, defaultValue: T): T {
        if (this._cache.has(key)) {
            return this._cache.get(key) as T;
        }
        const value = vscode.workspace.getConfiguration().get<T>(key, defaultValue);
        this._cache.set(key, value);
        return value;
    }

    get enabled(): boolean {
        return this._context.workspaceState.get<boolean>(this._enabledKey, true);
    }

    set enabled(value: boolean) {
        this._context.workspaceState.update(this._enabledKey, value);
        if (!value) {
            // Disable cursor prediction when NES is turned off
            this._context.workspaceState.update(this._ncpKey, false);
        }
        this._onDidChangeEnabled.fire();
    }

    get nextCursorPredictionEnabled(): boolean {
        return this._context.workspaceState.get<boolean>(this._ncpKey, false);
    }

    set nextCursorPredictionEnabled(value: boolean) {
        this._context.workspaceState.update(this._ncpKey, value);
        this._onDidChangeEnabled.fire();
    }

    get baseUrl(): string {
        return this._cached<string>(ConfigKeys.Nes.baseUrl, '');
    }

    get apiKey(): string {
        return this._cached<string>(ConfigKeys.Nes.apiKey, '');
    }

    get model(): string {
        return this._cached<string>(ConfigKeys.Nes.model, 'gpt-4o');
    }

    get supportedEndpoint(): NesSupportedEndpoint {
        return this._cached<NesSupportedEndpoint>(ConfigKeys.Nes.supportedEndpoint, 'chat/completions');
    }

    get capabilities(): NesCapabilities {
        const key = 'nes.capabilities';
        if (this._cache.has(key)) {
            return this._cache.get(key) as NesCapabilities;
        }
        const value: NesCapabilities = {
            limits: {
                max_output_tokens: this.maxOutputTokens,
                max_context_window_tokens: vscode.workspace.getConfiguration()
                    .get<number>(ConfigKeys.Nes.maxContextWindowTokens, 128000),
            },
            supports: {
                thinking: vscode.workspace.getConfiguration()
                    .get<boolean>(ConfigKeys.Nes.thinking, false),
                reasoning_effort: vscode.workspace.getConfiguration()
                    .get<string[]>(ConfigKeys.Nes.reasoningEffort, []),
            },
        };
        this._cache.set(key, value);
        return value;
    }

    get maxOutputTokens(): number {
        return this._cached<number>(ConfigKeys.Nes.maxOutputTokens, 8192);
    }

    get suffixOverlapThreshold(): number {
        return this._cached<number>(ConfigKeys.Nes.suffixOverlapThreshold, 0.85);
    }

    get suffixOverlapType(): 'low' | 'high' {
        return this._cached<'low' | 'high'>(ConfigKeys.Nes.suffixOverlapType, 'high');
    }

    get presencePenalty(): number {
        return this._cached<number>(ConfigKeys.Nes.presencePenalty, 1);
    }

    get frequencyPenalty(): number {
        return this._cached<number>(ConfigKeys.Nes.frequencyPenalty, 0.2);
    }

    get stream(): boolean {
        return this._cached<boolean>(ConfigKeys.Nes.stream, true);
    }

    get mimicGhostTextBehavior(): boolean {
        return this._cached<boolean>(ConfigKeys.Nes.mimicGhostTextBehavior, false);
    }

    onDidChangeEnabled(listener: () => void): vscode.Disposable {
        return this._onDidChangeEnabled.event(listener);
    }
}
