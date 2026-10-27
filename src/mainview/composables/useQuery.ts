import { effectScope, reactive, ref, watch, type EffectScope } from 'vue';
import { clearPersistedGridSort, isInvalidSortColumnError, readPersistedGridSort } from '../../datagrid/dataGridLayoutStorage';
import type { DbType, QueryExecutionResult, TableData, TableInfo, TableSummary, UpdateColumnParams } from '../../shared/types';
import { buildInteractiveSelectSql, cloneInteractiveSelectDraft, createInteractiveSelectDraft, type InteractiveSelectDraft } from '../../shared/utils/interactiveSelectQuery';
import { splitSqlStatements } from '../../shared/utils/sqlStatements';
import { useConnections } from './useConnections';
import { useDbSettings } from './useDbSettings';
import { useSettings } from './useSettings';
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

/** Which control set the data tab's query bar shows. */
export type CustomQueryEditorMode = 'interactive' | 'manual';

type CustomQueryCacheEntry = {
    text: string;
    isCustomQueryMode: boolean;
    sourceSql?: string;
    editorMode: CustomQueryEditorMode;
    draft: InteractiveSelectDraft;
};

/**
 * Shared by every tab, not owned by one: a script anywhere can drop or rename a table, so every
 * table tab's list is stale until it refetches.
 */
