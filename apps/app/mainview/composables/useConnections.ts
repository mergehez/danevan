import { _dbCoreState } from '@composables/dbCoreState';
import { useDbCaches } from '@composables/useDbCaches';
import { tasks } from '@composables/useTasks';
import { confirmAction } from '@lib/utils';
import type { ConnectionSchemaCache, CreateConnectionParams, TableInfo, TableSummary, UpdateConnectionParams } from '@utils/appClient';
import { reactive, watch } from 'vue';

export type ConnectionTablesState = {
    loaded: boolean;
    loading: boolean;
    tables: TableSummary[];
};

export type TableDetailsState = {
    loaded: boolean;
    loading: boolean;
    info?: TableInfo;
};

export function _useConnections() {
    const connectionTablesById = reactive<Record<number, ConnectionTablesState>>({});
    const tableDetailsByConnectionId = reactive<Record<number, Record<string, TableDetailsState>>>({});
    const dbCaches = useDbCaches();

    const state = reactive({
        connectionTablesById,
        tableDetailsByConnectionId,
        get connections() {
            return [..._dbCoreState.connections].sort((left, right) => Number(left.sequence) - Number(right.sequence) || left.name.localeCompare(right.name));
        },
        get selectedConnectionId() {
            return _dbCoreState.selectedConnectionId;
        },
        get selectedConnection() {
            return _dbCoreState.connections.find((connection) => connection.id === _dbCoreState.selectedConnectionId);
        },
        get selectedServerConnections() {
            return _dbCoreState.connections
                .filter((connection) => connection.server_id === _dbCoreState.selectedServerId)
                .sort((left, right) => Number(left.sequence) - Number(right.sequence) || left.name.localeCompare(right.name));
        },
        getCachedConnectionSchema(connectionId: number) {
            return dbCaches.getCachedConnectionSchema(connectionId);
        },
        getConnectionTablesState(connectionId: number) {
            if (!connectionTablesById[connectionId]) {
                connectionTablesById[connectionId] = {
                    loaded: false,
                    loading: false,
                    tables: [],
                };
            }

            return connectionTablesById[connectionId];
        },
        getTableDetailsState(connectionId: number, tableName: string) {
            if (!tableDetailsByConnectionId[connectionId]) {
                tableDetailsByConnectionId[connectionId] = {};
            }

            if (!tableDetailsByConnectionId[connectionId][tableName]) {
                tableDetailsByConnectionId[connectionId][tableName] = {
                    loaded: false,
                    loading: false,
                };
            }

            return tableDetailsByConnectionId[connectionId][tableName];
        },
        clearConnectionMetadata(connectionId: number) {
            delete connectionTablesById[connectionId];
            delete tableDetailsByConnectionId[connectionId];
            dbCaches.clearConnectionMetadataCache(connectionId);
        },
        clearAllMetadata() {
            for (const key of Object.keys(connectionTablesById)) {
                delete connectionTablesById[Number(key)];
            }

            for (const key of Object.keys(tableDetailsByConnectionId)) {
                delete tableDetailsByConnectionId[Number(key)];
            }

            dbCaches.clearAllConnectionMetadata();
        },
        applyConnectionSchemaCache(connectionId: number, cache: ConnectionSchemaCache) {
            dbCaches.applyConnectionSchemaCache(connectionId, cache);

            const tableState = state.getConnectionTablesState(connectionId);
            tableState.tables = cache.tables;
            tableState.loaded = true;
            tableState.loading = false;

            tableDetailsByConnectionId[connectionId] = Object.fromEntries(
                Object.entries(cache.tableInfoByName).map(([tableName, tableInfo]) => [
                    tableName,
                    {
                        loaded: true,
                        loading: false,
                        info: tableInfo,
                    } satisfies TableDetailsState,
                ])
            );
        },
        applyConnectionSnapshot(connectionId: number, tables: TableSummary[], tableDetails: Record<string, TableDetailsState> = {}) {
            const tableState = state.getConnectionTablesState(connectionId);
            tableState.tables = tables;
            tableState.loaded = true;
            tableState.loading = false;
            tableDetailsByConnectionId[connectionId] = tableDetails;

            const nextTableInfo = Object.fromEntries(
                Object.entries(tableDetails)
                    .filter(([, details]) => details.loaded && details.info)
                    .map(([tableName, details]) => [tableName, details.info!])
            );

            dbCaches.applyConnectionSnapshotToCache(connectionId, tables, nextTableInfo);
        },
        applyTableInfo(connectionId: number, tableName: string, tableInfo: TableInfo) {
            const tableState = state.getTableDetailsState(connectionId, tableName);
            tableState.info = tableInfo;
            tableState.loaded = true;
            tableState.loading = false;

            dbCaches.applyTableInfoToCache(connectionId, tableName, tableInfo, state.getConnectionTablesState(connectionId).tables);
        },
        async ensureConnectionTables(connectionId: number, force = false) {
            const tableState = state.getConnectionTablesState(connectionId);
            const previousTables = [...tableState.tables];
            const previousLoaded = tableState.loaded;

            if (tableState.loading || (tableState.loaded && !force)) {
                return;
            }

            const cachedSchema = force ? undefined : state.getCachedConnectionSchema(connectionId);

            if (cachedSchema?.tables?.length) {
                state.applyConnectionSchemaCache(connectionId, cachedSchema);
                return;
            }

            tableState.loading = true;

            try {
                const tables = await tasks.getTables.run({ connectionId });
                state.applyConnectionSnapshot(connectionId, tables, tableDetailsByConnectionId[connectionId] ?? {});
            } catch {
                tableState.tables = previousTables;
                tableState.loaded = previousLoaded && previousTables.length > 0;
            } finally {
                tableState.loading = false;
            }
        },
        async ensureConnectionSchema(connectionId: number, force = false) {
            if (force) {
                const cache = await tasks.refreshConnectionSchema.run({ connectionId });
                state.applyConnectionSchemaCache(connectionId, cache);
                return;
            }

            await state.ensureConnectionTables(connectionId, force);

            const tableState = state.getConnectionTablesState(connectionId);

            if (!tableState.loaded) {
                return;
            }

            await Promise.all(tableState.tables.map((table) => state.ensureTableDetails(connectionId, table.name, force)));
        },
        async ensureTableDetails(connectionId: number, tableName: string, force = false) {
            const tableState = state.getTableDetailsState(connectionId, tableName);
            const previousInfo = tableState.info;
            const previousLoaded = tableState.loaded;

            if (tableState.loading || (tableState.loaded && !force)) {
                return;
            }

            const cachedTableInfo = force ? undefined : state.getCachedConnectionSchema(connectionId)?.tableInfoByName?.[tableName];

            if (cachedTableInfo) {
                state.applyTableInfo(connectionId, tableName, cachedTableInfo);
                return;
            }

            tableState.loading = true;

            try {
                const tableInfo = force
                    ? await tasks.refreshTableInfo.run({ connectionId, tableName })
                    : await tasks.getTableInfo.run({
                          connectionId,
                          tableName,
                      });

                state.applyTableInfo(connectionId, tableName, tableInfo);
            } catch {
                tableState.info = previousInfo;
                tableState.loaded = previousLoaded && Boolean(previousInfo);
            } finally {
                tableState.loading = false;
            }
        },
        async selectConnection(connectionId: number | undefined) {
            _dbCoreState.applyBootstrap(await tasks.selectConnection.run({ connectionId }));
        },
        async createConnection(connection: CreateConnectionParams) {
            _dbCoreState.applyBootstrap(await tasks.createConnection.run(connection));
        },
        async createConnectionFromServerSchema(serverId: number, schemaName: string) {
            _dbCoreState.applyBootstrap(await tasks.createConnectionFromServerSchema.run({ serverId, schemaName }));
        },
        async setVisibleServerSchemas(serverId: number, schemaNames: string[]) {
            _dbCoreState.applyBootstrap(await tasks.setVisibleServerSchemas.run({ serverId, schemaNames }));
        },
        async updateConnection(connectionId: number, connection: UpdateConnectionParams) {
            _dbCoreState.applyBootstrap(await tasks.updateConnection.run({ connectionId, connection }));
        },
        async deleteConnection(connectionId: number) {
            const connection = _dbCoreState.connections.find((entry) => entry.id === connectionId);

            if (
                !(await confirmAction({
                    title: 'Delete connection?',
                    message: connection?.name ? `This will permanently remove ${connection.name}.` : 'This will permanently remove the selected connection.',
                    detail: 'Saved scripts and cached metadata tied to this connection will also be removed.',
                    confirmLabel: 'Delete',
                }))
            ) {
                return;
            }

            _dbCoreState.applyBootstrap(await tasks.deleteConnection.run({ connectionId }));
        },
        async dropTable(connectionId: number, tableName: string) {
            const normalizedTableName = tableName.trim();

            if (!normalizedTableName) {
                throw new Error('Table name is required.');
            }

            if (
                !(await confirmAction({
                    title: 'Delete table?',
                    message: `This will permanently delete ${normalizedTableName}.`,
                    detail: 'All rows and schema objects in this table will be removed from the database.',
                    confirmLabel: 'Delete table',
                }))
            ) {
                return;
            }

            const cache = await tasks.dropTable.run({ connectionId, tableName: normalizedTableName });
            state.applyConnectionSchemaCache(connectionId, cache);
        },
    });

    watch(
        () => _dbCoreState.connections.map((connection) => connection.id),
        (connectionIds) => {
            const activeIds = new Set(connectionIds);

            for (const key of Object.keys(connectionTablesById)) {
                const connectionId = Number(key);

                if (!activeIds.has(connectionId)) {
                    state.clearConnectionMetadata(connectionId);
                }
            }
        },
        { immediate: true }
    );

    return state;
}

let connectionsSingleton: ReturnType<typeof _useConnections> | undefined;

export function useConnections() {
    connectionsSingleton ??= _useConnections();
    return connectionsSingleton;
}
