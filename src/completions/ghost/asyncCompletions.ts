import { LRUCacheMap } from '../../common/lruCacheMap';
import { ReplaySubject } from '../../common/subject';
import { Deferred } from '../../common/async';
import { createServiceIdentifier } from '../../di/services';

export const IAsyncCompletionsManager = createServiceIdentifier<IAsyncCompletionsManager>('IAsyncCompletionsManager');

export interface IAsyncCompletionsManager {
    readonly _serviceBrand: undefined;
    shouldWaitForAsyncCompletions(prefix: string, suffix: string): boolean;
    updateCompletion(headerRequestId: string, text: string): void;
    queueCompletionRequest(
        headerRequestId: string,
        prefix: string,
        suffix: string,
        cancellationTokenSource: { cancel(): void },
        resultPromise: Promise<AsyncCompletionResult>
    ): Promise<void>;
    getFirstMatchingRequest(
        headerRequestId: string,
        prefix: string,
        suffix: string,
    ): Promise<AsyncCompletionResult | undefined>;
    hasActiveWaiters(): boolean;
    cancelStaleRequests(headerRequestId: string): void;
    clear(): void;
}

export interface AsyncCompletionResult {
    completionText: string;
    finishReason: string;
}

enum AsyncCompletionRequestState {
    Pending,
    Completed,
}

interface BaseAsyncCompletionRequest {
    cancellationTokenSource: { cancel(): void };
    headerRequestId: string;
    prefix: string;
    suffix: string;
    subject: ReplaySubject<AsyncCompletionRequest>;
    partialCompletionText?: string;
}

interface PendingAsyncCompletionRequest extends BaseAsyncCompletionRequest {
    state: AsyncCompletionRequestState.Pending;
}

interface CompletedAsyncCompletionRequest extends BaseAsyncCompletionRequest {
    state: AsyncCompletionRequestState.Completed;
    result: AsyncCompletionResult;
}

type AsyncCompletionRequest = PendingAsyncCompletionRequest | CompletedAsyncCompletionRequest;

export class AsyncCompletionsManager implements IAsyncCompletionsManager {
    readonly _serviceBrand: undefined;

    private readonly _requests = new LRUCacheMap<string, AsyncCompletionRequest>(100);

    /** Lock: only the most recent requester can cancel stale requests. */
    private _mostRecentRequestId = '';

    /** Count of active waiters in getFirstMatchingRequest — prevents abort while subscribers exist. */
    private _activeWaiterCount = 0;

    hasActiveWaiters(): boolean {
        return this._activeWaiterCount > 0;
    }

    shouldWaitForAsyncCompletions(prefix: string, suffix: string): boolean {
        for (const [, request] of this._requests) {
            if (_isCandidate(prefix, suffix, request)) {
                return true;
            }
        }
        return false;
    }

    updateCompletion(headerRequestId: string, text: string): void {
        const request = this._requests.get(headerRequestId);
        if (!request) return;
        request.partialCompletionText = text;
        request.subject.next(request);
    }

    queueCompletionRequest(
        headerRequestId: string,
        prefix: string,
        suffix: string,
        cts: { cancel(): void },
        resultPromise: Promise<AsyncCompletionResult>,
    ): Promise<void> {
        const subject = new ReplaySubject<AsyncCompletionRequest>();
        this._requests.set(headerRequestId, {
            state: AsyncCompletionRequestState.Pending,
            cancellationTokenSource: cts,
            headerRequestId,
            prefix,
            suffix,
            subject,
        });

        return resultPromise
            .then(result => {
                this._requests.delete(headerRequestId);
                const completed: CompletedAsyncCompletionRequest = {
                    state: AsyncCompletionRequestState.Completed,
                    cancellationTokenSource: cts,
                    headerRequestId,
                    prefix,
                    suffix,
                    subject,
                    result,
                };
                this._requests.set(headerRequestId, completed);
                subject.next(completed);
                subject.complete();
            })
            .catch(() => {
                this._requests.delete(headerRequestId);
                subject.error(new Error('Request failed'));
            });
    }

    async getFirstMatchingRequest(
        headerRequestId: string,
        prefix: string,
        suffix: string,
    ): Promise<AsyncCompletionResult | undefined> {
        this._mostRecentRequestId = headerRequestId;
        this._activeWaiterCount++;
        let resolved = false;
        const deferred = new Deferred<AsyncCompletionResult | undefined>();
        const subscriptions = new Map<string, () => void>();

        const finishRequest = (id: string) => () => {
            const subscription = subscriptions.get(id);
            if (subscription === undefined) return;
            subscription();
            subscriptions.delete(id);
            if (!resolved && subscriptions.size === 0) {
                resolved = true;
                deferred.resolve(undefined);
            }
        };

        const next = (request: AsyncCompletionRequest) => {
            if (_isCandidate(prefix, suffix, request)) {
                if (request.state === AsyncCompletionRequestState.Completed) {
                    const remainingPrefix = prefix.substring(request.prefix.length);
                    let { completionText } = request.result;
                    if (
                        !completionText.startsWith(remainingPrefix) ||
                        completionText.length <= remainingPrefix.length
                    ) {
                        finishRequest(request.headerRequestId)();
                        return;
                    }
                    completionText = completionText.substring(remainingPrefix.length);
                    deferred.resolve({ ...request.result, completionText });
                    resolved = true;
                }
            } else {
                this._cancelStaleRequest(headerRequestId, request);
                finishRequest(request.headerRequestId)();
            }
        };

        for (const [id, request] of this._requests) {
            if (_isCandidate(prefix, suffix, request)) {
                subscriptions.set(
                    id,
                    request.subject.subscribe({
                        next,
                        error: finishRequest(id),
                        complete: finishRequest(id),
                    })
                );
            } else {
                this._cancelStaleRequest(headerRequestId, request);
            }
        }

        return deferred.promise.finally(() => {
            this._activeWaiterCount--;
            for (const dispose of subscriptions.values()) {
                dispose();
            }
        });
    }

    cancelStaleRequests(headerRequestId: string): void {
        this._mostRecentRequestId = headerRequestId;
        for (const [, request] of this._requests) {
            this._cancelStaleRequest(headerRequestId, request);
        }
    }

    clear(): void {
        this._requests.clear();
    }

    private _cancelStaleRequest(headerRequestId: string, request: AsyncCompletionRequest): void {
        if (headerRequestId !== this._mostRecentRequestId) return;
        if (request.state === AsyncCompletionRequestState.Completed) return;
        request.cancellationTokenSource.cancel();
        this._requests.delete(request.headerRequestId);
    }
}

function _isCandidate(prefix: string, suffix: string, request: AsyncCompletionRequest): boolean {
    if (request.suffix !== suffix) return false;
    if (!prefix.startsWith(request.prefix)) return false;
    const remainingPrefix = prefix.substring(request.prefix.length);
    if (request.state === AsyncCompletionRequestState.Completed) {
        return (
            request.result.completionText.startsWith(remainingPrefix) &&
            request.result.completionText.trimEnd().length > remainingPrefix.length
        );
    }
    if (request.partialCompletionText === undefined) return true;
    return request.partialCompletionText.startsWith(remainingPrefix);
}
