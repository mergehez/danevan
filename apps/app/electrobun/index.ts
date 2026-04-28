import { app } from '@backend/app.ts';
import { executeTextCommand } from '@backend/bunSubprocess.ts';
import { useAppDb } from '@backend/db-app.ts';
import type { RPCSchema } from 'electrobun/bun';
import Electrobun, { ApplicationMenu, BrowserView, BrowserWindow, Screen, Updater, Utils, type ApplicationMenuItemConfig } from 'electrobun/bun';
import { existsSync } from 'fs';

const ANSI_RESET = '\x1b[0m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';

function getRendererDiagnosticColor(type: RendererDiagnosticPayload['type']) {
    return type === 'console-warn' ? ANSI_YELLOW : type === 'console-error' || type === 'window-error' || type === 'unhandled-rejection' ? ANSI_RED : ANSI_GREEN;
}

function formatRendererDiagnostic(diagnostic: RendererDiagnosticPayload) {
    const header = `[renderer:${diagnostic.type}] ${diagnostic.message}`;
    const body = diagnostic.details ? `${header}\n${diagnostic.details}` : header;

    return `${getRendererDiagnosticColor(diagnostic.type)}${body}${ANSI_RESET}`;
}

export type NativeCommand = {
    kind: 'open-settings';
};

export type RendererDiagnosticPayload = {
    type: 'console-debug' | 'console-info' | 'console-log' | 'console-warn' | 'console-error' | 'window-error' | 'unhandled-rejection';
    message: string;
    details?: string;
};

async function pickApplication(options: { defaultPath: string; extensions?: string[] }) {
    const paths = await Utils.openFileDialog({
        startingFolder: options.defaultPath,
        allowedFileTypes: ((exts?: string[]) => (exts && exts.length > 0 ? exts.join(',') : '*'))(options.extensions),
        canChooseFiles: true,
        canChooseDirectory: false,
        allowsMultipleSelection: false,
    });
    const path = paths.map((value) => value.trim()).find(Boolean);

    if (!path) {
        return undefined;
    }

    let label = path.split('/').pop() || path;
    if (label.endsWith('.app') || label.endsWith('.exe')) {
        label = label.slice(0, -4);
    }

    return { path, label };
}

async function pickDatabaseFile(defaultPath?: string) {
    const paths = await Utils.openFileDialog({
        startingFolder: defaultPath || Utils.paths.home,
        allowedFileTypes: '*',
        canChooseFiles: true,
        canChooseDirectory: false,
        allowsMultipleSelection: false,
    });

    return paths.map((value) => value.trim()).find(Boolean);
}

function _mapNo<TMethod extends () => any>(method: TMethod) {
    return async (): Promise<Awaited<ReturnType<TMethod>>> => await method();
}
function _mapPs<TMethod extends (...args: any) => any>(method: TMethod) {
    return async (ps: Parameters<TMethod>[0]): Promise<Awaited<ReturnType<TMethod>>> => await method(ps);
}
function _mapWindow<TMethod extends (window: BrowserWindow | undefined, ...args: any) => any>(method: TMethod) {
    return async (ps: Parameters<TMethod>[1]): Promise<Awaited<ReturnType<TMethod>>> => await method(window, ps);
}

type AppRequestHandler<TParams, TResponse> = (params: TParams) => Promise<TResponse> | TResponse;
const APP_RPC_MAX_REQUEST_TIME = 120_000;

