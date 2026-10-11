import { reactive, ref } from 'vue';
import { clearPersistedGridSort, isInvalidSortColumnError, readPersistedGridSort } from '../../datagrid/dataGridLayoutStorage';
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
    /** Set when raw SQL runs, so the grid reloads when its table tab is shown again. */
    const isTableDataStale = ref(false);
    const customQueryText = ref('');
    const isCustomQueryMode = ref(false);
    /** The statement behind the rows the custom query is showing; the grid's update target. */
    const customQuerySourceSql = ref(undefined as string | undefined);
    /** SQL returned by the backend for the current grid view. */
    const gridQueryText = ref('');

    // Per-table cache of the custom query text + custom-query mode, so a user's
    // custom query is restored when they return to a table. Written explicitly by
    // the paths that change it instead of by a watcher on the refs.
    const customQueryCache: Record<string, { text: string; isCustomQueryMode: boolean; sourceSql?: string }> = {};
    /** Incremented per table load; only the newest load may apply its result. */
    let loadSequence = 0;

    function rememberCustomQuery() {
        // The custom query belongs to the table the panel is showing, which is the loaded
        // connection — not whichever connection is selected in the sidebar.
        const connId = loadedConnectionId.value;
        const tableName = selectedTableName.value;

        if (!connId || !tableName) {
            return;
        }

        customQueryCache[`${connId}:${tableName}`] = {
            text: customQueryText.value,
            isCustomQueryMode: isCustomQueryMode.value,
            sourceSql: customQuerySourceSql.value,
        };
    }

    function setCustomQueryText(text: string) {
        customQueryText.value = text;
        // The shown rows belong to the previous text until it is run again.
        customQuerySourceSql.value = undefined;
        rememberCustomQuery();
    }

    async function loadSelectedTable(connectionId: number, tableName: string, options?: LoadSelectedTableOptions) {
        // Only the newest load may write: an older table's slow response used to land after a newer
        // one and show the previous table's rows under the new table's name.
        const loadId = ++loadSequence;
        isCustomQueryMode.value = false;
        loadedConnectionId.value = connectionId;
        const offset = Math.max(0, Math.round(options?.offset ?? tableData.value.offset ?? 0));
        const requestedOrderBy = options?.orderBy ?? readPersistedGridSort(connectionId, tableName);
        const orderBy = resolveOrderBy(connectionId, tableName, requestedOrderBy);
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
                const result = await readTableData(connectionId, tableName, { offset, orderBy });
                dataDurationMs = Math.round(performance.now() - operationStartedAt);
                return result;
            })();

            const [tableInfo2, tableData2] = await Promise.all([tableInfoPromise, tableDataPromise]);

            if (loadId !== loadSequence) {
                return;
            }

            gridQueryText.value = tableData2.sql ?? '';
            const customQueryKey = `${connectionId}:${tableName}`;
            const cachedCustomQuery = customQueryCache[customQueryKey];
            customQueryText.value = cachedCustomQuery?.text ?? gridQueryText.value;
            isCustomQueryMode.value = cachedCustomQuery?.isCustomQueryMode ?? false;
            customQuerySourceSql.value = cachedCustomQuery?.sourceSql;
            tableInfo.value = tableInfo2;
            tableData.value = tableData2;
            isTableDataStale.value = false;
            console.log(
                `[perf][ui] loadSelectedTable ${Math.round(performance.now() - startedAt)}ms ${JSON.stringify({ connectionId, tableName, getTableInfo: infoDurationMs, getTableData: dataDurationMs })}`
            );
        } catch {
            if (loadId !== loadSequence) {
                return;
            }

            customQueryText.value = '';
            isCustomQueryMode.value = false;
            customQuerySourceSql.value = undefined;
            tableInfo.value = undefined;
            tableData.value = getEmptyTableData();
        } finally {
            if (loadId === loadSequence) {
                isLoadingSelectedTable.value = false;
            }
        }
    }

    /** Drops a sort whose column the table is known not to have (renamed or
     *  dropped since the layout was persisted). */
    function resolveOrderBy(connectionId: number, tableName: string, orderBy: SortOrder | undefined) {
        if (!orderBy) {
            return undefined;
        }

        const knownColumns = connections.getTableDetailsState(connectionId, tableName).info?.columns;

        if (!knownColumns?.length || knownColumns.some((column) => column.name === orderBy.column)) {
            return orderBy;
        }

        clearPersistedGridSort(connectionId, tableName);
        return undefined;
    }

    async function readTableData(connectionId: number, tableName: string, params: { offset: number; orderBy: SortOrder | undefined }) {
        const request = {
            connectionId,
            tableName,
            limit: settings.state.queryRowLimit,
            offset: params.offset,
            returnQuery: true as const,
        };

        try {
            return await tasks.getTableData.run({ ...request, orderBy: params.orderBy });
        } catch (error) {
            if (!params.orderBy || !isInvalidSortColumnError(error, params.orderBy.column)) {
                throw error;
            }

            // The table no longer has that column: forget the sort instead of
            // failing the whole grid, and load the rows unsorted.
            clearPersistedGridSort(connectionId, tableName);
            return await tasks.getTableData.run({ ...request, orderBy: undefined });
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
                    // The statement and the connection travel with the rows so a later edit can name
                    // the table and database they came from: a column-shape guess picked an unrelated
                    // table, and the tab's current connection can differ from the one that ran.
                    lastRowResult = { ...result, sourceSql: statement, sourceConnectionId: connectionId };
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
        /** The statement the custom query last ran; names the table an edit is written to. */
        customQuerySourceSql: customQuerySourceSql,
        gridQueryText: gridQueryText,
        isLoadingTables: isLoadingTables,
        isLoadingSelectedTable: isLoadingSelectedTable,
        isRunningQuery: isRunningQuery,
        isTableDataStale: isTableDataStale,
        /** Loads the table list for the current connection. Does NOT
         *  auto-select or auto-load a table — the caller (e.g. activateTab)
         *  is responsible for calling selectTable / loadSelectedTable. */
        async loadTables(connectionId: number | undefined) {
            // The panel is bound to this connection from here on: its tables, its grid actions and
            // its custom query all name it instead of reading the sidebar's selection.
            loadedConnectionId.value = connectionId;

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
        /**
         * Runs the editor's SQL against the connection the caller names — the script tab's own
         * connection — never the sidebar's selection, which can point at another database while the
         * tab is open. The result is returned instead of assigned so the caller can attach it to the
         * tab that started the run, even if the user switched tabs while it was in flight.
         */
        async runQuery(connectionId: number | undefined, onStatement?: (entry: Omit<SqlHistoryEntry, 'id' | 'timestamp'>) => void) {
            if (!connectionId) {
                return undefined;
            }

            isRunningQuery.value = true;

            try {
                const result = await runSqlBatch(connectionId, queryText.value, onStatement);

                // The script may have changed data that the (currently hidden) table grid shows:
                // leave the reload to the table tab's activation instead of fetching a table the
                // user is not looking at.
                isTableDataStale.value = true;
                return result;
            } catch {
                return undefined;
            } finally {
                isRunningQuery.value = false;
            }
        },
        async runCustomQuery() {
            // The panel's own connection, not the sidebar's selection: the rows on screen and the
            // query that replaces them must belong to the same database.
            const connectionId = loadedConnectionId.value;

            if (!connectionId || !customQueryText.value.trim()) {
                return;
            }

            isRunningQuery.value = true;

            try {
                const result = await runSqlBatch(connectionId, customQueryText.value);

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
                    customQuerySourceSql.value = result.sourceSql;
                } else {
                    tableData.value = getEmptyTableData();
                    isCustomQueryMode.value = false;
                    customQuerySourceSql.value = undefined;
                }
            } catch {
                tableData.value = getEmptyTableData();
                isCustomQueryMode.value = false;
                customQuerySourceSql.value = undefined;
            } finally {
                isRunningQuery.value = false;
                rememberCustomQuery();
            }
        },
        setCustomQueryText: setCustomQueryText,
        clearCustomQuery() {
            const connId = loadedConnectionId.value;
            const tableName = selectedTableName.value;

            if (connId && tableName) {
                delete customQueryCache[`${connId}:${tableName}`];
            }

            customQueryText.value = '';
            isCustomQueryMode.value = false;
            customQuerySourceSql.value = undefined;
            rememberCustomQuery();

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
