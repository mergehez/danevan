<script setup lang="ts">
import DbServerFormModal from '@components/DbServerFormModal.vue';
import DbServerSchemasModal from '@components/DbServerSchemasModal.vue';
import FileTreeButton from '@components/FileTreeButton.vue';
import TreeActionButton from '@components/TreeActionButton.vue';
import TreeTable from '@components/TreeTable.vue';
import { useConnections } from '@composables/useConnections';
import { useDbSettings } from '@composables/useDbSettings';
import { useModifyTable } from '@composables/useModifyTable';
import { useServers } from '@composables/useServers';
import { ConnectionTreeItem, PersistedTreeState, TableCollectionKind, TableCollectionTreeItem, TreeServerItem, useServerTree } from '@composables/useServerTree';
import { tasks } from '@composables/useTasks';
import type { ContextMenuEntry } from '@directives/contextMenuTypes';
import { formatNumber, tryCatch } from '@lib/utils';
import { FileTreeAction } from '@shared/utils/useFileTree';
import Button from '@ui/Button.vue';
import { dbTypeIcons, type ServerRecord } from '@utils/appClient';
import { withMinLifetime } from '@utils/useMinLifetime';
import { computed, reactive } from 'vue';

const servers = useServers();
const connections = useConnections();
const modifyTable = useModifyTable();

const state = useServerTree();

const serverTree = computed<TreeServerItem[]>(() => {
    function getServerLocation(server: { file_path?: string; host?: string; port?: number }) {
        if (server.file_path) {
            return server.file_path;
        }

        if (server.host) {
            return `${server.host}${server.port ? `:${server.port}` : ''}`;
        }

        return 'No location';
    }
    return (
        servers.servers
            // .filter((server) => server.kind !== 'file')
            .map(
                (server) =>
                    ({
                        ...server,
                        title: server.name,
                        icon: dbTypeIcons[server.driver] || 'icon-[mdi--database-outline]',
                        tooltip: getServerLocation(server),
                        children: connections.connections.filter((connection) => connection.server_id === server.id).map((connection) => state.buildConnectionTreeItem(connection)),
                    }) satisfies TreeServerItem
            )
    );
});

const remoteServers = computed(() => serverTree.value.filter((server) => server.kind !== 'file'));
const fileServers = computed(() => serverTree.value.filter((server) => server.kind === 'file'));
const refreshingServerIds = reactive<Record<number, boolean>>({});
const isServerRefreshing = (serverId: number) => refreshingServerIds[serverId] === true;

function getFileServerConnection(serverId: number) {
    const connection = connections.connections.find((entry) => entry.server_id === serverId);
    return connection ? state.buildConnectionTreeItem(connection) : undefined;
}

const settings = useDbSettings();

// const fileServers = computed(() => servers.servers.filter((server) => server.kind === 'file'));

function isFileServerSelected(serverId: number) {
    return getFileServerConnection(serverId)?.id === connections.selectedConnectionId;
}

function isFileServerLoading(serverId: number) {
    return state.isConnectionLoading(getFileServerConnection(serverId)?.id);
}

function getPersistedTreeState(serverId: number): PersistedTreeState {
    const storageKey = state.getServerTreeStorageKey(serverId);
    const rawValue = (state.collapseStateVersion, localStorage.getItem(storageKey));

    if (!rawValue) {
        return {};
    }

    return tryCatch(
        () => JSON.parse(rawValue) as PersistedTreeState,
        () => ({})
    );
}

function toggleServerCollapsed(serverId: number) {
    const nextCollapsed = !state.isServerCollapsed(serverId);
    state.setPersistedTreeState(serverId, {
        ...getPersistedTreeState(serverId),
        collapsed: nextCollapsed,
    });
    return !nextCollapsed;
}

