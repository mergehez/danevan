<script setup lang="ts">
import { useOverlaysState } from '@directives/useOverlaysState';
import IconButton from '@ui/IconButton.vue';
import { twMerge } from 'tailwind-merge';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useAttrs, useSlots, useTemplateRef, watch, type Ref } from 'vue';

export type PopoverPosition = {
    left: number;
    top: number;
};

export type PopoverSize = {
    width: number;
    height: number;
};

export type FloatingResizeDirection = 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type PopoverProps = {
    open: boolean;
    title?: string;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    center?: boolean;
    backdrop?: boolean;
    backdropClass?: string;
    compactHeader?: boolean;
    localStorageKey?: string;
    modalMarginToScreenEdges?: number;
    contentClass?: string;
    surfaceClass?: string;
    titleClass?: string;
    headerDataTestid?: string;
    closeTooltip?: string;
    closeSeverity?: 'secondary' | 'raised';
    closeSmaller?: boolean;
    resizable?: boolean;
    closable?: boolean;
    showHeader?: boolean;
    onUpdateOpen?: (open: boolean) => void;
    onUpdatePosition?: (position: PopoverPosition) => void;
    onUpdateSize?: (size: PopoverSize) => void;
};

type StoredPopoverSize = {
    width?: number;
};

type FloatingSurfacePosition = {
    x: number;
    y: number;
};

type FloatingSurfaceSize = {
    width: number;
    height: number;
};

type ResizeHandleDefinition = {
    direction: FloatingResizeDirection;
    class: string;
};

type UsePopoverSurfaceOptions = {
    surfaceElement: Ref<HTMLElement | null>;
    clampPosition: (position: FloatingSurfacePosition, size: FloatingSurfaceSize) => FloatingSurfacePosition;
    clampSize: (size: FloatingSurfaceSize) => FloatingSurfaceSize;
    onCommitPosition?: (position: FloatingSurfacePosition) => void;
    onCommitSize?: (size: FloatingSurfaceSize, position: FloatingSurfacePosition) => void;
};
defineOptions({ inheritAttrs: false });

const DEFAULT_POPOVER_LEFT = 24;
const DEFAULT_POPOVER_TOP = 24;
const DEFAULT_POPOVER_WIDTH = 480;
const DEFAULT_POPOVER_MIN_WIDTH = 280;
const DEFAULT_MODAL_MIN_WIDTH = 320;
const DEFAULT_MIN_HEIGHT = 180;
const DEFAULT_POPOVER_MARGIN = 12;
const DEFAULT_MODAL_MARGIN = 16;

const POPOVER_RESIZE_HANDLES: ResizeHandleDefinition[] = [
    {
        direction: 'right',
        class: 'absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize touch-none',
    },
    { direction: 'left', class: 'absolute left-0 top-0 z-10 h-full w-2 cursor-ew-resize touch-none' },
];

const props = withDefaults(defineProps<PopoverProps>(), {
    title: '',
    left: 24,
    top: 24,
    minWidth: 280,
    minHeight: 180,
    resizable: true,
    closable: true,
    showHeader: true,
});

const overlayState = useOverlaysState();
const popoverZIndex = ref(90);

