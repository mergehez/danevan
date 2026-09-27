import { component, ensureAllTsxProps, tsxWithDefaults } from '#shared/utils/tsxHelpers.tsx';
import { twMerge } from 'tailwind-merge';
import { computed, onUnmounted, ref } from 'vue';
import { useCache } from '../utils/useCache';

export type SplitterProps = {
    localStorageKey?: string;
    defaultWidth?: string;
    baseSide: 'left' | 'right';
    class?: string;
    leftClass?: string;
    rightClass?: string;
    draggerClass?: string;
    draggerInvisible?: boolean;
    leftHidden?: boolean;
    rightHidden?: boolean;
    minWidth?: string;
    maxWidth?: string;
} & {
    slots?: { left?: () => unknown; right?: () => unknown };
};

export function splitter(props: Omit<SplitterProps, 'slots'> & { left: unknown; right: unknown }) {
    return (
        <Splitter
            {...props}
            slots={{
                left: () => props.left,
                right: () => props.right,
            }}
        />
    );
}

export const Splitter = component(
    (_props: SplitterProps) => {
        const props = tsxWithDefaults(_props, { defaultWidth: '50%', minWidth: '10%', maxWidth: '90%' });

        const { state: currentWidth } = useCache<string>({
            key: computed(() => props.localStorageKey),
            initialValue: () => props.defaultWidth,
            parse: (rawValue: string) => `${rawValue}px`,
            serialize: (value: string) => (value.endsWith('px') ? value.slice(0, -2) : value),
        });
        const isDragging = ref<boolean>(false);
        const splitterContainer = ref<HTMLElement>();

        const widths = computed(() => {
            if (props.rightHidden) return { left: '100%', right: '0' };
            if (props.leftHidden) return { left: '0', right: '100%' };

            // Use CSS clamp for visual consistency and boundary handling
            const clampedWidth = `clamp(${props.minWidth}, ${currentWidth.value}, ${props.maxWidth})`;

            return {
                left: props.baseSide === 'left' ? clampedWidth : `calc(100% - ${clampedWidth})`,
                right: props.baseSide === 'right' ? clampedWidth : `calc(100% - ${clampedWidth})`,
            };
        });

        const startResize = (event: MouseEvent) => {
            event.preventDefault();
            isDragging.value = true;
            document.addEventListener('mousemove', onResize);
            document.addEventListener('mouseup', stopResize);
            document.body.classList.add('select-none');
        };

        const onResize = (event: MouseEvent) => {
            if (!isDragging.value || !splitterContainer.value) return;

            const containerRect = splitterContainer.value.getBoundingClientRect();
            let newWidth: number;

            if (props.baseSide === 'left') {
                newWidth = event.clientX - containerRect.left;
            } else {
                newWidth = containerRect.right - event.clientX;
            }

            currentWidth.value = `${newWidth}px`;
        };

        const stopResize = () => {
            if (isDragging.value) {
                isDragging.value = false;
                document.removeEventListener('mousemove', onResize);
                document.removeEventListener('mouseup', stopResize);
                document.body.classList.remove('select-none');
            }
        };

        onUnmounted(() => {
            stopResize();
        });

        return () => (
            <div ref={splitterContainer} class={twMerge('flex w-full h-full overflow-hidden relative items-stretch', props.class)}>
                {isDragging.value ? <div class="absolute inset-0 z-50 cursor-col-resize" /> : null}
                {!props.leftHidden ? (
                    <div style={{ width: widths.value.left }} class={twMerge('min-h-full overflow-auto flex flex-col relative gap-1', props.leftClass)}>
                        {props.slots?.left?.() ?? <div class="p-4">Left Panel Content</div>}
                    </div>
                ) : null}
                {!props.leftHidden && !props.rightHidden ? (
                    <div
                        class={twMerge(
                            'w-1! z-60 min-h-full relative bg-surface-200 dark:bg-surface-900 hover:bg-primary-500  transition-colors',
                            props.draggerClass,
                            props.draggerInvisible ? 'opacity-0 hover:opacity-100' : ''
                        )}
                    >
                        <div title="Drag to resize" onMousedown={startResize} class="absolute h-full left-0 w-2 cursor-col-resize" style={{ transform: 'translateX(-50%)' }} />
                    </div>
                ) : null}
                {!props.rightHidden ? (
                    <div style={{ width: widths.value.right }} class={twMerge('min-h-full overflow-auto flex flex-col relative gap-1', props.rightClass)}>
                        {props.slots?.right?.() ?? <div class="p-4">Right Panel Content</div>}
                    </div>
                ) : null}
            </div>
        );
    },
    {
        name: 'Splitter',
        props: ensureAllTsxProps<SplitterProps>()([
            'localStorageKey',
            'defaultWidth',
            'baseSide',
            'class',
            'leftClass',
            'rightClass',
            'draggerClass',
            'draggerInvisible',
            'leftHidden',
            'rightHidden',
            'minWidth',
            'maxWidth',
            'slots',
        ]),
    }
);

export default Splitter;
