import { ILogService } from '../shared/log/logService';

export enum SpeculativeCancelReason {
    Rejected = 'Rejected',
    Superseded = 'Superseded',
    CacheCleared = 'CacheCleared',
    DocumentClosed = 'DocumentClosed',
}

export class SpeculativeRequestManager {
    private _running: Promise<unknown> | undefined;
    private _controller: AbortController | null = null;

    constructor(
        @ILogService private readonly _log: ILogService,
    ) {}

    /**
     * Executes a speculative async operation. If cancelled before completion,
     * the AbortController is triggered so the underlying fetch is aborted.
     */
    async execute<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
        // Cancel any previous speculative request
        if (this._controller) {
            this._controller.abort();
        }
        this._controller = new AbortController();
        const controller = this._controller;

        const promise = fn(controller.signal);
        this._running = promise;

        try {
            const result = await promise;
            if (controller.signal.aborted) {
                this._log.debug('SpeculativeRequest: result discarded (aborted)');
                return undefined;
            }
            return result;
        } catch (err) {
            if ((err as {name?: string})?.name === 'AbortError') {
                this._log.debug('SpeculativeRequest: aborted');
                return undefined;
            }
            this._log.error(`SpeculativeRequest failed: ${err}`);
            return undefined;
        } finally {
            if (this._controller === controller) {
                this._controller = null;
            }
        }
    }

    cancel(reason: SpeculativeCancelReason): void {
        if (this._controller) {
            this._log.debug(`SpeculativeRequest cancelled: ${reason}`);
            this._controller.abort();
            this._controller = null;
        }
    }
}
