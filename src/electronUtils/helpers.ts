import pkgObj from '../../package.json' with { type: 'json' };
// electron-builder loads this file through Node's ESM loader (electron.config.js -> electronConfig.ts
// -> helpers.ts), which needs the extension; a bundler would not.
import { readApiErrorMessage } from './apiErrorMessage.ts';

const pkg = JSON.parse(JSON.stringify(pkgObj));

type Config = {
    vuePort: number;
    apiPort: number;
    appId: string;
    copyright?: string;
    appName: string;
    dbFileName: string;
};

/** `pkg.name` is the app's own name, so the port overrides stay app-specific without naming it here. */
const envPrefix = String(pkg.name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');

/** Ignores empty or invalid overrides so a typo'd env var cannot silently move the app to a random port. */
function resolvePort(override: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(override ?? '', 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

/**
 * The renderer has no `process`, so it reads the `VITE_*` name instead: a bundler inlines that one,
 * which is how a dev run on other ports keeps the served app pointing at its own backend.
 */
function readPortOverride(envName: string, viteName: string): string | undefined {
    const fromProcess = typeof process === 'undefined' ? undefined : process.env[envName];

    return fromProcess ?? (import.meta.env?.[viteName] as string | undefined);
}

const vuePort = resolvePort(readPortOverride(`${envPrefix}_VUE_PORT`, 'VITE_VUE_PORT'), pkg.config.vuePort);
const apiPort = resolvePort(readPortOverride(`${envPrefix}_API_PORT`, 'VITE_API_PORT'), pkg.config.apiPort);

export const appConfig = {
    ...(pkg.config as Config),
    vuePort,
    apiPort,
    projectName: pkg.name,
    vueBaseUrl: `http://127.0.0.1:${vuePort}`,
    apiBaseUrl: `http://127.0.0.1:${apiPort}`,
};

/** Backstop above the longest backend operation, so a lost answer never blocks the main process forever. */
export const apiRequestTimeoutMs = 12 * 60_000;

export async function callApiPost(method: string, params?: unknown): Promise<unknown> {
    const response = await fetch(`${appConfig.apiBaseUrl}/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: params !== undefined ? JSON.stringify(params) : undefined,
        signal: AbortSignal.timeout(apiRequestTimeoutMs),
    });
    const body = await response.text();

    if (!response.ok) {
        throw new Error(readApiErrorMessage(response.status, body));
    }

    // An endpoint that returns nothing answers with an empty body, which `JSON.parse` would reject —
    // over this bridge a void method would look like a failure.
    return body ? JSON.parse(body) : undefined;
}
