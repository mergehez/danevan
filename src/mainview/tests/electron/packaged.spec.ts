// The artifact users install: the electron-builder bundle in `build/mac-arm64/Danevan.app`, whose
// `files` list ships `dist/**` and `dist-electron/**` and whose `main.cjs` externalises
// `better-sqlite3`. Launching it is the only way to know the asar layout and the native module are
// really there. Build with `bun run test:e2e:packaged`.
import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isMacAppSigned } from '../../../electronUtils/signMacApp.ts';
import { closeShell, createAppDataDir, post, shellEnv, withoutVolatileFields, type ElectronBridgeGlobal } from './helpers';

const APP_BUNDLE = join(process.cwd(), 'build', 'mac-arm64', 'Danevan.app');
const APP_EXECUTABLE = join(APP_BUNDLE, 'Contents', 'MacOS', 'Danevan');

test.beforeAll(() => {
    if (!existsSync(APP_EXECUTABLE)) {
        throw new Error(`The packaged app is missing ${APP_EXECUTABLE}. Run "bun run test:e2e:packaged" (it builds first).`);
    }
});

test('ships a bundle macOS can sandbox, which is what its helper processes need', async () => {
    // Unsigned, the renamed helper bundles cannot inherit a sandbox: Chromium's GPU process
    // crash-loops and aborts the app a second after launch (the window stays white). `identity: null`
    // means nothing but `signMacApp` signs this bundle, so the artifact is where to notice it.
    expect(await isMacAppSigned(APP_BUNDLE)).toBe(true);
});

test('the packaged app boots its bundled backend and answers IPC', async () => {
    const appDataDir = createAppDataDir('danevan-packaged-');

    // The same harness switches as the dev shell (`shellArgs`): a host that cannot give Chromium a
    // sandbox or a GPU process would fail to launch it, and this run must not open the developer's
    // own app DB and Electron profile.
    const app = await electron.launch({
        executablePath: APP_EXECUTABLE,
        args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${join(appDataDir, 'electron')}`],
        env: shellEnv(appDataDir),
    });

    try {
        // The app runs from the packaged asar, not from the working tree.
        expect(await app.evaluate(({ app: electronApp }) => electronApp.getAppPath())).toContain('app.asar');

        const window = await app.firstWindow();

        await expect(window.getByRole('heading', { name: 'Connections' })).toBeVisible();
        await expect(window.getByTestId('sidebar-settings')).toBeVisible();

        const bridge = await window.evaluate(() => Object.keys((globalThis as ElectronBridgeGlobal).electronAPI ?? {}));
        expect(bridge).toEqual(['invoke', 'onNativeCommand', 'sendDiagnostic']);

        const overIpc = (await window.evaluate(() => (globalThis as ElectronBridgeGlobal).electronAPI!.invoke('getBootstrap'))) as Record<string, unknown>;

        // The bundled backend answered, over the same app database the HTTP API reads.
        expect(withoutVolatileFields(overIpc)).toEqual(withoutVolatileFields(await post('getBootstrap')));
    } finally {
        await closeShell(app, appDataDir);
    }
});
