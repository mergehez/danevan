/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';

    const component: DefineComponent<object, object, unknown>;
    export default component;
}

interface Window {
    appClient?: import('./src/electron/preload.ts').ElectronAPI;
}

interface Element {
    openContextMenu?: import('./src/directives/VContextMenu').ContextMenuHostElement['openContextMenu'];
}