function usePopoverSurface(options: UsePopoverSurfaceOptions) {
    const position = reactive<FloatingSurfacePosition>({ x: 0, y: 0 });
    const size = reactive<FloatingSurfaceSize>({ width: 0, height: 0 });

    const activeDrag = reactive({
        pointerId: -1,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        originX: 0,
        originY: 0,
        isDragging: false,
    });

    const activeResize = reactive({
        pointerId: -1,
        direction: undefined as FloatingResizeDirection | undefined,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        originX: 0,
        originY: 0,
        originWidth: 0,
        originHeight: 0,
        isResizing: false,
    });

    let hasWindowListeners = false;
    let interactionFrameId = 0;

    function capturePointer(pointerId: number) {
        options.surfaceElement.value?.setPointerCapture?.(pointerId);
    }

    function releasePointer(pointerId: number) {
        if (pointerId < 0 || !options.surfaceElement.value?.hasPointerCapture?.(pointerId)) {
            return;
        }

        options.surfaceElement.value.releasePointerCapture(pointerId);
    }

    function applyPosition(nextPosition: FloatingSurfacePosition, nextSize: FloatingSurfaceSize = size) {
        const clamped = options.clampPosition(nextPosition, nextSize);
        position.x = clamped.x;
        position.y = clamped.y;
        return clamped;
    }

    function applySize(nextSize: FloatingSurfaceSize, nextPosition: FloatingSurfacePosition = position) {
        const clampedSize = options.clampSize(nextSize);
        size.width = clampedSize.width;
        size.height = clampedSize.height;

        const clampedPosition = applyPosition(nextPosition, clampedSize);

        return {
            position: clampedPosition,
            size: clampedSize,
        };
    }

    function commitPosition() {
        options.onCommitPosition?.({ x: position.x, y: position.y });
    }

    function commitSize() {
        options.onCommitSize?.({ width: size.width, height: size.height }, { x: position.x, y: position.y });
    }

    function cancelInteractionFrame() {
        if (!interactionFrameId) {
            return;
        }

        cancelAnimationFrame(interactionFrameId);
        interactionFrameId = 0;
    }

    function applyPendingInteraction() {
        interactionFrameId = 0;

        if (activeDrag.isDragging) {
            applyPosition({
                x: activeDrag.originX + (activeDrag.currentX - activeDrag.startX),
                y: activeDrag.originY + (activeDrag.currentY - activeDrag.startY),
            });
        }

        if (!activeResize.isResizing || !activeResize.direction) {
            return;
        }

        const widthDelta = activeResize.currentX - activeResize.startX;
        const heightDelta = activeResize.currentY - activeResize.startY;
        const resizeLeft = activeResize.direction.includes('left');
        const resizeTop = activeResize.direction.includes('top');
        const resizeRight = activeResize.direction.includes('right');
        const resizeBottom = activeResize.direction.includes('bottom');
        const anchorRight = activeResize.originX + activeResize.originWidth;
        const anchorBottom = activeResize.originY + activeResize.originHeight;

        const nextSize = options.clampSize({
            width: resizeLeft ? activeResize.originWidth - widthDelta : resizeRight ? activeResize.originWidth + widthDelta : activeResize.originWidth,
            height: resizeTop ? activeResize.originHeight - heightDelta : resizeBottom ? activeResize.originHeight + heightDelta : activeResize.originHeight,
        });

        applySize(nextSize, {
            x: resizeLeft ? anchorRight - nextSize.width : activeResize.originX,
            y: resizeTop ? anchorBottom - nextSize.height : activeResize.originY,
        });
    }

    function scheduleInteractionUpdate() {
        if (interactionFrameId) {
            return;
        }

        interactionFrameId = requestAnimationFrame(applyPendingInteraction);
    }

    function ensureWindowListeners() {
        if (hasWindowListeners) {
            return;
        }

        window.addEventListener('pointermove', onWindowPointerMove);
        window.addEventListener('pointerup', onWindowPointerUp);
        window.addEventListener('pointercancel', onWindowPointerUp);
        hasWindowListeners = true;
    }

    function removeWindowListeners() {
        if (activeDrag.isDragging || activeResize.isResizing || !hasWindowListeners) {
            return;
        }

        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onWindowPointerUp);
        window.removeEventListener('pointercancel', onWindowPointerUp);
        hasWindowListeners = false;
    }

    function stopDragging() {
        releasePointer(activeDrag.pointerId);
        activeDrag.pointerId = -1;
        activeDrag.isDragging = false;
        cancelInteractionFrame();
        removeWindowListeners();
    }

    function stopResizing() {
        releasePointer(activeResize.pointerId);
        activeResize.pointerId = -1;
        activeResize.direction = undefined;
        activeResize.isResizing = false;
        cancelInteractionFrame();
        removeWindowListeners();
    }

    function onWindowPointerMove(event: PointerEvent) {
        if (activeDrag.isDragging && event.pointerId === activeDrag.pointerId) {
            activeDrag.currentX = event.clientX;
            activeDrag.currentY = event.clientY;
            scheduleInteractionUpdate();
            return;
        }

        if (!activeResize.isResizing || event.pointerId !== activeResize.pointerId || !activeResize.direction) {
            return;
        }

        activeResize.currentX = event.clientX;
        activeResize.currentY = event.clientY;
        scheduleInteractionUpdate();
    }

    function onWindowPointerUp(event: PointerEvent) {
        if (event.pointerId === activeDrag.pointerId) {
            activeDrag.currentX = event.clientX;
            activeDrag.currentY = event.clientY;
            applyPendingInteraction();
            commitPosition();
            stopDragging();
        }

        if (event.pointerId === activeResize.pointerId) {
            activeResize.currentX = event.clientX;
            activeResize.currentY = event.clientY;
            applyPendingInteraction();
            commitSize();
            stopResizing();
        }
    }

    function startDrag(pointerEvent: PointerEvent) {
        activeDrag.pointerId = pointerEvent.pointerId;
        activeDrag.startX = pointerEvent.clientX;
        activeDrag.startY = pointerEvent.clientY;
        activeDrag.currentX = pointerEvent.clientX;
        activeDrag.currentY = pointerEvent.clientY;
        activeDrag.originX = position.x;
        activeDrag.originY = position.y;
        activeDrag.isDragging = true;
        capturePointer(pointerEvent.pointerId);
        ensureWindowListeners();
    }

    function startResize(direction: FloatingResizeDirection, pointerEvent: PointerEvent) {
        const fallbackSize = options.surfaceElement.value
            ? options.clampSize({
                  width: options.surfaceElement.value.offsetWidth,
                  height: options.surfaceElement.value.offsetHeight,
              })
            : { width: size.width, height: size.height };
        const originWidth = size.width > 0 ? size.width : fallbackSize.width;
        const originHeight = size.height > 0 ? size.height : fallbackSize.height;

        if (size.width === 0 || size.height === 0) {
            size.width = originWidth;
            size.height = originHeight;
        }

        activeResize.pointerId = pointerEvent.pointerId;
        activeResize.direction = direction;
        activeResize.startX = pointerEvent.clientX;
        activeResize.startY = pointerEvent.clientY;
        activeResize.currentX = pointerEvent.clientX;
        activeResize.currentY = pointerEvent.clientY;
        activeResize.originX = position.x;
        activeResize.originY = position.y;
        activeResize.originWidth = originWidth;
        activeResize.originHeight = originHeight;
        activeResize.isResizing = true;
        capturePointer(pointerEvent.pointerId);
        ensureWindowListeners();
    }

    onBeforeUnmount(() => {
        cancelInteractionFrame();
        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onWindowPointerUp);
        window.removeEventListener('pointercancel', onWindowPointerUp);
    });

    return {
        activeDrag,
        activeResize,
        position,
        size,
        applyPosition,
        applySize,
        startDrag,
        startResize,
        stopDragging,
        stopResizing,
    };
}
const attrs = useAttrs();
const slots = useSlots();
const surfaceElement = useTemplateRef('surfaceElement');
const isOpen = ref(props.open);
let surfaceResizeObserver: ResizeObserver | undefined;

