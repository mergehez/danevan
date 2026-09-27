import { ref, watch, nextTick, onBeforeUnmount, Teleport } from 'vue';
import { ContextMenuPanel } from './ContextMenuPanel.tsx';
import { useContextMenu } from './useContextMenu';
import { component, ensureAllTsxProps, prevented } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    state: ReturnType<typeof useContextMenu>;
};

export const ContextMenu = component(
    (props: Props) => {
        const menuRef = ref<HTMLElement>();
        const adjustedPosition = ref({ x: props.state.x, y: props.state.y });

        function closeMenu() {
            props.state.closeMenu();
        }

        function focusLeadingElement() {
            menuRef.value?.querySelector<HTMLElement>('.v-menu-leading-focus')?.focus();
        }

        function focusFirstItem() {
            menuRef.value?.querySelector<HTMLElement>('button.v-menu-item:not(:disabled)')?.focus();
        }

        function updatePosition() {
            const menu = menuRef.value;
            if (!menu) {
                adjustedPosition.value = { x: props.state.x, y: props.state.y };
                return;
            }

            const margin = 8;
            const bounds = menu.getBoundingClientRect();
            adjustedPosition.value = {
                x: Math.max(margin, Math.min(props.state.x, window.innerWidth - bounds.width - margin)),
                y: Math.max(margin, Math.min(props.state.y, window.innerHeight - bounds.height - margin)),
            };
        }

        function onWindowKeydown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                closeMenu();
            }
        }

        watch(
            () => [props.state.open, props.state.x, props.state.y, props.state.items.length],
            async ([isOpen]) => {
                if (!isOpen) {
                    return;
                }

                adjustedPosition.value = { x: props.state.x, y: props.state.y };
                await nextTick();
                updatePosition();
                await nextTick();

                if (props.state.autoFocus) {
                    focusFirstItem();
                    return;
                }

                focusLeadingElement();
            },
            { immediate: true }
        );

        watch(
            () => props.state.open,
            (isOpen) => {
                if (isOpen) {
                    window.addEventListener('keydown', onWindowKeydown);
                    return;
                }

                window.removeEventListener('keydown', onWindowKeydown);
            },
            { immediate: true }
        );

        onBeforeUnmount(() => {
            window.removeEventListener('keydown', onWindowKeydown);
        });

        return () => (
            <Teleport to="body">
                {props.state.open ? (
                    <div onMousedown={closeMenu} class="v-menu-root" style={{ zIndex: props.state.zIndex }}>
                        {/* element border */}
                        <div
                            class="v-menu-element-border"
                            style={{
                                borderRadius: props.state.element?.style.borderRadius || '4px',
                                top: `${props.state.elementRect?.top}px`,
                                left: `${props.state.elementRect?.left}px`,
                                width: `${props.state.elementRect?.width}px`,
                                height: `${props.state.elementRect?.height}px`,
                            }}
                        />
                        {/* menu */}
                        <div
                            ref={menuRef}
                            onMousedown={prevented(() => {})}
                            class="v-menu-wrapper"
                            style={{
                                top: `${adjustedPosition.value.y}px`,
                                left: `${adjustedPosition.value.x}px`,
                                zIndex: props.state.zIndex,
                            }}
                        >
                            <ContextMenuPanel items={props.state.items} leadingFocusTarget={true} onClose={closeMenu} zIndex={props.state.zIndex} />
                        </div>
                    </div>
                ) : null}
            </Teleport>
        );
    },
    { name: 'ContextMenu', props: ensureAllTsxProps<Props>()(['state']) }
);

export default ContextMenu;
