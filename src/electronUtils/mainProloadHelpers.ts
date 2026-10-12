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

/** The channel the renderer sends its console/window diagnostics on, both ends of it. */
const RENDERER_DIAGNOSTIC_CHANNEL = 'renderer:diagnostic';
/** Handlers are namespaced on the wire, so an app method cannot clash with an Electron channel. */
const IPC_CHANNEL_PREFIX = 'api:';

// __dirname: CJS provides it directly; ESM needs fileURLToPath(import.meta.url)
const __dirname = typeof __filename !== 'undefined' ? dirname(__filename) : dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

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
    /** Defaults to `fs.existsSync`; injected so a test can choose whether the built frontend exists. */
    fileExists?: (path: string) => boolean;
};
export function createElectronHelpers<AppServiceType extends Record<string, any>, NativeMethods extends Record<string, any>>(opts: Opts<AppServiceType, NativeMethods>) {
    const { apiMethods, getNativeMethods, getMenu } = opts;
    const fileExists = opts.fileExists ?? existsSync;
    // Read at creation time rather than at module scope so a test (and a fork) can set it first.
    const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

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
            // Registering the same name twice throws, so a handler of a window that is gone is
            // replaced rather than added next to its predecessor.
            ipcMain.removeHandler(`${IPC_CHANNEL_PREFIX}${name}`);
            ipcMain.handle(`${IPC_CHANNEL_PREFIX}${name}`, async (_event, ps) => (handler as (ps?: unknown) => Promise<unknown>)(ps));
        }

        const ANSI_RESET = '\x1b[0m';
        const ANSI_GREEN = '\x1b[32m';
        const ANSI_YELLOW = '\x1b[33m';
        const ANSI_RED = '\x1b[31m';
        // Same for the listener: it does not belong to a window, so it is registered once.
        ipcMain.removeAllListeners(RENDERER_DIAGNOSTIC_CHANNEL);
        ipcMain.on(RENDERER_DIAGNOSTIC_CHANNEL, (_event, diagnostic: RendererDiagnosticPayload) => {
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
        if (fileExists(indexPath)) await mainWindow.loadFile(indexPath);
        else throw new Error(`Frontend build not found at ${indexPath}. Run 'vp build' first.`);

        // final height
        console.log('final bounds: ', mainWindow.getBounds());
    }

    /** `loadBackend` is the sibling backend bundle by default; a test injects a stand-in that resolves at once. */
    function start(loadBackend?: () => { ready?: Promise<void> }) {
        const _require = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
        const load = loadBackend ?? (() => _require('./backend.cjs') as { ready?: Promise<void> });

        // A second launch of the same app cannot take the API port the first one owns, and it never
        // reached `createWindow` — the EADDRINUSE had nowhere to go. The launch is handed to the
        // window that is already open instead.
        if (!app.requestSingleInstanceLock()) {
            app.quit();
            return;
        }

        app.on('second-instance', () => {
            const [mainWindow] = BrowserWindow.getAllWindows();

            if (!mainWindow) {
                return;
            }

            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        });

        app.whenReady().then(async () => {
            console.log('Starting backend server...');
            await (async (): Promise<void> => {
                const mod = load();
                return mod.ready ?? Promise.resolve();
            })();
            console.log('Backend started. Creating window...');
            await createWindow();
        });

        function stopBackend() {}
        // The app is single-window and has no dock-only mode: closing the window quits it, so a
        // dock click starts the app afresh. Coming back would re-register every handler, and the
        // second registration throws.
        app.on('window-all-closed', () => {
            stopBackend();
            app.quit();
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
    const nativeCommandListeners = new Set<(command: NativeCommand) => void>();

    // Listen for native commands from the main process
    ipcRenderer.on('native-command', (_event, command: NativeCommand) => {
        nativeCommandListeners.forEach((listener) => listener(command));
    });

    const api = {
        invoke: (name: string, params?: unknown) => {
            return ipcRenderer.invoke(`${IPC_CHANNEL_PREFIX}${name}`, params);
        },
        onNativeCommand: (listener: (command: NativeCommand) => void) => {
            nativeCommandListeners.add(listener);
            return () => {
                nativeCommandListeners.delete(listener);
            };
        },
        sendDiagnostic: (payload: unknown) => ipcRenderer.send(RENDERER_DIAGNOSTIC_CHANNEL, payload),
    };
    contextBridge.exposeInMainWorld('electronAPI', api);
    return api;
}
