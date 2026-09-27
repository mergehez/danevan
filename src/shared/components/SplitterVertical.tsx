import { component, ensureAllTsxProps, tsxWithDefaults } from '#shared/utils/tsxHelpers.tsx';
import { twMerge } from 'tailwind-merge';
import { computed, onUnmounted, ref } from 'vue';
import { useCache } from '../utils/useCache';

type Props = {
    localStorageKey?: string;
    defaultHeight?: string;
    baseSide: 'top' | 'bottom';
    class?: string;
    topClass?: string;
    bottomClass?: string;
    draggerClass?: string;
    draggerInvisible?: boolean;
    draggerDisabled?: boolean;
    topHidden?: boolean;
    bottomHidden?: boolean;
    minHeight?: string;
    maxHeight?: string;
    forcedHeight?: string | number;
} & {
    slots?: { top?: () => unknown; bottom?: () => unknown };
};

export function splitterVertical(props: Omit<Props, 'slots'> & { top: unknown; bottom: unknown }) {
    return (
        <SplitterVertical
            {...props}
            slots={{
                top: () => props.top,
                bottom: () => props.bottom,
            }}
        />
    );
}

export const SplitterVertical = component(
    (_props: Props) => {
        const props = tsxWithDefaults(_props, { defaultHeight: '50%', minHeight: '10%', maxHeight: '90%' });

        const { state: currentHeight } = useCache<string>({
            key: computed(() => props.localStorageKey),
            initialValue: () => props.defaultHeight,
            parse: (rawValue: string) => `${rawValue}px`,
            serialize: (value: string) => (value.endsWith('px') ? value.slice(0, -2) : value),
        });
        const isDragging = ref<boolean>(false);
        const splitterContainer = ref<HTMLElement>();

        const heights = computed(() => {
            if (props.bottomHidden) return { top: '100%', bottom: '0' };
            if (props.topHidden) return { top: '0', bottom: '100%' };

            const clampedHeight = `clamp(${props.minHeight}, ${props.forcedHeight ?? currentHeight.value}, ${props.maxHeight})`;
            console.log('Calculating heights with', { currentHeight: currentHeight.value, forcedHeight: props.forcedHeight, clampedHeight });

            return {
                top: props.baseSide === 'top' ? clampedHeight : `calc(100% - ${clampedHeight})`,
                bottom: props.baseSide === 'bottom' ? clampedHeight : `calc(100% - ${clampedHeight})`,
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
            let newHeight: number;

            if (props.baseSide === 'top') {
                newHeight = event.clientY - containerRect.top;
            } else {
                newHeight = containerRect.bottom - event.clientY;
            }

            currentHeight.value = `${newHeight}px`;
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
            <div ref={splitterContainer} class={twMerge('flex w-full h-full overflow-hidden relative items-stretch flex-col', props.class)}>
                {isDragging.value ? <div class="absolute inset-0 z-50 cursor-row-resize" /> : null}
                {!props.topHidden ? (
                    <div style={{ height: heights.value.top }} class={twMerge('min-w-full overflow-auto flex flex-col relative gap-1', props.topClass)}>
                        {props.slots?.top?.() ?? <div class="p-4">Top Panel Content</div>}
                    </div>
                ) : null}
                {!props.topHidden && !props.bottomHidden ? (
                    <div
                        class={twMerge(
                            'h-1! z-60 min-w-full relative bg-surface-200 dark:bg-surface-900 hover:bg-primary-500  transition-colors',
                            props.draggerClass,
                            props.draggerInvisible ? 'opacity-0 hover:opacity-100' : '',
                            props.draggerDisabled ? 'pointer-events-none' : ''
                        )}
                    >
                        <div title="Drag to resize" onMousedown={startResize} class="absolute w-full top-0 h-2 cursor-row-resize" style={{ transform: 'translateY(-50%)' }} />
                    </div>
                ) : null}
                {!props.bottomHidden ? (
                    <div style={{ height: heights.value.bottom }} class={twMerge('min-w-full overflow-auto flex flex-col relative gap-1', props.bottomClass)}>
                        {props.slots?.bottom?.() ?? <div class="p-4">Bottom Panel Content</div>}
                    </div>
                ) : null}
            </div>
        );
    },
    {
        name: 'SplitterVertical',
        props: ensureAllTsxProps<Props>()([
            'localStorageKey',
            'defaultHeight',
            'baseSide',
            'class',
            'topClass',
            'bottomClass',
            'draggerClass',
            'draggerInvisible',
            'draggerDisabled',
            'topHidden',
            'bottomHidden',
            'minHeight',
            'maxHeight',
            'forcedHeight',
            'slots',
        ]),
    }
);

export default SplitterVertical;
