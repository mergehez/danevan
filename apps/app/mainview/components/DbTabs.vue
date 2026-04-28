<script setup lang="ts">
import { useConnections } from '@composables/useConnections';
import { useNavState } from '@composables/useNavState';
import { useServerTree } from '@composables/useServerTree';
import { Tab } from '@composables/useSettings';
import type { ContextMenuEntry } from '@directives/contextMenuTypes';
import { useContextMenu } from '@directives/useContextMenu';
import DragTabs from '@ui/DragTabs.vue';
import Icon from '@ui/Icon.vue';
import IconButton from '@ui/IconButton.vue';
import { computed } from 'vue';

const navState = useNavState();
const contextMenu = useContextMenu();
const connections = useConnections();
const serverTree = useServerTree();

const onAuxClick = (event: MouseEvent, endpoint: Tab) => {
    if (event.button === 1) {
        event.preventDefault();
        setTimeout(() => {
            navState.closeTab(endpoint);
        }, 200);
    }
};

const onMouseDown = (event: MouseEvent, endpoint: Tab) => {
    if (event.button == 1) {
        event.preventDefault();
        navState.closeTab(endpoint);
    }
};

function handleTabClick(tab: Tab) {
    if (tab.type === 'table' && tab.name) {
        serverTree.requestRevealTableSelection(tab.connectionId, tab.name);
    }

    navState.selectTab(tab);
}

function openTabContextMenu(event: MouseEvent, tab: Tab) {
    event.preventDefault();

    const items: ContextMenuEntry[] = [
        {
            id: `close-tab:${tab.hash}`,
            label: 'Close tab',
            iconClass: 'icon-[mdi--close]',
            action: () => navState.closeTab(tab),
        },
        {
            id: `close-other-tabs:${tab.hash}`,
            label: 'Close other',
            iconClass: 'icon-[mdi--close-box-multiple-outline]',
            disabled: navState.selectedTabs.length <= 1,
            action: () => navState.closeOtherTabs(tab),
        },
        {
            id: `close-all-tabs:${tab.hash}`,
            label: 'Close all',
            iconClass: 'icon-[mdi--close-network-outline]',
            disabled: navState.selectedTabs.length === 0,
            action: () => navState.closeAllTabs(),
        },
        {
            type: 'separator',
        },
        {
            id: 'reopen-closed-tab',
            label: 'Reopen closed tab',
            iconClass: 'icon-[mdi--tab-plus]',
            disabled: navState.closedTabs.length === 0,
            action: () => navState.reopenClosedTab(),
        },
    ];

    contextMenu.openAtEvent(event, items);
}

const getClass = (tab: Tab, requiredClass: string) => {
    return [
        'group relative flex cursor-pointer items-center gap-1 whitespace-nowrap border px-2 py-1 pr-5 text-xs text-white',
        requiredClass,
        navState.activeTab?.hash === tab.hash ? 'bg-green-700 hover:bg-green-800 border-green-600' : 'bg-x2 hover:bg-x0 border-x4 opacity-80',
    ].join(' ');
};

const states = computed(() => {
    return [navState.scriptTabs, navState.nonScriptTabs];
});

function onChange(tabs: Tab[], index: number) {
    if (index === 0) {
        navState.onScriptTabsChange(tabs);
    } else {
        navState.onNonScriptTabsChange(tabs);
    }
}
</script>

<template>
    <div class="flex min-w-0 flex-col gap-0.5 bg-x2">
        <template v-for="(tabs, i) in states" :key="i">
            <div v-if="i != 0 || tabs.length" class="flex min-w-0 items-center gap-2">
                <DragTabs :items="tabs" :on-change="(tabs) => onChange(tabs, i)" class="min-w-0 flex flex-1 flex-wrap overflow-x-auto border-b border-x0">
                    <template #tab="{ requiredClass, item: e }">
                        <div
                            v-tooltip.xs.nowrap.delay="e.tooltip"
                            draggable="true"
                            :id="e.hash"
                            :class="getClass(e, requiredClass)"
                            @click="() => handleTabClick(e)"
                            @contextmenu.prevent="(ev) => openTabContextMenu(ev, e)"
                            @mousedown="(ev) => onMouseDown(ev, e)"
                            @auxclick.prevent="(ev) => onAuxClick(ev, e)"
                        >
                            <Icon :icon="e.type === 'scratch' ? 'icon-[mdi--file-edit-outline]' : 'icon-[mdi--table-large]'" class="text-sm opacity-70" />
                            <span class="select-none pointer-events-none">{{ e.name }}</span>
                            <span @click.stop="navState.closeTab(e)" class="absolute right-1 flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                                <i class="icon icon-[mdi--close] aspect-square text-sm"></i>
                            </span>
                        </div>
                    </template>
                </DragTabs>
                <IconButton
                    v-if="i == 0"
                    icon="icon-[mdi--plus]"
                    v-tooltip.xs.nowrap="'New scratch tab'"
                    smaller
                    :disabled="!connections.connections.length"
                    @click="navState.openScratchTab()"
                />
            </div>
        </template>
    </div>
</template>
