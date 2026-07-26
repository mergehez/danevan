import type { AppRequestApi } from '@electron/bridge.ts';

export type AppApi = AppRequestApi;

const request = new Proxy({} as AppApi, {
    get(_target, propertyKey) {
        return (params?: unknown) => window.appClient!.invoke(propertyKey as any, params);
    },
}) as AppApi;

export const appClientRpc = {
    request,
};
