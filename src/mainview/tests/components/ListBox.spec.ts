// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import ListBox from '../../../shared/components/ListBox.tsx';

const items = [
    { label: 'Alpha', value: 'alpha' },
    { label: 'Beta', value: 'beta' },
];

describe('ListBox', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps the current selection when it is focused and blurred without input', async () => {
        const scrollIntoView = vi.fn();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: scrollIntoView,
        });

        const onSelect = vi.fn();
        const wrapper = mount(ListBox, {
            attachTo: document.body,
            props: {
                items,
                selection: 'alpha',
                onSelect,
            },
        });

        const input = wrapper.get('input');

        await input.trigger('focus');
        await input.trigger('blur');

        expect(onSelect).not.toHaveBeenCalled();
        expect((input.element as HTMLInputElement).value).toBe('Alpha');

        wrapper.unmount();
    });

    it('matches normalized subsequences like utf84gen to utf8mb4_general_ci', async () => {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
        });

        const wrapper = mount(ListBox, {
            attachTo: document.body,
            props: {
                items: [
                    { label: 'utf8mb4_general_ci', value: 'utf8mb4_general_ci' },
                    { label: 'latin1_swedish_ci', value: 'latin1_swedish_ci' },
                ],
                selection: undefined,
                onSelect: vi.fn(),
            },
        });

        const input = wrapper.get('input');

        await input.trigger('focus');
        await input.setValue('utf84gen');
        await input.trigger('input');

        expect(document.body.textContent).toContain('utf8mb4_general_ci');
        expect(document.body.textContent).not.toContain('latin1_swedish_ci');

        wrapper.unmount();
    });

    it('shows a selection that changes after a free-edit value was committed', async () => {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
        });

        const wrapper = mount(
            defineComponent({
                components: { ListBox },
                setup() {
                    const selection = ref('alpha');

                    return {
                        items,
                        selection,
                        onSelect: (item: { value?: string } | undefined | null, query?: string) => {
                            selection.value = String(item?.value ?? query ?? '');
                        },
                    };
                },
                template: '<ListBox :items="items" :selection="selection" :onSelect="onSelect" :freeEdit="true" />',
            }),
            {
                attachTo: document.body,
            }
        );

        const input = wrapper.get('input');

        await input.trigger('focus');
        await input.setValue('custom_type');
        await input.trigger('keyup', { key: 'Enter' });

        expect(wrapper.vm.selection).toBe('custom_type');
        expect((input.element as HTMLInputElement).value).toBe('custom_type');

        // A selection changed outside the field (an undo, a revert) is authoritative: the text the
        // free-edit commit left behind must not keep masking it.
        wrapper.vm.selection = 'alpha';
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        expect((input.element as HTMLInputElement).value).toBe('Alpha');

        wrapper.unmount();
    });

    it('applies rich option text and selects the first editable argument', async () => {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
        });

        const richItems = [
            {
                label: 'DATE(date:date)',
                value: 'DATE(date)',
                appliedText: 'DATE(date)',
                selectionStart: 5,
                selectionEnd: 9,
            },
        ];
        const wrapper = mount(
            defineComponent({
                components: { ListBox },
                setup() {
                    const selection = ref('');

                    return {
                        richItems,
                        selection,
                        onSelect: (item: (typeof richItems)[number] | undefined | null) => {
                            selection.value = typeof item?.value === 'string' ? item.value : '';
                        },
                    };
                },
                template: '<ListBox :items="richItems" :selection="selection" :onSelect="onSelect" />',
            }),
            {
                attachTo: document.body,
            }
        );

        const input = wrapper.get('input');

        await input.trigger('focus');
        const option = document.body.querySelector('[data-id="DATE(date)"]');

        expect(option).not.toBeNull();

        await (wrapper.getComponent(ListBox as any).vm as any).$nextTick();
        (option as HTMLElement).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        const element = input.element as HTMLInputElement;

        expect(element.value).toBe('DATE(date)');
        expect(element.selectionStart).toBe(5);
        expect(element.selectionEnd).toBe(9);

        wrapper.unmount();
    });

    it('selects the field text shortly after it is focused', async () => {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
        });
        vi.useFakeTimers();

        const wrapper = mount(ListBox, {
            attachTo: document.body,
            props: {
                items,
                selection: 'alpha',
                onSelect: vi.fn(),
            },
        });

        const input = wrapper.get('input').element as HTMLInputElement;

        input.focus();
        await wrapper.vm.$nextTick();
        vi.advanceTimersByTime(100);

        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Alpha'.length]);

        wrapper.unmount();
    });

    it('leaves no timer behind when it unmounts before the focus timer fires', () => {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
        });
        vi.useFakeTimers();
        const baseline = vi.getTimerCount();

        const wrapper = mount(ListBox, {
            attachTo: document.body,
            props: {
                items,
                selection: 'alpha',
                onSelect: vi.fn(),
            },
        });

        (wrapper.get('input').element as HTMLInputElement).focus();

        // The dropdown's 0 ms scroll timer has run; the 100 ms focus timer is still pending.
        vi.advanceTimersByTime(0);
        expect(vi.getTimerCount()).toBe(baseline + 1);

        wrapper.unmount();

        // A timer that outlives its component fires after jsdom is torn down and fails the whole
        // run with "ReferenceError: document is not defined".
        expect(vi.getTimerCount()).toBe(baseline);
    });
});
