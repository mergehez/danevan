/**
 * Electron preload script — bridges renderer to main process via contextBridge.
 *
 * Exposes `window.appClient` with:
 *  - `invoke(name, params)` — calls a backend IPC handler
 *  - `onNativeCommand(listener)` — subscribes to nativeCommand events from main
 *  - `diagnostic(payload)` — forwards renderer diagnostics to main process
 */

import { contextBridge, ipcRenderer } from 'electron';

type NativeCommand = {
    kind: 'open-settings';
    panel?: string;
};

type DiagnosticPayload = {
    type: string;
    message: string;
    details?: string;
};

const nativeCommandListeners = new Set<(command: NativeCommand) => void>();

// Listen for native commands from the main process
ipcRenderer.on('nativeCommand', (_event, command: NativeCommand) => {
    nativeCommandListeners.forEach((listener) => listener(command));
});

const appClient = {
    invoke: (name: string, params?: unknown) => {
        return ipcRenderer.invoke(`api:${name}`, params);
    },
    onNativeCommand: (listener: (command: NativeCommand) => void) => {
        nativeCommandListeners.add(listener);
        return () => {
            nativeCommandListeners.delete(listener);
        };
    },
    diagnostic: (payload: DiagnosticPayload) => {
        ipcRenderer.send('renderer:diagnostic', payload);
    },
};

export type ElectronAPI = typeof appClient;

contextBridge.exposeInMainWorld('appClient', appClient);
