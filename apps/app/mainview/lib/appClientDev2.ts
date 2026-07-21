/**
 * Browser-only dev mode adapter that replaces the Electrobun RPC bridge
 * with fetch() calls to the backend HTTP server.
 *
 * Activated when VITE_DEV2=true.
 */

const DEV2_API_TIMEOUT_MS = 75_000;

function trimTrailingSlash(value: string) {
    return value.replace(/\/+$/u, '');
}

export function resolveDev2ApiBase() {
    const configuredBase = import.meta.env.VITE_DEV2_API_BASE?.trim();
    if (configuredBase) {
        return trimTrailingSlash(configuredBase);
    }

    const apiPort = import.meta.env.VITE_DEV2_API_PORT?.trim() || '3264';
    const hostname = window.location.hostname || '127.0.0.1';
    return `http://${hostname}:${apiPort}/api`;
}

export async function invoke(method: string, params?: unknown): Promise<any> {
    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => controller.abort(new Error(`Request timed out after ${DEV2_API_TIMEOUT_MS}ms`)), DEV2_API_TIMEOUT_MS);
    const requestUrl = `${resolveDev2ApiBase()}/${method}`;

    try {
        const response = await fetch(requestUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: params !== undefined ? JSON.stringify(params) : undefined,
            signal: controller.signal,
            cache: 'no-store',
        });

        const responseText = await response.text();
        const responseBody = responseText.trim() ? JSON.parse(responseText) : undefined;

        if (!response.ok) {
            throw new Error(responseBody?.error || response.statusText || `HTTP ${response.status}`);
        }

        return responseBody;
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`Backend request "${method}" timed out after ${DEV2_API_TIMEOUT_MS}ms.`);
        }

        throw error;
    } finally {
        window.clearTimeout(timeoutHandle);
    }
}

// Minimal stub of the Electrobun bridge shape
const dev2Bridge = {
    invoke,
    onNativeCommand: () => () => {},
};

export function installDev2AppClientBridge() {
    (window as any).appClient = dev2Bridge;
}
