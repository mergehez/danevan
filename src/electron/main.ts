import { execFileSync } from 'child_process';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { app as backendApp } from '../backend/app.ts';
import { useAppDb } from '../backend/db-app.ts';
import { createElectronHelpers, type CreateAppClientRequestApi } from '../electronUtils/mainProloadHelpers.ts';
import { apiMethods } from '../shared/utils/apiMethods';

function getVsCodePath(): string | undefined {
    const candidates = [
        '/Applications/Visual Studio Code.app',
        '/Applications/Visual Studio Code - Insiders.app',
        '/usr/local/bin/code',
        '/opt/homebrew/bin/code',
        join(homedir(), 'Applications/Visual Studio Code.app'),
    ];

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

const helpers = createElectronHelpers({
    apiMethods: apiMethods as unknown as typeof backendApp,
    getNativeMethods: (_mainWindow, _apiPost) => ({
        pickDatabaseFile: async (ps?: { defaultPath?: string }) => {
            const result = await dialog.showOpenDialog({
                defaultPath: ps?.defaultPath || homedir(),
                properties: ['openFile'],
            });

            return result.filePaths.map((value) => value.trim()).find(Boolean);
        },
        pickSavePath: async (ps?: { defaultPath?: string }) => {
            const result = await dialog.showSaveDialog({
                defaultPath: ps?.defaultPath || homedir(),
            });

            return result.filePath?.trim() || undefined;
        },
        revealPathInFileManager: async (ps?: { path?: string; mode?: string }) => {
            if (!ps?.path) {
                return;
            }

            if (ps.mode === 'reveal-item') {
                shell.showItemInFolder(ps.path);
            } else {
                await shell.openPath(ps.path);
            }
        },
        openFileInEditor: async (ps?: { path?: string; editorPath?: string }) => {
            if (!ps?.path) {
                return;
            }

            if (!existsSync(ps.path)) {
                throw new Error('The exported file no longer exists on disk.');
            }

            const editorPath = ps.editorPath || getVsCodePath();

            if (!editorPath) {
                throw new Error('Visual Studio Code was not found on this machine.');
            }

            if (!existsSync(editorPath)) {
                throw new Error('The selected editor no longer exists on disk.');
            }

            if (process.platform === 'darwin') {
                execFileSync('open', ['-a', editorPath, ps.path]);
            } else {
                execFileSync(editorPath, [ps.path]);
            }
        },
    }),
    getMenu: (win: BrowserWindow) => {
        const template: Electron.MenuItemConstructorOptions[] = [
            {
                label: 'Danevan',
                submenu: [
                    { role: 'about' },
                    {
                        label: 'Open Settings',
                        accelerator: 'CmdOrCtrl+,',
                        click: () => {
                            if (win.isMinimized()) win.restore();
                            win.show();
                            win.focus();
                            win.webContents.send('native-command', { kind: 'open-settings' });
                        },
                    },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { type: 'separator' },
                    { role: 'quit' },
                ],
            },
            {
                label: 'Edit',
                submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
            },
            {
                label: 'View',
                submenu: [
                    {
                        label: 'Toggle Developer Tools',
                        accelerator: 'CmdOrCtrl+Alt+I',
                        click: () => win.webContents.toggleDevTools(),
                    },
                    {
                        label: 'Reload',
                        accelerator: 'CmdOrCtrl+R',
                        click: () => win.webContents.reload(),
                    },
                ],
            },
        ];
        return template;
    },
});

export type HandlersMap = ReturnType<typeof helpers.generateHandlers>;
export type AppClientRequestApi = CreateAppClientRequestApi<HandlersMap>;

function resolveAppDataDir(): string {
    const appData = process.env.DANEVAN_DATA_DIR;
    if (appData) return appData;

    const elecAppData = app.getPath('appData');
    return join(elecAppData, 'danevan');
}

const userDataDir = resolveAppDataDir();
useAppDb().configureDatabase(userDataDir);

helpers.start();
