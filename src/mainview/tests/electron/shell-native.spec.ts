// What `src/electron/main.ts` wires for the shell: the macOS menu and the native command it sends to
// the renderer, the file/path helpers the preload exposes, the renderer diagnostics, and the window
// lifecycle (`window-all-closed` on macOS, `activate`). Only the native dialogs and the shell calls
// are stubbed: they are the platform boundary and would otherwise open a real dialog or launch a
// real app on the machine running the suite.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { closeShell, createAppDataDir, launchShell, openAppWindow, requireShellBuild, type ElectronBridgeGlobal } from './helpers';

type NativeCalls = {
    revealed: string[];
    openedPaths: string[];
    diagnostics: string[];
};

/** Patches the platform boundary in the main process and records what the handlers do with it. */
async function stubNativeSurface(app: ElectronApplication, openPaths: string[], savePath: string | undefined) {
    await app.evaluate(
        ({ dialog, shell }, stub) => {
            const calls: NativeCalls = { revealed: [], openedPaths: [], diagnostics: [] };
            const globals = globalThis as unknown as { __nativeCalls: NativeCalls };

            globals.__nativeCalls = calls;

            (dialog as unknown as { showOpenDialog: () => Promise<unknown> }).showOpenDialog = async () => ({ canceled: false, filePaths: stub.openPaths });
            (dialog as unknown as { showSaveDialog: () => Promise<unknown> }).showSaveDialog = async () => ({ canceled: false, filePath: stub.savePath });
            (shell as unknown as { showItemInFolder: (path: string) => void }).showItemInFolder = (path: string) => calls.revealed.push(path);
            (shell as unknown as { openPath: (path: string) => Promise<string> }).openPath = async (path: string) => {
                calls.openedPaths.push(path);
                return '';
            };

            // The diagnostic handler writes through console, which is where it is recorded from.
            const originalWarn = console.warn.bind(console);
            console.warn = (...args: unknown[]) => {
                calls.diagnostics.push(String(args[0]));
                originalWarn(...args);
            };
        },
        { openPaths, savePath }
    );
}

function nativeCalls(app: ElectronApplication) {
    return app.evaluate(() => (globalThis as unknown as { __nativeCalls: NativeCalls }).__nativeCalls);
}

/** Whether the newest window's renderer has drawn the app's first heading. */
function drawnHeading(app: ElectronApplication) {
    return app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];

        if (!window) {
            return false;
        }

        const headings = (await window.webContents.executeJavaScript(
            "Array.from(document.querySelectorAll('h1, h2, h3')).map((element) => element.textContent?.trim() ?? '')"
        )) as string[];

        return headings.includes('Connections');
    });
}

/** Clicks a menu item by its label path, the way the menu bar does. */
async function clickMenuItem(app: ElectronApplication, ...labels: string[]) {
    await app.evaluate(({ Menu }, path) => {
        let siblings = Menu.getApplicationMenu()?.items ?? [];
        let item = siblings[0];

        for (const label of path) {
            const match = siblings.find((entry) => entry.label === label);

            if (!match) {
                throw new Error(`No menu item "${path.join(' > ')}" (looked for "${label}").`);
            }

            item = match;
            siblings = match.submenu?.items ?? [];
        }

        item.click();
    }, labels);
}

test.beforeAll(() => {
    requireShellBuild();
});

test('the app menu opens the settings window through a native command', async () => {
    const appDataDir = createAppDataDir('danevan-menu-');
    const app = await launchShell(appDataDir);

    try {
        const window = await openAppWindow(app);
        await expect(window.getByText('Preferences')).toHaveCount(0);

        await clickMenuItem(app, 'Danevan', 'Open Settings');

        await expect(window.getByText('Preferences')).toBeVisible();
        await expect(window.getByRole('heading', { name: 'Section1' })).toBeVisible();
    } finally {
        await closeShell(app, appDataDir);
    }
});

