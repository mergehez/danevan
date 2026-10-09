// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { runWithButtonLoadingIndicatorSilenced } from './loadingIndicatorState';
import { vLoading } from './VLoading';

const mountedWrappers: VueWrapper[] = [];

function loaderOf(host: HTMLElement) {
    const loader = host.querySelector<HTMLElement>('.v-loading');

    if (!loader) {
        throw new Error('v-loading did not render its loader');
    }

    return loader;
}

function mountLoading(template: string, initial?: unknown) {
    const value = ref(initial);
    const wrapper = mount(
        defineComponent({
            setup: () => ({ value }),
            template,
        }),
        { attachTo: document.body, global: { directives: { loading: vLoading } } }
    );

    mountedWrappers.push(wrapper);

    const host = wrapper.element as HTMLElement;

    return { wrapper, value, host, loader: loaderOf(host) };
}

afterEach(() => {
    while (mountedWrappers.length > 0) {
        mountedWrappers.pop()!.unmount();
    }

    document.body.innerHTML = '';
});

describe('vLoading', () => {
    it('appends the medium loader and positions a static host', () => {
        const { host, loader } = mountLoading(`<div class="host" v-loading="value">Save</div>`, true);

        expect(host.style.position).toBe('relative');
        expect(loader.className).toBe('v-loading v-loading-md');
        expect(loader.style.display).toBe('flex');
        expect(loader.querySelector<HTMLElement>('i')!.className).toBe('v-arg-icon v-loading-icon');
        expect(host.style.pointerEvents).toBe('none');
        expect(host.style.cursor).toBe('default');
    });

    it('shows the loader unless the value is false', async () => {
        const { value, loader } = mountLoading(`<div class="host" v-loading="value">Save</div>`, true);
        expect(loader.style.display).toBe('flex');

        value.value = false;
        await nextTick();
        expect(loader.style.display).toBe('none');

        value.value = true;
        await nextTick();
        expect(loader.style.display).toBe('flex');
    });

    it('reads the size from the value flags TSX uses', () => {
        const { loader } = mountLoading(`<div class="host" v-loading="{ value: true, lg: true }">Save</div>`);

        expect(loader.className).toBe('v-loading v-loading-lg');
    });

    it('reads the size from real dotted modifiers', () => {
        expect(mountLoading(`<div class="host" v-loading.sm="true">Save</div>`).loader.className).toBe('v-loading v-loading-xs');
        expect(mountLoading(`<div class="host" v-loading.xl="true">Save</div>`).loader.className).toBe('v-loading v-loading-xl');
    });

    it('removes the loader when the host element is unmounted', async () => {
        const show = ref(true);
        const wrapper = mount(
            defineComponent({
                setup: () => ({ show }),
                template: `<div><div v-if="show" class="host" v-loading="true">Save</div></div>`,
            }),
            { attachTo: document.body, global: { directives: { loading: vLoading } } }
        );

        mountedWrappers.push(wrapper);

        const host = wrapper.get('.host').element as HTMLElement;
        expect(host.querySelector('.v-loading')).not.toBeNull();

        show.value = false;
        await nextTick();
        expect(host.querySelector('.v-loading')).toBeNull();
    });

    it('keeps a button loader hidden while the button loading indicator is silenced', async () => {
        await runWithButtonLoadingIndicatorSilenced(async () => {
            expect(mountLoading(`<button class="btn" v-loading="value">Save</button>`, true).loader.style.display).toBe('none');
        });

        expect(mountLoading(`<button class="btn" v-loading="value">Save</button>`, true).loader.style.display).toBe('flex');
    });

    it('still shows a non-button loader while the button loading indicator is silenced', async () => {
        await runWithButtonLoadingIndicatorSilenced(async () => {
            expect(mountLoading(`<div class="host" v-loading="value">Save</div>`, true).loader.style.display).toBe('flex');
        });
    });
});
