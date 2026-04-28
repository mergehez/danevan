/// <reference types="vite-plus/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';

    const component: DefineComponent<object, object, unknown>;
    export default component;
}

interface Window {
    appClient: import('./apps/app/electrobun/index.ts').AppBridge<import('./apps/app/electrobun/index.ts').AppRequestMap>;
}

interface Element {
    openContextMenu?: import('./packages/directives/src/VContextMenu').ContextMenuHostElement['openContextMenu'];
}
