import { useConnections } from '@composables/useConnections';
import { useDbSettings } from '@composables/useDbSettings';
import { tasks } from '@composables/useTasks';
import type { QueryExecutionResult, TableData, TableInfo, TableSummary, UpdateColumnParams } from '@utils/appClient';
import { reactive, ref } from 'vue';

type LoadSelectedTableOptions = {
    offset?: number;
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

    async function loadSelectedTable(options?: LoadSelectedTableOptions) {
        if (!connections.selectedConnectionId || !selectedTableName.value) {
            tableInfo.value = undefined;
            tableData.value = getEmptyTableData();
            isLoadingSelectedTable.value = false;
            return;
        }

        const connectionId = connections.selectedConnectionId;
        const tableName = selectedTableName.value;
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
        isLoadingTables: isLoadingTables,
        isLoadingSelectedTable: isLoadingSelectedTable,
        isRunningQuery: isRunningQuery,
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

            if (!selectedTableName.value || !tables.value.some((table) => table.name === selectedTableName.value)) {
                selectedTableName.value = tables.value[0]?.name;
            }

            if (selectedTableName.value) {
                await this.loadSelectedTable({ offset: 0 });
            }
        },
        async selectTable(tableName: string) {
            selectedTableName.value = tableName;
            await this.loadSelectedTable({ offset: 0 });
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

            if (selectedTableName.value) {
                await this.loadSelectedTable();
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
