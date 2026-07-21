<script setup lang="ts" generic="T extends Pick<FileTreeItem, 'id' | 'rightText' | 'subtitle'> & { title?: string; name?: string }, TChild extends { id: string | number } = any">
import { useServerTree } from '@composables/useServerTree';
import { ContextMenuEntry } from '@directives/contextMenuTypes';
import { FileTreeItem } from '@shared/utils/useFileTree';
import { twMerge } from 'tailwind-merge';
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        item: T;
        dataTestid?: string;
        dataSidebarSelfToggle?: boolean | 'true';
        dataNodeId: string;
        dataParentId?: string;
        expandable?: boolean;
        draggable?: boolean;
        collapsed?: boolean;
        children?: () => TChild[];
        isLoading?: boolean;
        tooltip?: string;
        class?: string;
        selected?: boolean;
        skipTitle?: boolean;
        icon?: 'icon-[mdi--database-outline]' | 'icon-[mdi--folder-outline]' | 'icon-[mdi--file-outline]' | (string & {});
        contextMenuItems?: (item: T) => ContextMenuEntry[];

        onClick: (event: MouseEvent) => void;
        onDblClick?: (event: MouseEvent) => void;
        onDragstart?: (event: DragEvent) => void;
    }>(),
    {
        expandable: true,
    }
);

const state = useServerTree();

function focusSidebarEventTarget(event: MouseEvent) {
    if (event.currentTarget instanceof HTMLElement) {
        event.currentTarget.focus({ preventScroll: true });
    }
}
function clearPendingRowClick(nodeId: string | undefined) {
    if (!nodeId) {
        return;
    }

    const timerId = state.pendingRowClickTimers.get(nodeId);

    if (timerId === undefined) {
        return;
    }

    window.clearTimeout(timerId);
    state.pendingRowClickTimers.delete(nodeId);
}
function schedulePendingRowClick(nodeId: string | undefined, event: MouseEvent, action: () => void) {
    focusSidebarEventTarget(event);

    if (!nodeId || event.detail === 0) {
        action();
        return;
    }

    clearPendingRowClick(nodeId);
    const timerId = window.setTimeout(() => {
        state.pendingRowClickTimers.delete(nodeId);
        action();
    }, 200);
    state.pendingRowClickTimers.set(nodeId, timerId);
}

async function onRowClick(event: MouseEvent, skipSchedule = false) {
    if (!props.onClick) {
        return;
    }

    if (skipSchedule || props.dataSidebarSelfToggle) {
        props.onClick(event);
        return;
    }

    schedulePendingRowClick(props.dataNodeId, event, () => {
        props.onClick!(event);
    });
}

// function onContextMenu(event: MouseEvent) {
//     if (!props.contextMenuItems) {
//         return;
//     }

//     event.preventDefault();
//     focusSidebarEventTarget(event);
//     if (event.currentTarget instanceof HTMLElement) {
//         event.currentTarget.openContextMenu(props.contextMenuItems);
//     }

//     // props.onContextMenu!(props.item, props.dataNodeId, event);
// }

function handleDoubleClick(event: MouseEvent) {
    if (!props.onDblClick) {
        return;
    }

    event.preventDefault();
    clearPendingRowClick(props.dataNodeId);
    props.onDblClick!(event);
}

function handleDragStart(event: DragEvent) {
    if (!props.onDragstart) {
        return;
    }

    props.onDragstart(event);
}

const children = computed(() => {
    if (!props.children) {
        return [];
    }

    return props.children();
});
</script>

<template>
    <button
        v-if="!skipTitle"
        data-sidebar-row="true"
        :data-test-id="dataTestid"
        :data-sidebar-self-toggle="dataSidebarSelfToggle ? 'true' : undefined"
        :data-node-id="dataNodeId"
        :data-parent-id="dataParentId"
        :data-sidebar-expandable="expandable ? 'true' : 'false'"
        :data-sidebar-collapsed="String(collapsed)"
        :draggable="draggable"
        type="button"
        :class="
            twMerge(
                'flex min-h-5 items-center gap-1 text-default w-full px-1 hover:bg-white/6  focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-white/50 focus-visible:bg-white/10',
                props.class,
                selected ? 'bg-white/10' : ''
            )
        "
        @click="onRowClick"
        @dblclick="handleDoubleClick"
        v-menu="props.contextMenuItems ? { items: () => props.contextMenuItems!(item), key: props.dataNodeId } : undefined"
        @keydown="state.handleSidebarRowKeydown"
        @dragstart="handleDragStart"
    >
        <span class="flex min-w-0 flex-1 py-1 items-center gap-0.5 text-left select-none" v-tooltip.xs="tooltip">
            <span
                @click.prevent.stop="(e) => onRowClick(e, expandable)"
                class="icon"
                :data-sidebar-toggle-for="expandable ? dataNodeId : undefined"
                :class="[collapsed ? 'icon-[mdi--chevron-right]' : 'icon-[mdi--chevron-down]', expandable ? undefined : 'invisible w-2']"
            />
            <span class="flex-1 inline-flex items-center gap-1 min-w-0 shrink-0 truncate">
                <span v-if="icon" class="icon shrink-0 text-sm" :class="isLoading ? 'icon-[mdi--loading] animate-spin' : icon" />
                <span class="text-xs leading-tight text-white">
                    <slot name="text" :text="item.title ?? item.name">
                        {{ item.title ?? item.name }}
                    </slot>
                </span>
                <span v-if="!icon && isLoading" class="icon shrink-0 text-sm" :class="isLoading ? 'icon-[mdi--loading] animate-spin' : icon" />
                <span v-if="item.subtitle" class="pl-2 text-2xs opacity-70 select-none">{{ item.subtitle }}</span>
                <span v-if="item.rightText" class="pl-2 ml-auto text-2xs opacity-80 font-semibold select-none">{{ item.rightText }}</span>
            </span>
            <slot name="right-prefix"></slot>
        </span>

        <slot></slot>
    </button>

    <div v-if="!collapsed && children?.length" class="min-w-0 border-l border-x3/50" :class="skipTitle ? 'pl-0' : 'pl-3'">
        <div v-for="child in children" :key="child.id" class="flex min-w-0 flex-col">
            <slot name="child" :item="child" :parentId="dataNodeId" :allItems="children"></slot>
        </div>
    </div>
</template>
