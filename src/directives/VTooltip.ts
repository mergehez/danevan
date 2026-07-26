import { useOverlaysState } from '@directives/useOverlaysState';
import { twMerge } from 'tailwind-merge';
import type { Directive, DirectiveBinding } from 'vue';

export interface TooltipDirectiveModifiers {
    right?: boolean | undefined;
    left?: boolean | undefined;
    top?: boolean | undefined;
    bottom?: boolean | undefined;
    sm?: boolean | undefined;
    xs?: boolean | undefined;
    html?: boolean | undefined;
    always?: boolean | undefined;
    delay?: boolean | undefined;
    nowrap?: boolean | undefined;
}

export interface TooltipOptions {
    value?: string | undefined;
    class?: string | undefined;
    textClass?: string | undefined;
    always?: boolean | undefined;
}

type Bindings = Omit<DirectiveBinding, 'modifiers' | 'value'> & {
    value?: string | TooltipOptions | undefined;
    modifiers?: TooltipDirectiveModifiers | undefined;
};

type Elems = { tooltip: HTMLElement; text: HTMLElement; arrow: HTMLElement };

type Placement = 'top' | 'right' | 'bottom' | 'left';
type ComputedOptions = {
    content: string;
    tooltipClass: string;
    textClass: string;
    arrowClass: string;
    always: boolean;
    shouldNowrap: boolean;
    shouldDelay: boolean;
    size: 'default' | 'sm' | 'xs';
    useHtml: boolean;
    placement: Placement;
};

const overlayState = useOverlaysState();

function useOptions(binding: Bindings): ComputedOptions {
    const customClass = typeof binding.value === 'object' ? binding.value.class : undefined;
    const textClass = typeof binding.value === 'object' ? binding.value.textClass : undefined;
    const size = binding.modifiers?.xs ? 'xs' : binding.modifiers?.sm ? 'sm' : 'default';
    const shouldNowrap = !!binding.modifiers?.nowrap;
    const useHtml = !!binding.modifiers?.html;
    const placement: Placement = binding.modifiers?.right ? 'right' : binding.modifiers?.left ? 'left' : binding.modifiers?.top ? 'top' : 'bottom';

    return {
        content: typeof binding.value === 'string' ? binding.value : binding.value?.value || '',
        tooltipClass: twMerge(
            'tooltip',
            size === 'sm' ? 'tooltip-sm' : size === 'xs' ? 'tooltip-xs' : undefined,
            customClass,
            shouldNowrap ? 'tooltip-nowrap' : undefined,
            useHtml ? 'tooltip-html' : undefined
        ),
        textClass: textClass ? twMerge('tooltip-text', textClass) : 'tooltip-text',
        arrowClass:
            'tooltip-arrow ' +
            (placement === 'left' ? 'tooltip-arrow-left' : placement === 'right' ? 'tooltip-arrow-right' : placement === 'top' ? 'tooltip-arrow-top' : 'tooltip-arrow-bottom'),
        always: typeof binding.value === 'object' ? !!binding.value.always : !!binding.modifiers?.always,
        shouldDelay: !!binding.modifiers?.delay,
        shouldNowrap,
        size,
        useHtml,
        placement,
    };
}

function applyOptions(elems: Elems, options: ComputedOptions) {
    elems.text[options.useHtml ? 'innerHTML' : 'textContent'] = options.content;
    elems.text.className = options.textClass;
    elems.tooltip.className = options.tooltipClass;
    elems.arrow.className = options.arrowClass;
}

function show(tooltip: HTMLElement) {
    tooltip.style.position = 'fixed';
    tooltip.style.visibility = 'visible';
    const zIndex = overlayState.claimZIndex();
    tooltip.style.zIndex = zIndex.toString();
    tooltip.dataset.overlayZIndex = String(zIndex);
}

function hide(tooltip: HTMLElement) {
    tooltip.style.display = 'none';
    overlayState.releaseZIndex(Number(tooltip.dataset.overlayZIndex));
    delete tooltip.dataset.overlayZIndex;
}

