// Minimal stub: provides only what the DI code needs

import type { IDisposable } from './lifecycle';

/**
 * An `IdleValue` that always uses the current window.
 */
export class GlobalIdleValue<T> implements IDisposable {
	private _didRun = false;
	private _value?: T;
	private _error: unknown;
	private readonly _executor: () => void;
	private _timer: ReturnType<typeof setTimeout> | undefined;

	constructor(executor: () => T) {
		this._executor = () => {
			try {
				this._value = executor();
			} catch (err) {
				this._error = err;
			} finally {
				this._didRun = true;
			}
		};
		this._timer = setTimeout(() => this._executor(), 0);
	}

	dispose(): void {
		if (this._timer !== undefined) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}
	}

	get value(): T {
		if (!this._didRun) {
			if (this._timer !== undefined) {
				clearTimeout(this._timer);
				this._timer = undefined;
			}
			this._executor();
		}
		if (this._error) {
			throw this._error;
		}
		return this._value!;
	}

	get isInitialized(): boolean {
		return this._didRun;
	}
}

/**
 * Deferred promise implementation to enable delayed promise resolution.
 */
export class Deferred<T> {
    resolve: (value: T | PromiseLike<T>) => void = () => {};
    reject: (reason?: unknown) => void = () => {};

    readonly promise: Promise<T> = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
    });
}
