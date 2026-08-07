// NOTE:
// this file shouldn't contain project-specific logic. It should only contain generic helpers for Electron apps that use a backend server and a frontend built with Vite.
// we should be able to copy this file into another project and use it without any modifications.

import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { appConfig, callApiPost } from './helpers';

const config = appConfig;

// __dirname: CJS provides it directly; ESM needs fileURLToPath(import.meta.url)
const __dirname = typeof __filename !== 'undefined' ? dirname(__filename) : dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

export type RendererDiagnosticPayload = {
    type: 'console-debug' | 'console-info' | 'console-log' | 'console-warn' | 'console-error' | 'window-error' | 'unhandled-rejection';
    message: string;
    details?: string;
};
export type CreateAppClientRequestApi<HandlersMap extends Record<string, any>> = {
    [K in keyof HandlersMap]: undefined extends Parameters<HandlersMap[K]>[0]
        ? (params?: Parameters<HandlersMap[K]>[0]) => Promise<Awaited<ReturnType<HandlersMap[K]>>>
        : (params: Parameters<HandlersMap[K]>[0]) => Promise<Awaited<ReturnType<HandlersMap[K]>>>;
};

type Opts<AppServiceType extends Record<string, any>, NativeMethods extends Record<string, any>> = {
    apiMethods: AppServiceType; // this is a hack. we actually get a string array of method names, but we use this type to infer the types of the backend methods
    getNativeMethods: (mainWindow: BrowserWindow, apiPost: (method: string, params?: unknown) => Promise<unknown>) => NativeMethods;
    getMenu: (mainWindow: BrowserWindow) => Electron.MenuItemConstructorOptions[];
    windowSize?: (screen: Electron.Display['workAreaSize']) => { width: number; height: number; x: number; y: number };
};
export function createElectronHelpers<AppServiceType extends Record<string, any>, NativeMethods extends Record<string, any>>(opts: Opts<AppServiceType, NativeMethods>) {
    const { apiMethods, getNativeMethods, getMenu } = opts;

    function generateHandlers(mainWindow: BrowserWindow) {
        // type AppMethodKeys = { [K in keyof AppServiceType]: AppServiceType[K] extends (...args: any[]) => any ? K : never }[keyof AppServiceType];
        type BackendHandlers = {
            [K in keyof AppServiceType]: (ps: Parameters<AppServiceType[K]>[0]) => Promise<Awaited<ReturnType<AppServiceType[K]>>>;
        };

        const handlers = {} as any;
        for (const name of apiMethods as any) {
            // handlers[name] = async (_event: Electron.IpcMainInvokeEvent, ps?: unknown) => callApiPost(name as string, ps);
            handlers[name] = async (ps?: unknown) => callApiPost(name as string, ps);
        }

        const nativeMethods = getNativeMethods(mainWindow, callApiPost);

        return {
            ...(handlers as BackendHandlers),
            ...nativeMethods,
        };
    }

    function registerIpcHandlers(handlers: Record<string, any>) {
        for (const [name, handler] of Object.entries(handlers)) {
            ipcMain.handle(name, async (_event, ps) => (handler as (ps?: unknown) => Promise<unknown>)(ps));
        }

        const ANSI_RESET = '\x1b[0m';
        const ANSI_GREEN = '\x1b[32m';
        const ANSI_YELLOW = '\x1b[33m';
        const ANSI_RED = '\x1b[31m';
        // ipcMain.on('renderer-diagnostic', (_event, diagnostic: RendererDiagnosticPayload) => {
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
            const color =
                diagnostic.type === 'console-warn' ? ANSI_YELLOW : ['console-error', 'window-error', 'unhandled-rejection'].includes(diagnostic.type) ? ANSI_RED : ANSI_GREEN;
            write(`${color}${body}${ANSI_RESET}`);
        });
    }

    async function createWindow() {
        const primaryDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        opts.windowSize ??= (screen) => {
            const width = Math.round(Math.min(Math.max(screen.width * 0.5, 1440), screen.width));
            return { width, height: screen.height, x: 0, y: 0 };
        };
        const { width, height, x, y } = opts.windowSize(primaryDisplay.workAreaSize);

        console.log('workAreaSize', primaryDisplay.workAreaSize);
        console.log('requested bounds: ', { width, height, x, y });
        const mainWindow = new BrowserWindow({
            title: config.appName,
            x,
            y,
            width,
            height: height,
            titleBarStyle: 'default',
            webPreferences: {
                preload: join(__dirname, 'preload.cjs'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
            },
        });

        Menu.setApplicationMenu(Menu.buildFromTemplate(getMenu(mainWindow)));
        const handlers = generateHandlers(mainWindow);
        registerIpcHandlers(handlers);

        if (isDev) {
            try {
                const url = `http://127.0.0.1:${config.vuePort}`;
                await fetch(url, { method: 'HEAD' });
                await mainWindow.loadURL(url);
                // mainWindow.webContents.openDevTools();
                console.log('Using Vite dev server');
                return;
            } catch {
                /* fall through */
            }
        }

        const indexPath = join(projectRoot, 'dist', 'index.html');
        if (existsSync(indexPath)) await mainWindow.loadFile(indexPath);
        else throw new Error(`Frontend build not found at ${indexPath}. Run 'vp build' first.`);

        // final height
        console.log('final bounds: ', mainWindow.getBounds());
    }

    function start() {
        const _require = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);

        app.whenReady().then(async () => {
            console.log('Starting backend server...');
            await ((): Promise<void> => {
                const mod = _require('./backend.cjs') as { ready?: Promise<void> };
                return mod.ready ?? Promise.resolve();
            })();
            console.log('Backend started. Creating window...');
            await createWindow();
            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) createWindow();
            });
        });

        function stopBackend() {}
        app.on('window-all-closed', () => {
            stopBackend();
            if (process.platform !== 'darwin') app.quit();
        });
        app.on('will-quit', () => {
            stopBackend();
        });
    }
    return {
        generateHandlers,
        start,
        isDev,
    };
}

export function createPreloadApi<NativeCommand>(ipcRenderer: Electron.IpcRenderer, contextBridge: Electron.ContextBridge) {
    const api = {
        invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
        onNativeCommand: (listener: (command: NativeCommand) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, command: NativeCommand) => {
                listener(command);
            };
            ipcRenderer.on('native-command', handler);
            return () => {
                ipcRenderer.removeListener('native-command', handler);
            };
        },
        sendDiagnostic: (payload: unknown) => ipcRenderer.send('renderer-diagnostic', payload),
    };
    contextBridge.exposeInMainWorld('electronAPI', api);
    return api;
}
