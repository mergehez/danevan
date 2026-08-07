import { apiMethods } from '../shared/utils/apiMethods';
import { app, BrowserWindow, dialog } from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import { app as backendApp } from '../backend/app.ts';
import { useAppDb } from '../backend/db-app.ts';
import { createElectronHelpers, type CreateAppClientRequestApi } from '../electronUtils/mainProloadHelpers.ts';

const helpers = createElectronHelpers({
    apiMethods: apiMethods as unknown as typeof backendApp,
    getNativeMethods: (_mainWindow, _apiPost) => ({
        pickDatabaseFile: async (_: Electron.IpcMainInvokeEvent, ps?: { defaultPath?: string }) => {
            const result = await dialog.showOpenDialog({
                defaultPath: ps?.defaultPath || homedir(),
                properties: ['openFile'],
            });

            return result.filePaths.map((value) => value.trim()).find(Boolean);
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
