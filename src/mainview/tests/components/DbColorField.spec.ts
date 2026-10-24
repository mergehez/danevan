import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { DbColorDialog } from '../../components/DbColorDialog';
import { DbColorField } from '../../components/DbColorField';

function mountField(modelValue?: string | null) {
    const onChange = vi.fn();
    const wrapper = mount(DbColorField, { props: { modelValue, onChange } });

    return { wrapper, onChange };
}

describe('DbColorField', () => {
    it('shows the stored color and the picker is free-form, not a palette', async () => {
        const { wrapper, onChange } = mountField('#3b82f6');

        expect(wrapper.get('[data-testid="db-color-current"]').attributes('style')).toContain('rgb(59, 130, 246)');
        expect(wrapper.text()).toContain('#3b82f6');

        await wrapper.get('[data-testid="db-color-trigger"]').trigger('click');
        const picker = wrapper.get('[data-testid="db-color-picker"]');
        expect(picker.find('input[aria-label="Hex"]').exists()).toBe(true);

        // Any hex is accepted: type it into the picker's own field.
        const hexInput = picker.get('input[aria-label="Hex"]');
        await hexInput.setValue('ec4899');
        await hexInput.trigger('blur');

        expect(onChange).toHaveBeenCalledWith('#ec4899');
        wrapper.unmount();
    });

    it('clears the color back to none', async () => {
        const { wrapper, onChange } = mountField('#22c55e');

        await wrapper.get('[data-testid="db-color-clear"]').trigger('click');

        expect(onChange).toHaveBeenCalledWith(null);
        wrapper.unmount();
    });

    it('opens with no color and offers no clear button', () => {
        const { wrapper } = mountField(null);

        expect(wrapper.text()).toContain('no color');
        expect(wrapper.find('[data-testid="db-color-clear"]').exists()).toBe(false);
        wrapper.unmount();
    });
});

describe('DbColorDialog', () => {
    function mountDialog(value: string | null) {
        const onSave = vi.fn();
        const onClose = vi.fn();
        const wrapper = mount(DbColorDialog, { props: { open: true, title: 'Color', value, onSave, onClose } });

        return { wrapper, onSave, onClose };
    }

    it('saves a typed color and closes', async () => {
        const { wrapper, onSave, onClose } = mountDialog('#3b82f6');

        const hexInput = wrapper.get('[data-testid="db-color-dialog"] input[aria-label="Hex"]');
        await hexInput.setValue('ec4899');
        await hexInput.trigger('blur');
        await wrapper.get('[data-testid="db-color-dialog-save"]').trigger('click');

        expect(onSave).toHaveBeenCalledWith('#ec4899');
        expect(onClose).toHaveBeenCalled();
        wrapper.unmount();
    });

    it('clears the color', async () => {
        const { wrapper, onSave } = mountDialog('#22c55e');

        await wrapper.get('[data-testid="db-color-dialog-clear"]').trigger('click');
        await wrapper.get('[data-testid="db-color-dialog-save"]').trigger('click');

        expect(onSave).toHaveBeenCalledWith(null);
        wrapper.unmount();
    });
});
