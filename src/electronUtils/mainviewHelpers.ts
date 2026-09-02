import { isReactive, isRef, toRaw } from 'vue';
import { callApiPost } from './helpers';

// Electron IPC (ipcRenderer.invoke) serializes arguments with the structured clone algorithm,
// which cannot clone Vue reactive proxies. Recursively unwrap refs/reactive proxies into plain
// objects and arrays here — cheaper than a JSON round-trip, and preserves other types (Date,
// bigint, undefined, …) that JSON.stringify would mangle.
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function toIpcCloneable(value: unknown): unknown {
    if (isRef(value)) {
        return toIpcCloneable(value.value);
    }
    if (isReactive(value)) {
        return toIpcCloneable(toRaw(value));
    }
    if (Array.isArray(value)) {
        return value.map(toIpcCloneable);
    }
    if (isPlainObject(value)) {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
            result[key] = toIpcCloneable(value[key]);
        }
        return result;
    }
    return value;
}

export function createAppClientPpc<AppApi extends object>(appClient: undefined | { invoke(method: string, params?: unknown): Promise<unknown> }) {
    return {
        request: new Proxy<AppApi>(Object.create(null), {
            get(_target, method: string) {
                return (params?: unknown) => {
                    if (appClient) {
                        return appClient.invoke(method, toIpcCloneable(params));
                    }
                    return callApiPost(method, params);
                };
            },
        }),
    };
}