function getConnectionTreeChildren(connectionId: number): TableCollectionTreeItem[] {
    const tableState = connections.getConnectionTablesState(connectionId);

    if (!tableState.loaded) {
        return [];
    }

    const connection = connections.connections.find((entry) => entry.id === connectionId);

    const tableCount = tableState.tables.filter((table) => table.type === 'table').length;
    const viewCount = tableState.tables.filter((table) => table.type === 'view').length;
    const children: TableCollectionTreeItem[] = [];

    function buildCollectionItem(kind: TableCollectionKind, title: string, count: number) {
        return {
            id: state.getCollectionNodeId(connectionId, kind),
            title,
            rightText: formatNumber(count),
            kind,
            connectionId,
            expandable: true,
            children: [],
        } satisfies TableCollectionTreeItem & { children: never[] };
    }

    const filter = connection ? settings.state.collectionFilter.connections : undefined;
    if (!filter || filter.tables) {
        children.push(buildCollectionItem('tables', 'tables', tableCount));
    }

    if (!filter || filter.views) {
        children.push(buildCollectionItem('views', 'views', viewCount));
    }

    return children;
}

async function toggleConnectionRow(serverId: number, connection: ConnectionTreeItem) {
    const expanded = state.toggleGroupCollapsed(serverId, String(connection.id), true);
    if (expanded) {
        await state.ensureExpandedConnectionSnapshot(connection.id);
    }
}

async function handleFileServerToggle(server: ServerRecord) {
    const expanded = toggleServerCollapsed(server.id);
    if (!expanded || server.kind !== 'file') {
        return;
    }

    const connection = getFileServerConnection(server.id);
    if (connection) {
        await state.ensureExpandedConnectionSnapshot(connection.id);
    }
}

async function handleFileServerSelect(server: ServerRecord) {
    const connection = getFileServerConnection(server.id);
    if (connection) {
        await connections.selectConnection(connection.id);
    }
}

function focusSidebarEventTarget(event: MouseEvent) {
    if (event.currentTarget instanceof HTMLElement) {
        event.currentTarget.focus({ preventScroll: true });
    }
    return true;
}

async function refreshServerDatabases(serverId: number) {
    refreshingServerIds[serverId] = true;

    try {
        await withMinLifetime(() => servers.refreshServerSchemas(serverId), 2000);

        const expandedConnectionIds = connections.connections
            .filter((connection) => connection.server_id === serverId)
            .filter((connection) => state.isConnectionExpanded(serverId, connection.id))
            .map((connection) => connection.id);

        await Promise.all(expandedConnectionIds.map((connectionId) => state.loadConnectionTablesSnapshot(connectionId, true)));
    } finally {
        delete refreshingServerIds[serverId];
    }
}

async function refreshConnectionMetadata(connectionId: number) {
    state.refreshingConnectionIds[connectionId] = true;

    try {
        await withMinLifetime(() => connections.ensureConnectionSchema(connectionId, true), 2000);
        const tables = connections.getConnectionTablesState(connectionId).tables;
        const tableDetails = await state.loadExpandedTableDetailsSnapshot(connectionId, tables);
        for (const key of Object.keys(state.refreshingTableNodeIds)) {
            if (key.startsWith(`table:${connectionId}:`)) {
                delete state.refreshingTableNodeIds[key];
            }
        }
        connections.applyConnectionSnapshot(connectionId, tables, tableDetails);
    } finally {
        delete state.refreshingConnectionIds[connectionId];
    }
}

async function disconnectConnection(connectionId: number) {
    await tasks.disconnectConnection.run({ connectionId }, String(connectionId));
}

function serverMenuItems(server: ServerRecord): ContextMenuEntry[] {
    const fileConnection = server.kind === 'file' ? getFileServerConnection(server.id) : undefined;
    const items: ContextMenuEntry[] = [
        {
            id: `server-select:${server.id}`,
            label: 'Select source',
            iconClass: 'icon-[mdi--cursor-default-click-outline]',
            action: async () => {
                await servers.selectServer(server.id);
            },
        },
    ];

    if (fileConnection) {
        items.push({
            id: `server-create-table:${server.id}`,
            label: 'Create new table...',
            iconClass: 'icon-[mdi--table-plus]',
            action: async () => {
                await modifyTable.openModal({
                    connectionId: fileConnection.id,
                    mode: 'create',
                });
            },
        });
    } else {
        items.push(
            {
                id: `server-show-databases:${server.id}`,
                label: 'Choose databases...',
                iconClass: 'icon-[mdi--database-search-outline]',
                action: async () => {
                    servers.openSchemaSelectionModal(server.id);
                },
            },
            {
                id: `server-add-connection:${server.id}`,
                label: 'Add connection...',
                iconClass: 'icon-[mdi--plus]',
                action: async () => {
                    await servers.selectServer(server.id);
                    servers.openAddForm(server.driver, server.id);
                },
            }
        );
    }

    items.push(
        {
            id: `server-refresh-databases:${server.id}`,
            label: 'Refresh databases',
            iconClass: 'icon-[mdi--refresh]',
            action: async () => {
                await refreshServerDatabases(server.id);
            },
        },
        {
            id: `server-update:${server.id}`,
            label: 'Update...',
            iconClass: 'icon-[mdi--pencil-outline]',
            action: async () => {
                await servers.selectServer(server.id);
                servers.openUpdateForm(server.id);
            },
        },
        { type: 'separator', id: `server-separator:${server.id}` },
        {
            id: `server-delete:${server.id}`,
            label: server.kind === 'file' ? 'Delete source' : 'Delete server',
            iconClass: 'icon-[mdi--delete-outline]',
            danger: true,
            action: async () => {
                await servers.deleteServer(server.id);
            },
        }
    );

    return items;
}