function positionTooltip(el: TooltipHostElement) {
    const { tooltip, arrow, placement } = el.__tooltip!;
    const arrowSize = 8;
    const viewportMargin = 8;
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'inline-block';

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const hostRect = el.getBoundingClientRect();
            const tooltipWidth = tooltip.offsetWidth;
            const tooltipHeight = tooltip.offsetHeight;
            const maxLeft = Math.max(viewportMargin, window.innerWidth - tooltipWidth - viewportMargin);
            const maxTop = Math.max(viewportMargin, window.innerHeight - tooltipHeight - viewportMargin);
            const posPx = `-${arrowSize / 2}px`;

            if (placement === 'left' || placement === 'right') {
                const desiredTop = hostRect.top + (hostRect.height - tooltipHeight) / 2;
                const desiredLeft = placement === 'left' ? hostRect.left - tooltipWidth - arrowSize : hostRect.right + arrowSize;
                const tooltipTop = Math.min(maxTop, Math.max(viewportMargin, desiredTop));
                const tooltipLeft = Math.min(maxLeft, Math.max(viewportMargin, desiredLeft));

                tooltip.style.top = `${tooltipTop}px`;
                tooltip.style.left = `${tooltipLeft}px`;
                arrow.style.left = placement === 'left' ? 'unset' : posPx;
                arrow.style.right = placement === 'left' ? posPx : 'unset';
                arrow.style.top = `${hostRect.top + hostRect.height / 2 - tooltipTop}px`;
                arrow.style.transform = 'translateY(-50%) rotate(45deg)';
            } else {
                const desiredLeft = hostRect.left + (hostRect.width - tooltipWidth) / 2;
                const desiredTop = placement === 'top' ? hostRect.top - tooltipHeight - arrowSize : hostRect.bottom + arrowSize;
                const tooltipLeft = Math.min(maxLeft, Math.max(viewportMargin, desiredLeft));
                const tooltipTop = Math.min(maxTop, Math.max(viewportMargin, desiredTop));

                tooltip.style.left = `${tooltipLeft}px`;
                tooltip.style.top = `${tooltipTop}px`;

                arrow.style.left = `${hostRect.left + hostRect.width / 2 - tooltipLeft}px`;
                arrow.style.top = placement === 'top' ? 'unset' : posPx;
                arrow.style.bottom = placement === 'top' ? posPx : 'unset';
                arrow.style.transform = 'translateX(-50%) rotate(45deg)';
            }

            show(tooltip);
        });
    });
}

type TooltipHostElement = HTMLElement & {
    __tooltip: { tooltip: HTMLElement; arrow: HTMLElement; text: HTMLElement; placement: Placement } | undefined;
    __mouseEnter: (() => void) | undefined;
    __mouseLeave: (() => void) | undefined;
    __click: ((event: MouseEvent) => void) | undefined;
    __tooltipShowTimeout: number | undefined;
};

function clearTooltipShowTimeout(el: TooltipHostElement) {
    if (el.__tooltipShowTimeout === undefined) {
        return;
    }

    window.clearTimeout(el.__tooltipShowTimeout);
    el.__tooltipShowTimeout = undefined;
}

export const vTooltip: Directive<TooltipHostElement> = {
    mounted(el, binding: Bindings) {
        if (!binding.value) return;

        const arrow = document.createElement('div');
        const text = document.createElement('div');
        const tooltip = document.createElement('div');

        const opts = useOptions(binding);

        applyOptions({ tooltip, arrow, text }, opts);

        tooltip.appendChild(text);
        tooltip.appendChild(arrow);
        document.body.appendChild(tooltip);

        el.__tooltip = { tooltip, arrow, text, placement: opts.placement };
        el.__tooltipShowTimeout = undefined;

        el.__mouseEnter = () => {
            clearTooltipShowTimeout(el);

            if (opts.shouldDelay) {
                el.__tooltipShowTimeout = window.setTimeout(() => {
                    positionTooltip(el);
                    el.__tooltipShowTimeout = undefined;
                }, 500);
                return;
            }

            positionTooltip(el);
        };

        el.__mouseLeave = () => {
            clearTooltipShowTimeout(el);
            if (!opts.always) {
                hide(tooltip);
            }
        };

        el.__click = (_e: MouseEvent) => {
            clearTooltipShowTimeout(el);
            if (!opts.always) {
                hide(tooltip);
            }
        };

        el.addEventListener('mouseenter', el.__mouseEnter);
        el.addEventListener('mouseleave', el.__mouseLeave);
        document.addEventListener('click', el.__click);
    },

    updated(el, binding: Bindings) {
        if (el.__tooltip && binding.value) {
            applyOptions(el.__tooltip, useOptions(binding));
        }
    },

    unmounted(el) {
        if (!el.__tooltip) {
            return;
        }

        clearTooltipShowTimeout(el);

        if (el.__mouseEnter) {
            el.removeEventListener('mouseenter', el.__mouseEnter);
        }

        if (el.__mouseLeave) {
            el.removeEventListener('mouseleave', el.__mouseLeave);
        }

        if (el.__click) {
            document.removeEventListener('click', el.__click);
        }

        el.__tooltip.tooltip.remove();
        el.__tooltip = undefined;
        el.__mouseEnter = undefined;
        el.__mouseLeave = undefined;
        el.__click = undefined;
    },
};
