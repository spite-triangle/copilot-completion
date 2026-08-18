import * as vscode from 'vscode';
import { createServiceIdentifier } from '../di/services';
import { ConfigKeys } from './configKeys';

export type GhostEndpoint = 'completions' | 'fim/completions';

export interface GhostCapabilities {
    limits: {
        max_output_tokens: number;
        max_context_window_tokens: number;
    };
}

export const IGhostConfigProvider = createServiceIdentifier<IGhostConfigProvider>('IGhostConfigProvider');

export interface IGhostConfigProvider {
    readonly _serviceBrand: undefined;
    get enabled(): boolean;
    set enabled(value: boolean);
    get baseUrl(): string;
    get apiKey(): string;
    get model(): string;
    get endpoint(): GhostEndpoint;
    get stops(): string[];
    get promptTemplate(): string;
    get capabilities(): GhostCapabilities;
    get maxOutputTokens(): number;
    get delay(): number;
    get suffixOverlapThreshold(): number;
    get suffixOverlapType(): 'low' | 'high';
    get presencePenalty(): number;
    get frequencyPenalty(): number;
    get stream(): boolean;
    onDidChangeEnabled(listener: () => void): vscode.Disposable;
}

export class VSCodeGhostConfigProvider implements IGhostConfigProvider {
    readonly _serviceBrand: undefined;

    private readonly _onDidChangeEnabled = new vscode.EventEmitter<void>();
    private readonly _stateKey = 'ghost.enabled';
    private readonly _cache = new Map<string, unknown>();

    constructor(private readonly _context: vscode.ExtensionContext) {
        _context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('cc-completion.ghost')) {
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

    // --- workspaceState (no cache) ---

    get enabled(): boolean {
        return this._context.workspaceState.get<boolean>(this._stateKey, true);
    }

    set enabled(value: boolean) {
        this._context.workspaceState.update(this._stateKey, value);
        this._onDidChangeEnabled.fire();
    }

    // --- settings.json (cached) ---

    get baseUrl(): string {
        return this._cached<string>(ConfigKeys.Ghost.baseUrl, '');
    }

    get apiKey(): string {
        return this._cached<string>(ConfigKeys.Ghost.apiKey, '');
    }

    get model(): string {
        return this._cached<string>(ConfigKeys.Ghost.model, 'gpt-4o');
    }

    get endpoint(): GhostEndpoint {
        return this._cached<GhostEndpoint>(ConfigKeys.Ghost.endpoint, 'completions');
    }

    get stops(): string[] {
        return this._cached<string[]>(ConfigKeys.Ghost.stops, []);
    }

    get promptTemplate(): string {
        return this._cached<string>(
            ConfigKeys.Ghost.promptTemplate,
            '<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>',
        );
    }

    get capabilities(): GhostCapabilities {
        const key = 'ghost.capabilities';
        if (this._cache.has(key)) {
            return this._cache.get(key) as GhostCapabilities;
        }
        const value: GhostCapabilities = {
            limits: {
                max_output_tokens: this.maxOutputTokens,
                max_context_window_tokens: this._cached<number>(ConfigKeys.Ghost.maxContextWindowTokens, 128000),
            },
        };
        this._cache.set(key, value);
        return value;
    }

    get maxOutputTokens(): number {
        return this._cached<number>(ConfigKeys.Ghost.maxOutputTokens, 256);
    }

    get delay(): number {
        return this._cached<number>(ConfigKeys.Ghost.delay, 200);
    }

    get suffixOverlapThreshold(): number {
        return this._cached<number>(ConfigKeys.Ghost.suffixOverlapThreshold, 0.6);
    }

    get suffixOverlapType(): 'low' | 'high' {
        return this._cached<'low' | 'high'>(ConfigKeys.Ghost.suffixOverlapType, 'low');
    }

    get presencePenalty(): number {
        return this._cached<number>(ConfigKeys.Ghost.presencePenalty, 1);
    }

    get frequencyPenalty(): number {
        return this._cached<number>(ConfigKeys.Ghost.frequencyPenalty, 0.2);
    }

    get stream(): boolean {
        return this._cached<boolean>(ConfigKeys.Ghost.stream, true);
    }

    onDidChangeEnabled(listener: () => void): vscode.Disposable {
        return this._onDidChangeEnabled.event(listener);
    }
}
