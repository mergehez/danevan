import { TableDetailsState, useConnections } from '@composables/useConnections';
import { type PersistedTreeState, useDbCaches } from '@composables/useDbCaches';
import { useQuery } from '@composables/useQuery';
import { useServers } from '@composables/useServers';
import { tasks } from '@composables/useTasks';
import type { ConnectionRecord, ServerRecord, TableSummary } from '@utils/appClient';
import { formatNumber } from '@utils/utils';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useSidebarKeyboardNavigation } from './useSidebarKeyboardNavigation';

type TreeItemWithChildren<T> = {
    title: string;
    children: T[];
};

export type TreeItemBase = {
    id: string | number;
    title: string;
    rightText?: string;
    expandable?: boolean;
};
export type TreeBranchBase = TreeItemBase & {
    expandable: true;
};
export type TableCollectionKind = 'tables' | 'views';
export type DetailCollectionKind = 'columns' | 'keys' | 'indexes';
export type ConnectionTreeItem = ConnectionRecord & TreeBranchBase;
export type TableTreeItem = TableSummary &
    TreeBranchBase & {
        connectionId: number;
    };
export type TreeServerItem = ServerRecord & {
    icon: string;
    title: string;
    tooltip?: string;
    children: ConnectionTreeItem[];
};
export type TableCollectionTreeItem = TreeBranchBase & {
    kind: TableCollectionKind;
    connectionId: number;
};

export type DetailCollectionTreeItem = TreeBranchBase & {
    kind: DetailCollectionKind;
    connectionId: number;
    tableName: string;
};
export type DetailLeafTreeItem = TreeItemBase & {
    tooltip?: string;
    accent?: 'pk' | 'ux' | 'fk' | 'idx';
};

export type ColumnCollectionSortMode = 'none' | 'name-asc' | 'name-desc';

export { type PersistedTreeState } from '@composables/useDbCaches';

export function getTableTreeForCollection(
    collection: TableCollectionTreeItem,
    connections: ReturnType<typeof useConnections>,
    state: ReturnType<typeof _useServerTree>
): TreeItemWithChildren<TableTreeItem> {
    const tableType = collection.kind === 'tables' ? 'table' : 'view';

    return {
        title: '',
        children: connections
            .getConnectionTablesState(collection.connectionId)
            .tables.filter((table) => table.type === tableType)
            .map((table) => {
                return {
                    ...table,
                    id: state.getTableNodeId(collection.connectionId, table.name),
                    connectionId: collection.connectionId,
                    title: table.name,
                    rightText: table.rowCount ? formatNumber(table.rowCount) : '-',
                    expandable: true,
                    children: [],
                } satisfies TableTreeItem & { children: never[] };
            }),
    };
}

