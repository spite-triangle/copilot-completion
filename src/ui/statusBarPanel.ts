import * as vscode from 'vscode';
import { createServiceIdentifier } from '../di/services';
import { IGhostConfigProvider } from '../config/ghostConfig';
import { INesConfigProvider } from '../config/nesConfig';
import { ILogService } from '../completions/shared/log/logService';

export const IStatusBarPanel = createServiceIdentifier<IStatusBarPanel>('IStatusBarPanel');

export interface IStatusBarPanel {
    readonly _serviceBrand: undefined;
    register(): vscode.Disposable;
}

export class StatusBarPanel implements IStatusBarPanel {
    readonly _serviceBrand: undefined;
    private _statusBarItem: vscode.StatusBarItem;

    constructor(
        @IGhostConfigProvider private readonly _ghostConfig: IGhostConfigProvider,
        @INesConfigProvider private readonly _nesConfig: INesConfigProvider,
        @ILogService private readonly _log: ILogService,
    ) {
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this._updateStatusBar();
    }

    register(): vscode.Disposable {
        this._statusBarItem.show();
        this._statusBarItem.command = 'cc-completion.togglePanel';

        const commandDisposable = vscode.commands.registerCommand(
            'cc-completion.togglePanel',
            () => this._showQuickPick(),
        );

        const ghostChange = this._ghostConfig.onDidChangeEnabled(() => this._updateStatusBar());
        const nesChange = this._nesConfig.onDidChangeEnabled(() => this._updateStatusBar());

        return {
            dispose: () => {
                this._statusBarItem.dispose();
                commandDisposable.dispose();
                ghostChange.dispose();
                nesChange.dispose();
            },
        };
    }

    private _updateStatusBar(): void {
        const ghostOn = this._ghostConfig.enabled;
        const nesOn = this._nesConfig.enabled;
        const ncpOn = this._nesConfig.nextCursorPredictionEnabled;
        const active = [ghostOn && 'G', nesOn && 'N', ncpOn && 'C'].filter(Boolean).join('/');
        if (active) {
            this._statusBarItem.text = `$(sparkle) CC [${active}]`;
            this._statusBarItem.tooltip = `GHOST: ${ghostOn ? 'ON' : 'OFF'}, NES: ${nesOn ? 'ON' : 'OFF'}, NCP: ${ncpOn ? 'ON' : 'OFF'}`;
        } else {
            this._statusBarItem.text = `$(circle-slash) CC [OFF]`;
            this._statusBarItem.tooltip = 'CC Completion disabled';
        }
    }

    private async _showQuickPick(): Promise<void> {
        const ghostOn = this._ghostConfig.enabled;
        const nesOn = this._nesConfig.enabled;
        const ncpOn = this._nesConfig.nextCursorPredictionEnabled;

        const ghostLabel = `$(symbol-boolean) Ghost Inline Completion (GHOST): ${ghostOn ? 'ON' : 'OFF'}`;
        const nesLabel = `$(symbol-boolean) Next Edit Suggestion (NES): ${nesOn ? 'ON' : 'OFF'}`;
        const ncpLabel = `$(symbol-boolean) Next Cursor Prediction (NCP): ${ncpOn ? 'ON' : 'OFF'}`;

        const pick = await vscode.window.showQuickPick(
            [
                {
                    label: ghostLabel,
                    description: ghostOn ? 'Click to disable' : 'Click to enable',
                    type: 'toggleGhost',
                },
                {
                    label: nesLabel,
                    description: nesOn ? 'Click to disable' : 'Click to enable',
                    type: 'toggleNes',
                },
                {
                    label: ncpLabel,
                    description: ncpOn ? 'Click to disable' : 'Click to enable',
                    type: 'toggleNcp',
                },
            ],
            {
                placeHolder: 'Toggle GHOST / NES / NCP completion features',
                title: 'CC Completion',
            },
        );

        if (!pick) return;

        if (pick.type === 'toggleGhost') {
            await vscode.workspace.getConfiguration().update(
                'cc-completion.ghost.enabled',
                !ghostOn,
                vscode.ConfigurationTarget.Global,
            );
            this._log.info(`GHOST: ${!ghostOn ? 'enabled' : 'disabled'}`);
        } else if (pick.type === 'toggleNes') {
            await vscode.workspace.getConfiguration().update(
                'cc-completion.nes.enabled',
                !nesOn,
                vscode.ConfigurationTarget.Global,
            );
            this._log.info(`NES: ${!nesOn ? 'enabled' : 'disabled'}`);
        } else if (pick.type === 'toggleNcp') {
            await vscode.workspace.getConfiguration().update(
                'cc-completion.nes.nextCursorPrediction.enabled',
                !ncpOn,
                vscode.ConfigurationTarget.Global,
            );
            this._log.info(`NCP: ${!ncpOn ? 'enabled' : 'disabled'}`);
        }
        this._updateStatusBar();
    }
}
