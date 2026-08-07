import { contextBridge, ipcRenderer } from 'electron';
import { createPreloadApi } from '../electronUtils/mainProloadHelpers';
import type { NativeCommand } from '../shared/types';

const api = createPreloadApi<NativeCommand>(ipcRenderer, contextBridge);
export type ElectronAPI = typeof api;
