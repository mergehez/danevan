import { computed, reactive, ref, watch } from 'vue';
import { useDataGrid, type DataGridCellValue, type DataGridPendingChange, type GridDisplayType, type PendingRowState, type TableData } from '../../datagrid';
import { getDataGridLayoutStorageKey } from '../../datagrid/dataGridLayoutStorage';
import type { ApplyTableChangesParams, DbType, GridCustomFormatter, SqlValue, TableInfo } from '../../shared/types';
import { quoteSqlIdentifier } from '../../shared/utils/sqlIdentifiers';
import { toast } from '../../shared/utils/useToast';
import { formatValue } from '../../shared/utils/valueFormatting';
import {
    getDbGridCellMenuItems,
    getDbGridHeaderMenuItems,
    getDbGridRowMenuItems,
    getDbGridToolbarCopyItems,
    type DbGridPeekRelationParams,
    type DbGridPeekUsagesParams,
} from '../lib/dbGridMenus';
import { useConnections } from './useConnections';
import { copyTableAsDdl } from './useCopyTableDdl';
import { useForeignKeyPeek } from './useForeignKeyPeek';
import { useGridFormatters } from './useGridFormatters';
import { useQuery } from './useQuery';
import { useServers } from './useServers';
import { tasks } from './useTasks';

type PendingCellChange = {
    rowIndex: number;
    columnName: string;
    previousValue: SqlValue;
    nextValue: SqlValue;
    originalValue: SqlValue;
    matchColumn: string;
    matchValue: SqlValue;
};

type PendingInsertedRow = { values: Record<string, SqlValue>; isDiscarded: boolean };

type PlannedPendingUpdateChange = PendingCellChange & { matchValue: SqlValue };

type UseDbDataGridOptions = {
    connectionId: () => number | undefined;
    emptyText?: () => string | undefined;
    onPeekRelation?: (params: DbGridPeekRelationParams) => void | Promise<void>;
    onPeekUsages?: (params: DbGridPeekUsagesParams) => void | Promise<void>;
    /**
     * Replaces the default post-save reload of the panel's table. A script result grid passes its
     * own refresh (its rows are a query result, not a loaded table); every other grid reloads the
     * table the save went to, which also re-applies an active custom query.
     */
    onSaved?: () => void | Promise<void>;
    /**
     * Names the view this grid instance is currently showing (usually the active tab's hash).
     * Pending edits, inserted/deleted rows, the active cell and the row selection are parked
     * under that key when the view changes and restored on return, so navigating between tabs
     * keeps each tab's grid state instead of resetting the shared grid.
     */
    stateKey?: () => string | undefined;
    ignoreDisplayFilters?: () => boolean | undefined;
    disabledFiltersMessage?: string;
    onSortChange?: (columnName: string) => void;
    tableData: () => TableData;
    tableInfo: () => TableInfo | undefined;
    tableName: () => string | undefined;
};

type StashedTabGridState = {
    connectionId: number | undefined;
    tableName: string | undefined;
    rowCount: number;
    offset: number;
    limit: number | undefined;
    /** First row's primary-key value, when the table has one: row indexes are only trustworthy
     *  while the row set still starts at the same row. */
    firstRowFingerprint: string | undefined;
    cellChanges: Record<string, DataGridPendingChange>;
    insertedRows: PendingInsertedRow[];
    deletedBaseRowIndexes: number[];
    activeCell: { rowIndex: number; columnIndex: number };
    selectedRowIndexes: number[];
};

/**
 * Pending grid state parked per view key (see `stateKey`). The grid itself is one shared
 * instance, so without this every tab switch resets pending edits, the position and the
 * selection of the tab being left. Bounded: closed tabs must not accumulate entries forever.
 */
const tabGridStash = new Map<string, StashedTabGridState>();
const MAX_STASHED_TAB_GRIDS = 30;

export type TDbDataGridState = ReturnType<typeof useDbDataGrid>;

function getColumnEditorInitialRows(column: TableInfo['columns'][number] | undefined) {
    const type = column?.type?.trim().toLocaleLowerCase();

    if (!type) {
        return 1;
    }

    const isStringColumn = /(char|text|clob|memo|string|varchar|nvarchar|nchar|tinytext|mediumtext|longtext)/i.test(type);

    if (!isStringColumn) {
        return 1;
    }

    const lengthMatch = type.match(/\((\d+)\)/);
    const declaredLength = lengthMatch ? Number(lengthMatch[1]) : undefined;

    if (declaredLength == null || !Number.isFinite(declaredLength)) {
        return /(text|clob|memo|longtext|mediumtext)/i.test(type) ? 6 : 3;
    }

    const resolvedLength: number = declaredLength;

    if (resolvedLength <= 80) {
        return 1;
    }

    if (resolvedLength <= 160) {
        return 2;
    }

    if (resolvedLength <= 320) {
        return 3;
    }

    if (resolvedLength <= 640) {
        return 4;
    }

    if (resolvedLength <= 1000) {
        return 5;
    }

    return 6;
}

