// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { type Component, defineComponent, nextTick, ref } from 'vue';
import { vError } from './VError';

const mountedWrappers: VueWrapper[] = [];

function tooltip() {
    return document.body.querySelector<HTMLElement>('.tooltip');
}

function tooltipText() {
    return document.body.querySelector<HTMLElement>('.tooltip-text');
}

function arrow() {
    return document.body.querySelector<HTMLElement>('.tooltip-arrow');
}

function mountError(template: string, initial?: unknown, components: Record<string, Component> = {}) {
    const value = ref(initial);
    const wrapper = mount(
        defineComponent({
            components,
            setup: () => ({ value }),
            template,
        }),
        { attachTo: document.body, global: { directives: { error: vError } } }
    );

    mountedWrappers.push(wrapper);

    return { wrapper, value };
}

afterEach(() => {
    while (mountedWrappers.length > 0) {
        mountedWrappers.pop()!.unmount();
    }

    document.body.innerHTML = '';
});

describe('vError', () => {
    it('renders a string value as the error message below the element', () => {
        mountError(`<button class="host" v-error="value">host</button>`, 'Required');

        expect(tooltip()!.className).toBe('tooltip v-error');
        expect(tooltipText()!.className).toBe('tooltip-text');
        expect(tooltipText()!.textContent).toBe('Required');
        expect(arrow()!.className).toBe('tooltip-arrow tooltip-arrow-bottom');
    });

    it('renders message, extra class and text class from the value object', () => {
        mountError(`<button class="host" v-error="value">host</button>`, { message: 'Email required', class: 'form-error', textClass: 'text-xs' });

        expect(tooltip()!.className).toBe('tooltip v-error form-error');
        expect(tooltipText()!.className).toBe('tooltip-text text-xs');
        expect(tooltipText()!.textContent).toBe('Email required');
    });

    it('reads the size flags TSX folds into the value', () => {
        mountError(`<button class="host" v-error="value">host</button>`, { message: 'Email required', xs: true });

        expect(tooltip()!.className).toBe('tooltip tooltip-xs v-error');
        expect(tooltipText()!.textContent).toBe('Email required');
    });

    it('honours a placement modifier instead of the default bottom placement', () => {
        mountError(`<button class="host" v-error.top="value">host</button>`, 'Required');

        expect(arrow()!.className).toBe('tooltip-arrow tooltip-arrow-top');
    });

    it('writes raw html into the message with the html modifier', () => {
        mountError(`<button class="host" v-error.html="value">host</button>`, '<b>Required</b>');

        expect(tooltipText()!.innerHTML).toBe('<b>Required</b>');
        expect(tooltipText()!.textContent).toBe('Required');
    });

    it('swaps the message when the binding value changes', async () => {
        const { value } = mountError(`<button class="host" v-error="value">host</button>`, 'First');

        expect(tooltipText()!.textContent).toBe('First');

        value.value = 'Second';
        await nextTick();

        expect(tooltipText()!.textContent).toBe('Second');
    });

    it('removes the tooltip when the value becomes falsy', async () => {
        const { value } = mountError(`<button class="host" v-error="value">host</button>`, 'Required');
        expect(tooltip()).not.toBeNull();

        value.value = undefined;
        await nextTick();

        expect(tooltip()).toBeNull();
    });

    it('anchors on the root element of a component host and cleans the tooltip up on unmount', async () => {
        const Child = defineComponent({ name: 'Child', template: `<button class="child">child</button>` });
        const show = ref(true);
        const wrapper = mount(
            defineComponent({
                components: { Child },
                setup: () => ({ show }),
                template: `<div class="container"><Child v-if="show" v-error="'Required'" /></div>`,
            }),
            { attachTo: document.body, global: { directives: { error: vError } } }
        );

        mountedWrappers.push(wrapper);

        const container = wrapper.get('.container').element as HTMLElement;

        // Vue moves a component directive onto the cloned root element vnode, so the component
        // host is the button itself and no wrapper div is injected around it.
        expect(container.childElementCount).toBe(1);
        expect(container.firstElementChild!.className).toBe('child');
        expect(tooltipText()!.textContent).toBe('Required');

        show.value = false;
        await nextTick();

        expect(tooltip()).toBeNull();
    });
});
