<script setup lang="ts" generic="TItem extends DraggableListItem">
import Icon from '@ui/Icon.vue';
import type { ClassNameValue } from 'tailwind-merge';
import { twMerge } from 'tailwind-merge';
import { ref } from 'vue';

export type DraggableListItem = {
    id: any;
    title: string;
    subtitle?: string;
};

const props = withDefaults(
    defineProps<{
        items: TItem[];
        selection?: any | any[];
        emptyText?: string;
        itemClass?: ClassNameValue;
        disabled?: boolean;
        onSelect?: (item: TItem, event?: MouseEvent) => void;
        onContextMenu?: (item: TItem, event?: MouseEvent) => void;
        onReorder?: (payload: { item: TItem; fromIndex: number; toIndex: number }) => void | Promise<void>;
    }>(),
    {
        emptyText: 'No items available.',
    }
);

const draggingIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);
const dropPosition = ref<'before' | 'after' | null>(null);

function onContextMenu(event: MouseEvent, item: TItem) {
    if (!props.onContextMenu) {
        return;
    }

    event.preventDefault();
    props.onContextMenu(item, event);
}

function isSelected(entry: TItem) {
    return Array.isArray(props.selection) ? props.selection.includes(entry.id) : props.selection === entry.id;
}

function clearDragState() {
    draggingIndex.value = null;
    dropIndex.value = null;
    dropPosition.value = null;
}

function onDragStart(event: DragEvent, index: number) {
    if (props.disabled) {
        event.preventDefault();
        return;
    }

    draggingIndex.value = index;
    event.dataTransfer?.setData('text/plain', String(props.items[index]?.id ?? index));

    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
    }
}

function onDragOver(event: DragEvent, index: number) {
    if (props.disabled || draggingIndex.value === null) {
        return;
    }

    event.preventDefault();

    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
    }

    const currentTarget = event.currentTarget as HTMLElement | null;
    if (!currentTarget) {
        return;
    }

    const bounds = currentTarget.getBoundingClientRect();
    const midpoint = bounds.top + bounds.height / 2;

    dropIndex.value = index;
    dropPosition.value = event.clientY < midpoint ? 'before' : 'after';
}

function resolveTargetIndex() {
    if (draggingIndex.value === null || dropIndex.value === null || dropPosition.value === null) {
        return null;
    }

    let nextIndex = dropIndex.value + (dropPosition.value === 'after' ? 1 : 0);

    if (draggingIndex.value < nextIndex) {
        nextIndex -= 1;
    }

    return nextIndex === draggingIndex.value ? null : nextIndex;
}

function isDropIndicatorVisible(index: number, position: 'before' | 'after') {
    return dropIndex.value === index && dropPosition.value === position && draggingIndex.value !== null;
}

async function onDrop(event: DragEvent) {
    if (props.disabled) {
        return;
    }

    event.preventDefault();

    const fromIndex = draggingIndex.value;
    const toIndex = resolveTargetIndex();

    if (fromIndex === null || toIndex === null || !props.onReorder) {
        clearDragState();
        return;
    }

    const item = props.items[fromIndex];
    if (!item) {
        clearDragState();
        return;
    }

    try {
        await props.onReorder({ item, fromIndex, toIndex });
    } finally {
        clearDragState();
    }
}
</script>

<template>
    <section class="min-h-0 overflow-auto">
        <div v-if="!items.length" class="px-5 py-2 text-xs opacity-50">
            {{ emptyText }}
        </div>

        <div v-else class="min-h-0 overflow-auto">
            <div
                v-for="(entry, index) in items"
                :key="`${entry.id}`"
                class="group relative flex min-h-9 items-center gap-1 px-2 py-1 text-left transition"
                :class="[
                    isSelected(entry) ? 'bg-white/10 outline-1 -outline-offset-1 outline-white/8' : 'hover:bg-white/6',
                    draggingIndex === index ? 'opacity-55' : undefined,
                    twMerge(itemClass),
                ]"
                @dragover="(event) => onDragOver(event, index)"
                @drop="onDrop"
            >
                <div v-if="isDropIndicatorVisible(index, 'before')" class="pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded-full bg-green-500"></div>
                <div v-if="isDropIndicatorVisible(index, 'after')" class="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-green-500"></div>

                <button
                    type="button"
                    class="flex shrink-0 cursor-grab items-center self-stretch px-1 transition text-x8 hover:text-white active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="props.disabled"
                    :draggable="!props.disabled"
                    :aria-label="`Reorder ${entry.title}`"
                    @click.stop
                    @dragstart="(event) => onDragStart(event, index)"
                    @dragend="clearDragState"
                >
                    <Icon icon="icon-[fluent--drag-24-filled]" class="text-base" />
                </button>

                <button
                    type="button"
                    :data-testid="`draggable-list-item-${entry.id}`"
                    :aria-label="entry.title"
                    class="flex min-w-0 w-full flex-1 items-center gap-1.5 overflow-hidden text-left"
                    @click="(event) => props.onSelect?.(entry, event as MouseEvent)"
                    @contextmenu="(event) => onContextMenu(event, entry)"
                >
                    <slot name="item-leftIcon" :item="entry"></slot>
                    <div class="flex min-w-0 flex-1 items-center text-xs py-px overflow-hidden">
                        <slot name="item-title" :item="entry">
                            <p class="truncate font-medium">{{ entry.title }}</p>
                        </slot>
                    </div>
                    <!-- <p v-if="entry.subtitle" class="hidden truncate text-xs opacity-70 xl:block ">
                        {{ entry.subtitle }}
                    </p> -->
                </button>

                <div class="flex shrink-0 items-center gap-1">
                    <slot name="item-rightIcon" :item="entry"></slot>
                </div>
            </div>
        </div>
    </section>
</template>
