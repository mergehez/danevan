import type { ContextMenuHostElement } from './VContextMenu';

declare global {
    interface Element {
        openContextMenu?: ContextMenuHostElement['openContextMenu'];
    }
}

export {};
