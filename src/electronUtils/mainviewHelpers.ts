import { callApiPost } from './helpers';

export function createAppClientPpc<AppApi extends object>(appClient: undefined | { invoke(method: string, params?: unknown): Promise<unknown> }) {
    return {
        request: new Proxy<AppApi>(Object.create(null), {
            get(_target, method: string) {
                return (params?: unknown) => {
                    if (appClient) {
                        return appClient.invoke(method, params);
                    }
                    return callApiPost(method, params);
                };
            },
        }),
    };
}