test('the file and path helpers answer through the real dialogs and shell calls', async () => {
    const appDataDir = createAppDataDir('danevan-native-');
    const app = await launchShell(appDataDir);
    const exported = join(appDataDir, 'exported.sql');
    writeFileSync(exported, 'select 1;');

    try {
        const window = await openAppWindow(app);
        // Blank entries are dropped and the path is trimmed, which is what the form stores.
        await stubNativeSurface(app, ['   ', ` ${exported} `], ` ${exported} `);

        const picked = await window.evaluate((defaultPath) => (globalThis as ElectronBridgeGlobal).electronAPI!.invoke('pickDatabaseFile', { defaultPath }), appDataDir);
        expect(picked).toBe(exported);

        const saved = await window.evaluate((defaultPath) => (globalThis as ElectronBridgeGlobal).electronAPI!.invoke('pickSavePath', { defaultPath }), appDataDir);
        expect(saved).toBe(exported);

        // `reveal-item` reveals, anything else opens the path, and no path does nothing.
        await window.evaluate(() => (globalThis as ElectronBridgeGlobal).electronAPI!.invoke('revealPathInFileManager', { path: '/tmp/revealed.sql', mode: 'reveal-item' }));
        await window.evaluate(() => (globalThis as ElectronBridgeGlobal).electronAPI!.invoke('revealPathInFileManager', { path: '/tmp/opened.sql' }));
        await window.evaluate(() => (globalThis as ElectronBridgeGlobal).electronAPI!.invoke('revealPathInFileManager', {}));

        // The editor helper checks both paths before it launches anything.
        await expect(
            window.evaluate((missing) => (globalThis as ElectronBridgeGlobal).electronAPI!.invoke('openFileInEditor', { path: missing }), join(appDataDir, 'gone.sql'))
        ).rejects.toThrow('The exported file no longer exists on disk.');
        await expect(
            window.evaluate(
                (filePath) => (globalThis as ElectronBridgeGlobal).electronAPI!.invoke('openFileInEditor', { path: filePath, editorPath: '/definitely/not/an/editor' }),
                exported
            )
        ).rejects.toThrow('The selected editor no longer exists on disk.');

        expect(await nativeCalls(app)).toMatchObject({ revealed: ['/tmp/revealed.sql'], openedPaths: ['/tmp/opened.sql'] });
    } finally {
        await closeShell(app, appDataDir);
    }
});

test('a renderer diagnostic reaches the main process', async () => {
    const appDataDir = createAppDataDir('danevan-diagnostics-');
    const app = await launchShell(appDataDir);

    try {
        const window = await openAppWindow(app);
        await stubNativeSurface(app, [], undefined);

        await window.evaluate(() =>
            (globalThis as ElectronBridgeGlobal).electronAPI!.sendDiagnostic({ type: 'console-warn', message: 'diagnostic probe', details: 'from the renderer' })
        );

        await expect.poll(async () => (await nativeCalls(app)).diagnostics).toContainEqual(expect.stringContaining('[renderer:console-warn] diagnostic probe'));
    } finally {
        await closeShell(app, appDataDir);
    }
});

test('closing the last window keeps the app alive until activate opens a new one', async () => {
    const appDataDir = createAppDataDir('danevan-activate-');
    const app = await launchShell(appDataDir);

    try {
        await openAppWindow(app);

        // The window count is read in the main process: Playwright's own list keeps the page it saw.
        const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
        await expect.poll(windowCount, { message: 'closing the only window should leave none' }).toBe(0);
        // macOS keeps the process: `window-all-closed` does not quit it.
        expect(app.process().exitCode).toBeNull();

        await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
        await expect.poll(windowCount, { message: 'activate should create a window again' }).toBe(1);

        // Playwright's window list stays empty once the first window was closed, so what the
        // recreated window drew is read from its `webContents` instead.
        await expect.poll(() => drawnHeading(app), { message: 'the reopened window should draw the app shell' }).toBe(true);
    } finally {
        await closeShell(app, appDataDir);
    }
});
