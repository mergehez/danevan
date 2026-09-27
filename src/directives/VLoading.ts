import type { Directive, DirectiveBinding } from 'vue';
import { resolveDirectiveModifiers } from './directiveModifiers';
import { isButtonLoadingIndicatorSilenced } from './loadingIndicatorState';
import { useOverlaysState } from './useOverlaysState';

export interface LoadingDirectiveModifiers {
    sm?: boolean | undefined;
    md?: boolean | undefined;
    lg?: boolean | undefined;
    xl?: boolean | undefined;
}

// TSX has no dotted modifiers, so they arrive inside the value object: `v-loading={{ value: true, lg: true }}`.
export type LoadingBindingValue = boolean | (LoadingDirectiveModifiers & { value?: boolean }) | undefined;

type Bindings = Omit<DirectiveBinding, 'modifiers' | 'value'> & {
    value?: LoadingBindingValue;
    modifiers?: LoadingDirectiveModifiers | undefined;
};
export type VLoadingDirectiveBinding = Bindings;

const overlayState = useOverlaysState();

export const vLoading: Directive<HTMLElement & { __loader: any; __loaderZIndex: any }, LoadingBindingValue, keyof LoadingDirectiveModifiers> = {
    mounted(el, binding: Bindings, _vnode) {
        const position = window.getComputedStyle(el).position;
        if (position === 'static' || position === '') {
            el.style.position = 'relative';
        }

        const modifiers = resolveDirectiveModifiers<LoadingDirectiveModifiers>(binding);
        const size = modifiers.sm ? 'v-loading-xs' : modifiers.lg ? 'v-loading-lg' : modifiers.xl ? 'v-loading-xl' : 'v-loading-md';

        const loader = document.createElement('span');
        loader.className = `v-loading ${size}`;
        const loaderZIndex = overlayState.claimZIndex();
        loader.style.zIndex = loaderZIndex.toString();

        const isBtn = el.tagName.toLowerCase() === 'button' || el.classList.contains('btn') || el.classList.contains('button');
        const icStyle = isBtn ? `style="width: ${el.clientWidth - 1}px; height: ${el.clientHeight - 1}px;"` : '';
        loader.innerHTML = `<i class="v-arg-icon v-loading-icon" ${icStyle}></i>`;

        el.appendChild(loader);

        el.__loader = loader;
        el.__loaderZIndex = loaderZIndex;

        toggleLoading(el, binding);
    },

    updated(el, binding: Bindings, _vnode, _prevVnode) {
        toggleLoading(el, binding);
    },

    unmounted(el, _binding: Bindings, _vnode) {
        if (el.__loader) {
            overlayState.releaseZIndex(el.__loaderZIndex);
            el.__loader.remove();
            el.__loader = undefined;
            el.__loaderZIndex = undefined;
        }
    },
};

function isButtonLikeElement(el: HTMLElement) {
    return el.tagName.toLowerCase() === 'button' || el.classList.contains('btn') || el.classList.contains('button');
}

function toggleLoading(el: any, binding: Bindings) {
    const value = typeof binding.value === 'object' ? binding.value?.value : binding.value;
    const shouldShow = value !== false && !(isButtonLikeElement(el) && isButtonLoadingIndicatorSilenced.value);
    overlayState.toggleZIndex(shouldShow, el.__loaderZIndex);

    el.__loader.style.display = shouldShow ? 'flex' : 'none';
    el.style.pointerEvents = 'none';
    el.style.cursor = 'default';
}