export const sidebarTreeRef = ref<HTMLElement>();
function _useServerTree() {
    const servers = useServers();
    const connections = useConnections();
    const query = useQuery();
    const dbCaches = useDbCaches();
    const sidebarKeyNav = useSidebarKeyboardNavigation();
    const pendingRevealSelectionKey = ref<string>();

    const refreshingConnectionIds = reactive<Record<number, boolean>>({});
    const refreshingTableNodeIds = reactive<Record<string, boolean>>({});
    const columnCollectionSortModes = reactive<Record<string, ColumnCollectionSortMode>>({});

    const getTableNodeId = (connId: number, table: string) => `table:${connId}:${table}`;
    const getCollectionNodeId = (connId: number, kind: TableCollectionKind | DetailCollectionKind, parentName?: string) => `${kind}:${connId}:${parentName ?? 'root'}`;
    const getServerTreeStorageKey = (serverId: number) => dbCaches.getServerTreeStorageKey(serverId);
    const getColumnCollectionSortKey = (connId: number, table: string) => getCollectionNodeId(connId, 'columns', table);

    const isConnectionRefreshing = (connId: number) => refreshingConnectionIds[connId] === true;
    const isConnectionDisconnecting = (connId: number) => tasks.disconnectConnection.isRunning(String(connId));
    const isTableRefreshing = (connId: number, table: string) => refreshingTableNodeIds[getTableNodeId(connId, table)] === true;
    const isConnectionLoading = (connId?: number): boolean =>
        !!connId && (connections.getConnectionTablesState(connId).loading || isConnectionRefreshing(connId) || isConnectionDisconnecting(connId));
    const isTableLoading = (connId: number, table: string) => connections.getTableDetailsState(connId, table).loading || isTableRefreshing(connId, table);

    const isServerCollapsed = (serverId: number) => getPersistedTreeState(serverId).collapsed ?? false;
    const isGroupCollapsed = (serverId: number, groupId: string, defaultCollapsed: boolean) => getPersistedTreeState(serverId).groups?.[groupId] ?? defaultCollapsed;
    const isConnectionExpanded = (serverId: number, connectionId: number) => {
        if (isServerCollapsed(serverId)) {
            return false;
        }

        const server = servers.servers.find((entry) => entry.id === serverId);

        if (server?.kind === 'file') {
            return true;
        }

        return !isGroupCollapsed(serverId, String(connectionId), true);
    };

    const isTableExpanded = (serverId: number, connId: number, table: string) => !isGroupCollapsed(serverId, getTableNodeId(connId, table), true);
    const isCollectionCollapsed = (serverId: number, collection: { id: string | number }) => isGroupCollapsed(serverId, String(collection.id), false);

    function toggleGroupCollapsed(serverId: number, groupId: string, defaultCollapsed: boolean) {
        const newValue = !isGroupCollapsed(serverId, groupId, defaultCollapsed);
        const s = getPersistedTreeState(serverId);
        setPersistedTreeState(serverId, {
            ...s,
            groups: {
                ...s.groups,
                [groupId]: newValue,
            },
        });
        return !newValue;
    }

    function getColumnCollectionSortMode(connId: number, table: string): ColumnCollectionSortMode {
        return columnCollectionSortModes[getColumnCollectionSortKey(connId, table)] ?? 'none';
    }

    function setColumnCollectionSortMode(connId: number, table: string, sortMode: ColumnCollectionSortMode) {
        const sortKey = getColumnCollectionSortKey(connId, table);

        if (sortMode === 'none') {
            delete columnCollectionSortModes[sortKey];
            return;
        }

        columnCollectionSortModes[sortKey] = sortMode;
    }

    function toggleColumnCollectionSort(connId: number, table: string) {
        const currentSortMode = getColumnCollectionSortMode(connId, table);
        const nextSortMode = currentSortMode === 'none' ? 'name-asc' : currentSortMode === 'name-asc' ? 'name-desc' : 'none';
        setColumnCollectionSortMode(connId, table, nextSortMode);
    }

    const treeSelection = computed(() => {
        const selection: Array<number | string> = [];

        if (connections.selectedConnectionId !== undefined) {
            selection.push(connections.selectedConnectionId);
            if (query.selectedTableName) {
                selection.push(getTableNodeId(connections.selectedConnectionId, query.selectedTableName));
            }
        }

        return selection;
    });

    function getTreeSelectionKey(connectionId: number | undefined, tableName: string | undefined) {
        if (connectionId === undefined) {
            return '';
        }

        return [connectionId, ...[tableName ? getTableNodeId(connectionId, tableName) : undefined].filter((value): value is string => !!value)].join('|');
    }

    function requestRevealTableSelection(connectionId: number, tableName: string) {
        pendingRevealSelectionKey.value = getTreeSelectionKey(connectionId, tableName);
    }

    function expandServerRow(serverId: number) {
        if (!isServerCollapsed(serverId)) {
            return;
        }

        const currentState = getPersistedTreeState(serverId);
        setPersistedTreeState(serverId, {
            ...currentState,
            collapsed: false,
        });
    }

    function expandServerGroup(serverId: number, groupId: string | number) {
        if (!isGroupCollapsed(serverId, String(groupId), true)) {
            return;
        }

        const currentState = getPersistedTreeState(serverId);
        setPersistedTreeState(serverId, {
            ...currentState,
            groups: {
                ...currentState.groups,
                [String(groupId)]: false,
            },
        });
    }

    function expandServerCollection(serverId: number, collectionId: string) {
        if (!isGroupCollapsed(serverId, collectionId, false)) {
            return;
        }

        const currentState = getPersistedTreeState(serverId);
        setPersistedTreeState(serverId, {
            ...currentState,
            groups: {
                ...currentState.groups,
                [collectionId]: false,
            },
        });
    }

    async function ensureSelectedSidebarPathVisible() {
        const connectionId = connections.selectedConnectionId;

        if (connectionId === undefined) {
            return;
        }

        const connection = connections.connections.find((entry) => entry.id === connectionId);

        if (!connection) {
            return;
        }

        expandServerRow(connection.server_id);

        if (servers.servers.find((entry) => entry.id === connection.server_id)?.kind !== 'file') {
            expandServerGroup(connection.server_id, connection.id);
        }

        await nextTick();
        await ensureExpandedConnectionSnapshot(connectionId);

        if (!query.selectedTableName) {
            return;
        }

        const selectedTable = connections.getConnectionTablesState(connectionId).tables.find((table) => table.name === query.selectedTableName);

        if (!selectedTable) {
            return;
        }

        const collectionId = getCollectionNodeId(connectionId, selectedTable.type === 'view' ? 'views' : 'tables');
        expandServerCollection(connection.server_id, collectionId);
        await nextTick();
    }

    async function revealSelectedSidebarRow() {
        if (!sidebarTreeRef.value) {
            return;
        }

        await ensureSelectedSidebarPathVisible();
        await nextTick();
        console.warn('Revealing selected sidebar row');
        scrollSelectedSidebarRowIntoView();
    }

    function scrollSelectedSidebarRowIntoView() {
        const selectedIds = [...treeSelection.value].reverse();

        if (selectedIds.length === 0) {
            return;
        }

        const rows = Array.from(sidebarTreeRef.value?.querySelectorAll<HTMLElement>('[data-sidebar-row="true"]') ?? []);
        const row = selectedIds.map((selectedId) => rows.find((entry) => entry.dataset.nodeId === String(selectedId))).find((entry) => !!entry);

        if (!row) {
            return;
        }

        console.warn('Scrolling into view:', { selectedIds, nodeId: row.dataset.nodeId, title: row.dataset.title });
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function buildConnectionTreeItem(connection: ConnectionRecord) {
        return {
            ...connection,
            title: connection.database_name || connection.name,
            expandable: true,
            children: [],
        } satisfies ConnectionTreeItem & { children: never[] };
    }

    const getPersistedTreeState = (serverId: number) => dbCaches.getPersistedTreeState(serverId);
    const setPersistedTreeState = (serverId: number, nextState: PersistedTreeState) => dbCaches.setPersistedTreeState(serverId, nextState);

    async function loadExpandedTableDetailsSnapshot(connectionId: number, tables: TableSummary[]) {
        const connection = connections.connections.find((entry) => entry.id === connectionId);
        const previousDetails = connections.tableDetailsByConnectionId[connectionId] ?? {};

        if (!connection) {
            return previousDetails;
        }

        const expandedTableNames = tables.filter((table) => isTableExpanded(connection.server_id, connectionId, table.name)).map((table) => table.name);

        const detailEntries: Array<readonly [string, TableDetailsState] | undefined> = [];

        for (const tableName of expandedTableNames) {
            try {
                await connections.ensureTableDetails(connectionId, tableName);
                const tableInfo = connections.getTableDetailsState(connectionId, tableName).info;

                if (!tableInfo) {
                    throw new Error('Missing table details.');
                }

                detailEntries.push([
                    tableName,
                    {
                        loaded: true,
                        loading: false,
                        info: tableInfo,
                    } satisfies TableDetailsState,
                ] as const);
            } catch {
                const previousState = previousDetails[tableName];
                detailEntries.push(previousState ? ([tableName, previousState] as const) : undefined);
            }
        }

        return Object.fromEntries(detailEntries.filter((entry): entry is readonly [string, TableDetailsState] => Boolean(entry)));
    }
    async function loadConnectionTablesSnapshot(connectionId: number, force = false) {
        try {
            await connections.ensureConnectionTables(connectionId, force);
            const tables = connections.getConnectionTablesState(connectionId).tables;
            const tableDetails = await loadExpandedTableDetailsSnapshot(connectionId, tables);
            connections.applyConnectionSnapshot(connectionId, tables, tableDetails);
        } catch {}
    }

    async function ensureExpandedConnectionSnapshot(connectionId: number) {
        await connections.ensureConnectionTables(connectionId);

        const tableState = connections.getConnectionTablesState(connectionId);

        if (tableState.loading) {
            console.warn('Connection tables are still loading, cannot ensure expanded connection snapshot');
            return;
        }

        if (!tableState.loaded || tableState.tables.length === 0) {
            await loadConnectionTablesSnapshot(connectionId);
            return;
        }

        const tableDetails = await loadExpandedTableDetailsSnapshot(connectionId, tableState.tables);

        if (Object.keys(tableDetails).length === 0) {
            console.warn('No table details found for expanded tables.');
            return;
        }

        connections.applyConnectionSnapshot(connectionId, tableState.tables, {
            ...connections.tableDetailsByConnectionId[connectionId],
            ...tableDetails,
        });
    }

    watch(
        () => connections.connections.map((connection) => `${connection.server_id}:${connection.id}`),
        async () => {
            // ensurePersistedExpandedConnectionsLoaded
            const expandedConnections = connections.connections.filter((connection) => isConnectionExpanded(connection.server_id, connection.id));

            for (const connection of expandedConnections) {
                const tableState = connections.getConnectionTablesState(connection.id);

                if (tableState.loading) {
                    continue;
                }

                if (!tableState.loaded || tableState.tables.length === 0) {
                    await loadConnectionTablesSnapshot(connection.id);
                    continue;
                }

                await ensureExpandedConnectionSnapshot(connection.id);
            }
        },
        { immediate: true }
    );

    watch(
        () => [pendingRevealSelectionKey.value, getTreeSelectionKey(connections.selectedConnectionId, query.selectedTableName), dbCaches.collapseStateVersion],
        async ([pendingSelectionKey, currentSelectionKey]) => {
            if (!pendingSelectionKey || pendingSelectionKey !== currentSelectionKey) {
                return;
            }

            pendingRevealSelectionKey.value = undefined;
            await revealSelectedSidebarRow();
        }
    );

    watch(
        () => sidebarTreeRef.value,
        async (element) => {
            if (!element) {
                return;
            }

            console.log('Sidebar tree ref set, revealing selected row');
            await revealSelectedSidebarRow();
        },
        { flush: 'post' }
    );

    watch(
        () =>
            connections.connections.map((connection) => {
                const tableState = connections.getConnectionTablesState(connection.id);
                return `${connection.server_id}:${connection.id}:${tableState.loaded}:${tableState.loading}:${tableState.tables.map((table) => table.name).join('|')}`;
            }),
        async () => {
            // ensurePersistedExpandedTableDetailsLoaded
            for (const connection of connections.connections) {
                if (!isConnectionExpanded(connection.server_id, connection.id)) {
                    continue;
                }

                const tableState = connections.getConnectionTablesState(connection.id);

                if (!tableState.loaded || tableState.loading || tableState.tables.length === 0) {
                    continue;
                }

                for (const table of tableState.tables) {
                    if (!isTableExpanded(connection.server_id, connection.id, table.name)) {
                        continue;
                    }

                    const tableDetailsState = connections.getTableDetailsState(connection.id, table.name);

                    if (tableDetailsState.loaded || tableDetailsState.loading) {
                        continue;
                    }

                    await connections.ensureTableDetails(connection.id, table.name);
                }
            }
        },
        { immediate: true }
    );

    return reactive({
        sidebarTreeRef: sidebarTreeRef,
        collapseStateVersion: dbCaches.collapseStateVersion,
        refreshingConnectionIds: refreshingConnectionIds,
        refreshingTableNodeIds: refreshingTableNodeIds,
        columnCollectionSortModes: columnCollectionSortModes,
        treeSelection: treeSelection,
        pendingRevealSelectionKey: pendingRevealSelectionKey,

        pendingRowClickTimers: new Map<string, number>(),

        getTableNodeId: getTableNodeId,
        getCollectionNodeId: getCollectionNodeId,
        getServerTreeStorageKey: getServerTreeStorageKey,
        getColumnCollectionSortMode: getColumnCollectionSortMode,
        setColumnCollectionSortMode: setColumnCollectionSortMode,

        isConnectionDisconnecting: isConnectionDisconnecting,
        isConnectionLoading: isConnectionLoading,
        isTableLoading: isTableLoading,

        isServerCollapsed: isServerCollapsed,
        isGroupCollapsed: isGroupCollapsed,
        isConnectionExpanded: isConnectionExpanded,
        isTableExpanded: isTableExpanded,
        isCollectionCollapsed: isCollectionCollapsed,
        toggleGroupCollapsed: toggleGroupCollapsed,
        toggleColumnCollectionSort: toggleColumnCollectionSort,

        buildConnectionTreeItem: buildConnectionTreeItem,
        handleSidebarRowKeydown: sidebarKeyNav.handleSidebarRowKeydown,
        ensureSelectedSidebarPathVisible: ensureSelectedSidebarPathVisible,
        requestRevealTableSelection: requestRevealTableSelection,
        revealSelectedSidebarRow: revealSelectedSidebarRow,
        scrollSelectedSidebarRowIntoView: scrollSelectedSidebarRowIntoView,
        getPersistedTreeState: getPersistedTreeState,
        setPersistedTreeState: setPersistedTreeState,
        loadConnectionTablesSnapshot: loadConnectionTablesSnapshot,
        ensureExpandedConnectionSnapshot: ensureExpandedConnectionSnapshot,
        loadExpandedTableDetailsSnapshot: loadExpandedTableDetailsSnapshot,

        collectionFilterVersion: dbCaches.collectionFilterVersion,
    });
}

let serverTreeSingleton: ReturnType<typeof _useServerTree> | undefined;

export function useServerTree() {
    serverTreeSingleton ??= _useServerTree();
    return serverTreeSingleton;
}
