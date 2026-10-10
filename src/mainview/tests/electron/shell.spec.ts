// The shipped shell, and the spec that launches the built frontend: `dist-electron/main.cjs` boots the
// backend in-process (`backend.cjs`), opens a BrowserWindow whose preload exposes
// `window.electronAPI`, and loads the built frontend from `dist/`. Everything else runs in
// browser-only dev mode, where none of that is exercised.
import { expect, test } from '@playwright/test';
import { closeShell, createAppDataDir, launchShell, post, requireShellBuild, withoutTimestamps, type ElectronBridgeGlobal } from './helpers';

test.beforeAll(() => {
    requireShellBuild();
});

test('the shell opens its window and answers an IPC round trip', async () => {
    const appDataDir = createAppDataDir('danevan-shell-');
    const app = await launchShell(appDataDir);

    try {
        const window = await app.firstWindow();

        // `App.tsx` titles the window after the selected source, so the title proves the renderer
        // booted against the app database — not that it drew a fixed string.
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
        const bridge = await window.evaluate(() => Object.keys((globalThis as ElectronBridgeGlobal).electronAPI ?? {}));
        expect(bridge).toEqual(['invoke', 'onNativeCommand', 'sendDiagnostic']);

        // One request/response through preload -> IPC -> main -> HTTP -> backend -> app DB.
        const overIpc = (await window.evaluate(() => (globalThis as ElectronBridgeGlobal).electronAPI!.invoke('getBootstrap'))) as Record<string, unknown>;

        // A fresh app DB has no source, so nothing is selected and the response carries no
        // `selected*` keys; the shell answers the same bootstrap over IPC as over HTTP.
        expect(Object.keys(overIpc).sort()).toEqual(['connections', 'scripts', 'servers']);
        // The renderer's answer is the backend's answer, not a stub.
        expect(withoutTimestamps(overIpc)).toEqual(withoutTimestamps(bootstrap));
    } finally {
        await closeShell(app, appDataDir);
    }
});