const getScreenEdgeMargin = () => props.modalMarginToScreenEdges ?? (props.center ? DEFAULT_MODAL_MARGIN : DEFAULT_POPOVER_MARGIN);
const getMinWidth = () => props.minWidth ?? (props.center ? DEFAULT_MODAL_MIN_WIDTH : DEFAULT_POPOVER_MIN_WIDTH);
const getMinHeight = () => props.minHeight ?? DEFAULT_MIN_HEIGHT;
const getDefaultWidth = () => props.width ?? (props.center ? undefined : DEFAULT_POPOVER_WIDTH);

function getStoredSize() {
    if (!props.localStorageKey) {
        return undefined;
    }

    try {
        const storedValue = window.localStorage.getItem(props.localStorageKey);

        if (!storedValue) {
            return undefined;
        }

        const parsedValue = JSON.parse(storedValue) as StoredPopoverSize;

        return {
            width: typeof parsedValue.width === 'number' ? parsedValue.width : undefined,
        };
    } catch {
        return undefined;
    }
}

const initialStoredSize = getStoredSize();

const { position, size, activeDrag, activeResize, applyPosition, applySize, startDrag, startResize, stopDragging, stopResizing } = usePopoverSurface({
    surfaceElement,
    clampPosition(nextPosition, nextSize) {
        const margin = getScreenEdgeMargin();

        if (props.center) {
            const horizontalLimit = Math.max((window.innerWidth - nextSize.width) / 2 - margin, 0);
            const verticalLimit = Math.max((window.innerHeight - nextSize.height) / 2 - margin, 0);

            return {
                x: Math.min(Math.max(Math.round(nextPosition.x), -horizontalLimit), horizontalLimit),
                y: Math.min(Math.max(Math.round(nextPosition.y), -verticalLimit), verticalLimit),
            };
        }

        const maxLeft = Math.max(window.innerWidth - nextSize.width - margin, margin);
        const maxTop = Math.max(window.innerHeight - nextSize.height - margin, margin);

        return {
            x: Math.min(Math.max(Math.round(nextPosition.x), margin), maxLeft),
            y: Math.min(Math.max(Math.round(nextPosition.y), margin), maxTop),
        };
    },
    clampSize(nextSize) {
        const margin = getScreenEdgeMargin();
        const minWidth = getMinWidth();
        const minHeight = getMinHeight();
        const maxWidth = Math.max(Math.min(props.maxWidth ?? Number.POSITIVE_INFINITY, window.innerWidth - margin * 2), minWidth);
        const maxHeight = Math.max(Math.min(props.maxHeight ?? Number.POSITIVE_INFINITY, window.innerHeight - margin * 2), minHeight);

        return {
            width: Math.min(Math.max(Math.round(nextSize.width), minWidth), maxWidth),
            height: Math.min(Math.max(Math.round(nextSize.height), minHeight), maxHeight),
        };
    },
    onCommitPosition(nextPosition) {
        props.onUpdatePosition?.({
            left: nextPosition.x,
            top: nextPosition.y,
        });
    },
    onCommitSize(nextSize, nextPosition) {
        props.onUpdateSize?.({
            width: nextSize.width,
            height: nextSize.height,
        });
        props.onUpdatePosition?.({
            left: nextPosition.x,
            top: nextPosition.y,
        });

        if (props.localStorageKey) {
            try {
                window.localStorage.setItem(
                    props.localStorageKey,
                    JSON.stringify({
                        width: nextSize.width,
                    } satisfies StoredPopoverSize)
                );
            } catch {
                // Best-effort persistence only.
            }
        }
    },
});

