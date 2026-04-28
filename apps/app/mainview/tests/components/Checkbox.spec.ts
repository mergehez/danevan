import Checkbox from '@ui/Checkbox.vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';

describe('Checkbox', () => {
    it('exposes a tabbable checkbox shell for keyboard users', () => {
        const wrapper = mount(Checkbox, {
            attachTo: document.body,
            props: {
                modelValue: false,
                'onUpdate:modelValue': () => {},
                label: 'Enabled',
            },
        });

        const shell = wrapper.get('[role="checkbox"]');

        expect(shell.attributes('tabindex')).toBe('0');
        (shell.element as HTMLElement).focus();
        expect(document.activeElement).toBe(shell.element);

        wrapper.unmount();
    });

    it('toggles from keyboard interaction on the custom shell', async () => {
        const wrapper = mount(
            defineComponent({
                components: { Checkbox },
                setup() {
                    const value = ref(false);

                    return { value };
                },
                template: '<Checkbox v-model="value" />',
            }),
            {
                attachTo: document.body,
            }
        );

        const shell = wrapper.get('[role="checkbox"]');

        await shell.trigger('keydown.space');

        expect((wrapper.vm as { value: boolean }).value).toBe(true);
        expect(shell.attributes('aria-checked')).toBe('true');

        wrapper.unmount();
    });
});
