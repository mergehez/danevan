import { useConnections } from '@composables/useConnections';
import { copyTableAsDdl } from '@composables/useCopyTableDdl';
import { useForeignKeyPeek, type FkPeekRelation } from '@composables/useForeignKeyPeek';
import { useGridFormatters } from '@composables/useGridFormatters';
import { useQuery } from '@composables/useQuery';
import { useServers } from '@composables/useServers';
import { tasks } from '@composables/useTasks';
import { useDataGrid, type DataGridCellValue, type GridDisplayType, type PendingRowState, type TableData } from '@datagrid/index';
import type { ContextMenuEntry } from '@directives/contextMenuTypes';
import type { ApplyTableChangesParams, GridCustomFormatter, SqlValue, TableInfo } from '@utils/appClient';
import { quoteSqlIdentifier } from '@utils/sqlIdentifiers';
import { formatValue } from '@utils/valueFormatting';
import { computed, reactive, ref, watch } from 'vue';

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
    onPeekRelation?: (params: {
        connectionId: number;
        rowIndex: number;
        columnIndex: number;
        columnName: string;
        relation: FkPeekRelation;
        value: SqlValue;
        event: MouseEvent;
    }) => void | Promise<void>;
    onPeekUsages?: (params: {
        connectionId: number;
        tableName: string;
        columnName: string;
        value: SqlValue;
        rowValues: Record<string, SqlValue>;
        event: MouseEvent;
    }) => void | Promise<void>;
    onSaved?: () => void;
    tableData: () => TableData;
    tableInfo: () => TableInfo | undefined;
    tableName: () => string | undefined;
};

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
    void gridFormatters.loadFormatters();

    const fkPeek = useForeignKeyPeek({
        connectionId: computed(() => options.connectionId()),
        tableInfo: tableInfo,
        sqlDialect: sqlDialect,
        getDisplayedCellValue: (rowIndex, columnName) => getDisplayedCellValue(rowIndex, columnName),
    });
    const gridState = useDataGrid({
        layoutStorageKey: computed(() => {
            const connectionId = options.connectionId();
            const currentTableName = options.tableName();

            if (!connectionId || !currentTableName) {
                return undefined;
            }

            return `data-grid-layout:${connectionId}:${currentTableName}`;
        }),
        editable: true,
        tableData: overlayTableData,
        emptyText: computed(() => options.emptyText?.()),
        sqlInsertTableName: tableName,
        sqlInsertDialect: sqlDialect,
        toolbarCopyAsCustomItems: computed(() => {
            const connectionId = options.connectionId();
            const currentTableName = tableName.value;

            if (!connectionId || !currentTableName) {
                return [];
            }

            return [
                {
                    id: 'toolbar-copy-all-as-ddl',
                    label: 'As DDL',
                    action: async () => copyTableAsDdl(connectionId, currentTableName, sqlDialect.value),
                } satisfies ContextMenuEntry,
            ];
        }),
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
        cellContextMenuCustomItems: (context) => {
            const items: ContextMenuEntry[] = [];
            const relation = fkPeek.getFkPeekRelation(context.columnName);
            const connectionId = options.connectionId();
            const currentTableName = tableName.value;
            const value = getDisplayedCellValue(context.rowIndex, context.columnName);
            const column = tableColumnByName.value.get(context.columnName);

            if (relation) {
                items.push({
                    id: 'peek-relation',
                    label: 'Peek Relation',
                    action: async () => {
                        if (connectionId && options.onPeekRelation) {
                            await options.onPeekRelation({
                                connectionId,
                                rowIndex: context.rowIndex,
                                columnIndex: context.columnIndex,
                                columnName: context.columnName,
                                relation,
                                value,
                                event: context.event,
                            });
                            return;
                        }

                        await fkPeek.openFkPeek(context.rowIndex, gridState.getColumnName(context.columnIndex), context.event);
                    },
                } satisfies ContextMenuEntry);
            }

            if (column?.isPrimaryKey && value != null && connectionId && currentTableName && options.onPeekUsages) {
                items.push({
                    id: 'peek-usages',
                    label: 'Peek Usages',
                    action: async () => {
                        console.log('[useDbDataGrid] Peek Usages action', {
                            connectionId,
                            tableName: currentTableName,
                            columnName: context.columnName,
                            rowIndex: context.rowIndex,
                            value,
                        });
                        await options.onPeekUsages?.({
                            connectionId,
                            tableName: currentTableName,
                            columnName: context.columnName,
                            value,
                            rowValues: Object.fromEntries(tableColumns.value.map((tableColumn) => [tableColumn.name, getDisplayedCellValue(context.rowIndex, tableColumn.name)])),
                            event: context.event,
                        });
                    },
                } satisfies ContextMenuEntry);
            }

            return items;
        },
        canUseTimestampDisplayTypes: isColumnIntegerLike,
        getColumnDisplayType: getColumnDisplayType,
        headerContextMenuCustomItems: (context) =>
            ((): ContextMenuEntry[] => {
                const columnName: string = context.columnName;
                const isIntegerColumn = isColumnIntegerLike(columnName);
                const assignedFormatterId = gridFormatters.columnFormatterIds[columnName];

                return [
                    ...(isIntegerColumn
                        ? []
                        : [
                              {
                                  id: 'display-type-custom-default',
                                  label: 'Default',
                                  checked: !assignedFormatterId,
                                  action: () => setColumnFormatter(columnName, undefined),
                              } satisfies ContextMenuEntry,
                          ]),
                    ...gridFormatters.customFormatters.map((formatter: GridCustomFormatter) => ({
                        id: `display-type-custom-${formatter.id}`,
                        label: formatter.name,
                        checked: assignedFormatterId === formatter.id,
                        action: () => setColumnFormatter(columnName, formatter.id),
                    })),
                    {
                        id: 'display-type-custom-manage',
                        label: 'Manage Formatters...',
                        action: () => gridFormatters.openManager(),
                    },
                ];
            })(),
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
            const matchColumn = primaryKeyColumns.value[0] || gridState.allColumns[0];
            const previousValue = coerceSqlValue(rawValue);

            if (!row || !matchColumn) {
                return {
                    rowIndex,
                    columnName,
                    previousValue,
                    nextValue: coerceSqlValue(nextValue),
                    originalValue: previousValue,
                    matchColumn: '',
                    matchValue: null,
                } satisfies PendingCellChange;
            }

            const originalValue = previousValue;
            const matchValue = row[matchColumn] ?? null;

            return {
                rowIndex,
                columnName,
                previousValue,
                nextValue: coerceSqlValue(nextValue),
                originalValue,
                matchColumn,
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

    watch(
        () => [options.connectionId(), tableName.value, sourceTableData.value.rowCount, sourceTableData.value.offset, sourceTableData.value.limit, tableInfo.value?.name],
        () => {
            if (!gridState) {
                return;
            }

            disableForeignKeyChecks.value = false;
            foreignKeyViolations.value = [];
            isForeignKeyViolationsOpen.value = false;
            pendingInsertedRows.value = [];
            pendingDeletedBaseRowIndexes.value = [];
            gridState.resetViewState({ clearColumnList: true, clearHistory: true });
            fkPeek.closeFkPeekPopover();
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

    watch(
        () => [options.connectionId(), tableName.value],
        ([connectionId, currentTableName]) => {
            void gridFormatters.loadContext(connectionId as number | undefined, currentTableName as string | undefined);
        },
        { immediate: true }
    );

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
        const valueSql = insertableColumns.map((column) => formatValue(getDisplayedCellValue(rowIndex, column.name), { mode: 'sql', binaryMode: 'hex' })).join(', ');

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
            await query.loadSelectedTable();
            options.onSaved?.();
        } finally {
            gridState.setSavingChanges(false);
        }
    }

    function buildDeleteCondition(rowIndex: number) {
        const row = gridState.getRow(rowIndex);

        if (!row || !primaryKeyColumns.value.length) {
            return undefined;
        }

        return primaryKeyColumns.value
            .map((columnName) => {
                const value = row[columnName] ?? null;
                const identifier = quoteSqlIdentifier(columnName, sqlDialect.value);
                return value == null ? `${identifier} IS NULL` : `${identifier} = ${formatValue(value, { mode: 'sql', binaryMode: 'hex' })}`;
            })
            .join(' AND ');
    }

    const dbGridState = reactive({
        closeFkPeekPopover: fkPeek.closeFkPeekPopover,
        columnDisplayTypes: columnDisplayTypes,
        disableForeignKeyChecks: disableForeignKeyChecks,
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
                    `SET ${quoteSqlIdentifier(change.columnName, sqlDialect.value)} = ${formatValue(change.nextValue, { mode: 'sql' })}`,
                    `WHERE ${quoteSqlIdentifier(change.matchColumn, sqlDialect.value)} = ${formatValue(change.matchValue, { mode: 'sql' })};`,
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
        setDisableForeignKeyChecks: (value: boolean) => (disableForeignKeyChecks.value = value),
        supportsForeignKeyCheckToggle: supportsForeignKeyCheckToggle,
    });

    return gridState.extend(dbGridState);
}
