import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { DbAppearanceDialog } from '../../components/DbAppearanceDialog';
import { DbAppearanceField } from '../../components/DbAppearanceField';

function mountField(modelValue?: string | null, shortCode?: string | null) {
    const onChange = vi.fn();
    const onShortCodeChange = vi.fn();
    const wrapper = mount(DbAppearanceField, { props: { modelValue, shortCode, onChange, onShortCodeChange } });

    return { wrapper, onChange, onShortCodeChange };
}

describe('DbAppearanceField', () => {
    it('shows the stored color and tag, and the picker is free-form', async () => {
        const { wrapper, onChange } = mountField('#3b82f6', 'TI');

        expect(wrapper.get('[data-testid="db-appearance-current"]').attributes('style')).toContain('rgb(59, 130, 246)');
        expect(wrapper.text()).toContain('#3b82f6');
        expect((wrapper.get('[data-testid="db-short-code"]').element as HTMLInputElement).value).toBe('TI');

        await wrapper.get('[data-testid="db-appearance-trigger"]').trigger('click');
        const picker = wrapper.get('[data-testid="db-appearance-picker"]');
        const hexInput = picker.get('input[aria-label="Hex"]');
        await hexInput.setValue('ec4899');
        await hexInput.trigger('blur');

        expect(onChange).toHaveBeenCalledWith('#ec4899');
        wrapper.unmount();
    });

    it('upper-cases the tag and keeps at most two letters', async () => {
        const { wrapper, onShortCodeChange } = mountField(null, null);

        const codeInput = wrapper.get('[data-testid="db-short-code"]');
        await codeInput.setValue('tir');
        expect(onShortCodeChange).toHaveBeenLastCalledWith('TI');
        wrapper.unmount();
    });

    it('clears both parts', async () => {
        const { wrapper, onChange, onShortCodeChange } = mountField('#22c55e', 'PE');

        await wrapper.get('[data-testid="db-appearance-clear"]').trigger('click');

        expect(onChange).toHaveBeenCalledWith(null);
        expect(onShortCodeChange).toHaveBeenCalledWith(null);
        wrapper.unmount();
    });

    it('opens with no appearance and offers no clear button', () => {
        const { wrapper } = mountField(null, null);

        expect(wrapper.text()).toContain('no color');
        expect(wrapper.find('[data-testid="db-appearance-clear"]').exists()).toBe(false);
        wrapper.unmount();
    });
});

describe('DbAppearanceDialog', () => {
    function mountDialog(color: string | null, shortCode: string | null) {
        const onSave = vi.fn();
        const onClose = vi.fn();
        const wrapper = mount(DbAppearanceDialog, { props: { open: true, title: 'Appearance', color, shortCode, onSave, onClose } });

        return { wrapper, onSave, onClose };
    }

    it('saves a typed color and tag, then closes', async () => {
        const { wrapper, onSave, onClose } = mountDialog('#3b82f6', 'TI');

        const hexInput = wrapper.get('[data-testid="db-appearance-dialog"] input[aria-label="Hex"]');
        await hexInput.setValue('ec4899');
        await hexInput.trigger('blur');
        const codeInput = wrapper.get('[data-testid="db-appearance-short-code"]');
        await codeInput.setValue('db');
        await wrapper.get('[data-testid="db-appearance-save"]').trigger('click');

        expect(onSave).toHaveBeenCalledWith({ color: '#ec4899', shortCode: 'DB' });
        expect(onClose).toHaveBeenCalled();
        wrapper.unmount();
    });

    it('clears both', async () => {
        const { wrapper, onSave } = mountDialog('#22c55e', 'AB');

        await wrapper.get('[data-testid="db-appearance-clear"]').trigger('click');
        await wrapper.get('[data-testid="db-appearance-save"]').trigger('click');

        expect(onSave).toHaveBeenCalledWith({ color: null, shortCode: null });
        wrapper.unmount();
    });
});