function connectionMenuitems(connection: ConnectionTreeItem): ContextMenuEntry[] {
    const items: ContextMenuEntry[] = [
        {
            id: `connection-select:${connection.id}`,
            label: 'Select connection',
            iconClass: 'icon-[mdi--cursor-default-click-outline]',
            action: async () => {
                await connections.selectConnection(connection.id);
            },
        },
        {
            id: `connection-refresh:${connection.id}`,
            label: 'Refresh metadata',
            iconClass: 'icon-[mdi--refresh]',
            action: async () => {
                await refreshConnectionMetadata(connection.id);
            },
        },
        {
            id: `connection-create-table:${connection.id}`,
            label: 'Create new table...',
            iconClass: 'icon-[mdi--table-plus]',
            action: async () => {
                await modifyTable.openModal({
                    connectionId: connection.id,
                    mode: 'create',
                });
            },
        },
    ];

    if (servers.servers.find((server) => server.id === connection.server_id)?.driver === 'msaccess') {
        items.push({
            id: `connection-disconnect:${connection.id}`,
            label: 'Disconnect source',
            iconClass: 'icon-[mdi--power-plug-off-outline]',
            disabled: state.isConnectionDisconnecting(connection.id),
            action: async () => {
                await disconnectConnection(connection.id);
            },
        });
    }

    items.push(
        { type: 'separator', id: `connection-separator:${connection.id}` },
        {
            id: `connection-delete:${connection.id}`,
            label: 'Delete connection',
            iconClass: 'icon-[mdi--delete-outline]',
            danger: true,
            action: async () => {
                await connections.deleteConnection(connection.id);
            },
        }
    );

    return items;
}

function openSchemaSelectionPopover(serverId: number, event: MouseEvent) {
    servers.openSchemaSelectionModal(serverId, event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined);
}

function getHeaderActions(server: ServerRecord) {
    const actions: FileTreeAction[] = [];
    if (server.kind !== 'file') {
        actions.push({
            title: 'Add connection',
            icon: 'icon-[mdi--plus]',
            onClick: () => servers.openAddForm(server.driver, server.id),
        });
    }
    actions.push(
        {
            title: 'Refresh databases',
            icon: isServerRefreshing(server.id) ? 'icon-[mdi--loading] animate-spin' : 'icon-[mdi--refresh]',
            onClick: () => refreshServerDatabases(server.id),
            disabled: isServerRefreshing(server.id),
        },
        {
            title: 'Delete',
            icon: 'icon-[mdi--delete-outline]',
            onClick: () => servers.deleteServer(server.id),
        }
    );
    return actions;
}
</script>

