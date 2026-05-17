import * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../di/services';

/** Context passed to all multiline detectors */
export interface MultilineContext {
    document: vscode.TextDocument;
    position: vscode.Position;
    prefix: string;
    suffix: string;
    languageId: string;
    isMiddleOfTheLine: boolean;
    afterAccept: boolean;
}

/** Result from a single detector */
export type DetectionResult =
    | { decision: 'multiline' }
    | { decision: 'singleline' }
    | { decision: 'defer' };

/** Detector interface — each detector has a single responsibility */
export interface IMultilineDetector {
    readonly name: string;
    detect(ctx: MultilineContext): Promise<DetectionResult>;
}

/** Strategy interface — overall multiline decision entry point */
export interface IMultilineStrategy {
    _serviceBrand: undefined;
    determineMultiline(ctx: MultilineContext): Promise<boolean>;
}

export const IMultilineStrategy = createServiceIdentifier<IMultilineStrategy>('IMultilineStrategy');
