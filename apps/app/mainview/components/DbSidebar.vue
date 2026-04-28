<script setup lang="ts">
import DbConnectionForm from '@components/DbConnectionForm.vue';
import TreeServer from '@components/TreeServer.vue';
import { useConnections } from '@composables/useConnections';
import { useDbCaches } from '@composables/useDbCaches';
import { useDbSettings } from '@composables/useDbSettings';
import { useNavState } from '@composables/useNavState';
import { useQuery } from '@composables/useQuery';
import { useScriptsDb } from '@composables/useScriptsDb';
import { useServers } from '@composables/useServers';
import { tasks } from '@composables/useTasks';
import { ContextMenuEntry } from '@directives/contextMenuTypes';
import { useContextMenu } from '@directives/useContextMenu';
import { uniqueId } from '@lib/utils';
import { FileTreeItem, useFileTree } from '@shared/utils/useFileTree';
import FileTree from '@ui/FileTree.vue';
import IconButton from '@ui/IconButton.vue';
import SplitterVertical from '@ui/SplitterVertical.vue';
import type { CollectionFilterState, ScriptRecord } from '@utils/appClient';
import { toast } from '@utils/useToast';
import { computed, nextTick, ref, watch } from 'vue';

const settings = useDbSettings();
const servers = useServers();
const connections = useConnections();
const dbCaches = useDbCaches();
const query = useQuery();
const scripts = useScriptsDb();
const navState = useNavState();
const debugResetKey = ref(0);
const scriptsTreeRef = ref<HTMLElement>();

type ScriptTreeItem = ScriptRecord & {
    title: string;
    subtitle?: string;
    rightText?: string;
};

type ScriptTreeGroup = {
    id: string;
    kind: 'connection' | 'group';
    connectionId: number;
    title: string;
    children: ScriptTreeNode[];
    rightText?: string;
};

type ScriptTreeNode = ScriptTreeItem | ScriptTreeGroup;

function getScriptConnectionGroupId(connectionId: number) {
    return `script-connection:${connectionId}`;
}

function getScriptConnectionTitle(connectionId: number) {
    const connection = connections.connections.find((entry) => entry.id === connectionId);
    const server = servers.servers.find((entry) => entry.id === connection?.server_id);

    if (server?.kind === 'file') {
        return server.name || connection?.name || 'Unknown source';
    }

    return connection?.database_name || connection?.name || 'Unknown database';
}

const activeScriptsTreeSelection = computed<(number | string)[]>(() => {
    const currentTab = navState.activeTab;

    if (!currentTab || (currentTab.type !== 'script' && currentTab.type !== 'scratch')) {
        return [];
    }

    const selection: Array<number | string> = [getScriptConnectionGroupId(currentTab.connectionId)];

    if (currentTab.type === 'script') {
        selection.push(currentTab.targetId);
    }

    return selection;
});

const activeScriptsTreeNodeId = computed(() => {
    const currentTab = navState.activeTab;

    if (!currentTab || (currentTab.type !== 'script' && currentTab.type !== 'scratch')) {
        return undefined;
    }

    return currentTab.type === 'script' ? `script:${currentTab.targetId}` : getScriptConnectionGroupId(currentTab.connectionId);
});

