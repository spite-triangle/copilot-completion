import { ILogService } from '../shared/log/logService';

export enum SpeculativeCancelReason {
    Rejected = 'Rejected',
    Superseded = 'Superseded',
    CacheCleared = 'CacheCleared',
    DocumentClosed = 'DocumentClosed',
}

export class SpeculativeRequestManager {
    private _running: Promise<unknown> | undefined;
    private _cancelled = false;

    constructor(
        @ILogService private readonly _log: ILogService,
    ) {}

    async execute<T>(fn: () => Promise<T>): Promise<T | undefined> {
        this._cancelled = false;
        const promise = fn();
        this._running = promise;
        try {
            const result = await promise;
            if (this._cancelled) {
                this._log.debug('SpeculativeRequest: result discarded (cancelled)');
                return undefined;
            }
            return result;
        } catch (err) {
            this._log.error(`SpeculativeRequest failed: ${err}`);
            return undefined;
        }
    }

    cancel(reason: SpeculativeCancelReason): void {
        this._cancelled = true;
        this._log.debug(`SpeculativeRequest cancelled: ${reason}`);
    }
}
