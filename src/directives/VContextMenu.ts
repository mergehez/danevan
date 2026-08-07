import type { Directive, DirectiveBinding } from 'vue';
import type { ContextMenuEntry } from './contextMenuTypes';
import { type ContextMenuPlacement, useContextMenu } from './useContextMenu';

export interface ContextMenuDirectiveModifiers {
    right?: boolean | undefined;
    left?: boolean | undefined;
    top?: boolean | undefined;
    bottom?: boolean | undefined;
    start?: boolean | undefined;
    end?: boolean | undefined;
    autoFocus?: boolean | undefined;
    button?: boolean | undefined;
}

export type ContextMenuDirectiveValue = ContextMenuEntry[] | (() => ContextMenuEntry[]);

export interface ContextMenuOptions {
    value?: ContextMenuDirectiveValue | undefined;
    items?: ContextMenuDirectiveValue | undefined;
    key?: string | undefined;
    disabled?: boolean | undefined;
    placement?: ContextMenuPlacement | undefined;
    autoFocus?: boolean | undefined;
}

export type OpenContextMenuOptions = {
    event?: MouseEvent;
    items?: ContextMenuEntry[];
    key?: string;
    placement?: ContextMenuPlacement;
    autoFocus?: boolean;
};

type Bindings = Omit<DirectiveBinding, 'modifiers' | 'value'> & {
    value?: ContextMenuDirectiveValue | ContextMenuOptions | undefined;
    modifiers?: ContextMenuDirectiveModifiers | undefined;
};

type ResolvedContextMenuOptions = {
    items: ContextMenuEntry[];
    key?: string;
    disabled: boolean;
    placement: ContextMenuPlacement;
    autoFocus: boolean;
};

export type ContextMenuHostElement = HTMLElement & {
    openContextMenu: (options?: OpenContextMenuOptions) => void;
    __contextMenuBinding: Bindings | undefined;
    __contextMenuListener: ((event: MouseEvent) => void) | undefined;
    __contextMenuClickListener: ((event: MouseEvent) => void) | undefined;
    __contextMenuKeydownListener: ((event: KeyboardEvent) => void) | undefined;
};

function getPlacement(binding: Bindings): ContextMenuPlacement {
    if (binding.modifiers?.left) {
        return binding.modifiers.end ? 'left-start' : 'left-start';
    }

    if (binding.modifiers?.right) {
        return 'right-start';
    }

    if (binding.modifiers?.top) {
        return binding.modifiers.end ? 'top-end' : 'top-start';
    }

    if (binding.modifiers?.bottom) {
        return binding.modifiers.end ? 'bottom-end' : 'bottom-start';
    }

    return binding.modifiers?.end ? 'bottom-end' : 'bottom-start';
}

function getValueSource(binding: Bindings): ContextMenuDirectiveValue | undefined {
    if (Array.isArray(binding.value) || typeof binding.value === 'function') {
        return binding.value;
    }

    return binding.value?.items ?? binding.value?.value;
}

function resolveItems(source: ContextMenuDirectiveValue | undefined) {
    if (!source) {
        return [];
    }

    return typeof source === 'function' ? source() : source;
}

function useOptions(binding: Bindings): ResolvedContextMenuOptions {
    const options = !Array.isArray(binding.value) && typeof binding.value === 'object' ? binding.value : undefined;

    return {
        items: resolveItems(getValueSource(binding)),
        key: options?.key,
        disabled: !!options?.disabled,
        placement: options?.placement ?? getPlacement(binding),
        autoFocus: options?.autoFocus ?? !!binding.modifiers?.autoFocus,
    };
}

function openBoundContextMenu(el: ContextMenuHostElement, override?: OpenContextMenuOptions) {
    const contextMenu = useContextMenu();
    const binding = el.__contextMenuBinding;

    if (!binding) {
        return;
    }

    const options = useOptions(binding);

    if (options.disabled) {
        return;
    }

    const items = override?.items ?? options.items;

    if (items.length === 0) {
        return;
    }

    el.focus({ preventScroll: true });

    if (override?.event) {
        contextMenu.openAtEvent(override.event, items, {
            key: override.key ?? options.key,
            autoFocus: override.autoFocus ?? options.autoFocus,
        });
        return;
    }

    contextMenu.openAtElement(el, items, override?.placement ?? options.placement, {
        key: override?.key ?? options.key,
        autoFocus: override?.autoFocus ?? options.autoFocus,
    });
}

export const vContextMenu: Directive<ContextMenuHostElement> = {
    mounted(el, binding: Bindings) {
        el.__contextMenuBinding = binding;
        el.openContextMenu = (options?: OpenContextMenuOptions) => {
            openBoundContextMenu(el, options);
        };

        el.__contextMenuListener = (event: MouseEvent) => {
            event.preventDefault();
            openBoundContextMenu(el, { event });
        };

        el.__contextMenuClickListener = (event: MouseEvent) => {
            if (!el.__contextMenuBinding?.modifiers?.button) {
                return;
            }

            event.preventDefault();
            openBoundContextMenu(el);
        };

        el.__contextMenuKeydownListener = (event: KeyboardEvent) => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
                return;
            }

            event.preventDefault();
            openBoundContextMenu(el);
        };

        el.addEventListener('contextmenu', el.__contextMenuListener);
        el.addEventListener('click', el.__contextMenuClickListener);
        el.addEventListener('keydown', el.__contextMenuKeydownListener);
    },

    updated(el, binding: Bindings) {
        el.__contextMenuBinding = binding;

        const contextMenu = useContextMenu();

        if (!contextMenu.open || contextMenu.element !== el) {
            return;
        }

        contextMenu.updateItems(useOptions(binding).items);
    },

    unmounted(el) {
        if (el.__contextMenuListener) {
            el.removeEventListener('contextmenu', el.__contextMenuListener);
        }

        if (el.__contextMenuKeydownListener) {
            el.removeEventListener('keydown', el.__contextMenuKeydownListener);
        }

        if (el.__contextMenuClickListener) {
            el.removeEventListener('click', el.__contextMenuClickListener);
        }

        el.__contextMenuBinding = undefined;
        el.__contextMenuListener = undefined;
        el.__contextMenuClickListener = undefined;
        el.__contextMenuKeydownListener = undefined;
        el.openContextMenu = () => {};
    },
};