const scriptTreeRootNodeId = 'scripts-root';
const scriptsTreeState = useFileTree<ScriptTreeNode>({
    localStorageKey: 'scriptsTree',
    tree: computed(() => {
        const scriptsByConnection = new Map<number, ScriptRecord[]>();

        for (const script of scripts.scripts) {
            const connectionScripts = scriptsByConnection.get(script.connection_id) ?? [];
            connectionScripts.push(script);
            scriptsByConnection.set(script.connection_id, connectionScripts);
        }

        const connectionGroups: ScriptTreeGroup[] = [];

        for (const connection of connections.connections) {
            const connectionScripts = scriptsByConnection.get(connection.id) ?? [];

            if (connectionScripts.length === 0) {
                continue;
            }

            const groupedScripts = new Map<string, ScriptTreeItem[]>();
            const ungroupedScripts: ScriptTreeItem[] = [];

            for (const script of connectionScripts) {
                const item = {
                    ...script,
                    title: script.name,
                    rightText: script.updated_at || 'Not saved yet',
                } satisfies ScriptTreeItem;

                if (!script.group_name) {
                    ungroupedScripts.push(item);
                    continue;
                }

                const groupScripts = groupedScripts.get(script.group_name) ?? [];
                groupScripts.push(item);
                groupedScripts.set(script.group_name, groupScripts);
            }

            const groupedItems: ScriptTreeGroup[] = [...groupedScripts.entries()]
                .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
                .map(
                    ([groupName, groupScripts]) =>
                        ({
                            id: `script-group:${connection.id}:${groupName}`,
                            kind: 'group',
                            connectionId: connection.id,
                            title: groupName,
                            rightText: String(groupScripts.length),
                            children: groupScripts,
                        }) satisfies ScriptTreeGroup
                );

            connectionGroups.push({
                id: getScriptConnectionGroupId(connection.id),
                kind: 'connection',
                connectionId: connection.id,
                title: getScriptConnectionTitle(connection.id),
                rightText: String(connectionScripts.length),
                children: [...ungroupedScripts, ...groupedItems],
            });
        }

        return {
            title: 'Scripts',
            count: scripts.scripts.length,
            children: connectionGroups,
        } satisfies FileTreeItem<ScriptTreeItem | ScriptTreeGroup>;
    }),
    emptyText: 'No scripts saved',
    selection: activeScriptsTreeSelection,
    headerNodeId: scriptTreeRootNodeId,
    outlineSelection: computed<(number | string)[]>(() => [
        ...activeScriptsTreeSelection.value,
        ...[contextMenuScriptId.value].filter((value): value is number => typeof value === 'number'),
    ]),
    activateOnDoubleClick: (_, isGroup) => !isGroup,
    nodeId: (script, isGroup) => (isGroup ? String(script.id) : `script:${script.id}`),
    parentId: (script, isGroup) => {
        if (isGroup) {
            const group = script as ScriptTreeGroup;
            return group.kind === 'connection' ? scriptTreeRootNodeId : getScriptConnectionGroupId(group.connectionId);
        }

        const item = script as ScriptTreeItem;
        return item.group_name ? `script-group:${item.connection_id}:${item.group_name}` : getScriptConnectionGroupId(item.connection_id);
    },
    onHeaderKeydown: handleScriptsTreeKeydown,
    onItemKeydown: handleScriptsTreeKeydown,
    onSelect: (script) => openScript(script.id),
    onContextMenu: (script, event) => {
        if ('children' in script) {
            return;
        }
        contextMenuScriptId.value = script.id;
        appContextMenu.openAtEvent(event, [
            {
                id: `script-delete:${script.id}`,
                label: 'Delete script',
                iconClass: 'icon-[mdi--delete-outline]',
                danger: true,
                action: async () => {
                    await scripts.deleteScript(script.id);
                },
            },
        ]);
    },
    leftIcon: (_, isGroup) => (isGroup ? 'icon-[mdi--folder-outline]' : 'icon-[mdi--script-text-outline]'),
    headerActions: [
        {
            title: 'Add script',
            icon: 'icon-[mdi--plus]',
            async onClick() {
                const connection = connections.selectedConnection ?? connections.connections[0];
                if (!connection) {
                    toast.showToast('Please create a connection before adding scripts.', 'warning');
                    return;
                }
                const newName = `Script ${uniqueId(5)}`;
                await scripts.createScript({
                    connectionId: connection.id,
                    name: newName,
                    sqlText: '',
                });

                const script = scripts.scripts.find((s) => s.connection_id === connection.id && s.name === newName);
                if (script) {
                    await openScript(script.id);
                }
            },
        },
    ],
    // onHeaderToggle: (_, expanded) => {
    //     splitterBottomForcedheight.value = expanded ? undefined : 40;
    // },
});

// const splitterBottomForcedheight = ref<number>();
const splitterBottomForcedheight = computed(() => {
    if (scriptsTreeState.collapsed) {
        return '40px';
    } else {
        return undefined;
    }
});

const contextMenuScriptId = ref<number>();
const appContextMenu = useContextMenu();