export const appRequestHandlers = {
    getEditorSettings: _mapNo(() => app.getEditorSettings()),
    pickEditorApplication: _mapWindow(async function () {
        return await pickApplication({
            defaultPath: process.platform === 'darwin' ? '/Applications' : Utils.paths.home,
            extensions: process.platform === 'darwin' ? ['app'] : process.platform === 'win32' ? ['exe'] : undefined,
        });
    }),
    pickDatabaseFile: _mapPs(async (ps: { defaultPath?: string } | undefined) => {
        return pickDatabaseFile(ps?.defaultPath);
    }),
    updateEditorSettings: _mapPs(app.updateEditorSettings),
    getBootstrap: _mapNo(app.getBootstrap),
    createServer: _mapPs(app.createServer),
    updateServer: _mapPs(app.updateServer),
    deleteServer: _mapPs(app.deleteServer),
    reorderServer: _mapPs(app.reorderServer),
    selectServer: _mapPs(app.selectServer),
    createConnection: _mapPs(app.createConnection),
    createConnectionFromServerSchema: _mapPs(app.createConnectionFromServerSchema),
    setVisibleServerSchemas: _mapPs(app.setVisibleServerSchemas),
    updateConnection: _mapPs(app.updateConnection),
    deleteConnection: _mapPs(app.deleteConnection),
    reorderConnection: _mapPs(app.reorderConnection),
    selectConnection: _mapPs(app.selectConnection),
    disconnectConnection: _mapPs(app.disconnectConnection),
    testConnection: _mapPs(app.testConnection),
    getMsAccessRuntimeStatus: _mapNo(() => app.getMsAccessRuntimeStatus()),
    createScript: _mapPs(app.createScript),
    updateScript: _mapPs(app.updateScript),
    deleteScript: _mapPs(app.deleteScript),
    reorderScript: _mapPs(app.reorderScript),
    selectScript: _mapPs(app.selectScript),
    getTables: _mapPs(app.getTables),
    getTableInfo: _mapPs(app.getTableInfo),
    getTableDdl: _mapPs(app.getTableDdl),
    getServerSchemas: _mapPs(app.getServerSchemas),
    refreshServerSchemas: _mapPs(app.refreshServerSchemas),
    refreshConnectionSchema: _mapPs(app.refreshConnectionSchema),
    invalidateAllMetadataCaches: _mapNo(() => app.invalidateAllMetadataCaches()),
    refreshTableInfo: _mapPs(app.refreshTableInfo),
    dropTable: _mapPs(app.dropTable),
    getTableData: _mapPs(app.getTableData),
    peekFkUsages: _mapPs(app.peekFkUsages),
    peekFkUsageRows: _mapPs(app.peekFkUsageRows),
    runQuery: _mapPs(app.runQuery),
    getSqlDiagnostics: _mapPs(app.getSqlDiagnostics),
    formatSql: _mapPs(app.formatSql),
    updateColumn: _mapPs(app.updateColumn),
    applyTableChanges: _mapPs(app.applyTableChanges),
    modifyTable: _mapPs(app.modifyTable),
    getGridCustomFormatters: _mapNo(app.getGridCustomFormatters),
    getGridFormatterState: _mapPs(app.getGridFormatterState),
    saveGridCustomFormatter: _mapPs(app.saveGridCustomFormatter),
    deleteGridCustomFormatter: _mapPs(app.deleteGridCustomFormatter),
    setGridColumnFormatter: _mapPs(app.setGridColumnFormatter),
    revealPathInFileManager: _mapPs(async (ps: { path: string; mode?: 'reveal-item' | 'open-path' }) => {
        if (ps.mode === 'reveal-item') {
            Utils.showItemInFolder(ps.path);
            return;
        }

        Utils.openPath(ps.path);
    }),
    openPathWithDefaultProgram: _mapPs(async (ps: { path: string }) => {
        Utils.openPath(ps.path);
    }),
    openFileInEditor: _mapPs(async (ps: { path: string; editorPath: string }) => {
        const resolved = app.openResolvedPathInEditor(ps);

        const command = process.platform === 'darwin' ? 'open' : resolved.editorPath || ps.editorPath;
        const args = process.platform === 'darwin' ? ['-a', ps.editorPath, resolved.path] : [resolved.path];
        const [, , exitCode] = await executeTextCommand({
            command,
            args,
        });

        if (exitCode !== 0) {
            throw new Error('Failed to open the file in the selected application.');
        }
    }),
} as const satisfies Record<string, AppRequestHandler<any, any>>;

type AppRequestMapFromHandlers<THandlers extends Record<string, AppRequestHandler<any, any>>> = {
    [K in keyof THandlers]: {
        params: Parameters<THandlers[K]>[0];
        response: Awaited<ReturnType<THandlers[K]>>;
    };
};

type AppRequestApiFromMap<TMap extends Record<string, { params: unknown; response: unknown }>> = {
    [K in keyof TMap]: undefined extends TMap[K]['params']
        ? (params?: TMap[K]['params']) => Promise<TMap[K]['response']>
        : (params: TMap[K]['params']) => Promise<TMap[K]['response']>;
};
export type AppRequestMap = AppRequestMapFromHandlers<typeof appRequestHandlers>;

