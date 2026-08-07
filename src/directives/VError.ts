import type { Directive, DirectiveBinding, ObjectDirective, VNode } from 'vue';
import { type TooltipDirectiveModifiers, type TooltipOptions, vTooltip } from './VTooltip';

export interface ErrorDirectiveOptions extends Omit<TooltipOptions, 'value'> {
    value?: string | undefined;
    message?: string | undefined;
    html?: boolean | undefined;
}

type TooltipTargetElement = HTMLElement & {
    __tooltip?: any;
    __mouseEnter?: any;
    __mouseLeave?: any;
    __click?: any;
    __errorTarget?: TooltipTargetElement | undefined;
    __errorWrapper?: HTMLElement | undefined;
};

type ErrorBinding = Omit<DirectiveBinding, 'modifiers' | 'value'> & {
    value?: string | ErrorDirectiveOptions | undefined;
    modifiers?: TooltipDirectiveModifiers | undefined;
};

type TooltipBinding = Omit<DirectiveBinding, 'modifiers' | 'value'> & {
    value: string | TooltipOptions | undefined;
    modifiers: Partial<Record<string, boolean>>;
};

const tooltipDirective = vTooltip as ObjectDirective<TooltipTargetElement, string | TooltipOptions | undefined>;

function isComponentVNode(vnode: VNode) {
    return typeof vnode.type === 'object' || typeof vnode.type === 'function';
}

function ensureDirectiveTarget(el: TooltipTargetElement, vnode: VNode): TooltipTargetElement {
    if (!isComponentVNode(vnode)) {
        el.__errorTarget = el;
        return el;
    }

    if (el.__errorWrapper?.isConnected) {
        if (el.parentElement !== el.__errorWrapper) {
            el.__errorWrapper.appendChild(el);
        }
        el.__errorTarget = el.__errorWrapper as TooltipTargetElement;
        return el.__errorTarget;
    }

    const parent = el.parentNode;
    if (!parent) {
        el.__errorTarget = el;
        return el;
    }

    const wrapper = document.createElement('div');
    wrapper.style.display = 'inline-block';
    parent.insertBefore(wrapper, el);
    wrapper.appendChild(el);

    el.__errorWrapper = wrapper;
    el.__errorTarget = wrapper as TooltipTargetElement;
    return el.__errorTarget;
}

function getDirectiveTarget(el: TooltipTargetElement) {
    return (el.__errorTarget ?? el) as TooltipTargetElement;
}

function resolveTooltipOptions(value?: string | ErrorDirectiveOptions) {
    if (!value) return undefined;

    if (typeof value === 'string') {
        if (!value) return undefined;
        return {
            value,
            class: 'v-error',
        } as TooltipOptions;
    }

    const message = value.message ?? value.value;
    if (!message) return undefined;

    return {
        value: message,
        class: `v-error ${value.class ?? ''}`.trim(),
        textClass: value.textClass,
    } as TooltipOptions;
}

function resolveModifiers(modifiers?: TooltipDirectiveModifiers, value?: string | ErrorDirectiveOptions): Partial<Record<string, boolean>> {
    const useHtml = typeof value === 'object' ? !!value?.html : false;

    if (modifiers?.top || modifiers?.bottom || modifiers?.left || modifiers?.right) {
        return {
            ...modifiers,
            html: !!modifiers?.html || useHtml,
        };
    }
    modifiers ??= {};

    return {
        ...modifiers,
        bottom: true,
        html: !!modifiers?.html || useHtml,
    };
}

function toTooltipBinding(binding: ErrorBinding, value: TooltipOptions): TooltipBinding {
    return {
        ...binding,
        value,
        modifiers: resolveModifiers(binding.modifiers, binding.value),
    };
}

function toCleanupBinding(binding: ErrorBinding): TooltipBinding {
    return {
        ...binding,
        value: undefined,
        modifiers: resolveModifiers(binding.modifiers, binding.value),
    };
}

export const vError: Directive<TooltipTargetElement> = {
    mounted(el, binding: ErrorBinding, vnode, prevVnode) {
        const target = ensureDirectiveTarget(el, vnode);
        const options = resolveTooltipOptions(binding.value);
        if (!options) return;

        tooltipDirective.mounted?.(target, toTooltipBinding(binding, options), vnode, prevVnode);
    },

    updated(el, binding: ErrorBinding, vnode, prevVnode) {
        const target = ensureDirectiveTarget(el, vnode);
        const options = resolveTooltipOptions(binding.value);

        if (!options) {
            if (target.__tooltip) {
                tooltipDirective.unmounted?.(target, toCleanupBinding(binding), vnode, null);
            }
            return;
        }

        const tooltipBinding = toTooltipBinding(binding, options);
        if (target.__tooltip) {
            tooltipDirective.updated?.(target, tooltipBinding, vnode, prevVnode);
            return;
        }

        tooltipDirective.mounted?.(target, tooltipBinding, vnode, null);
    },

    unmounted(el, binding: ErrorBinding, vnode, prevVnode) {
        const target = getDirectiveTarget(el);

        if (target.__tooltip) {
            tooltipDirective.unmounted?.(target, toCleanupBinding(binding), vnode, prevVnode);
        }

        if (el.__errorWrapper?.isConnected) {
            el.__errorWrapper.remove();
        }

        el.__errorTarget = undefined;
        el.__errorWrapper = undefined;
    },
};
