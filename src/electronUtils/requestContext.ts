import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Carries the abort signal of the HTTP request being served so a spawned process can be
 * killed when the renderer stops waiting for the answer.
 */
const requestAbortStorage = new AsyncLocalStorage<AbortSignal>();

export function runWithRequestAbortSignal<T>(signal: AbortSignal, task: () => T): T {
    return requestAbortStorage.run(signal, task);
}

export function currentRequestAbortSignal(): AbortSignal | undefined {
    return requestAbortStorage.getStore();
}