const modalLike = computed(() => props.center || props.backdrop);

const transitionClasses = computed(() =>
    modalLike.value
        ? {
              enterFrom: 'opacity-0',
              enterTo: 'opacity-100',
              leaveFrom: 'opacity-100',
              leaveTo: 'opacity-0',
          }
        : {
              enterFrom: 'opacity-0 scale-[0.985]',
              enterTo: 'opacity-100 scale-100',
              leaveFrom: 'opacity-100 scale-100',
              leaveTo: 'opacity-0 scale-[0.99]',
          }
);

const wrapperClass = computed(() =>
    twMerge(
        'fixed inset-0 overflow-y-auto px-6 py-10',
        props.center ? 'flex items-center justify-center' : '',
        props.backdrop ? 'pointer-events-auto bg-x0/70 backdrop-blur dark' : 'pointer-events-none bg-transparent',
        props.backdropClass
    )
);

const wrapperStyle = computed(() => ({
    zIndex: popoverZIndex.value,
}));

const popoverStyle = computed(() => ({
    left: props.center ? undefined : '0px',
    top: props.center ? undefined : '0px',
    transform: props.center ? `translate(${position.x}px, ${position.y}px)` : `translate3d(${position.x}px, ${position.y}px, 0)`,
    width: size.width > 0 ? `${size.width}px` : undefined,
    zIndex: props.center || props.backdrop ? undefined : `${popoverZIndex.value}`,
    willChange: activeDrag.isDragging || activeResize.isResizing ? 'transform, width, height' : undefined,
}));

