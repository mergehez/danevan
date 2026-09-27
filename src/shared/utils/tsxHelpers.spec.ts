// Guards that Vue's own `v-model` reaches these components: the plugin hands a component
// `onUpdate:modelValue` / `onUpdate:open`, while the components declare `onChange` / `onOpenChange`.
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { component, componentGeneric } from './tsxHelpers.tsx';

type Props = { modelValue: string; onChange?: (val: string) => unknown };

const ProbeInput = component((props: Props) => () => h('input', { 'data-testid': 'probe', value: props.modelValue, onInput: () => props.onChange?.('next') }), {
    name: 'ProbeInput',
    props: ['modelValue', 'onChange'],
});

const GenericProbe = componentGeneric<{ open: boolean; onOpenChange?: (val: boolean) => void }>(
    (props) => () => h('input', { 'data-testid': 'generic', value: String(props.open), onInput: () => props.onOpenChange?.(true) }),
    { name: 'GenericProbe', props: ['open', 'onOpenChange'] }
);

describe('model props', () => {
    it('routes the standard `onUpdate:modelValue` handler to the onChange prop', async () => {
        const onUpdate = vi.fn();
        const wrapper = mount(ProbeInput, { props: { modelValue: 'start' }, attrs: { 'onUpdate:modelValue': onUpdate } });

        await wrapper.get('[data-testid=probe]').trigger('input');

        expect(onUpdate).toHaveBeenCalledWith('next');
    });

    it('prefers an explicit onChange over the standard handler', async () => {
        const own = vi.fn();
        const standard = vi.fn();
        const wrapper = mount(ProbeInput, { props: { modelValue: 'start', onChange: own }, attrs: { 'onUpdate:modelValue': standard } });

        await wrapper.get('[data-testid=probe]').trigger('input');

        expect(own).toHaveBeenCalledWith('next');
        expect(standard).not.toHaveBeenCalled();
    });

    it('routes a named model (`onUpdate:open`) to onOpenChange', async () => {
        const onUpdate = vi.fn();
        const wrapper = mount(GenericProbe, { props: { open: false }, attrs: { 'onUpdate:open': onUpdate } });

        await wrapper.get('[data-testid=generic]').trigger('input');

        expect(onUpdate).toHaveBeenCalledWith(true);
    });
});
