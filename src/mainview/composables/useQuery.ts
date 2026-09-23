import { reactive, ref, watch } from 'vue';
import { readPersistedGridSort } from '../../datagrid/dataGridLayoutStorage';
import type { QueryExecutionResult, TableData, TableInfo, TableSummary, UpdateColumnParams } from '../../shared/types';
import { splitSqlStatements } from '../../shared/utils/sqlStatements';
import { useConnections } from './useConnections';
import { useDbSettings } from './useDbSettings';
import type { SqlHistoryEntry } from './useSqlHistory';
import { tasks } from './useTasks';

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
    const loadedConnectionId = ref(undefined as number | undefined);
    const tableInfo = ref(undefined as TableInfo | undefined);
    const tableData = ref(getEmptyTableData());
    const queryText = ref('');
    const queryResult = ref(undefined as QueryExecutionResult | undefined);
    const isLoadingTables = ref(false);
    const isLoadingSelectedTable = ref(false);
    const isRunningQuery = ref(false);
    const customQueryText = ref('');
    const isCustomQueryMode = ref(false);
    /** SQL returned by the backend for the current grid view. */
    const gridQueryText = ref('');

    // Per-table cache of the custom query text + custom-query mode, so a user's
    // custom query is restored when they return to a table.
    const customQueryCache: Record<string, { text: string; isCustomQueryMode: boolean }> = {};
    const suppressCustomQuerySync = ref(false);

    watch(
        [customQueryText, isCustomQueryMode],
        ([text, mode]) => {
            if (suppressCustomQuerySync.value) {
                return;
            }

            const connId = connections.selectedConnectionId;
            const tableName = selectedTableName.value;

            if (!connId || !tableName) {
                return;
            }

            customQueryCache[`${connId}:${tableName}`] = { text, isCustomQueryMode: mode };
        },
        { flush: 'sync' }
    );

    async function loadSelectedTable(connectionId: number, tableName: string, options?: LoadSelectedTableOptions) {
        suppressCustomQuerySync.value = true;
        isCustomQueryMode.value = false;
        loadedConnectionId.value = connectionId;
        const offset = Math.max(0, Math.round(options?.offset ?? tableData.value.offset ?? 0));
        const orderBy = options?.orderBy ?? readPersistedGridSort(connectionId, tableName);
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
                    orderBy,
                    returnQuery: true,
                });
                dataDurationMs = Math.round(performance.now() - operationStartedAt);
                return result;
            })();

            const [tableInfo2, tableData2] = await Promise.all([tableInfoPromise, tableDataPromise]);

            gridQueryText.value = tableData2.sql ?? '';
            const customQueryKey = `${connectionId}:${tableName}`;
            const cachedCustomQuery = customQueryCache[customQueryKey];
            customQueryText.value = cachedCustomQuery?.text ?? gridQueryText.value;
            isCustomQueryMode.value = cachedCustomQuery?.isCustomQueryMode ?? false;
            tableInfo.value = tableInfo2;
            tableData.value = tableData2;
            console.log(
                `[perf][ui] loadSelectedTable ${Math.round(performance.now() - startedAt)}ms ${JSON.stringify({ connectionId, tableName, getTableInfo: infoDurationMs, getTableData: dataDurationMs })}`
            );
        } catch {
            customQueryText.value = '';
            isCustomQueryMode.value = false;
            tableInfo.value = undefined;
            tableData.value = getEmptyTableData();
        } finally {
            isLoadingSelectedTable.value = false;
            suppressCustomQuerySync.value = false;
        }
    }

    /** Splits a SQL script into statements and runs them in order. Returns the
     *  last row-returning result (so the grid shows data), falling back to the
     *  last result when there are no row-returning statements. */
    async function runSqlBatch(
        connectionId: number,
        sql: string,
        onStatement?: (entry: Omit<SqlHistoryEntry, 'id' | 'timestamp'>) => void
    ): Promise<QueryExecutionResult | undefined> {
        const statements = splitSqlStatements(sql);

        if (!statements.length) {
            return undefined;
        }

        let lastResult: QueryExecutionResult | undefined;
        let lastRowResult: QueryExecutionResult | undefined;

        for (const statement of statements) {
            const startedAt = performance.now();

            try {
                const result = await tasks.runQuery.run({ connectionId, sql: statement });
                lastResult = result;

                if (result.kind === 'rows') {
                    lastRowResult = result;
                }

                onStatement?.({
                    source: 'script',
                    sql: statement,
                    connectionId,
                    status: 'success',
                    durationMs: Math.round(performance.now() - startedAt),
                });
            } catch (error) {
                onStatement?.({
                    source: 'script',
                    sql: statement,
                    connectionId,
                    status: 'error',
                    errorMessage: error instanceof Error ? error.message : String(error),
                    durationMs: Math.round(performance.now() - startedAt),
                });
                throw error;
            }
        }

        return lastRowResult ?? lastResult;
    }

    return reactive({
        tables: tables,
        selectedTableName: selectedTableName,
        loadedConnectionId: loadedConnectionId,
        tableInfo: tableInfo,
        tableData: tableData,
        queryText: queryText,
        queryResult: queryResult,
        customQueryText: customQueryText,
        isCustomQueryMode: isCustomQueryMode,
        gridQueryText: gridQueryText,
        isLoadingTables: isLoadingTables,
        isLoadingSelectedTable: isLoadingSelectedTable,
        isRunningQuery: isRunningQuery,
        /** Loads the table list for the current connection. Does NOT
         *  auto-select or auto-load a table — the caller (e.g. activateTab)
         *  is responsible for calling selectTable / loadSelectedTable. */
        async loadTables(connectionId: number | undefined) {
            // connectionId ??= connections.selectedConnectionId;
            if (!connectionId) {
                tables.value = [];
                selectedTableName.value = undefined;
                tableInfo.value = undefined;
                tableData.value = getEmptyTableData();
                isLoadingTables.value = false;
                return;
            }

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
        async selectTable(connectionId: number, tableName: string) {
            if (!connectionId) {
                return;
            }

            selectedTableName.value = tableName;
            await this.loadSelectedTable(connectionId, tableName, { offset: 0 });
        },
        loadSelectedTable: loadSelectedTable,
        async runQuery(onStatement?: (entry: Omit<SqlHistoryEntry, 'id' | 'timestamp'>) => void) {
            if (!connections.selectedConnectionId) {
                return;
            }

            isRunningQuery.value = true;

            try {
                queryResult.value = await runSqlBatch(connections.selectedConnectionId, queryText.value, onStatement);
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
                const result = await runSqlBatch(connections.selectedConnectionId, customQueryText.value);

                if (result?.kind === 'rows') {
                    const isSameAsGrid = customQueryText.value.trim() === gridQueryText.value.trim();
                    tableData.value = {
                        columns: result.columns,
                        rows: result.rows,
                        columnStats: result.columnStats,
                        rowCount: result.rows.length,
                        limit: settings.state.queryRowLimit,
                        offset: 0,
                    };
                    isCustomQueryMode.value = !isSameAsGrid;
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
            const connId = connections.selectedConnectionId;
            const tableName = selectedTableName.value;

            if (connId && tableName) {
                delete customQueryCache[`${connId}:${tableName}`];
            }

            suppressCustomQuerySync.value = true;
            customQueryText.value = '';
            isCustomQueryMode.value = false;
            suppressCustomQuerySync.value = false;

            if (connId && tableName) {
                void this.loadSelectedTable(connId, tableName);
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
