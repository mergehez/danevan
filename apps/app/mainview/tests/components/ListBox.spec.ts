import ListBox from '@ui/ListBox.vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

const items = [
    { label: 'Alpha', value: 'alpha' },
    { label: 'Beta', value: 'beta' },
];

describe('ListBox', () => {
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
});
