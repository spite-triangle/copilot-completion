import * as vscode from 'vscode';
import { createServiceIdentifier } from '../di/services';
import { ConfigKeys } from './configKeys';

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
    get baseUrl(): string;
    get apiKey(): string;
    get model(): string;
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

    get enabled(): boolean {
        return vscode.workspace.getConfiguration().get<boolean>(ConfigKeys.Ghost.enabled, true);
    }

    get baseUrl(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Ghost.baseUrl, '');
    }

    get apiKey(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Ghost.apiKey, '');
    }

    get model(): string {
        return vscode.workspace.getConfiguration().get<string>(ConfigKeys.Ghost.model, 'gpt-4o');
    }

    get promptTemplate(): string {
        return vscode.workspace.getConfiguration().get<string>(
            ConfigKeys.Ghost.promptTemplate,
            '<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>'
        );
    }

    get capabilities(): GhostCapabilities {
        return {
            limits: {
                max_output_tokens: this.maxOutputTokens,
                max_context_window_tokens: vscode.workspace.getConfiguration()
                    .get<number>(ConfigKeys.Ghost.maxContextWindowTokens, 128000),
            }
        };
    }

    get maxOutputTokens(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Ghost.maxOutputTokens, 256);
    }

    get delay(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Ghost.delay, 200);
    }

    get suffixOverlapThreshold(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Ghost.suffixOverlapThreshold, 0.6);
    }

    get suffixOverlapType(): 'low' | 'high' {
        return vscode.workspace.getConfiguration()
            .get<'low' | 'high'>(ConfigKeys.Ghost.suffixOverlapType, 'low');
    }

    get presencePenalty(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Ghost.presencePenalty, 1);
    }

    get frequencyPenalty(): number {
        return vscode.workspace.getConfiguration()
            .get<number>(ConfigKeys.Ghost.frequencyPenalty, 0.2);
    }

    get stream(): boolean {
        return vscode.workspace.getConfiguration()
            .get<boolean>(ConfigKeys.Ghost.stream, true);
    }

    onDidChangeEnabled(listener: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(ConfigKeys.Ghost.enabled)) {
                listener();
            }
        });
    }
}
