/// <reference types="vite-plus/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';

    const component: DefineComponent<object, object, unknown>;
    export default component;
}

interface Window {
    appClient?: import('./electron/preload.ts').ElectronAPI;
}

interface Element {
    openContextMenu?: import('./packages/directives/src/VContextMenu').ContextMenuHostElement['openContextMenu'];
}
