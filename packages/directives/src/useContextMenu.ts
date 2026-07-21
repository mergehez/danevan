import type { ContextMenuEntry } from '@directives/contextMenuTypes';
import { useOverlaysState } from '@directives/useOverlaysState';
import { computed, reactive, ref } from 'vue';

type ContextMenuPosition = {
    x: number;
    y: number;
};

export type ContextMenuPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start';
type ContextMenuOpenOptions = {
    autoFocus?: boolean;
    key?: string;
};

function getDefaultState() {
    return {
        open: false,
        x: 0,
        y: 0,
        items: [] as ContextMenuEntry[],
        autoFocus: false,
        key: undefined as string | undefined,
        element: undefined as HTMLElement | undefined,
        elementRect: undefined as DOMRect | undefined,
        zIndex: 90,
    };
}

export function _useContextMenu() {
    const state = ref(getDefaultState());

    const overlayState = useOverlaysState();

    function closeMenu() {
        state.value = getDefaultState();
        overlayState.releaseZIndex(state.value.zIndex);
    }

    function openAtPosition(position: ContextMenuPosition, items: ContextMenuEntry[], element?: HTMLElement, options?: ContextMenuOpenOptions) {
        closeMenu();
        state.value = {
            x: position.x,
            y: position.y,
            items: items.map((entry) => reactive(entry)),
            element: element,
            elementRect: element?.getBoundingClientRect(),
            key: options?.key,
            autoFocus: options?.autoFocus === true,
            open: items.length > 0,
            zIndex: overlayState.claimZIndex(),
        };
    }

    function updateItems(items: ContextMenuEntry[]) {
        if (!state.value.open) {
            console.log('Cannot update context menu items when menu is closed');
            return;
        }

        state.value = {
            ...state.value,
            items: items.map((entry) => reactive(entry)),
        };
    }

    function isKeyOpen(key: string) {
        return state.value.open && state.value.key === key;
    }

    function openAtEvent(event: MouseEvent | undefined, items: ContextMenuEntry[], options?: ContextMenuOpenOptions) {
        if (!event) {
            return;
        }

        openAtPosition({ x: event.clientX, y: event.clientY }, items, event.currentTarget as HTMLElement, options);
    }

    function getElementPosition(element: HTMLElement, placement: ContextMenuPlacement): ContextMenuPosition {
        const bounds = element.getBoundingClientRect();
        const offset = 6;

        switch (placement) {
            case 'top-start':
                return {
                    x: Math.round(bounds.left),
                    y: Math.round(bounds.top - offset),
                };
            case 'top-end':
                return {
                    x: Math.round(bounds.right),
                    y: Math.round(bounds.top - offset),
                };
            case 'right-start':
                return {
                    x: Math.round(bounds.right + offset),
                    y: Math.round(bounds.top),
                };
            case 'left-start':
                return {
                    x: Math.round(bounds.left - offset),
                    y: Math.round(bounds.top),
                };
            case 'bottom-end':
                return {
                    x: Math.round(bounds.right),
                    y: Math.round(bounds.bottom + offset),
                };
            case 'bottom-start':
            default:
                return {
                    x: Math.round(bounds.left),
                    y: Math.round(bounds.bottom + offset),
                };
        }
    }

    function openAtElement(element: HTMLElement | undefined, items: ContextMenuEntry[], placement: ContextMenuPlacement = 'bottom-start', options?: ContextMenuOpenOptions) {
        if (!element) {
            return;
        }

        openAtPosition(getElementPosition(element, placement), items, element, options);
    }

    return reactive({
        open: computed(() => state.value.open),
        items: computed(() => state.value.items),
        x: computed(() => state.value.x),
        y: computed(() => state.value.y),
        element: computed(() => state.value.element),
        elementRect: computed(() => state.value.elementRect),
        zIndex: computed(() => state.value.zIndex),
        autoFocus: computed(() => state.value.autoFocus),

        closeMenu: closeMenu,
        isKeyOpen: isKeyOpen,
        openAtEvent: openAtEvent,
        openAtPosition: openAtPosition,
        openAtElement: openAtElement,
        updateItems: updateItems,
    });
}

let globalState: ReturnType<typeof _useContextMenu> | null = null;

export function useContextMenu() {
    if (!globalState) {
        globalState = _useContextMenu();
    }

    return globalState;
}