const resolvedSurfaceClass = computed(() =>
    twMerge(
        props.center
            ? 'pointer-events-auto relative flex min-h-0 flex-col w-full overflow-y-auto rounded-lg border border-x4 bg-x1 shadow-[0_30px_80px_rgba(0,0,0,0.45)]'
            : 'pointer-events-auto fixed flex min-h-0 flex-col border-2 border-blue-800 bg-x0 shadow-[0_0_15px_rgba(255,255,255,0.05)]',
        props.surfaceClass
    )
);

const resolvedHeaderClass = computed(() =>
    props.center ? twMerge('border-b border-x3 px-3', props.compactHeader ? 'text-lg py-1.5' : 'text-xl py-3') : 'border-b border-x3 px-3 py-2'
);

const resolvedTitleClass = computed(() => props.titleClass ?? (props.center ? 'font-semibold text-default' : 'text-sm font-medium text-default'));
const resolvedBodyClass = computed(() => twMerge(props.center ? 'flex flex-1 flex-col overflow-y-auto' : 'flex-1 overflow-auto', props.contentClass));
const resolvedCloseTooltip = computed(() => props.closeTooltip ?? (props.center ? 'Close dialog' : 'Close popover'));
const resolvedCloseSeverity = computed(() => props.closeSeverity ?? (props.center ? 'raised' : 'secondary'));
const resolvedCloseSmaller = computed(() => props.closeSmaller ?? !props.center);
const hasFooterSlot = computed(() => Boolean(slots.footer));

if (initialStoredSize?.width) {
    applySize(
        {
            width: initialStoredSize.width ?? getMinWidth(),
            height: getMinHeight(),
        },
        {
            x: props.center ? 0 : (props.left ?? DEFAULT_POPOVER_LEFT),
            y: props.center ? 0 : (props.top ?? DEFAULT_POPOVER_TOP),
        }
    );
}

function updateOpen(nextOpen: boolean) {
    popoverZIndex.value = nextOpen ? overlayState.claimZIndex() : overlayState.releaseZIndex(popoverZIndex.value);
    isOpen.value = nextOpen;
    props.onUpdateOpen?.(nextOpen);
}

function resetCenteredState() {
    applyPosition({ x: 0, y: 0 });
    size.width = 0;
    size.height = 0;
}

async function syncSizeFromSurface() {
    await nextTick();

    const surface = surfaceElement.value;

    if (!surface) {
        return;
    }

    const storedSize = getStoredSize();
    const measuredHeight = surface.offsetHeight;

    if (measuredHeight > 0) {
        size.height = measuredHeight;
    }

    if (!storedSize && (size.width > 0 || position.x !== 0 || position.y !== 0)) {
        applyPosition(
            { x: position.x, y: position.y },
            {
                width: size.width > 0 ? size.width : surface.offsetWidth,
                height: measuredHeight > 0 ? measuredHeight : getMinHeight(),
            }
        );
        return;
    }

    applySize(
        {
            width: storedSize?.width ?? surface.offsetWidth,
            height: measuredHeight > 0 ? measuredHeight : getMinHeight(),
        },
        { x: 0, y: 0 }
    );
}

onMounted(() => {
    const surface = surfaceElement.value;

    if (surface) {
        surfaceResizeObserver = new ResizeObserver(() => {
            if (!isOpen.value || activeResize.isResizing) {
                return;
            }

            const measuredHeight = surface.offsetHeight;

            if (measuredHeight <= 0) {
                return;
            }

            size.height = measuredHeight;
            applyPosition(
                { x: position.x, y: position.y },
                {
                    width: size.width > 0 ? size.width : surface.offsetWidth,
                    height: measuredHeight,
                }
            );
        });

        surfaceResizeObserver.observe(surface);
    }

    if (surfaceElement.value && props.center && isOpen.value) {
        void syncSizeFromSurface();
    }
});

onBeforeUnmount(() => {
    surfaceResizeObserver?.disconnect();
});

