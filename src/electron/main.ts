/**
 * Electron main process
 *
 * Responsibilities:
 *  - Initialise the backend database
 *  - Register IPC handlers that bridge renderer requests to backend app methods
 *  - Handle native OS operations
 *  - Create the BrowserWindow and load the frontend
 *  - Install the application menu
 */

import { app as backendApp } from '@backend/app.ts';
import { useAppDb } from '@backend/db-app.ts';
import { apiMethods } from '@utils/apiMethods';
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, type MenuItemConstructorOptions } from 'electron';
import { homedir, platform } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const IS_DEV = process.env.NODE_ENV === 'development' || process.env.VITE_DEV2 === 'true' || !app.isPackaged;
const DEV_SERVER_URL = 'http://127.0.0.1:3263';
const FRONTEND_DIST = join(__dirname, '..', 'src', 'mainview', 'dist', 'index.html');

function resolveAppDataDir(): string {
    const appData = process.env.DANEVAN_DATA_DIR;
    if (appData) return appData;

    const elecAppData = app.getPath('appData');
    return join(elecAppData, 'danevan');
}

const userDataDir = resolveAppDataDir();
useAppDb().configureDatabase(userDataDir);

async function pickDatabaseFile(defaultPath?: string) {
    const result = await dialog.showOpenDialog({
        defaultPath: defaultPath || homedir(),
        properties: ['openFile'],
    });

    return result.filePaths.map((value) => value.trim()).find(Boolean);
}

type BackendApp = typeof backendApp;
type BackendMethodKeys = keyof BackendApp & (typeof apiMethods)[number];
type BackendHandlers = {
    [K in BackendMethodKeys]: (ps: Parameters<BackendApp[K]>[0]) => Promise<Awaited<ReturnType<BackendApp[K]>>>;
};

function createHandlers() {
    // Auto-generate backend handlers from apiMethods.
    const backendHandlers: Record<string, (event: Electron.IpcMainInvokeEvent, ps?: unknown) => Promise<unknown>> = {};
    for (const name of apiMethods) {
        const fn = (backendApp as Record<string, (ps?: unknown) => unknown>)[name];
        if (typeof fn === 'function') {
            backendHandlers[name] = async (_event: Electron.IpcMainInvokeEvent, ps?: unknown) => fn(ps);
        }
    }

    return {
        ...(backendHandlers as unknown as BackendHandlers),
        pickDatabaseFile: async (_: Electron.IpcMainInvokeEvent, ps?: { defaultPath?: string }) => {
            return pickDatabaseFile(ps?.defaultPath);
        },
    };
}

export type HandlersMap = ReturnType<typeof createHandlers>;

/** Renderer-facing API: strips the IPC event param from each handler. */
export type AppRequestApi = {
    [K in keyof HandlersMap]: undefined extends Parameters<HandlersMap[K]>[0]
        ? (params?: Parameters<HandlersMap[K]>[0]) => Promise<Awaited<ReturnType<HandlersMap[K]>>>
        : (params: Parameters<HandlersMap[K]>[0]) => Promise<Awaited<ReturnType<HandlersMap[K]>>>;
};

function registerIpcHandlers() {
    const handlers = createHandlers();
    for (const [methodName, handler] of Object.entries(handlers)) {
        ipcMain.handle(`api:${methodName}`, handler as (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown);
    }
}

type RendererDiagnosticPayload = {
    type: 'console-debug' | 'console-info' | 'console-log' | 'console-warn' | 'console-error' | 'window-error' | 'unhandled-rejection';
    message: string;
    details?: string;
};
const ANSI_RESET = '\x1b[0m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';
ipcMain.on('renderer:diagnostic', (_event, diagnostic: RendererDiagnosticPayload) => {
    const write =
        diagnostic.type === 'console-debug'
            ? console.debug
            : diagnostic.type === 'console-info' || diagnostic.type === 'console-log'
              ? console.log
              : diagnostic.type === 'console-warn'
                ? console.warn
                : console.error;

    const header = `[renderer:${diagnostic.type}] ${diagnostic.message}`;
    const body = diagnostic.details ? `${header}\n${diagnostic.details}` : header;
    const color = diagnostic.type === 'console-warn' ? ANSI_YELLOW : ['console-error', 'window-error', 'unhandled-rejection'].includes(diagnostic.type) ? ANSI_RED : ANSI_GREEN;
    write(`${color}${body}${ANSI_RESET}`);
});

function installMenu(win: BrowserWindow) {
    const template: MenuItemConstructorOptions[] = [
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
                        win.webContents.send('nativeCommand', { kind: 'open-settings' });
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

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

async function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const width = Math.max(screenWidth * 0.5, 1440);
    const height = Math.max(screenHeight * 0.95, 720);
    const x = Math.round((screenWidth - width) / 2);
    const y = Math.round((screenHeight - height) / 2);

    const win = new BrowserWindow({
        title: 'Danevan',
        x,
        y,
        width,
        height,
        titleBarStyle: 'default',
        webPreferences: {
            preload: join(__dirname, 'preload.mjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    installMenu(win);

    if (IS_DEV) {
        win.loadURL(DEV_SERVER_URL);
        win.webContents.openDevTools();
    } else {
        win.loadFile(FRONTEND_DIST);
    }

    return win;
}

app.whenReady().then(async () => {
    registerIpcHandlers();

    await createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (platform() !== 'darwin') {
        app.quit();
    }
});
