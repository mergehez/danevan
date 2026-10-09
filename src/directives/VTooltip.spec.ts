// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { vTooltip } from './VTooltip';

const mountedWrappers: VueWrapper[] = [];

function mountTooltip(template: string, initial?: unknown) {
    const value = ref(initial);
    const wrapper = mount(
        defineComponent({
            setup: () => ({ value }),
            template,
        }),
        { attachTo: document.body, global: { directives: { tooltip: vTooltip } } }
    );

    mountedWrappers.push(wrapper);

    return { wrapper, value };
}

function tooltip() {
    return document.body.querySelector<HTMLElement>('.tooltip');
}

function tooltipText() {
    return document.body.querySelector<HTMLElement>('.tooltip-text');
}

// The element is appended on mount but only positioned/shown by the hover handlers.
function expectNotShown() {
    expect(tooltip()!.style.position).toBe('');
}

function expectShown() {
    const tip = tooltip()!;
    expect(tip.style.position).toBe('fixed');
    expect(tip.style.visibility).toBe('visible');
    expect(tip.dataset.overlayZIndex).toBe(tip.style.zIndex);
}

afterEach(() => {
    vi.useRealTimers();

    while (mountedWrappers.length > 0) {
        mountedWrappers.pop()!.unmount();
    }

    document.body.innerHTML = '';
});

describe('vTooltip', () => {
    it('renders the string value as the tooltip title with the default bottom arrow', () => {
        mountTooltip(`<button class="host" v-tooltip="value">host</button>`, 'Open file');

        expect(tooltip()!.className).toBe('tooltip');
        expect(tooltipText()!.className).toBe('tooltip-text');
        expect(tooltipText()!.textContent).toBe('Open file');
        expect(document.body.querySelector<HTMLElement>('.tooltip-arrow')!.className).toBe('tooltip-arrow tooltip-arrow-bottom');
    });

    it('renders the value object text, extra classes and text classes', () => {
        mountTooltip(`<button class="host" v-tooltip="value">host</button>`, { value: 'Rename this file', class: 'custom-tooltip', textClass: 'custom-text' });

        expect(tooltip()!.className).toBe('tooltip custom-tooltip');
        expect(tooltipText()!.className).toBe('tooltip-text custom-text');
        expect(tooltipText()!.textContent).toBe('Rename this file');
    });

    it('applies the xs and nowrap modifiers to the size and the text classes', () => {
        mountTooltip(`<button class="host" v-tooltip.xs.nowrap="value">host</button>`, 'Tip');

        expect(tooltip()!.className).toBe('tooltip tooltip-xs tooltip-nowrap');
    });

    it('applies the sm modifier to the tooltip size', () => {
        mountTooltip(`<button class="host" v-tooltip.sm="value">host</button>`, 'Tip');

        expect(tooltip()!.className).toBe('tooltip tooltip-sm');
    });

    it('reads the size flags TSX folds into the value and lets real modifiers win', () => {
        mountTooltip(`<button class="host" v-tooltip="value">host</button>`, { value: 'Tip', xs: true });

        expect(tooltip()!.className).toBe('tooltip tooltip-xs');
    });

    it('sets the arrow class from the placement modifier', () => {
        mountTooltip(`<button class="host" v-tooltip.top="value">host</button>`, 'Tip');
        expect(document.body.querySelector<HTMLElement>('.tooltip-arrow')!.className).toBe('tooltip-arrow tooltip-arrow-top');
    });

    it('writes raw html into the tooltip text with the html modifier', () => {
        mountTooltip(`<button class="host" v-tooltip.html="value">host</button>`, '<b>Bold</b>');

        expect(tooltipText()!.innerHTML).toBe('<b>Bold</b>');
        expect(tooltipText()!.textContent).toBe('Bold');
        expect(tooltip()!.className).toBe('tooltip tooltip-html');
    });

    it('renders no tooltip at all when the value has no content', () => {
        mountTooltip(`<button class="host" v-tooltip="value">host</button>`, '');

        expect(tooltip()).toBeNull();
    });

    it('shows the tooltip on hover and hides it on mouseleave', async () => {
        vi.useFakeTimers();
        const { wrapper } = mountTooltip(`<button class="host" v-tooltip="value">host</button>`, 'Open file');
        const tip = tooltip()!;

        expectNotShown();

        await wrapper.trigger('mouseenter');
        await vi.advanceTimersByTimeAsync(40);
        expectShown();

        await wrapper.trigger('mouseleave');
        expect(tip.style.display).toBe('none');
    });

    it('hides the tooltip on a document click', async () => {
        vi.useFakeTimers();
        const { wrapper } = mountTooltip(`<button class="host" v-tooltip="value">host</button>`, 'Open file');
        const tip = tooltip()!;

        await wrapper.trigger('mouseenter');
        await vi.advanceTimersByTimeAsync(40);
        expectShown();

        document.dispatchEvent(new MouseEvent('click'));
        expect(tip.style.display).toBe('none');
    });

    it('waits 500ms before showing with the delay modifier', async () => {
        vi.useFakeTimers();
        const { wrapper } = mountTooltip(`<button class="host" v-tooltip.delay="value">host</button>`, 'Delayed');

        await wrapper.trigger('mouseenter');
        await vi.advanceTimersByTimeAsync(499);
        expectNotShown();

        await vi.advanceTimersByTimeAsync(500);
        expectShown();
    });

    it('cancels a pending delayed show when the pointer leaves first', async () => {
        vi.useFakeTimers();
        const { wrapper } = mountTooltip(`<button class="host" v-tooltip.delay="value">host</button>`, 'Delayed');

        await wrapper.trigger('mouseenter');
        await wrapper.trigger('mouseleave');
        await vi.advanceTimersByTimeAsync(600);

        expect(tooltip()!.style.display).toBe('none');
        expectNotShown();
    });

    it('keeps an always tooltip visible after mouseleave and document clicks', async () => {
        vi.useFakeTimers();
        const { wrapper } = mountTooltip(`<button class="host" v-tooltip.always="value">host</button>`, 'Pinned');
        const tip = tooltip()!;

        await wrapper.trigger('mouseenter');
        await vi.advanceTimersByTimeAsync(40);
        expectShown();

        await wrapper.trigger('mouseleave');
        expect(tip.style.visibility).toBe('visible');

        document.dispatchEvent(new MouseEvent('click'));
        expect(tip.style.visibility).toBe('visible');
    });

    it('swaps the tooltip text and classes when the binding value changes', async () => {
        const { value } = mountTooltip(`<button class="host" v-tooltip="value">host</button>`, 'First');

        expect(tooltipText()!.textContent).toBe('First');

        value.value = { value: 'Second', class: 'custom-tooltip' };
        await nextTick();

        expect(tooltipText()!.textContent).toBe('Second');
        expect(tooltip()!.className).toBe('tooltip custom-tooltip');
    });
});
