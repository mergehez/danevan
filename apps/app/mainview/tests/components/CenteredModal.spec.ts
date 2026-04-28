import CenteredModal from '@ui/CenteredModal.vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

const iconButtonStub = defineComponent({
    name: 'IconButton',
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

const PointerEventCtor = window.PointerEvent ?? MouseEvent;

function dispatchPointerEvent(target: EventTarget, type: string, options: { clientX: number; clientY: number; button?: number; pointerId?: number }) {
    const event = new PointerEventCtor(type, {
        bubbles: true,
        clientX: options.clientX,
        clientY: options.clientY,
        button: options.button ?? 0,
        pointerId: options.pointerId ?? 1,
    });

    target.dispatchEvent(event);
}

function mountModal(open = true) {
    return mount(
        defineComponent({
            components: {
                CenteredModal,
            },
            setup() {
                const isOpen = ref(open);

                return {
                    isOpen,
                };
            },
            template: `
            <CenteredModal v-model:open="isOpen" title="Settings">
                <div>Body</div>
            </CenteredModal>
        `,
        }),
        {
            attachTo: document.body,
            global: {
                stubs: {
                    IconButton: iconButtonStub,
                },
                directives: {
                    tooltip: {},
                },
            },
        }
    );
}

describe('CenteredModal', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('drags the modal surface from the header', async () => {
        const wrapper = mountModal();
        const header = wrapper.get('[data-testid="centered-modal-header"]');
        const surface = wrapper.get('[data-testid="centered-modal-surface"]');

        dispatchPointerEvent(header.element, 'pointerdown', { clientX: 100, clientY: 120 });
        dispatchPointerEvent(window, 'pointermove', { clientX: 160, clientY: 180 });
        dispatchPointerEvent(window, 'pointerup', { clientX: 160, clientY: 180 });
        await wrapper.vm.$nextTick();

        expect((surface.element as HTMLElement).style.transform).toBe('translate(60px, 60px)');
        wrapper.unmount();
    });

    it('resets the drag offset when the modal closes', async () => {
        const wrapper = mountModal();
        const header = wrapper.get('[data-testid="centered-modal-header"]');
        const surface = wrapper.get('[data-testid="centered-modal-surface"]');

        dispatchPointerEvent(header.element, 'pointerdown', { clientX: 40, clientY: 40 });
        dispatchPointerEvent(window, 'pointermove', { clientX: 90, clientY: 100 });
        dispatchPointerEvent(window, 'pointerup', { clientX: 90, clientY: 100 });
        await wrapper.vm.$nextTick();

        expect((surface.element as HTMLElement).style.transform).toBe('translate(50px, 60px)');

        (wrapper.vm as { isOpen: boolean }).isOpen = false;
        await nextTick();
        (wrapper.vm as { isOpen: boolean }).isOpen = true;
        await nextTick();

        expect((wrapper.get('[data-testid="centered-modal-surface"]').element as HTMLElement).style.transform).toBe('translate(0px, 0px)');
        wrapper.unmount();
    });

    it('resizes the modal from the left edge', async () => {
        window.localStorage.setItem('centered-modal:resize', JSON.stringify({ width: 320, height: 180 }));

        const wrapper = mount(
            defineComponent({
                components: {
                    CenteredModal,
                },
                setup() {
                    const isOpen = ref(true);

                    return {
                        isOpen,
                    };
                },
                template: `
                    <CenteredModal v-model:open="isOpen" title="Settings" local-storage-key="centered-modal:resize" contentClass="w-[640px] h-[320px]">
                        <div>Body</div>
                    </CenteredModal>
                `,
            }),
            {
                attachTo: document.body,
                global: {
                    stubs: {
                        IconButton: iconButtonStub,
                    },
                    directives: {
                        tooltip: {},
                    },
                },
            }
        );

        const surface = wrapper.get('[data-testid="centered-modal-surface"]');
        const leftHandle = wrapper.get('[data-testid="floating-surface-handle-left"]');

        await nextTick();
        await nextTick();

        dispatchPointerEvent(leftHandle.element, 'pointerdown', { clientX: 200, clientY: 100 });
        dispatchPointerEvent(window, 'pointermove', { clientX: 160, clientY: 100 });
        dispatchPointerEvent(window, 'pointerup', { clientX: 160, clientY: 100 });
        await wrapper.vm.$nextTick();

        expect((surface.element as HTMLElement).style.width).toBe('360px');
        expect((surface.element as HTMLElement).style.transform).toBe('translate(-40px, 0px)');
        wrapper.unmount();
    });

    it('restores a persisted size for a specific usage key', async () => {
        window.localStorage.setItem('centered-modal:test', JSON.stringify({ width: 540, height: 260 }));

        const wrapper = mount(
            defineComponent({
                components: {
                    CenteredModal,
                },
                setup() {
                    const isOpen = ref(true);

                    return {
                        isOpen,
                    };
                },
                template: `
                    <CenteredModal v-model:open="isOpen" title="Settings" local-storage-key="centered-modal:test" contentClass="w-[640px] h-[320px]">
                        <div>Body</div>
                    </CenteredModal>
                `,
            }),
            {
                attachTo: document.body,
                global: {
                    stubs: {
                        IconButton: iconButtonStub,
                    },
                    directives: {
                        tooltip: {},
                    },
                },
            }
        );

        await nextTick();
        await nextTick();

        const surface = wrapper.get('[data-testid="centered-modal-surface"]');

        expect((surface.element as HTMLElement).style.width).toBe('540px');
        expect((surface.element as HTMLElement).style.height).toBe('260px');
        wrapper.unmount();
    });
});
