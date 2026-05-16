import * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../di/services';

export const ILogService = createServiceIdentifier<ILogService>('ILogService');

export interface ILogService {
    readonly _serviceBrand: undefined;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
    show(): void;
}

export class LogService implements ILogService {
    readonly _serviceBrand: undefined;
    private readonly _channel: vscode.LogOutputChannel;

    constructor() {
        this._channel = vscode.window.createOutputChannel('CC Completion', { log: true });
    }

    info(message: string): void { this._channel.info(message); }
    warn(message: string): void { this._channel.warn(message); }
    error(message: string): void { this._channel.error(message); }
    debug(message: string): void { this._channel.debug(message); }
    show(): void { this._channel.show(); }
}
