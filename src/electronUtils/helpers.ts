import pkgObj from '../../package.json' with { type: 'json' };

const pkg = JSON.parse(JSON.stringify(pkgObj));

type Config = {
    vuePort: number;
    apiPort: number;
    appId: string;
    copyright?: string;
    appName: string;
    dbFileName: string;
};

export const appConfig = {
    ...(pkg.config as Config),
    projectName: pkg.name,
    vueBaseUrl: `http://127.0.0.1:${pkg.config.vuePort}`,
    apiBaseUrl: `http://127.0.0.1:${pkg.config.apiPort}`,
};

export async function callApiPost(method: string, params?: unknown): Promise<unknown> {
    const response = await fetch(`${appConfig.apiBaseUrl}/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: params !== undefined ? JSON.stringify(params) : undefined,
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Backend error (${response.status}): ${text}`);
    }

    // Endpoints that return nothing answer with an empty body, which `response.json()`
    // rejects — over this bridge a void API method would look like a failure.
    const body = await response.text();
    return body ? JSON.parse(body) : undefined;
}
