import type { ContextMenuHostElement } from '@directives/VContextMenu';

declare global {
    interface Element {
        openContextMenu?: ContextMenuHostElement['openContextMenu'];
    }
}

export {};
