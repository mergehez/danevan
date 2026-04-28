import AppConfirmationModal from '@ui/AppConfirmationModal.vue';
import { confirmation } from '@utils/useConfirmation';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

function findButtonByText(wrapper: ReturnType<typeof mount>, label: string) {
    const button = wrapper.findAll('button').find((entry) => entry.text().trim() === label);

    if (!button) {
        throw new Error(`Expected button with label "${label}" to be present.`);
    }

    return button;
}

describe('AppConfirmationModal', () => {
    beforeEach(() => {
        if (confirmation.state.isOpen) {
            confirmation.cancel();
        }
    });

    it('resolves false when the active confirmation is canceled', async () => {
        const wrapper = mount(AppConfirmationModal, {
            global: {
                directives: {
                    tooltip: {},
                },
                stubs: {
                    Transition: false,
                    IconButton: {
                        template: '<button type="button" @click="$emit(\'click\')">Close</button>',
                    },
                },
            },
        });

        const pendingConfirmation = confirmation.request({
            title: 'Remove connection',
            message: 'Remove Alpha from Danevan?',
            confirmLabel: 'Remove',
        });

        await flushPromises();

        expect(wrapper.text()).toContain('Remove connection');
        expect(wrapper.text()).toContain('Remove Alpha from Danevan?');

        await findButtonByText(wrapper, 'Cancel').trigger('click');

        await expect(pendingConfirmation).resolves.toBe(false);
        expect(confirmation.state.isOpen).toBe(false);
    });

    it('shows the next queued confirmation after canceling the current one', async () => {
        const wrapper = mount(AppConfirmationModal, {
            global: {
                directives: {
                    tooltip: {},
                },
                stubs: {
                    Transition: false,
                    IconButton: {
                        template: '<button type="button" @click="$emit(\'click\')">Close</button>',
                    },
                },
            },
        });

        const firstConfirmation = confirmation.request({
            title: 'First confirmation',
            message: 'Handle the first action?',
        });
        const secondConfirmation = confirmation.request({
            title: 'Second confirmation',
            message: 'Handle the second action?',
            confirmLabel: 'Proceed',
        });

        await flushPromises();
        expect(wrapper.text()).toContain('First confirmation');

        await findButtonByText(wrapper, 'Cancel').trigger('click');
        await expect(firstConfirmation).resolves.toBe(false);

        await flushPromises();
        expect(wrapper.text()).toContain('Second confirmation');

        await findButtonByText(wrapper, 'Proceed').trigger('click');
        await expect(secondConfirmation).resolves.toBe(true);
    });
});