export type AppRequestApi = AppRequestApiFromMap<AppRequestMap>;

export type AppRequestDefinition = {
    params: unknown;
    response: unknown;
};
type AppRequestMapConstraint<TMap> = {
    [K in keyof TMap]: AppRequestDefinition;
};

export type AppBridge<TMap extends AppRequestMapConstraint<TMap>> = {
    invoke<K extends keyof TMap>(name: K, params: TMap[K]['params']): Promise<TMap[K]['response']>;
    onNativeCommand(listener: (command: NativeCommand) => void): () => void;
};

function installMenu() {
    const menu: ApplicationMenuItemConfig[] = [
        {
            label: 'Danevan',
            submenu: [
                { role: 'about' },
                {
                    label: 'Open Settings',
                    action: 'open-settings',
                    accelerator: 'CmdOrCtrl+,',
                },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'showAll' },
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
                    action: 'toggle-devtools',
                    accelerator: 'CmdOrCtrl+Alt+I',
                },
                {
                    label: 'Reload',
                    action: 'reload-window',
                    accelerator: 'CmdOrCtrl+R',
                },
            ],
        },
    ];

    ApplicationMenu.setApplicationMenu(menu);

    Electrobun.events.on('application-menu-clicked', (event) => {
        switch (event.data.action) {
            case 'open-settings':
                if (window.isMinimized()) {
                    window.unminimize();
                }

                window.show();
                window.focus();

                rpc.send.nativeCommand({ kind: 'open-settings' });
                break;
            case 'toggle-devtools':
                window?.webview.toggleDevTools();
                break;
            case 'reload-window':
                window?.webview.executeJavascript('window.location.reload()');
                break;
        }
    });
}

useAppDb().configureDatabase(Utils.paths.appData + '/danevan');
installMenu();

export type DanevanElectrobunRpc = {
    bun: RPCSchema<{
        requests: AppRequestMap;
        messages: {
            rendererDiagnostic: RendererDiagnosticPayload;
        };
    }>;
    webview: RPCSchema<{
        requests: {};
        messages: {
            nativeCommand: NativeCommand;
        };
    }>;
};
const rpc = BrowserView.defineRPC<DanevanElectrobunRpc>({
    maxRequestTime: APP_RPC_MAX_REQUEST_TIME,
    handlers: {
        requests: appRequestHandlers,
        messages: {
            rendererDiagnostic(diagnostic: RendererDiagnosticPayload) {
                const write =
                    diagnostic.type === 'console-debug'
                        ? console.debug
                        : diagnostic.type === 'console-info' || diagnostic.type === 'console-log'
                          ? console.log
                          : diagnostic.type === 'console-warn'
                            ? console.warn
                            : console.error;

                write(formatRendererDiagnostic(diagnostic));
            },
            '*'(message, origin) {
                if (message === 'rendererDiagnostic') {
                    return;
                }

                console.warn(`Received unknown message from webview:`, { message, origin });
            },
        },
    },
});

const DEV_SERVER_URL = 'http://127.0.0.1:5173';

async function getMainViewUrl(): Promise<string> {
    const channel = await Updater.localInfo.channel();
    if (channel === 'dev') {
        try {
            await fetch(DEV_SERVER_URL, { method: 'HEAD' });
            console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
            return DEV_SERVER_URL;
        } catch {
            console.log("Vite dev server not running. Run 'bun run dev' for HMR support.");
        }
    }
    return 'views://mainview/index.html';
}

const window = new BrowserWindow({
    title: 'Danevan',
    frame: (() => {
        const display = Screen.getPrimaryDisplay();
        const width = Math.max(display.workArea.width * 0.5, 1440);
        const height = Math.max(display.workArea.height * 0.8, 720);
        const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2);
        const y = Math.round(display.workArea.y + (display.workArea.height - height) / 2);

        return { x, y, width, height };
    })(),
    titleBarStyle: 'default',
    url: await getMainViewUrl(),
    rpc: rpc,
});

if (!existsSync(Utils.paths.appData + '/danevan')) {
    console.log('Application data directory will be created on first write.');
}