<template>
    <div :ref="(element) => (state.sidebarTreeRef = element as HTMLElement | undefined)" class="flex min-h-0 min-w-0 flex-col gap-1">
        <div v-for="server in remoteServers" :key="server.id" class="shrink-0">
            <FileTreeButton
                class="bg-x4"
                :icon="server.icon"
                :item="server"
                :tooltip="server.tooltip"
                :data-node-id="`server:${server.id}`"
                :collapsed="state.isServerCollapsed(server.id)"
                :is-loading="isServerRefreshing(server.id)"
                :onClick="(e) => focusSidebarEventTarget(e) && toggleServerCollapsed(server.id)"
                :context-menu-items="serverMenuItems"
                :children="() => server.children"
            >
                <Button
                    severity="secondary"
                    :disabled="isServerRefreshing(server.id)"
                    class="text-2xs px-1 py-0.5"
                    smaller
                    id="server-schema-selection-button"
                    @click.stop="openSchemaSelectionPopover(server.id, $event)"
                >
                    {{ `${server.children.length} of ${server.schema_count || connections.connections.filter((c) => c.server_id === server.id).length || '?'}` }}
                </Button>
                <TreeActionButton v-for="action in getHeaderActions(server)" :key="action.title" :action="action" />

                <template #child="{ item: connection, parentId }">
                    <!-- Grouped mode -->
                    <!-- v-if="settings.isConnectionFilterFlat" -->
                    <FileTreeButton
                        :item="connection"
                        :data-node-id="`connection:${connection.id}`"
                        :data-parent-id="parentId"
                        :collapsed="state.isGroupCollapsed(server.id, String(connection.id), true)"
                        :is-loading="state.isConnectionLoading(connection.id)"
                        :selected="connections.selectedConnectionId === connection.id"
                        :onClick="() => void toggleConnectionRow(server.id, connection)"
                        :onDblClick="() => void connections.selectConnection(connection.id)"
                        :context-menu-items="connectionMenuitems"
                        :children="() => getConnectionTreeChildren(connection.id)"
                    >
                        <template #child="{ item: collection, parentId, allItems }">
                            <TreeTable :server="server" :collection="collection" :parent-id="parentId" :skipTitle="allItems.length === 1" />
                        </template>
                    </FileTreeButton>
                    <!-- Flat mode -->
                    <!-- <FileTreeButton
                        v-else
                        :item="connection"
                        :data-node-id="`connection:${connection.id}`"
                        :data-parent-id="parentId"
                        :collapsed="state.isGroupCollapsed(server.id, String(connection.id), true)"
                        :is-loading="state.isConnectionLoading(connection.id)"
                        :selected="connections.selectedConnectionId === connection.id"
                        :onClick="() => void toggleConnectionRow(server.id, connection)"
                        :onDblClick="() => void connections.selectConnection(connection.id)"
                        :context-menu-items="connectionMenuitems"
                        :children="() => getConnectionFlatTables(connection)"
                    >
                        <template #child="{ item: table, parentId }">
                            <TreeTableRow :server="server" :table="table" :parent-id="parentId" />
                        </template>
                    </FileTreeButton> -->
                </template>
            </FileTreeButton>
        </div>

        <div v-for="server in fileServers" :key="`file-server-${server.id}`" class="shrink-0">
            <!-- Grouped mode: both tables and views shown with collection headers -->
            <FileTreeButton
                :item="server"
                :icon="server.icon"
                :tooltip="server.file_path"
                :data-node-id="`server:${server.id}`"
                :collapsed="state.isServerCollapsed(server.id)"
                :is-loading="isFileServerLoading(server.id)"
                :selected="isFileServerSelected(server.id)"
                :onClick="() => void handleFileServerToggle(server)"
                :onDblClick="() => void handleFileServerSelect(server)"
                :context-menu-items="serverMenuItems"
                :children="() => getConnectionTreeChildren(getFileServerConnection(server.id)!.id)"
            >
                <!-- settings.isConnectionFilterFlat ? () => getConnectionCollectionTree(getFileServerConnection(server.id)!.id).children : () => getFileServerFlatTables(server)
            " -->
                <TreeActionButton v-for="action in getHeaderActions(server)" :key="action.title" :action="action" />

                <template #child="{ item: collection, parentId, allItems }">
                    <TreeTable :server="server" :collection="collection" :parent-id="parentId" :skipTitle="allItems.length === 1" />
                    <!-- <TreeTableRow v-else :server="server" :table="collection" :parent-id="parentId" /> -->
                </template>
            </FileTreeButton>
        </div>

        <p v-if="!serverTree.length && !fileServers.length" class="px-2 py-6 text-center text-xs opacity-60">Add a source, then create compact named connections under it.</p>
    </div>

    <DbServerSchemasModal v-model:open="servers.schemaSelectionModal.visible" />
    <DbServerFormModal :open="servers.updateForm.visible" :server-id="servers.updateForm.serverId" :on-close="servers.closeUpdateForm" />
</template>