const isTableDataStale = ref(false);

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
    /** The statement behind the rows the custom query is showing; the grid's update target. */
    const customQuerySourceSql = ref(undefined as string | undefined);
    /** SQL returned by the backend for the current grid view. */
    const gridQueryText = ref('');
    const customQueryEditorMode = ref<CustomQueryEditorMode>('interactive');
    /** The interactive bar's controls; turned into SQL only when the query is run. */
    const interactiveDraft = ref(createInteractiveSelectDraft());

    // Per-table cache of the custom query (typed text, generated interactive draft, the mode it
    // was run in), so returning to a table restores what its panel was showing. Written explicitly
    // by the paths that change them instead of by a watcher on the refs.
    const customQueryCache: Record<string, CustomQueryCacheEntry> = {};
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
            editorMode: customQueryEditorMode.value,
            draft: cloneInteractiveSelectDraft(interactiveDraft.value),
        };
    }

    // Draft edits are unrun state: they belong to the table too, or switching tabs (which reloads
    // the table) would silently drop the filters the user was building.
    watch([interactiveDraft, customQueryEditorMode], rememberCustomQuery, { deep: true });

    function setCustomQueryText(text: string) {
        customQueryText.value = text;
        // The shown rows belong to the previous text until it is run again.
        customQuerySourceSql.value = undefined;
        rememberCustomQuery();
    }

    async function runCustomQuery() {
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
    }

    /** The statement the interactive bar's controls describe right now, for its popover previews. */
    function buildInteractiveQuerySql(dialect: DbType) {
        return buildInteractiveSelectSql({ tableName: selectedTableName.value, draft: interactiveDraft.value, dialect });
    }

    /**
     * Runs what the interactive controls describe. The statement is built here rather than in the
     * panel so the rows on screen, the text in the manual field and the grid's edit target are all
     * the same statement.
     */
    async function runInteractiveQuery(dialect: DbType) {
        const sql = buildInteractiveQuerySql(dialect);

        if (!sql) {
            return;
        }

        customQueryText.value = sql;
        await runCustomQuery();
    }

    /**
     * Mirrors a sort the grid was given into the bar. A header sort that reloads also syncs through
     * the load; this covers the ones that only repaint the loaded page (the header menu).
     */
    function syncInteractiveOrderBy(orderBy: SortOrder | undefined) {
        if (isCustomQueryMode.value) {
            return;
        }

        const draft = interactiveDraft.value;

        // A hand-built multi-column order is the user's own draft and the grid cannot show it.
        if (draft.orderBy.length > 1) {
            return;
        }

        draft.orderBy = orderBy ? [{ column: orderBy.column, direction: orderBy.direction }] : [];
    }

    /** Points the bar's paging and sort at the page the grid just loaded; the toolbar shows the same. */
    function syncDraftWithLoadedPage(tableData: TableData, orderBy: SortOrder | undefined) {
        const draft = interactiveDraft.value;
        draft.limit = tableData.limit < 0 ? '' : tableData.limit;
        draft.offset = tableData.offset > 0 ? tableData.offset : '';
        syncInteractiveOrderBy(orderBy);
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

            const [tableInfo2, loadedPage] = await Promise.all([tableInfoPromise, tableDataPromise]);
            const tableData2 = loadedPage.tableData;

            if (loadId !== loadSequence) {
                return;
            }

            gridQueryText.value = tableData2.sql ?? '';
            const customQueryKey = `${connectionId}:${tableName}`;
            const cachedCustomQuery = customQueryCache[customQueryKey];
            customQueryText.value = cachedCustomQuery?.text ?? gridQueryText.value;
            isCustomQueryMode.value = cachedCustomQuery?.isCustomQueryMode ?? false;
            customQuerySourceSql.value = cachedCustomQuery?.sourceSql;
            customQueryEditorMode.value = cachedCustomQuery?.editorMode ?? 'interactive';
            // The draft names this table's columns: a restored one is the user's own filters, a
            // new one starts on every column with the grid's own row limit.
            interactiveDraft.value = cachedCustomQuery?.draft
                ? cloneInteractiveSelectDraft(cachedCustomQuery.draft)
                : createInteractiveSelectDraft({ columns: tableInfo2.columns.map((column) => column.name) });

            // A base load is the grid showing its own query, so the bar's LIMIT/OFFSET/ORDER BY are
            // the page just loaded — the toolbar's page size, page and sort. Restoring a custom
            // query keeps the draft that produced those rows instead.
            if (!isCustomQueryMode.value) {
                syncDraftWithLoadedPage(tableData2, loadedPage.orderBy);
            }

            tableInfo.value = tableInfo2;
            tableData.value = tableData2;
            isTableDataStale.value = false;
            // The load just measured this table (`rowCount` is an exact COUNT(*) unless the
            // table is too large to count), so the sidebar row stops showing the list's estimate.
            connections.applyTableRowCount(connectionId, tableName, tableData2.rowCount, tableData2.rowCountIsEstimated === true);
            console.log(
                `[perf][ui] loadSelectedTable ${Math.round(performance.now() - startedAt)}ms ${JSON.stringify({ connectionId, tableName, getTableInfo: infoDurationMs, getTableData: dataDurationMs })}`
            );

            // The restored custom mode names a filter the base rows do not apply: leaving them
            // on screen shows another row set under the custom query's text (and its edit
            // target), so the custom query is re-run and its rows take the grid back.
            if (loadId === loadSequence && isCustomQueryMode.value && customQueryText.value.trim() && customQueryText.value.trim() !== gridQueryText.value.trim()) {
                await runCustomQuery();
            }
        } catch {
            if (loadId !== loadSequence) {
                return;
            }

            customQueryText.value = '';
            isCustomQueryMode.value = false;
            customQuerySourceSql.value = undefined;
            interactiveDraft.value = createInteractiveSelectDraft({ limit: settings.state.queryRowLimit });
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
            // The order that was really applied travels back: the bar mirrors it, and a rejected
            // sort is retried unsorted.
            return { tableData: await tasks.getTableData.run({ ...request, orderBy: params.orderBy }), orderBy: params.orderBy };
        } catch (error) {
            if (!params.orderBy || !isInvalidSortColumnError(error, params.orderBy.column)) {
                throw error;
            }

            // The table no longer has that column: forget the sort instead of
            // failing the whole grid, and load the rows unsorted.
            clearPersistedGridSort(connectionId, tableName);
            return { tableData: await tasks.getTableData.run({ ...request, orderBy: undefined }), orderBy: undefined };
        }
    }

    /** The grid's page size: the toolbar's page-size menu and the bar's LIMIT are the same number. */
    async function setPageLimit(limit: number, orderBy?: SortOrder) {
        await settings.setQueryRowLimit(limit);

        const connId = loadedConnectionId.value;
        const tableName = selectedTableName.value;

        if (connId && tableName) {
            await loadSelectedTable(connId, tableName, { offset: 0, orderBy });
        }
    }

    /** The grid's page offset: the toolbar's paging and the bar's OFFSET are the same number. */
    async function setPageOffset(offset: number, orderBy?: SortOrder) {
        const connId = loadedConnectionId.value;
        const tableName = selectedTableName.value;

        if (connId && tableName) {
            await loadSelectedTable(connId, tableName, { offset, orderBy });
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
        /** Which control set the query bar shows; the interactive one is the default. */
        customQueryEditorMode: customQueryEditorMode,
        interactiveDraft: interactiveDraft,
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
        runCustomQuery: runCustomQuery,
        buildInteractiveQuerySql: buildInteractiveQuerySql,
        runInteractiveQuery: runInteractiveQuery,
        setPageLimit: setPageLimit,
        setPageOffset: setPageOffset,
        syncInteractiveOrderBy: syncInteractiveOrderBy,
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
            // The controls go back to the table they name, not to the previous table's filters.
            interactiveDraft.value = createInteractiveSelectDraft({
                columns: tableInfo.value?.columns.map((column) => column.name) ?? [],
                limit: settings.state.queryRowLimit,
            });
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

export type TQueryState = ReturnType<typeof _useQuery>;

const queryStatesByTabHash = new Map<string, TQueryState>();
/** One scope per state: the store's watchers must stop with the tab that owns them. */
const queryScopesByTabHash = new Map<string, EffectScope>();
let detachedQueryState: TQueryState | undefined;
let detachedQueryScope: EffectScope | undefined;

/**
 * The query state a tab owns: created on first use and kept while the tab is open, so two tabs can
 * never share rows, a table target, draft SQL or a result. The editor text is filled by
 * `seedQueryTextForTab` on the tab's first open, not here, because a render can create the state
 * before the tab activates.
 */
export function useQueryForTab(tabHash: string | undefined): TQueryState {
    if (!tabHash) {
        if (!detachedQueryState) {
            detachedQueryScope = effectScope(true);
            detachedQueryState = detachedQueryScope.run(() => _useQuery())!;
        }

        return detachedQueryState;
    }

    let state = queryStatesByTabHash.get(tabHash);

    if (!state) {
        const scope = effectScope(true);
        state = scope.run(() => _useQuery())!;
        queryStatesByTabHash.set(tabHash, state);
        queryScopesByTabHash.set(tabHash, scope);
    }

    return state;
}

/** Tabs whose editor text has been seeded from the stored draft (or typed into) at least once. */
const seededTextTabs = new Set<string>();

/**
 * Puts the tab's stored draft into its editor, once. The state can be created by a render before
 * the tab activates, so this is ordered by "first open" rather than by state creation.
 */
export function seedQueryTextForTab(tabHash: string | undefined, text: string) {
    if (!tabHash || seededTextTabs.has(tabHash)) {
        return;
    }

    seededTextTabs.add(tabHash);
    useQueryForTab(tabHash).queryText = text;
}

/** Marks the tab as having its own text, so a later activation does not seed over what was typed. */
export function markQueryTextSeeded(tabHash: string | undefined) {
    if (tabHash) {
        seededTextTabs.add(tabHash);
    }
}

export function dropQueryStateForTab(tabHash: string) {
    queryStatesByTabHash.delete(tabHash);
    // The state's own watchers keep its rows reachable until the scope stops.
    queryScopesByTabHash.get(tabHash)?.stop();
    queryScopesByTabHash.delete(tabHash);
    seededTextTabs.delete(tabHash);
}

/** Carries a state to a new hash when a scratch tab becomes a saved script. */
export function moveQueryStateForTab(fromHash: string, toHash: string) {
    if (fromHash === toHash) {
        return;
    }

    const state = queryStatesByTabHash.get(fromHash);

    if (!state) {
        return;
    }

    queryStatesByTabHash.set(toHash, state);
    queryStatesByTabHash.delete(fromHash);

    const scope = queryScopesByTabHash.get(fromHash);

    if (scope) {
        queryScopesByTabHash.set(toHash, scope);
        queryScopesByTabHash.delete(fromHash);
    }

    if (seededTextTabs.delete(fromHash)) {
        seededTextTabs.add(toHash);
    }
}

/** The tabs that still hold a query state, so a closed tab's state can be dropped. */
export function queryStateTabHashes(): string[] {
    return [...queryStatesByTabHash.keys()];
}

/**
 * The state of the tab that is active now. A proxy rather than a captured object because the
 * composables that read it are singletons: a value captured at setup would belong to whichever tab
 * happened to be active then. Every read and write resolves the current tab.
 */
export function useQuery(): TQueryState {
    const resolve = () => useQueryForTab(useSettings().activeTabHash);

    return new Proxy({} as TQueryState, {
        get: (_target, property) => Reflect.get(resolve(), property),
        set: (_target, property, value) => {
            Reflect.set(resolve(), property, value);
            return true;
        },
        has: (_target, property) => Reflect.has(resolve(), property),
    });
}
