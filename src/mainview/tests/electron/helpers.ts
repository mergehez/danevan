// Shared setup for the specs that launch the built shell: `test:e2e:electron` builds `dist/` and
// `dist-electron/` first, and every spec gets its own app data dir — the shell must never write to
// the developer's real `~/Library/Application Support/danevan` DB, and its keychain accounts are
// namespaced by that dir (`auth.ts`), so one spec cannot reach another's secrets.
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SHELL_ENTRY = join(process.cwd(), 'dist-electron', 'main.cjs');
export const FRONTEND_ENTRY = join(process.cwd(), 'dist', 'index.html');
export const API_URL = 'http://127.0.0.1:3264/api';

export type ElectronBridge = {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    onNativeCommand: (listener: (command: unknown) => void) => () => void;
    sendDiagnostic: (payload: unknown) => void;
};

/** `window` as the preload leaves it; the bridge is absent until `preload.cjs` runs. */
export type ElectronBridgeGlobal = { electronAPI?: ElectronBridge };

export function requireShellBuild() {
    for (const artifact of [SHELL_ENTRY, FRONTEND_ENTRY]) {
        if (!existsSync(artifact)) {
            throw new Error(`The shell build is missing ${artifact}. Run "bun run build:shell" first (test:e2e:electron does).`);
        }
    }
}

/** A throwaway app data dir; the caller removes it. */
export function createAppDataDir(prefix: string) {
    return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * The shell's environment: NODE_ENV=production keeps `main.cjs` on the built frontend instead of a
 * dev server, and `APP_DATA_DIR` pins the DB the shell writes. `ELECTRON_RUN_AS_NODE` is dropped —
 * some harness shells export it, which turns the Electron binary into plain Node, so it rejects
 * Playwright's `--remote-debugging-port` flag and never launches a window.
 */
export function shellEnv(appDataDir: string): Record<string, string> {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'APP_DATA_DIR') {
            env[key] = value;
        }
    }

    env.NODE_ENV = 'production';
    env.APP_DATA_DIR = appDataDir;

    return env;
}

export function launchShell(appDataDir: string) {
    return electron.launch({
        // `--user-data-dir` keeps Electron's own profile — and the DevTools port file Playwright
        // attaches through — inside the throwaway dir instead of the developer's
        // `~/Library/Application Support`. `--no-sandbox` and `--disable-gpu` are what the renderer
        // needs where the host cannot give Chromium a sandbox or a GPU process, as in a CI container.
        args: [SHELL_ENTRY, '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(appDataDir, 'electron')}`],
        env: shellEnv(appDataDir),
    });
}

export async function closeShell(app: ElectronApplication, appDataDir: string) {
    await app.close().catch(() => undefined);
    rmSync(appDataDir, { recursive: true, force: true });
}

/** Posts to the API the launched shell runs in-process; `data` becomes the JSON body. */
export async function post(method: string, data?: unknown): Promise<unknown> {
    const response = await fetch(`${API_URL}/${method}`, {
        method: 'POST',
        ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    });

    if (!response.ok) {
        throw new Error(`POST /api/${method} failed with ${response.status}: ${await response.text()}`);
    }

    const body = await response.text();
    return body ? JSON.parse(body) : undefined;
}

/** `getBootstrap` re-normalises the stored selection, which rewrites `updated_at` on the rows
 *  it touches, so timestamps cannot be compared across two calls. */
export function withoutTimestamps(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(withoutTimestamps);
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !key.endsWith('_at'))
                .map(([key, entry]) => [key, withoutTimestamps(entry)])
        );
    }

    return value;
}

/** The schema version an app data dir's DB records, read the way the app reads it. */
export function readAppDbVersion(appDataDir: string) {
    const database = new Database(join(appDataDir, 'danevan.sqlite'));

    try {
        return Number(database.pragma('user_version', { simple: true }));
    } finally {
        database.close();
    }
}

/** Waits for the renderer of a freshly launched shell to draw the app shell. */
export async function openAppWindow(app: ElectronApplication): Promise<Page> {
    const window = await app.firstWindow();
    await expect(window.getByRole('heading', { name: 'Connections' })).toBeVisible();

    return window;
}