function getScriptRows() {
    return Array.from(scriptsTreeRef.value?.querySelectorAll<HTMLElement>('[data-sidebar-row="true"]') ?? []);
}

function getActiveScriptGroupNodeId() {
    const currentTab = navState.activeTab;

    if (!currentTab || currentTab.type !== 'script') {
        return undefined;
    }

    const script = scripts.scripts.find((entry) => entry.id === currentTab.targetId);

    if (!script?.group_name) {
        return undefined;
    }

    return `script-group:${script.connection_id}:${script.group_name}`;
}

async function expandScriptsTreeRow(nodeId: string | undefined) {
    if (!nodeId) {
        return;
    }

    const row = getScriptRows().find((entry) => entry.dataset.nodeId === nodeId);

    if (!row || row.dataset.sidebarCollapsed !== 'true') {
        return;
    }

    row.click();
    await nextTick();
}

async function ensureActiveScriptsTreePathVisible() {
    if (!activeScriptsTreeNodeId.value) {
        return;
    }

    await expandScriptsTreeRow(scriptTreeRootNodeId);
    await expandScriptsTreeRow(getScriptConnectionGroupId(navState.activeTab!.connectionId));
    await expandScriptsTreeRow(getActiveScriptGroupNodeId());
}

async function revealActiveScriptsTreeNode() {
    if (!scriptsTreeRef.value) {
        return;
    }

    await nextTick();
    await ensureActiveScriptsTreePathVisible();
    await nextTick();
    scrollScriptsTreeRowIntoView(activeScriptsTreeNodeId.value);
}

function scrollScriptsTreeRowIntoView(nodeId: string | undefined) {
    if (!nodeId) {
        return;
    }

    const row = getScriptRows().find((entry) => entry.dataset.nodeId === nodeId);

    if (!row) {
        return;
    }

    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function focusScriptRow(row: HTMLElement | undefined) {
    if (!row) {
        return;
    }

    row.focus();
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function openScriptRowContextMenu(currentRow: HTMLElement) {
    currentRow.dispatchEvent(
        new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: Math.round(currentRow.getBoundingClientRect().left + 12),
            clientY: Math.round(currentRow.getBoundingClientRect().top + 12),
        })
    );
}

function handleScriptsTreeKeydown(event: KeyboardEvent) {
    const currentRow = event.currentTarget as HTMLElement;
    const rows = getScriptRows();
    const currentIndex = rows.findIndex((row) => row === currentRow);

    if (currentIndex < 0) {
        return;
    }

    if (event.metaKey && event.key === 'Enter') {
        event.preventDefault();
        void openScriptRowContextMenu(currentRow);
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusScriptRow(rows[currentIndex - 1]);
        return;
    }

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusScriptRow(rows[currentIndex + 1]);
        return;
    }

    if (event.key === 'ArrowLeft') {
        event.preventDefault();

        if (currentRow.dataset.sidebarExpandable === 'true' && currentRow.dataset.sidebarCollapsed === 'false') {
            currentRow.click();
            return;
        }

        const parentId = currentRow.dataset.parentId;

        if (parentId) {
            focusScriptRow(rows.find((row) => row.dataset.nodeId === parentId));
        }

        return;
    }

    if (event.key === 'ArrowRight') {
        event.preventDefault();

        if (currentRow.dataset.sidebarExpandable === 'true' && currentRow.dataset.sidebarCollapsed === 'true') {
            currentRow.click();
            return;
        }

        const nodeId = currentRow.dataset.nodeId;

        if (nodeId) {
            focusScriptRow(rows.find((row) => row.dataset.parentId === nodeId));
        }

        return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        currentRow.click();
    }
}

async function openScript(scriptId: number) {
    navState.selectScript(scriptId);
}

function clearSidebarExpansionState() {
    dbCaches.clearSidebarExpansionState();
}

async function invalidateDebugCaches() {
    await tasks.invalidateAllMetadataCaches.run(undefined);

    connections.clearAllMetadata();
    servers.clearAllServerSchemas();

    clearSidebarExpansionState();
    debugResetKey.value += 1;

    if (connections.selectedConnectionId) {
        await query.loadTables();
    }

    toast.showToast('Metadata caches and sidebar tree state cleared.', 'success');
}

