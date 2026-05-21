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

    constructor(private readonly _context: vscode.ExtensionContext) {}

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
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Nes.baseUrl, '');
    }

    get apiKey(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Nes.apiKey, '');
    }

    get model(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Nes.model, 'gpt-4o');
    }

    get supportedEndpoint(): NesSupportedEndpoint {
        return vscode.workspace.getConfiguration()
            .get<NesSupportedEndpoint>(ConfigKeys.Nes.supportedEndpoint, 'chat/completions');
    }

    get capabilities(): NesCapabilities {
        return {
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
            }
        };
    }

    get maxOutputTokens(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Nes.maxOutputTokens, 8192);
    }

    get suffixOverlapThreshold(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Nes.suffixOverlapThreshold, 0.85);
    }

    get suffixOverlapType(): 'low' | 'high' {
        return vscode.workspace.getConfiguration()
            .get<'low' | 'high'>(ConfigKeys.Nes.suffixOverlapType, 'high');
    }

    get presencePenalty(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Nes.presencePenalty, 1);
    }

    get frequencyPenalty(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Nes.frequencyPenalty, 0.2);
    }

    get stream(): boolean {
        return vscode.workspace.getConfiguration()
            .get<boolean>(ConfigKeys.Nes.stream, true);
    }

    get mimicGhostTextBehavior(): boolean {
        return vscode.workspace.getConfiguration()
            .get<boolean>(ConfigKeys.Nes.mimicGhostTextBehavior, false);
    }

    onDidChangeEnabled(listener: () => void): vscode.Disposable {
        return this._onDidChangeEnabled.event(listener);
    }
}
