// The artifact users install: the electron-builder bundle in `build/mac-arm64/Danevan.app`, whose
// `files` list ships `dist/**` and `dist-electron/**` and whose `main.cjs` externalises
// `better-sqlite3`. Launching it is the only way to know the asar layout and the native module are
// really there. Build with `bun run test:e2e:packaged`.
import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const APP_BUNDLE = join(process.cwd(), 'build', 'mac-arm64', 'Danevan.app');
const APP_EXECUTABLE = join(APP_BUNDLE, 'Contents', 'MacOS', 'Danevan');
const API_URL = 'http://127.0.0.1:3264/api';

type ElectronBridge = {
    electronAPI?: {
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
};

test.beforeAll(() => {
    if (!existsSync(APP_EXECUTABLE)) {
        throw new Error(`The packaged app is missing ${APP_EXECUTABLE}. Run "bun run test:e2e:packaged" (it builds first).`);
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

/** Timestamps are rewritten by the bootstrap's own selection normalisation. */
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

test('the packaged app boots its bundled backend and answers IPC', async () => {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
        // As in the dev-shell spec: ELECTRON_RUN_AS_NODE makes Electron behave as plain Node.
        if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') {
            env[key] = value;
        }
    }

    const app = await electron.launch({ executablePath: APP_EXECUTABLE, env });

    try {
        // The app runs from the packaged asar, not from the working tree.
        expect(await app.evaluate(({ app: electronApp }) => electronApp.getAppPath())).toContain('app.asar');

        const window = await app.firstWindow();

        await expect(window.getByRole('heading', { name: 'Connections' })).toBeVisible();
        await expect(window.getByTestId('sidebar-settings')).toBeVisible();

        const bridge = await window.evaluate(() => Object.keys((globalThis as ElectronBridge).electronAPI ?? {}));
        expect(bridge).toEqual(['invoke', 'onNativeCommand', 'sendDiagnostic']);

        const overIpc = (await window.evaluate(() => (globalThis as ElectronBridge).electronAPI!.invoke('getBootstrap'))) as Record<string, unknown>;

        // The bundled backend answered, over the same app database the HTTP API reads.
        expect(withoutTimestamps(overIpc)).toEqual(withoutTimestamps(await post('getBootstrap')));
    } finally {
        await app.close();
    }
});
