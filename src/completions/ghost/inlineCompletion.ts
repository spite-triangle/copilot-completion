import * as vscode from 'vscode';
import { IInstantiationService } from '../../di/instantiation';
import { GhostTextComputer, GhostTextResult } from './ghostTextComputer';
import { CurrentGhostText } from './current';
import { LastGhostText } from './last';

export class GhostText {
    constructor(
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
    ) {}

    async getInlineCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<GhostTextResult | undefined> {
        const computer = this._instantiationService.createInstance(GhostTextComputer, new CurrentGhostText(), new LastGhostText());
        return computer.getGhostText(document, position, false);
    }
}