export function useDbDataGrid(options: UseDbDataGridOptions) {
    const query = useQuery();
    const connections = useConnections();
    const servers = useServers();
    const isPreviewOpen = ref(false);
    const disableForeignKeyChecks = ref(false);
    const foreignKeyViolations = ref<string[]>([]);
    const isForeignKeyViolationsOpen = ref(false);
    const pendingInsertedRows = ref<PendingInsertedRow[]>([]);
    const pendingDeletedBaseRowIndexes = ref<number[]>([]);
    const isAddRowDialogOpen = ref(false);
    const addRowDialogValues = ref<Record<string, SqlValue>>({});
    const isEditRowDialogOpen = ref(false);
    const editRowDialogRowIndex = ref(-1);
    /** Set when the last save failed, so the save bar can say why instead of failing silently. */
    const saveErrorMessage = ref<string | undefined>(undefined);

    // Separate undo stacks for row-level operations (delete/insert).
    // Cell-level edits are tracked via the DataGrid's own undoStack.
    type RowUndoEntry = {
        deletedRows: number[];
        insertedRows: PendingInsertedRow[];
    };
    const pendingRowUndoStack = ref<RowUndoEntry[]>([]);
    const pendingRowRedoStack = ref<RowUndoEntry[]>([]);

    function pushPendingRowSnapshot() {
        pendingRowUndoStack.value = [
            ...pendingRowUndoStack.value,
            {
                deletedRows: [...pendingDeletedBaseRowIndexes.value],
                insertedRows: pendingInsertedRows.value.map((row) => ({ ...row, values: { ...row.values } })),
            },
        ];
        pendingRowRedoStack.value = [];
    }

    const tableInfo = computed(() => options.tableInfo());
    const tableName = computed(() => options.tableName());
    const tableColumns = computed(() => tableInfo.value?.columns ?? []);
    const tableColumnByName = computed(() => new Map(tableColumns.value.map((column) => [column.name, column] as const)));
    const primaryKeyColumns = computed(() =>
        (tableInfo.value?.columns ?? [])
            .filter((column) => column.isPrimaryKey)
            .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
            .map((column) => column.name)
    );

    const sourceTableData = computed(() => options.tableData());
    const overlayTableData = computed<TableData>(() => {
        const baseTableData = sourceTableData.value;
        const baseRows = baseTableData.rows ?? [];

        return {
            ...baseTableData,
            rows: [...baseRows, ...pendingInsertedRows.value.map((row) => row.values)],
            rowCount: baseRows.length + pendingInsertedRows.value.length,
        } satisfies TableData;
    });

    const sqlDialect = computed(() => {
        const connection = connections.connections.find((entry) => entry.id === options.connectionId());
        const server = servers.servers.find((entry) => entry.id === connection?.server_id);
        return server?.driver || 'sqlite';
    });
    const supportsForeignKeyCheckToggle = computed(() => sqlDialect.value === 'sqlite' || sqlDialect.value === 'mysql');
    const gridFormatters = useGridFormatters();

    // Load the formatters of this grid's own table. A bare loadFormatters() kept the context of
    // whichever table was activated last, so another table's assignments decorated these columns.
    watch(
        () => [options.connectionId(), tableName.value] as const,
        ([connectionId, currentTableName]) => {
            void gridFormatters.loadContext(connectionId, currentTableName);
        },
        { immediate: true }
    );

    const fkPeek = useForeignKeyPeek({
        connectionId: computed(() => options.connectionId()),
        tableInfo: tableInfo,
        sqlDialect: sqlDialect,
        getDisplayedCellValue: (rowIndex, columnName) => getDisplayedCellValue(rowIndex, columnName),
    });
    const ddlText = ref('');
    const isDdlModalOpen = ref(false);
    const gridState = useDataGrid({
        layoutStorageKey: computed(() => {
            const connectionId = options.connectionId();
            const currentTableName = options.tableName();

            if (!connectionId || !currentTableName) {
                return undefined;
            }

            return getDataGridLayoutStorageKey(connectionId, currentTableName);
        }),
        editable: true,
        tableData: overlayTableData,
        emptyText: computed(() => options.emptyText?.()),
        sqlInsertTableName: tableName,
        sqlInsertDialect: sqlDialect,
        toolbarCopyAsCustomItems: computed(() =>
            getDbGridToolbarCopyItems({
                connectionId: options.connectionId(),
                tableName: tableName.value,
                onCopyAsDdl: () => {
                    const connectionId = options.connectionId();
                    const currentTableName = tableName.value;

                    return connectionId && currentTableName ? copyTableAsDdl(connectionId, currentTableName, sqlDialect.value) : undefined;
                },
            })
        ),
        copyTableAsDdl: () => {
            const connectionId = options.connectionId();
            const currentTableName = tableName.value;

            if (!connectionId || !currentTableName) {
                return Promise.resolve();
            }

            return copyTableAsDdl(connectionId, currentTableName, sqlDialect.value);
        },
        showTableDdl: async () => {
            const connectionId = options.connectionId();
            const currentTableName = tableName.value;

            if (!connectionId || !currentTableName) {
                return;
            }

            const ddl = await tasks.getTableDdl.run({ connectionId, tableName: currentTableName });
            const formatted = await tasks.formatSql.run({ sql: ddl, dialect: sqlDialect.value }).catch(() => {
                tasks.formatSql.clearError();
                return ddl;
            });
            ddlText.value = formatted;
            isDdlModalOpen.value = true;
        },
        primaryKeyColumns: computed(() => tableInfo.value?.columns.filter((c) => c.isPrimaryKey).map((c) => c.name)),
        getFormattedCellValue: (rowIndex: number, columnName: string) => {
            const value = getDisplayedCellValue(rowIndex, columnName);
            const pendingRowState = getPendingRowState(rowIndex);
            const column = tableColumnByName.value.get(columnName);

            if (pendingRowState === 'inserted' && column?.isAutoIncrement && value == null) {
                return 'auto';
            }

            const displayType = getColumnDisplayType(columnName);

            if (displayType === 'custom') {
                const formatter = gridFormatters.getColumnFormatter(columnName);

                if (!formatter) {
                    console.log('Formatter not found for column', { columnName });
                    return formatDisplayValue(value);
                }

                const baseValue = formatDisplayValue(value);
                return gridFormatters.runTemplate(formatter, baseValue);
                // return formatter.template.replaceAll('{{value}}', baseValue).replaceAll('{{text}}', baseValue);
            }

            if (displayType === 'number' || !isColumnIntegerLike(columnName)) {
                return formatDisplayValue(value);
            }

            // convert integer-like values to dates if a timestamp display type is set
            return ((value: SqlValue) => {
                const integerValue = ((value: SqlValue) => {
                    if (typeof value === 'bigint') {
                        return value;
                    }

                    if (typeof value === 'number' && Number.isInteger(value)) {
                        return value;
                    }

                    if (typeof value === 'string' && /^[-+]?\d+$/.test(value.trim())) {
                        try {
                            return BigInt(value.trim());
                        } catch {
                            return null;
                        }
                    }

                    return null;
                })(value);

                if (integerValue == null) {
                    return formatDisplayValue(value);
                }

                let milliseconds: number;

                if (typeof integerValue === 'bigint') {
                    const nextMilliseconds =
                        displayType === 'timestamp-seconds' ? integerValue * 1000n : displayType === 'timestamp-milliseconds' ? integerValue : integerValue / 1000n;

                    if (nextMilliseconds > BigInt(Number.MAX_SAFE_INTEGER) || nextMilliseconds < BigInt(Number.MIN_SAFE_INTEGER)) {
                        return formatDisplayValue(value);
                    }

                    milliseconds = Number(nextMilliseconds);
                } else {
                    milliseconds = displayType === 'timestamp-seconds' ? integerValue * 1000 : displayType === 'timestamp-milliseconds' ? integerValue : integerValue / 1000;
                }

                const date = new Date(milliseconds);

                if (Number.isNaN(date.getTime())) {
                    return formatDisplayValue(value);
                }

                return date.toISOString();
            })(value);
        },
        handleGridCommandKeydown: (event: KeyboardEvent, context: { commitEditingCell: () => void; isTextInputTarget: boolean }) => {
            const key = event.key.toLowerCase();

            if (key === 's') {
                event.preventDefault();

                if (gridState.editingCell.rowIndex >= 0 && gridState.editingCell.columnIndex >= 0) {
                    context.commitEditingCell();
                }

                void saveChanges();
                return true;
            }

            if (context.isTextInputTarget) {
                return false;
            }

            return false;
        },
        cellContextMenuCustomItems: (context) =>
            getDbGridCellMenuItems(
                {
                    connectionId: options.connectionId(),
                    tableName: tableName.value,
                    rowIndex: context.rowIndex,
                    columnIndex: context.columnIndex,
                    columnName: context.columnName,
                    value: getDisplayedCellValue(context.rowIndex, context.columnName),
                    isPrimaryKey: Boolean(tableColumnByName.value.get(context.columnName)?.isPrimaryKey),
                    relation: fkPeek.getFkPeekRelation(context.columnName),
                    event: context.event,
                },
                {
                    onPeekRelation: options.onPeekRelation,
                    onPeekUsages: options.onPeekUsages,
                    openFkPeek: () => fkPeek.openFkPeek(context.rowIndex, gridState.getColumnName(context.columnIndex), context.event),
                    getRowValues: () => Object.fromEntries(tableColumns.value.map((tableColumn) => [tableColumn.name, getDisplayedCellValue(context.rowIndex, tableColumn.name)])),
                }
            ),
        rowContextMenuCustomItems: (context) =>
            getDbGridRowMenuItems(
                {
                    connectionId: options.connectionId(),
                    tableName: tableName.value,
                    isTransposed: gridState.isTransposed,
                    rowIndex: context.rowIndex,
                    selectedRowIndexes: gridState.selectedRowIndexes,
                    selectedCellRange: gridState.selectedCellRange,
                    primaryKeyColumns: primaryKeyColumns.value,
                    tableColumns: tableColumns.value,
                    sortedRowIndexes: gridState.sortedRowIndexes,
                    getCellValue: getDisplayedCellValue,
                },
                {
                    openEditRowDialog: (rowIndex) => dbGridState.openEditRowDialog(rowIndex),
                    openDuplicateRowDialog: (rowValues) => dbGridState.openDuplicateRowDialog(rowValues),
                    selectRow: (rowIndex, selectOptions) => gridState.selectRow(rowIndex, selectOptions),
                    clearSelectedRows: () => gridState.clearSelectedRows(),
                    selectAllRows: () => gridState.selectAllRows(),
                    deleteSelectedRows: () => gridState.deleteSelectedRows?.(),
                }
            ),
        canUseTimestampDisplayTypes: isColumnIntegerLike,
        getColumnDisplayType: getColumnDisplayType,
        headerContextMenuCustomItems: (context) =>
            getDbGridHeaderMenuItems(
                {
                    columnName: context.columnName,
                    isIntegerColumn: isColumnIntegerLike(context.columnName),
                    assignedFormatterId: gridFormatters.columnFormatterIds[context.columnName],
                    customFormatters: gridFormatters.customFormatters,
                },
                {
                    setColumnFormatter: (columnName, formatterId) => void setColumnFormatter(columnName, formatterId),
                    openFormatterManager: () => gridFormatters.openManager(),
                }
            ),
        parseEditingValue: (draftValue: string, originalValue: DataGridCellValue): DataGridCellValue => {
            if (draftValue === '__NULL__') {
                return null;
            }

            if (originalValue == null && draftValue === '') {
                return null;
            }

            if (originalValue == null && draftValue.trim().toUpperCase() === 'NULL') {
                return null;
            }

            if (typeof originalValue === 'number') {
                const nextNumber = Number(draftValue);
                return Number.isFinite(nextNumber) ? nextNumber : originalValue;
            }

            if (typeof originalValue === 'bigint') {
                try {
                    return BigInt(draftValue);
                } catch {
                    return originalValue;
                }
            }

            return draftValue;
        },
        setColumnDisplayType: (columnName: string, displayType: GridDisplayType) => {
            if (displayType !== 'custom' && !isColumnIntegerLike(columnName)) {
                return;
            }

            if (displayType !== 'custom' && gridFormatters.columnFormatterIds[columnName]) {
                void setColumnFormatter(columnName, undefined);
            }

            gridState.updateLayoutState({
                displayTypes: {
                    ...gridState.layoutState.displayTypes,
                    [columnName]: displayType,
                },
            });
        },
        createPendingChange: ({
            rowIndex,
            columnName,
            nextValue,
            rawValue,
        }: {
            rowIndex: number;
            columnName: string;
            nextValue: DataGridCellValue;
            rawValue: DataGridCellValue;
        }) => {
            const row = gridState.getRow(rowIndex);
            const matchColumn = primaryKeyColumns.value[0];
            const previousValue = coerceSqlValue(rawValue);

            // Without a named table a save has no target: the result is a join, a derived table or
            // a statement that reads no table of this connection. Refusing beats writing somewhere
            // the user did not ask for.
            if (!tableName.value) {
                toast.showToast('Editing is unavailable for this result: it does not read a single known table.', 'warning');
                return undefined;
            }

            // Without a primary key there is no WHERE clause that names the edited row: the first
            // column used to stand in for one, so a save overwrote every row sharing its value.
            // A pending insert needs no match column, so it stays editable.
            if (!matchColumn && !isInsertedRowIndex(rowIndex)) {
                toast.showToast('Editing needs a primary key: without one, a save would overwrite every row that looks the same.', 'warning');
                return undefined;
            }

            if (!row) {
                return undefined;
            }

            const originalValue = previousValue;
            const matchValue = matchColumn ? (row[matchColumn] ?? null) : null;

            return {
                rowIndex,
                columnName,
                previousValue,
                nextValue: coerceSqlValue(nextValue),
                originalValue,
                matchColumn: matchColumn ?? '',
                matchValue: coerceSqlValue(matchValue),
            } satisfies PendingCellChange;
        },
        renderVersion: computed(() =>
            [
                gridFormatters.renderVersion,
                gridFormatters.customFormatters.map((formatter: GridCustomFormatter) => `${formatter.id}:${formatter.updatedAt}`).join(','),
                Object.entries(gridFormatters.columnFormatterIds ?? {})
                    .map(([columnName, formatterId]) => `${columnName}:${formatterId ?? ''}`)
                    .join(','),
                // A display-type switch changes no row and no formatter, so without its
                // signature here the canvas keeps painting the cached text and the
                // switch looks like it did nothing.
                Object.entries(gridState.layoutState.displayTypes ?? {})
                    .map(([columnName, displayType]) => `${columnName}:${displayType ?? ''}`)
                    .join(','),
                gridState.dirtyChanges.length,
                gridState.savedCellKeys.join(','),
                gridState.savedRowIndexes.join(','),
                pendingInsertedRows.value.map((row, index) => `${index}:${row.isDiscarded ? 'discarded' : 'active'}`).join(','),
                pendingDeletedBaseRowIndexes.value.join(','),
            ].join('|')
        ),
        transposeTooltip: 'Transpose table',
        enableTranspose: true,
        deleteSelectedRows: async () => {
            const connectionId = options.connectionId();
            const currentTableName = tableName.value;

            if (!connectionId || !currentTableName || gridState.isTransposed || !gridState.selectedRowIndexes.length) {
                return;
            }

            const selectedRowIndexes = [...gridState.selectedRowIndexes].sort((left, right) => left - right);
            const hasExistingRowsToDelete = selectedRowIndexes.some((rowIndex) => getPendingRowState(rowIndex) !== 'deleted' && !isInsertedRowIndex(rowIndex));

            if (hasExistingRowsToDelete && !primaryKeyColumns.value.length) {
                return;
            }

            pushPendingRowSnapshot();
            const nextDeletedBaseRowIndexes = new Set(pendingDeletedBaseRowIndexes.value);
            const nextInsertedRows = [...pendingInsertedRows.value];

            for (const rowIndex of selectedRowIndexes) {
                const pendingRowState = getPendingRowState(rowIndex);

                if (isInsertedRowIndex(rowIndex)) {
                    const insertedRow = nextInsertedRows[rowIndex - getBaseRowCount()];

                    if (insertedRow) {
                        insertedRow.isDiscarded = pendingRowState !== 'deleted';
                    }

                    continue;
                }

                if (pendingRowState === 'deleted') {
                    nextDeletedBaseRowIndexes.delete(rowIndex);
                } else {
                    nextDeletedBaseRowIndexes.add(rowIndex);
                }
            }

            pendingDeletedBaseRowIndexes.value = [...nextDeletedBaseRowIndexes].sort((left, right) => left - right);
            pendingInsertedRows.value = nextInsertedRows;
            gridState.cancelEditingCell();
        },
        getPendingRowState: getPendingRowState,
        addRow: async function () {
            const connectionId = options.connectionId();
            const currentTableName = tableName.value;

            if (!connectionId || !currentTableName || gridState.isTransposed) {
                return;
            }

            pushPendingRowSnapshot();
            const nextRowIndex = getBaseRowCount() + pendingInsertedRows.value.length;
            const nextRow = Object.fromEntries(tableColumns.value.map((column) => [column.name, null])) as Record<string, SqlValue>;

            pendingInsertedRows.value = [...pendingInsertedRows.value, { values: nextRow, isDiscarded: false }];
            gridState.clearSelectedColumn();
            gridState.clearSelectedCellRange();
            gridState.selectRow(nextRowIndex, { focus: true });
        },
        canAddRow: computed(() => {
            return !!options.connectionId() && !!tableName.value && !gridState.isTransposed && sqlDialect.value !== 'msaccess';
        }),
        canDeleteSelectedRows: computed(() => {
            if (!options.connectionId() || !tableName.value || gridState.isTransposed || !gridState.selectedRowIndexes.length) {
                return false;
            }

            const hasExistingRowsToDelete = gridState.selectedRowIndexes.some((rowIndex) => getPendingRowState(rowIndex) !== 'deleted' && !isInsertedRowIndex(rowIndex));

            return !hasExistingRowsToDelete || primaryKeyColumns.value.length > 0;
        }),
        ignoreLayoutFilters: computed(() => options.ignoreDisplayFilters?.()),
        onSortChange: options.onSortChange,
        disabledFiltersMessage: options.disabledFiltersMessage,
    });

    const columnDisplayTypes = computed(() => {
        const nextDisplayTypes: Record<string, GridDisplayType | undefined> = {};

        for (const columnName of gridState.allColumns) {
            const displayType = gridState.layoutState.displayTypes[columnName];

            if (displayType) {
                nextDisplayTypes[columnName] = displayType;
            }
        }

        return nextDisplayTypes;
    });
    const pendingDbChanges = computed(() => gridState.dirtyChanges as unknown as PendingCellChange[]);
    const pendingBaseRowDeleteCount = computed(() => pendingDeletedBaseRowIndexes.value.length);
    const pendingInsertedRowCount = computed(() => pendingInsertedRows.value.filter((row) => !row.isDiscarded).length);
    const pendingDiscardedInsertedRowCount = computed(() => pendingInsertedRows.value.filter((row) => row.isDiscarded).length);
    const pendingRowChangeCount = computed(() => pendingBaseRowDeleteCount.value + pendingInsertedRowCount.value + pendingDiscardedInsertedRowCount.value);
    const pendingUpdateChanges = computed(() =>
        pendingDbChanges.value.filter((change) => {
            const pendingRowState = getPendingRowState(change.rowIndex);
            return pendingRowState !== 'deleted' && !isInsertedRowIndex(change.rowIndex);
        })
    );
    const hasPendingGridChanges = computed(() => pendingUpdateChanges.value.length > 0 || pendingRowChangeCount.value > 0);

    /** The row set the staged row indexes address: restoring them is only valid while the grid
     *  still shows these rows. */
    function currentRowsIdentity() {
        return {
            connectionId: options.connectionId(),
            tableName: tableName.value,
            rowCount: sourceTableData.value.rowCount ?? sourceTableData.value.rows.length,
            offset: sourceTableData.value.offset ?? 0,
            limit: sourceTableData.value.limit,
            firstRowFingerprint: fingerprintFirstRow(),
        };
    }

    function fingerprintFirstRow() {
        const matchColumn = primaryKeyColumns.value[0];
        const firstRow = sourceTableData.value.rows[0];

        if (!matchColumn || !firstRow) {
            return undefined;
        }

        try {
            return JSON.stringify(firstRow[matchColumn] ?? null);
        } catch {
            return undefined;
        }
    }

    function hasStashableGridState() {
        return (
            Object.keys(gridState.pendingChanges).length > 0 ||
            pendingInsertedRows.value.length > 0 ||
            pendingDeletedBaseRowIndexes.value.length > 0 ||
            gridState.selectedRowIndexes.length > 0 ||
            gridState.activeCell.rowIndex !== 0 ||
            gridState.activeCell.columnIndex !== 0
        );
    }

    function stashTabGridState(key: string, rowsIdentity: ReturnType<typeof currentRowsIdentity>) {
        if (!hasStashableGridState()) {
            return;
        }

        tabGridStash.set(key, {
            ...rowsIdentity,
            cellChanges: { ...gridState.pendingChanges },
            insertedRows: pendingInsertedRows.value.map((row) => ({ ...row, values: { ...row.values } })),
            deletedBaseRowIndexes: [...pendingDeletedBaseRowIndexes.value],
            activeCell: { rowIndex: gridState.activeCell.rowIndex, columnIndex: gridState.activeCell.columnIndex },
            selectedRowIndexes: [...gridState.selectedRowIndexes],
        });

        while (tabGridStash.size > MAX_STASHED_TAB_GRIDS) {
            const oldest = tabGridStash.keys().next().value;

            if (oldest === undefined || oldest === key) {
                break;
            }

            tabGridStash.delete(oldest);
        }
    }

    /**
     * Brings back the state parked under `key` when the grid still shows the rows it was staged
     * on. A changed row set (reload, save, fresh run) drops the stash instead: row indexes from
     * another row set would stage edits onto the wrong rows. When the key just changed the rows
     * are still in flight, so the stash is kept for the fire that brings them.
     */
    function restoreTabGridState(key: string, keyChanged: boolean) {
        const stash = tabGridStash.get(key);

        if (!stash) {
            return;
        }

        const identity = currentRowsIdentity();
        const rowsMatch =
            stash.connectionId === identity.connectionId &&
            stash.tableName === identity.tableName &&
            stash.rowCount === identity.rowCount &&
            stash.offset === identity.offset &&
            stash.limit === identity.limit &&
            (stash.firstRowFingerprint === undefined || identity.firstRowFingerprint === undefined || stash.firstRowFingerprint === identity.firstRowFingerprint);

        if (!rowsMatch) {
            if (!keyChanged) {
                tabGridStash.delete(key);
            }

            return;
        }

        tabGridStash.delete(key);
        pendingInsertedRows.value = stash.insertedRows.map((row) => ({ ...row, values: { ...row.values } }));
        pendingDeletedBaseRowIndexes.value = [...stash.deletedBaseRowIndexes];
        gridState.restorePendingChanges(stash.cellChanges);

        for (const [index, rowIndex] of stash.selectedRowIndexes.entries()) {
            if (index === 0) {
                gridState.selectRow(rowIndex);
            } else {
                gridState.selectRow(rowIndex, { mode: 'toggle' });
            }
        }

        gridState.setActiveCell(stash.activeCell.rowIndex, stash.activeCell.columnIndex);
    }

    // A fire with the same key and the same rows (late metadata, a layout-only change) must not
    // reset the view: that is what used to wipe staged edits and the scroll position without the
    // user leaving the tab.
    let lastGridDataIdentity: string | undefined;
    // The rows on screen before this fire: a key change parks the leaving view's state, which
    // belongs to these rows — not to the incoming view's rows, which is all the live state
    // already shows by the time the watcher runs.
    let lastKnownRowsIdentity: ReturnType<typeof currentRowsIdentity> | undefined;

    watch(
        () => [
            options.stateKey?.(),
            options.connectionId(),
            tableName.value,
            sourceTableData.value.rowCount,
            sourceTableData.value.offset,
            sourceTableData.value.limit,
            tableInfo.value?.name,
        ],
        (current, previous) => {
            if (!gridState) {
                return;
            }

            const [stateKey, connectionId, currentTableName] = current;
            const [previousStateKey, previousConnectionId, previousTableName] = previous ?? [];
            const keyChanged = stateKey !== previousStateKey;
            // Only reset the active cell (which scrolls the grid back to the top-left)
            // when a different table/connection is loaded. Reloads of the same table
            // (sorting, paging, refresh) must keep the active cell / scroll position.
            const tableChanged = connectionId !== previousConnectionId || currentTableName !== previousTableName;

            // Park this view's pending state under the tab being left, so coming back
            // restores its edits and position instead of a reset grid.
            if (keyChanged && typeof previousStateKey === 'string' && lastKnownRowsIdentity) {
                stashTabGridState(previousStateKey, lastKnownRowsIdentity);
            }

            const rowsIdentity = currentRowsIdentity();
            const identity = JSON.stringify(rowsIdentity);

            if (!keyChanged && identity === lastGridDataIdentity) {
                return;
            }

            lastGridDataIdentity = identity;
            lastKnownRowsIdentity = rowsIdentity;

            disableForeignKeyChecks.value = false;
            pendingInsertedRows.value = [];
            pendingDeletedBaseRowIndexes.value = [];
            gridState.resetViewState({ clearColumnList: true, clearHistory: true, preserveActiveCell: !tableChanged });
            fkPeek.closeFkPeekPopover();

            // The save that produced the report reloads the same table; a reload must not
            // wipe the violations the user still has to read. Only leaving the table does.
            if (tableChanged) {
                foreignKeyViolations.value = [];
                isForeignKeyViolationsOpen.value = false;
            }

            if (typeof stateKey === 'string') {
                restoreTabGridState(stateKey, keyChanged);
            }
        },
        { immediate: true }
    );

    function getBaseRowCount() {
        return sourceTableData.value.rows.length;
    }

    function isInsertedRowIndex(rowIndex: number) {
        return rowIndex >= getBaseRowCount();
    }

    function getPendingRowState(rowIndex: number): PendingRowState {
        if (rowIndex < getBaseRowCount()) {
            return pendingDeletedBaseRowIndexes.value.includes(rowIndex) ? 'deleted' : undefined;
        }

        const insertedRow = pendingInsertedRows.value[rowIndex - getBaseRowCount()];

        if (!insertedRow) {
            return undefined;
        }

        return insertedRow.isDiscarded ? 'deleted' : 'inserted';
    }

    // watch(
    //     () => [options.connectionId(), tableName.value],
    //     ([connectionId, currentTableName]) => {
    //         void gridFormatters.loadContext(connectionId as number | undefined, currentTableName as string | undefined);
    //     },
    //     { immediate: true }
    // );

    function getDisplayedCellValue(rowIndex: number, columnName: string) {
        return coerceSqlValue(gridState.resolveCell(rowIndex, columnName).value);
    }

    function formatDisplayValue(value: SqlValue) {
        return formatValue(value, { binaryMode: 'hex' });
    }

    function coerceSqlValue(value: DataGridCellValue): SqlValue {
        return (value ?? null) as SqlValue;
    }

    function buildPlannedPendingUpdateChanges() {
        const currentMatchValuesByRowIndex = new Map<number, SqlValue>();

        return pendingUpdateChanges.value.map((change) => {
            const row = sourceTableData.value.rows[change.rowIndex];
            const initialMatchValue = change.matchColumn ? (row?.[change.matchColumn] ?? null) : null;
            const plannedMatchValue = currentMatchValuesByRowIndex.has(change.rowIndex) ? (currentMatchValuesByRowIndex.get(change.rowIndex) ?? null) : initialMatchValue;
            const plannedChange: PlannedPendingUpdateChange = {
                ...change,
                matchValue: coerceSqlValue(plannedMatchValue),
            };

            if (change.columnName === change.matchColumn) {
                currentMatchValuesByRowIndex.set(change.rowIndex, coerceSqlValue(change.nextValue));
            }

            return plannedChange;
        });
    }

    /** Detect column types that store date/time values. */
    function isDateTimeColumn(columnType: string | undefined): boolean {
        if (!columnType) return false;
        const normalized = columnType.trim().toLowerCase();
        return (
            normalized.startsWith('date') || normalized.startsWith('time') || normalized === 'timestamp' || normalized.startsWith('timestamp(') || normalized.includes('datetime')
        );
    }

    /**
     * Format an SQL value with awareness of the column type.
     * For datetime columns, ISO strings (e.g. "2026-07-21T14:04:58.000Z")
     * are converted to a format the database understands.
     */
    function formatSqlValue(value: unknown, columnType: string | undefined, sqlDialectName: string): string {
        if (value == null) return 'NULL';

        // For datetime columns, convert ISO strings to DB-friendly format.
        if (isDateTimeColumn(columnType) && typeof value === 'string') {
            // Replace 'T' with space and strip trailing 'Z' or timezone offset.
            const cleaned = value
                .replace('T', ' ')
                .replace(/\s*Z$/i, '')
                .replace(/([+-]\d{2}:\d{2})$/, '');
            return formatValue(cleaned, { mode: 'sql', dialect: sqlDialectName as DbType });
        }

        // The statement is executed as it is written, so its literal is escaped for that dialect.
        return formatValue(value as SqlValue, { mode: 'sql', binaryMode: 'hex', dialect: sqlDialectName as DbType });
    }

    function buildInsertStatement(rowIndex: number) {
        const currentTableName = tableName.value;
        const row = gridState.getRow(rowIndex);

        if (!currentTableName || !row || getPendingRowState(rowIndex) !== 'inserted') {
            return undefined;
        }

        const tableIdentifier = quoteSqlIdentifier(currentTableName, sqlDialect.value);
        const insertableColumns = tableColumns.value.filter((column) => {
            const value = getDisplayedCellValue(rowIndex, column.name);
            return !column.isAutoIncrement || value != null;
        });

        if (!insertableColumns.length) {
            return sqlDialect.value === 'mysql' ? `INSERT INTO ${tableIdentifier} () VALUES ();` : `INSERT INTO ${tableIdentifier} DEFAULT VALUES;`;
        }

        const columnSql = insertableColumns.map((column) => quoteSqlIdentifier(column.name, sqlDialect.value)).join(', ');
        const valueSql = insertableColumns.map((column) => formatSqlValue(getDisplayedCellValue(rowIndex, column.name), column.type, sqlDialect.value)).join(', ');

        return `INSERT INTO ${tableIdentifier} (${columnSql}) VALUES (${valueSql});`;
    }

    function buildDeleteStatement(rowIndex: number) {
        const currentTableName = tableName.value;
        const whereClause = buildDeleteCondition(rowIndex);

        if (!currentTableName || !whereClause || getPendingRowState(rowIndex) !== 'deleted' || isInsertedRowIndex(rowIndex)) {
            return undefined;
        }

        const tableIdentifier = quoteSqlIdentifier(currentTableName, sqlDialect.value);
        return `DELETE FROM ${tableIdentifier} WHERE ${whereClause};`;
    }

    function isColumnIntegerLike(columnName: string) {
        const columnType = tableInfo.value?.columns.find((column) => column.name === columnName)?.type?.trim();

        if (columnType) {
            return /(^|[^a-z])(bigint|int|integer|mediumint|smallint|tinyint|serial)([^a-z]|$)/i.test(columnType);
        }

        return (gridState.tableData.rows ?? []).every((row: TableData['rows'][number]) => {
            const value = row[columnName];
            return (
                value == null ||
                typeof value === 'bigint' ||
                (typeof value === 'number' && Number.isInteger(value)) ||
                (typeof value === 'string' && /^[-+]?\d+$/.test(value.trim()))
            );
        });
    }

    function getColumnDisplayType(columnName: string) {
        if (gridFormatters.columnFormatterIds[columnName]) {
            return 'custom';
        }

        const displayType = columnDisplayTypes.value[columnName];
        return displayType === 'custom' ? 'number' : (displayType ?? 'number');
    }

    async function setColumnFormatter(columnName: string, formatterId: string | undefined) {
        const connectionId = options.connectionId();
        const currentTableName = tableName.value;

        if (!connectionId || !currentTableName) {
            return;
        }

        await gridFormatters.assignFormatter({
            connectionId,
            tableName: currentTableName,
            columnName,
            formatterId,
        });
        gridState.updateLayoutState({
            displayTypes: {
                ...gridState.layoutState.displayTypes,
                [columnName]: formatterId ? 'custom' : gridState.layoutState.displayTypes[columnName] === 'custom' ? 'number' : gridState.layoutState.displayTypes[columnName],
            },
        });
    }

    async function saveChanges() {
        const connectionId = options.connectionId();

        if (!connectionId || !tableName.value || !hasPendingGridChanges.value || gridState.isSavingChanges) {
            return;
        }

        const changes = buildPlannedPendingUpdateChanges();
        const insertStatements = overlayTableData.value.rows.map((_, rowIndex) => buildInsertStatement(rowIndex)).filter((statement): statement is string => !!statement);
        const deleteStatements = overlayTableData.value.rows.map((_, rowIndex) => buildDeleteStatement(rowIndex)).filter((statement): statement is string => !!statement);

        gridState.setSavingChanges(true);
        saveErrorMessage.value = undefined;

        try {
            if (changes.length) {
                const result = await tasks.applyTableChanges.run({
                    connectionId,
                    tableName: tableName.value,
                    changes: changes.map((change) => ({
                        targetColumn: change.columnName,
                        value: change.nextValue,
                        matchColumn: change.matchColumn,
                        matchValue: change.matchValue,
                    })),
                    disableForeignKeyChecks: supportsForeignKeyCheckToggle.value && disableForeignKeyChecks.value,
                    limit: gridState.tableData.limit,
                    offset: gridState.tableData.offset,
                } satisfies ApplyTableChangesParams);

                foreignKeyViolations.value = result.foreignKeyViolations;
                isForeignKeyViolationsOpen.value = result.foreignKeyViolations.length > 0;
            } else {
                foreignKeyViolations.value = [];
                isForeignKeyViolationsOpen.value = false;
            }

            for (const statement of insertStatements) {
                await tasks.runQuery.run({ connectionId, sql: statement });
            }

            for (const statement of deleteStatements) {
                await tasks.runQuery.run({ connectionId, sql: statement });
            }

            gridState.clearPendingChanges();
            pendingInsertedRows.value = [];
            pendingDeletedBaseRowIndexes.value = [];
            isPreviewOpen.value = false;

            if (options.onSaved) {
                await options.onSaved();
            } else {
                await query.loadSelectedTable(connectionId, tableName.value);
            }
        } catch (error) {
            // The pending changes stay staged (they are only cleared on success), so the save bar
            // is the place the user finds out why the save did not happen.
            saveErrorMessage.value = error instanceof Error ? error.message : String(error);
        } finally {
            gridState.setSavingChanges(false);
        }
    }

    function buildDeleteCondition(rowIndex: number) {
        const row = gridState.getRow(rowIndex);

        if (!row || !primaryKeyColumns.value.length) {
            return undefined;
        }

        const pkColumnMap = new Map(tableColumns.value.map((col) => [col.name, col]));

        return primaryKeyColumns.value
            .map((columnName) => {
                const value = row[columnName] ?? null;
                const identifier = quoteSqlIdentifier(columnName, sqlDialect.value);
                if (value == null) return `${identifier} IS NULL`;
                const col = pkColumnMap.get(columnName);
                return `${identifier} = ${formatSqlValue(value, col?.type, sqlDialect.value)}`;
            })
            .join(' AND ');
    }

    // Capture original cell-level undo/redo before overriding (extend will
    // overlay dbGridState properties onto gridState, overwriting them).
    const cellUndoChanges = gridState.undoChanges;
    const cellRedoChanges = gridState.redoChanges;

    const dbGridState = reactive({
        closeFkPeekPopover: fkPeek.closeFkPeekPopover,
        columnDisplayTypes: columnDisplayTypes,
        ddlText: ddlText,
        isDdlModalOpen: isDdlModalOpen,
        disableForeignKeyChecks: disableForeignKeyChecks,
        isAddRowDialogOpen: isAddRowDialogOpen,
        addRowDialogValues: addRowDialogValues,
        isEditRowDialogOpen: isEditRowDialogOpen,
        editRowDialogRowIndex: editRowDialogRowIndex,
        openAddRowDialog: () => {
            if (!tableName.value || gridState.isTransposed) return;
            addRowDialogValues.value = {};
            isAddRowDialogOpen.value = true;
        },
        openDuplicateRowDialog: (rowValues: Record<string, SqlValue>) => {
            if (!tableName.value || gridState.isTransposed) return;
            addRowDialogValues.value = { ...rowValues };
            isAddRowDialogOpen.value = true;
        },
        openEditRowDialog: (rowIndex: number) => {
            if (!tableName.value || gridState.isTransposed) return;
            editRowDialogRowIndex.value = rowIndex;
            const row = gridState.getRow(rowIndex);
            if (row) {
                addRowDialogValues.value = { ...row } as Record<string, SqlValue>;
            }
            isEditRowDialogOpen.value = true;
        },
        closeAddRowDialog: () => {
            isAddRowDialogOpen.value = false;
        },
        closeEditRowDialog: () => {
            isEditRowDialogOpen.value = false;
            editRowDialogRowIndex.value = -1;
        },
        commitAddRow: (values: Record<string, SqlValue>) => {
            if (!tableName.value) return;
            const nextRow = Object.fromEntries(tableColumns.value.map((col) => [col.name, values[col.name] ?? null])) as Record<string, SqlValue>;
            pendingInsertedRows.value = [...pendingInsertedRows.value, { values: nextRow, isDiscarded: false }];
            isAddRowDialogOpen.value = false;
            gridState.clearSelectedColumn();
            gridState.clearSelectedCellRange();
        },
        commitEditRow: (values: Record<string, SqlValue>) => {
            const rowIndex = editRowDialogRowIndex.value;
            if (rowIndex < 0 || gridState.isTransposed) return;
            const row = gridState.getRow(rowIndex);
            if (!row) return;
            for (const col of tableColumns.value) {
                const newValue = values[col.name];
                const oldValue = row[col.name];
                if (newValue !== oldValue) {
                    const colIndex = gridState.getColumnIndex(col.name);
                    if (colIndex >= 0) {
                        gridState.startEditingCell(rowIndex, colIndex);
                        gridState.setEditingValue(String(newValue ?? ''));
                        gridState.commitEditingCell();
                    }
                }
            }
            isEditRowDialogOpen.value = false;
            editRowDialogRowIndex.value = -1;
        },
        canUndo: computed(() => gridState.dirtyChanges.length > 0 || pendingRowUndoStack.value.length > 0),
        canRedo: computed(() => pendingRowRedoStack.value.length > 0),
        undoChanges: () => {
            saveErrorMessage.value = undefined;

            // Prefer undoing row-level changes first (most recent user action).
            if (pendingRowUndoStack.value.length > 0) {
                const snapshot = pendingRowUndoStack.value.at(-1)!;
                pendingRowRedoStack.value = [
                    ...pendingRowRedoStack.value,
                    {
                        deletedRows: [...pendingDeletedBaseRowIndexes.value],
                        insertedRows: pendingInsertedRows.value.map((row) => ({ ...row, values: { ...row.values } })),
                    },
                ];
                pendingRowUndoStack.value = pendingRowUndoStack.value.slice(0, -1);
                pendingDeletedBaseRowIndexes.value = snapshot.deletedRows;
                pendingInsertedRows.value = snapshot.insertedRows;
                return;
            }

            cellUndoChanges();
        },
        redoChanges: () => {
            saveErrorMessage.value = undefined;

            if (pendingRowRedoStack.value.length > 0) {
                const snapshot = pendingRowRedoStack.value.at(-1)!;
                pendingRowUndoStack.value = [
                    ...pendingRowUndoStack.value,
                    {
                        deletedRows: [...pendingDeletedBaseRowIndexes.value],
                        insertedRows: pendingInsertedRows.value.map((row) => ({ ...row, values: { ...row.values } })),
                    },
                ];
                pendingRowRedoStack.value = pendingRowRedoStack.value.slice(0, -1);
                pendingDeletedBaseRowIndexes.value = snapshot.deletedRows;
                pendingInsertedRows.value = snapshot.insertedRows;
                return;
            }

            cellRedoChanges();
        },
        /** Discards all pending changes and clears undo/redo stacks. */
        clearChanges: () => {
            saveErrorMessage.value = undefined;
            gridState.clearHistory();
            gridState.clearPendingChanges();
            pendingRowUndoStack.value = [];
            pendingRowRedoStack.value = [];
            pendingInsertedRows.value = [];
            pendingDeletedBaseRowIndexes.value = [];
            isPreviewOpen.value = false;
            foreignKeyViolations.value = [];
            isForeignKeyViolationsOpen.value = false;
        },
        fkPeekPopover: fkPeek.fkPeekPopover,
        foreignKeyViolations: foreignKeyViolations,
        gridFormatters: gridFormatters,
        hasPendingChanges: hasPendingGridChanges,
        getColumnEditorInitialRows: (columnName: string) => getColumnEditorInitialRows(tableColumnByName.value.get(columnName)),
        isForeignKeyViolationsOpen: isForeignKeyViolationsOpen,
        isPreviewOpen: isPreviewOpen,
        openPreview: () => {
            if (hasPendingGridChanges.value) {
                isPreviewOpen.value = true;
            }
        },
        pendingChangeCount: computed(() => pendingUpdateChanges.value.length + pendingRowChangeCount.value),
        previewQueries: computed(() => {
            const updateQueries = buildPlannedPendingUpdateChanges().map((change) => {
                if (!tableName.value) {
                    return '';
                }

                return [
                    `UPDATE ${quoteSqlIdentifier(tableName.value, sqlDialect.value)}`,
                    `SET ${quoteSqlIdentifier(change.columnName, sqlDialect.value)} = ${formatValue(change.nextValue, { mode: 'sql', dialect: sqlDialect.value })}`,
                    `WHERE ${quoteSqlIdentifier(change.matchColumn, sqlDialect.value)} = ${formatValue(change.matchValue, { mode: 'sql', dialect: sqlDialect.value })};`,
                ].join(' ');
            });
            const insertQueries = overlayTableData.value.rows.map((_, rowIndex) => buildInsertStatement(rowIndex)).filter((statement): statement is string => !!statement);
            const deleteQueries = overlayTableData.value.rows.map((_, rowIndex) => buildDeleteStatement(rowIndex)).filter((statement): statement is string => !!statement);
            const discardQueries = pendingInsertedRows.value.map((row, index) => (row.isDiscarded ? `-- Discard pending new row ${index + 1}` : '')).filter(Boolean);

            return [...insertQueries, ...updateQueries, ...deleteQueries, ...discardQueries];
        }),
        saveButtonLabel: computed(() => {
            if (gridState.isSavingChanges) {
                return 'Saving...';
            }

            const pendingCount = pendingUpdateChanges.value.length + pendingRowChangeCount.value;

            if (!pendingCount) {
                return 'Save';
            }

            return pendingCount === 1 ? 'Save 1 change' : `Save ${pendingCount} changes`;
        }),
        saveChanges: saveChanges,
        saveErrorMessage: saveErrorMessage,
        setDisableForeignKeyChecks: (value: boolean) => (disableForeignKeyChecks.value = value),
        supportsForeignKeyCheckToggle: supportsForeignKeyCheckToggle,
    });

    return gridState.extend(dbGridState);
}