function getMenuItems(): ContextMenuEntry[] {
    function createFilterEntry(key: keyof CollectionFilterState, label: string): ContextMenuEntry[] {
        return [
            { type: 'title', title: label, id: `filter-collections:${key}` },
            ...Object.entries(settings.state.collectionFilter[key]).map(
                ([subKey, value]) =>
                    ({
                        id: `filter-collections:${key}:${subKey}`,
                        type: 'checkbox',
                        label: subKey.charAt(0).toUpperCase() + subKey.slice(1),
                        checked: value,
                        action: () => {
                            settings.toggleCollectionState(key, subKey as keyof CollectionFilterState[typeof key]);
                            // useContextMenu().updateItems(getMenuItems());
                        },
                    }) satisfies ContextMenuEntry
            ),
        ];
    }

    return [
        {
            id: `clear-metadata-caches`,
            label: 'Clear metadata caches',
            iconClass: 'icon-[mdi--cursor-default-click-outline]',
            action: async () => {
                await invalidateDebugCaches();
            },
        },
        {
            id: 'collapse-all',
            label: 'Collapse all',
            iconClass: 'icon-[mdi--arrow-collapse]',
            action: () => {
                clearSidebarExpansionState();
                debugResetKey.value += 1;
            },
        },
        {
            id: `connection-filter-collections`,
            label: 'Filter collections',
            iconClass: 'icon-[mdi--filter-variant]',
            children: [...createFilterEntry('connections', 'Connections'), ...createFilterEntry('tables', 'Tables')],
        },
        {
            id: 'open-settings',
            label: 'Open settings',
            iconClass: 'icon-[mdi--cog-outline]',
            action: () => {
                settings.openSettingsWindow('editors');
            },
        },
    ];
}

watch(
    () => [activeScriptsTreeNodeId.value, debugResetKey.value, scripts.scripts.map((script) => script.id).join('|')],
    async () => {
        await revealActiveScriptsTreeNode();
    },
    { immediate: true }
);

watch(
    () => scriptsTreeRef.value,
    async (element) => {
        if (!element) {
            return;
        }

        await revealActiveScriptsTreeNode();
    },
    { flush: 'post' }
);
</script>

<template>
    <aside class="flex h-full flex-1 flex-col border-r border-x3 bg-x1 py-4">
        <div class="flex items-center justify-between px-2 pb-2">
            <h2 class="text-sm font-semibold tracking-[0.02em] text-reverse">Connections</h2>
            <div class="flex items-center gap-1">
                <IconButton icon="icon-[mdi--database-plus-outline]" v-tooltip.xs.nowrap="'Add source'" smaller @click="servers.openAddForm()" />
                <IconButton icon="icon-[mdi--dots-vertical]" v-tooltip.xs.nowrap="'Open settings'" smaller v-menu.button="getMenuItems" />
            </div>
        </div>

        <div class="flex flex-1 flex-col gap-1 overflow-auto p-2">
            <DbConnectionForm v-if="servers.addForm.visible" />

            <SplitterVertical
                class="flex-1"
                dragger-class="bg-x3 my-2"
                base-side="bottom"
                default-height="200px"
                min-height="40px"
                max-height="70%"
                local-storage-key="sidebarBottomSplit"
                :dragger-disabled="scriptsTreeState.collapsed"
                :forced-height="splitterBottomForcedheight"
            >
                <template #top>
                    <TreeServer :key="`server-tree-${debugResetKey}`" />
                </template>
                <template #bottom>
                    <div v-if="!connections.connections.length" class="flex flex-1 flex-col gap-1 overflow-auto p-2">
                        <div class="tracking-[0.02em] text-default text-xs font-bold">SCRIPTS</div>
                        <div class="opacity-70 text-xs leading-tight mt-1">Add at least a source to be able to use scripts. Click the database-plus icon above to get started.</div>
                    </div>
                    <div v-else ref="scriptsTreeRef" class="min-h-0 min-w-0">
                        <FileTree :key="`scripts-tree-${debugResetKey}`" :state="scriptsTreeState" />
                    </div>
                </template>
            </SplitterVertical>
        </div>
    </aside>
</template>
