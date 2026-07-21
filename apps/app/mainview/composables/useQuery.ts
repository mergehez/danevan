import { useConnections } from '@composables/useConnections';
import { useDbSettings } from '@composables/useDbSettings';
import { tasks } from '@composables/useTasks';
import type { QueryExecutionResult, TableData, TableInfo, TableSummary, UpdateColumnParams } from '@utils/appClient';
import { reactive, ref } from 'vue';

type SortOrder = {
    column: string;
    direction: 'ASC' | 'DESC';
};

type LoadSelectedTableOptions = {
    offset?: number;
    orderBy?: SortOrder;
};

export function _useQuery() {
    const connections = useConnections();
    const settings = useDbSettings();

    const getEmptyTableData = (): TableData => ({
        columns: [],
        rows: [],
        columnStats: {},
        rowCount: 0,
        limit: 0,
        offset: 0,
    });

    const tables = ref([] as TableSummary[]);
    const selectedTableName = ref(undefined as string | undefined);
    const tableInfo = ref(undefined as TableInfo | undefined);
    const tableData = ref(getEmptyTableData());
    const queryText = ref('');
    const queryResult = ref(undefined as QueryExecutionResult | undefined);
    const isLoadingTables = ref(false);
    const isLoadingSelectedTable = ref(false);
    const isRunningQuery = ref(false);
    const customQueryText = ref('');
    const isCustomQueryMode = ref(false);

    async function loadSelectedTable(connectionId: number, tableName: string, options?: LoadSelectedTableOptions) {
        isCustomQueryMode.value = false;
        const offset = Math.max(0, Math.round(options?.offset ?? tableData.value.offset ?? 0));
        const startedAt = performance.now();
        let infoDurationMs = 0;
        let dataDurationMs = 0;
        isLoadingSelectedTable.value = true;

        try {
            const tableInfoPromise = (async () => {
                const operationStartedAt = performance.now();
                await connections.ensureTableDetails(connectionId, tableName);
                const result = connections.getTableDetailsState(connectionId, tableName).info;

                if (!result) {
                    throw new Error('Unable to load table details.');
                }

                infoDurationMs = Math.round(performance.now() - operationStartedAt);
                return result;
            })();
            const tableDataPromise = (async () => {
                const operationStartedAt = performance.now();
                const result = await tasks.getTableData.run({
                    connectionId,
                    tableName,
                    limit: settings.state.queryRowLimit,
                    offset,
                    orderBy: options?.orderBy,
                });
                dataDurationMs = Math.round(performance.now() - operationStartedAt);
                return result;
            })();

            const [tableInfo2, tableData2] = await Promise.all([tableInfoPromise, tableDataPromise]);

            tableInfo.value = tableInfo2;
            tableData.value = tableData2;
            console.log(
                `[perf][ui] loadSelectedTable ${Math.round(performance.now() - startedAt)}ms ${JSON.stringify({ connectionId, tableName, getTableInfo: infoDurationMs, getTableData: dataDurationMs })}`
            );
        } catch {
            tableInfo.value = undefined;
            tableData.value = getEmptyTableData();
        } finally {
            isLoadingSelectedTable.value = false;
        }
    }

    return reactive({
        tables: tables,
        selectedTableName: selectedTableName,
        tableInfo: tableInfo,
        tableData: tableData,
        queryText: queryText,
        queryResult: queryResult,
        customQueryText: customQueryText,
        isCustomQueryMode: isCustomQueryMode,
        isLoadingTables: isLoadingTables,
        isLoadingSelectedTable: isLoadingSelectedTable,
        isRunningQuery: isRunningQuery,
        /** Loads the table list for the current connection. Does NOT
         *  auto-select or auto-load a table — the caller (e.g. activateTab)
         *  is responsible for calling selectTable / loadSelectedTable. */
        async loadTables() {
            if (!connections.selectedConnectionId) {
                tables.value = [];
                selectedTableName.value = undefined;
                tableInfo.value = undefined;
                tableData.value = getEmptyTableData();
                isLoadingTables.value = false;
                return;
            }

            const connectionId = connections.selectedConnectionId;
            isLoadingTables.value = true;

            try {
                await connections.ensureConnectionTables(connectionId);
                tables.value = connections.getConnectionTablesState(connectionId).tables;
            } catch {
                tables.value = [];
                selectedTableName.value = undefined;
                tableInfo.value = undefined;
                tableData.value = getEmptyTableData();
                isLoadingTables.value = false;
                return;
            } finally {
                isLoadingTables.value = false;
            }

            // If the previously-selected table no longer exists, pick the first
            // available table so there's always a sensible default.
            if (selectedTableName.value && !tables.value.some((table) => table.name === selectedTableName.value)) {
                selectedTableName.value = tables.value[0]?.name;
            }
        },
        async selectTable(tableName: string) {
            const connectionId = connections.selectedConnectionId;

            if (!connectionId) {
                return;
            }

            selectedTableName.value = tableName;
            await this.loadSelectedTable(connectionId, tableName, { offset: 0 });
        },
        loadSelectedTable: loadSelectedTable,
        async runQuery() {
            if (!connections.selectedConnectionId) {
                return;
            }

            isRunningQuery.value = true;

            try {
                queryResult.value = await tasks.runQuery.run({
                    connectionId: connections.selectedConnectionId,
                    sql: queryText.value,
                });
            } catch {
                queryResult.value = undefined;
                isRunningQuery.value = false;
                return;
            } finally {
                isRunningQuery.value = false;
            }

            const connId = connections.selectedConnectionId;
            if (connId && selectedTableName.value) {
                await this.loadSelectedTable(connId, selectedTableName.value);
            }
        },
        async runCustomQuery() {
            if (!connections.selectedConnectionId || !customQueryText.value.trim()) {
                return;
            }

            isRunningQuery.value = true;

            try {
                const result = await tasks.runQuery.run({
                    connectionId: connections.selectedConnectionId,
                    sql: customQueryText.value,
                });

                if (result.kind === 'rows') {
                    tableData.value = {
                        columns: result.columns,
                        rows: result.rows,
                        columnStats: result.columnStats,
                        rowCount: result.rows.length,
                        limit: settings.state.queryRowLimit,
                        offset: 0,
                    };
                    isCustomQueryMode.value = true;
                } else {
                    tableData.value = getEmptyTableData();
                    isCustomQueryMode.value = false;
                }
            } catch {
                tableData.value = getEmptyTableData();
                isCustomQueryMode.value = false;
            } finally {
                isRunningQuery.value = false;
            }
        },
        clearCustomQuery() {
            customQueryText.value = '';
            isCustomQueryMode.value = false;

            const connId = connections.selectedConnectionId;
            if (connId && selectedTableName.value) {
                void this.loadSelectedTable(connId, selectedTableName.value);
            }
        },
        async applyCellUpdate(params: UpdateColumnParams) {
            try {
                tableData.value = await tasks.updateColumn.run(params);
            } catch {
                tableData.value = getEmptyTableData();
            }
        },
    });
}

let querySingleton: ReturnType<typeof _useQuery> | undefined;

export function useQuery() {
    querySingleton ??= _useQuery();
    return querySingleton;
}
