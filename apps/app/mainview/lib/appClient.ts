import type { AppRequestApi, AppRequestMap } from '@electrobun/index';

const request = new Proxy({} as AppRequestApi, {
    get(_target, propertyKey) {
        return (params?: unknown) => window.appClient.invoke(propertyKey as keyof AppRequestMap, params as AppRequestMap[keyof AppRequestMap]['params']);
    },
}) as AppRequestApi;

export const appClientRpc = {
    request,
};