function onHeaderPointerDown(event: PointerEvent) {
    if (event.button !== 0 || activeResize.isResizing) {
        return;
    }

    if (!props.center) {
        event.preventDefault();
        event.stopPropagation();
    }

    const target = event.target instanceof Element ? event.target : null;

    if (target?.closest('button, a, input, textarea, select, summary, [role="button"]')) {
        return;
    }

    startDrag(event);
}

function onResizeHandlePointerDown(direction: FloatingResizeDirection, event: PointerEvent) {
    if (!props.resizable || event.button !== 0 || activeDrag.isDragging) {
        return;
    }

    startResize(direction, event);
}

function onBackdropClick() {
    if (!props.backdrop || !props.closable) {
        return;
    }

    updateOpen(false);
}

watch(
    () => props.open,
    async (value) => {
        popoverZIndex.value = value ? overlayState.claimZIndex() : overlayState.releaseZIndex(popoverZIndex.value);
        isOpen.value = value;

        if (!value) {
            stopDragging();
            stopResizing();

            if (props.center) {
                resetCenteredState();
            }

            return;
        }

        if (props.center) {
            await syncSizeFromSurface();
        }
    },
    { immediate: true }
);

watch(
    () => [props.left, props.top],
    ([left, top]) => {
        if (props.center) {
            applyPosition({ x: 0, y: 0 });
            return;
        }

        applyPosition({ x: left ?? DEFAULT_POPOVER_LEFT, y: top ?? DEFAULT_POPOVER_TOP });
    },
    { immediate: true }
);

watch(
    () => props.width,
    (width) => {
        const desiredWidth = width ?? getDefaultWidth();

        if (desiredWidth == null) {
            return;
        }

        applySize(
            {
                width: desiredWidth,
                height: size.height > 0 ? size.height : getMinHeight(),
            },
            props.center ? { x: 0, y: 0 } : undefined
        );
    },
    { immediate: true }
);
</script>

<template>
    <Transition
        enter-active-class="transition duration-150 ease-out"
        :enter-from-class="transitionClasses.enterFrom"
        :enter-to-class="transitionClasses.enterTo"
        leave-active-class="transition duration-120 ease-in"
        :leave-from-class="transitionClasses.leaveFrom"
        :leave-to-class="transitionClasses.leaveTo"
    >
        <div v-if="isOpen" :class="wrapperClass" :style="wrapperStyle" @click.self="onBackdropClick">
            <div v-bind="attrs" ref="surfaceElement" role="dialog" :style="popoverStyle" :class="resolvedSurfaceClass">
                <div
                    v-if="props.showHeader"
                    :data-testid="props.headerDataTestid"
                    :class="twMerge('flex cursor-move touch-none select-none items-center justify-between gap-3 text-default', resolvedHeaderClass)"
                    @pointerdown="onHeaderPointerDown"
                >
                    <div class="min-w-0 flex-1">
                        <slot name="title">
                            <p :class="twMerge('truncate', resolvedTitleClass)">{{ props.title }}</p>
                        </slot>
                    </div>

                    <div v-if="props.closable || $slots.actions" class="flex items-center gap-2">
                        <slot name="actions"></slot>
                        <IconButton
                            v-if="props.closable"
                            :severity="resolvedCloseSeverity"
                            :smaller="resolvedCloseSmaller"
                            icon="icon-[mdi--close]"
                            v-tooltip.xs.nowrap="resolvedCloseTooltip"
                            @click="updateOpen(false)"
                        />
                    </div>
                </div>

                <div :class="twMerge('min-h-0 flex-1', resolvedBodyClass)">
                    <slot></slot>
                </div>

                <div v-if="hasFooterSlot" class="border-t border-x3 px-3 py-2">
                    <slot name="footer"></slot>
                </div>

                <template v-if="props.resizable">
                    <div
                        v-for="handle in POPOVER_RESIZE_HANDLES"
                        :key="handle.direction"
                        :data-testid="`floating-surface-handle-${handle.direction}`"
                        :class="handle.class"
                        :style="{
                            zIndex: popoverZIndex,
                        }"
                        @pointerdown.stop.prevent="onResizeHandlePointerDown(handle.direction, $event)"
                    ></div>
                </template>
            </div>
        </div>
    </Transition>
</template>
