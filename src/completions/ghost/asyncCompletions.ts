import { createServiceIdentifier } from '../../di/services';

export const IAsyncCompletionsManager = createServiceIdentifier<IAsyncCompletionsManager>('IAsyncCompletionsManager');

export interface IAsyncCompletionsManager {
    readonly _serviceBrand: undefined;
    queueCompletionRequest(requestFn: () => Promise<string>): Promise<string>;
    getFirstMatchingRequest(): string | undefined;
}

export class AsyncCompletionsManager implements IAsyncCompletionsManager {
    readonly _serviceBrand: undefined;
    private _pending: string | undefined;

    async queueCompletionRequest(requestFn: () => Promise<string>): Promise<string> {
        const result = await requestFn();
        this._pending = result;
        return result;
    }

    getFirstMatchingRequest(): string | undefined {
        return this._pending;
    }
}
