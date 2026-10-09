// The shipped shell, and the only spec that launches it: `dist-electron/main.cjs` boots the
// backend in-process (`backend.cjs`), opens a BrowserWindow whose preload exposes
// `window.electronAPI`, and loads the built frontend from `dist/`. Everything else runs in
// browser-only dev mode, where none of that is exercised.
import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SHELL_ENTRY = join(process.cwd(), 'dist-electron', 'main.cjs');
const FRONTEND_ENTRY = join(process.cwd(), 'dist', 'index.html');
const API_URL = 'http://127.0.0.1:3264/api';

type ElectronBridge = {
    electronAPI?: {
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
};

test.beforeAll(() => {
    for (const artifact of [SHELL_ENTRY, FRONTEND_ENTRY]) {
        if (!existsSync(artifact)) {
            throw new Error(`The shell build is missing ${artifact}. Run "bun run build:shell" first (test:e2e:electron does).`);
        }
    }
});

async function post(method: string): Promise<unknown> {
    const response = await fetch(`${API_URL}/${method}`, { method: 'POST' });

    if (!response.ok) {
        throw new Error(`POST /api/${method} failed with ${response.status}: ${await response.text()}`);
    }

    const body = await response.text();
    return body ? JSON.parse(body) : undefined;
}

/** `getBootstrap` re-normalises the stored selection, which rewrites `updated_at` on the rows
 *  it touches, so timestamps cannot be compared across two calls. */
function withoutTimestamps(value: unknown): unknown {
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

/**
 * The shell's environment: NODE_ENV=production keeps `main.cjs` on the built frontend instead of
 * a dev server. `ELECTRON_RUN_AS_NODE` is dropped — some harness shells export it, which turns
 * the Electron binary into plain Node, so it rejects Playwright's `--remote-debugging-port` flag
 * and never launches a window.
 */
function shellEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') {
            env[key] = value;
        }
    }

    env.NODE_ENV = 'production';

    return env;
}

test('the shell opens its window and answers an IPC round trip', async () => {
    const app = await electron.launch({ args: [SHELL_ENTRY], env: shellEnv() });

    try {
        const window = await app.firstWindow();

        // `App.tsx` titles the window after the selected source, so the title proves the renderer
        // booted against the real app database — not that it drew a fixed string.
        const bootstrap = (await post('getBootstrap')) as {
            servers: Array<{ id: number; name: string }>;
            connections: Array<{ id: number; server_id: number; name: string }>;
            selectedConnectionId: number | undefined;
        };
        const selectedConnection = bootstrap.connections.find((connection) => connection.id === bootstrap.selectedConnectionId);
        const selectedServer = bootstrap.servers.find((server) => server.id === selectedConnection?.server_id);
        const expectedTitle = selectedConnection ? `${selectedConnection.name} - ${selectedServer?.name ?? 'Danevan'}` : 'Danevan';

        await expect(window).toHaveTitle(expectedTitle);
        await expect(window.getByRole('heading', { name: 'Connections' })).toBeVisible();
        await expect(window.getByTestId('sidebar-settings')).toBeVisible();

        // The preload bridge, not a browser stub.
        const bridge = await window.evaluate(() => Object.keys((globalThis as ElectronBridge).electronAPI ?? {}));
        expect(bridge).toEqual(['invoke', 'onNativeCommand', 'sendDiagnostic']);

        // One request/response through preload -> IPC -> main -> HTTP -> backend -> app DB.
        const overIpc = (await window.evaluate(() => (globalThis as ElectronBridge).electronAPI!.invoke('getBootstrap'))) as Record<string, unknown>;

        expect(Object.keys(overIpc).sort()).toEqual(['connections', 'scripts', 'selectedConnectionId', 'selectedScriptId', 'selectedServerId', 'servers']);
        // The renderer's answer is the backend's answer, not a stub.
        expect(withoutTimestamps(overIpc)).toEqual(withoutTimestamps(bootstrap));
    } finally {
        await app.close();
    }
});
