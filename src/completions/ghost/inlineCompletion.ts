import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { GhostTextComputer, GhostTextResult } from './ghostTextComputer';
import { CurrentGhostText, LastGhostText } from './ghostTextState';

export class GhostText {
    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
    ) {}

    async getInlineCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        token?: vscode.CancellationToken,
    ): Promise<GhostTextResult | undefined> {
        const computer = this._instantiationService.createInstance(GhostTextComputer, new CurrentGhostText(), new LastGhostText());
        return computer.getGhostText(document, position, token, false);
    }
}
