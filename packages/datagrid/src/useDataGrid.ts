import { DEFAULT_DATA_GRID_FONT_FAMILY, DEFAULT_DATA_GRID_SHOW_ROW_NUMBERS, resolveDataGridTheme, type DataGridFontFamily } from '@datagrid/dataGridAppearance';
import { createDataGridClipboard } from '@datagrid/useDataGridClipboard';
import { compareGridValues, formatDefaultValue, gridValuesEqual } from '@datagrid/useDataGridCoreUtils';
import { createDataGridMenus } from '@datagrid/useDataGridMenus';
import { createDataGridNavigation } from '@datagrid/useDataGridNavigation';
import {
    fillMissionOptions,
    normalizeGridLayoutState,
    UseDataGridFinalOptions,
    type DataGridCellChange,
    type DataGridModalEditingCell,
    type DataGridPendingChange,
    type DataGridResolvedCell,
    type DataGridRow,
    type GridLayoutState,
    type TableData,
    type UseDataGridOptions,
} from '@datagrid/useDataGridTypes';
import { useDataGridView } from '@datagrid/useDataGridView';
import { useCache } from '@utils/useCache';
import { useContextMenu } from '@directives/useContextMenu';
import { formatValue } from '@utils/valueFormatting';
import { computed, reactive, toRaw, toRef, unref, watch } from 'vue';

export { normalizeGridLayoutState } from '@datagrid/useDataGridTypes';
export type { DataGridCellContext, DataGridCellValue, DataGridRow, GridDisplayType, GridLayoutState, MaybeReactiveValue, TableData } from '@datagrid/useDataGridTypes';

type DataGridSearchMatch = {
    rowIndex: number;
    columnIndex: number;
};

export type TDataGridState<TExtra extends object = {}> = ReturnType<typeof useDataGrid> & TExtra;
export type DataGridInternalState = ReturnType<typeof createInternalState>;
export type DataGridTransposedState = ReturnType<typeof createTransposedState>;

export const getCellKey = (rowIndex: number, columnName: string) => `${rowIndex}:${columnName}`;
function createInternalState(options: UseDataGridFinalOptions) {
    function createInitialGridLayoutState(): GridLayoutState {
        return {
            columnsOrderDirection: undefined,
            columnOrder: [],
            columnWidths: {},
            hiddenColumns: [],
            displayTypes: {},
            sort: null,
            fontFamily: DEFAULT_DATA_GRID_FONT_FAMILY,
            showRowNumbers: DEFAULT_DATA_GRID_SHOW_ROW_NUMBERS,
        };
    }
    const tableData = computed<TableData>(() => {
        const resolvedTableData = unref(options.tableData);

        return {
            columns: resolvedTableData?.columns ?? [],
            columnStats: resolvedTableData?.columnStats ?? {},
            rows: resolvedTableData?.rows ?? [],
            rowCount: resolvedTableData?.rowCount ?? resolvedTableData?.rows?.length ?? 0,
            limit: resolvedTableData?.limit,
            offset: resolvedTableData?.offset,
        };
    });
    const layoutState = useCache<GridLayoutState>({
        key: computed(() => unref(options.layoutStorageKey)),
        initialValue: createInitialGridLayoutState,
    });
    const normalizedLayoutState = computed(() => normalizeGridLayoutState(layoutState.state.value));
    const tableDataColumns = computed(() => tableData.value.columns);
    const tableDataColumnSet = computed(() => new Set(tableDataColumns.value));
    const sourceHiddenColumns = computed(() => normalizedLayoutState.value.hiddenColumns.filter((columnName: string) => tableDataColumnSet.value.has(columnName)));
    const sourceOrderedColumns = computed(() => {
        const ordered: string[] = [];
        const included = new Set<string>();

        for (const columnName of normalizedLayoutState.value.columnOrder) {
            if (!tableDataColumnSet.value.has(columnName) || included.has(columnName)) {
                continue;
            }

            ordered.push(columnName);
            included.add(columnName);
        }

        for (const columnName of tableDataColumns.value) {
            if (included.has(columnName)) {
                continue;
            }

            ordered.push(columnName);
            included.add(columnName);
        }

        if (!sourceHiddenColumns.value.length) {
            return ordered;
        }

        const hiddenColumns = new Set(sourceHiddenColumns.value);
        return ordered.filter((columnName) => !hiddenColumns.has(columnName));
    });

    const state = reactive({
        gridElement: undefined as undefined | HTMLElement,
        tableElement: undefined as undefined | HTMLElement,
        activeCell: { rowIndex: 0, columnIndex: 0 },
        editingCell: { rowIndex: -1, columnIndex: -1, draftValue: '' },
        modalEditingCell: { open: false, rowIndex: -1, columnIndex: -1, draftValue: '' } as DataGridModalEditingCell,
        selectedRowIndexes: unref(options.selectedRowIndexes) ?? [],
        selectedCellRange: unref(options.selectedCellRange),
        selectedColumnName: unref(options.selectedColumnName),
        isColumnListOpen: unref(options.isColumnListOpen) ?? false,
        undoStack: [] as DataGridCellChange[],
        redoStack: [] as DataGridCellChange[],
        pendingChanges: {} as Record<string, DataGridPendingChange>,
        savedCellKeys: [] as string[],
        savedRowIndexes: [] as number[],
        isSavingChanges: false,
        activeCellScrollAlign: 'nearest' as 'nearest' | 'center',
        searchQuery: '',
        get normalizedSearchQuery() {
            return state.searchQuery.trim().toLocaleLowerCase();
        },
        isTransposed: options.transposeState ?? false,
        transposeLabelColumnName: computed(() => unref(options.transposeLabelColumnName) ?? 'Column'),
        sqlInsertTableName: computed(() => unref(options.sqlInsertTableName)?.trim() || undefined),
        sqlInsertDialect: computed(() => unref(options.sqlInsertDialect) ?? 'sqlite'),
        primaryKeyColumns: computed(() => unref(options.primaryKeyColumns) ?? []),
        toolbarCopyAsCustomItems: computed(() => unref(options.toolbarCopyAsCustomItems) ?? []),
        theme: computed(() => resolveDataGridTheme(unref(options.theme))),

        tableData: tableData,
        layoutStateCache: layoutState.state,
        normalizedLayoutState: normalizedLayoutState,
        gridFontFamily: computed(() => normalizedLayoutState.value.fontFamily),
        showRowNumbers: computed(() => normalizedLayoutState.value.showRowNumbers),
        sourceRows: computed(() => tableData.value.rows),
        sourceColumns: tableDataColumns,

        sourceHiddenColumns: sourceHiddenColumns,
        sourceOrderedColumns: sourceOrderedColumns,

        transposeTooltip: computed(() => unref(options.transposeTooltip) ?? 'Transpose grid'),
        emptyText: computed((): string | undefined => {
            return state.normalizedSearchQuery ? 'No matching rows.' : unref(options.emptyText);
        }),
        renderVersion: computed((): string => {
            return `${unref(options.renderVersion) ?? 0}:${options.enableTranspose ? (state.isTransposed ? 't' : 'n') : 'static'}`;
        }),
        dirtyChanges: computed((): DataGridCellChange[] => {
            return Object.values(state.pendingChanges);
        }),
        hasPendingChanges: computed((): boolean => {
            return state.dirtyChanges.length > 0;
        }),
    });

    return state;
}

function createTransposedState(options: UseDataGridFinalOptions, _state: DataGridInternalState) {
    const _isTransposed = computed(() => options.enableTranspose && _state.isTransposed);
    const _getRawCellValue = (rowIndex: number, columnName: string) => _state.sourceRows[rowIndex]?.[columnName] ?? null;

    const transposeColumnEntries = computed(() =>
        _state.sourceRows
            .map((_: DataGridRow, rowIndex: number) => ({
                rowIndex,
                columnName: options.getTransposeColumnName(rowIndex, _state.sourceRows.length),
            }))
            .filter(({ rowIndex }) =>
                _state.sourceOrderedColumns.some((columnName: string) => {
                    const pendingValue = _state.pendingChanges[getCellKey(rowIndex, columnName)]?.nextValue;
                    return (pendingValue ?? _getRawCellValue(rowIndex, columnName)) != null;
                })
            )
    );
    function _getSourceCellValue(rowIndex: number, columnName: string) {
        if (options.getSourceCellValue) return options.getSourceCellValue(rowIndex, columnName);

        return _state.pendingChanges[getCellKey(rowIndex, columnName)]?.nextValue ?? _getRawCellValue(rowIndex, columnName);
    }

    const allColumns = computed(() => {
        if (!_isTransposed.value) {
            return _state.sourceColumns;
        }

        return [_state.transposeLabelColumnName, ...transposeColumnEntries.value.map((t) => t.columnName)];
    });
    const allColumnsSet = computed(() => new Set(allColumns.value));
    const orderedColumns = computed(() => {
        if (_isTransposed.value) {
            return allColumns.value;
        }

        return _state.sourceOrderedColumns;
    });
    const hiddenColumns = computed(() => _state.normalizedLayoutState.hiddenColumns.filter((columnName: string) => allColumnsSet.value.has(columnName)));
    const transposeRowIndexByColumnName = computed(
        () =>
            new Map<string, number>(
                _state.sourceRows.map((_: DataGridRow, rowIndex: number) => [options.getTransposeColumnName(rowIndex, _state.sourceRows.length), rowIndex] as const)
            )
    );
    const rows = computed(() => {
        if (!_isTransposed.value) {
            return _state.sourceRows;
        }

        return _state.sourceOrderedColumns.map((columnName: string) => {
            const nextRow: DataGridRow = {
                [_state.transposeLabelColumnName]: columnName,
            };

            transposeColumnEntries.value.forEach(({ rowIndex, columnName: transposeColumnName }) => {
                nextRow[transposeColumnName] = _getSourceCellValue(rowIndex, columnName) ?? null;
            });

            return nextRow;
        });
    });
    const columnWidths = computed(() => {
        const widths: Record<string, number> = {};

        for (const columnName of orderedColumns.value) {
            const width = _state.normalizedLayoutState.columnWidths[columnName];

            if (typeof width === 'number' && Number.isFinite(width)) {
                widths[columnName] = width;
            }
        }

        return widths;
    });

    const state = reactive({
        allColumns: allColumns,
        orderedColumns: orderedColumns,
        hiddenColumns: hiddenColumns,

        get sortState() {
            if (_isTransposed.value) {
                return null;
            }

            const currentSort = _state.normalizedLayoutState.sort;

            if (!currentSort || !allColumns.value.includes(currentSort.columnName)) {
                return null;
            }

            return currentSort;
        },
        getColumnName(columnIndex: number) {
            return state.orderedColumns[columnIndex];
        },

        getColumnIndex(columnName: string) {
            return state.orderedColumns.indexOf(columnName);
        },
        transposeRowIndexByColumnName: transposeRowIndexByColumnName,

        rows: rows,

        getSourceColumnNameForRow(rowIndex: number) {
            if (!_isTransposed.value) {
                return undefined;
            }

            return _state.sourceOrderedColumns[rowIndex];
        },

        getSourceColumnNameForColumn(columnIndex: number) {
            if (_isTransposed.value) {
                return undefined;
            }

            return state.orderedColumns[columnIndex];
        },

        columnWidths: columnWidths,
        resolveCell(rowIndex: number, columnName: string): DataGridResolvedCell {
            if (!options.enableTranspose || !_state.isTransposed) {
                return {
                    editable: options.editable,
                    sourceRowIndex: rowIndex,
                    sourceColumnName: columnName,
                    value: _getSourceCellValue(rowIndex, columnName),
                };
            }

            const sourceColumnName = state.getSourceColumnNameForRow(rowIndex);

            if (columnName === _state.transposeLabelColumnName) {
                return {
                    editable: false,
                    sourceRowIndex: -1,
                    sourceColumnName,
                    value: sourceColumnName,
                };
            }

            const sourceRowIndex: number = state.transposeRowIndexByColumnName.get(columnName) ?? -1;

            if (sourceRowIndex < 0 || !sourceColumnName) {
                return {
                    editable: false,
                    sourceRowIndex,
                    sourceColumnName,
                    value: null,
                };
            }

            return {
                editable: options.editable,
                sourceRowIndex,
                sourceColumnName,
                value: _getSourceCellValue(sourceRowIndex, sourceColumnName),
            };
        },
        getDisplayedCellValue(rowIndex: number, columnName: string) {
            if (options.getDisplayedCellValue) return options.getDisplayedCellValue(rowIndex, columnName);
            return state.resolveCell(rowIndex, columnName).value;
        },
        get baseSortedRowIndexes() {
            if (options.enableTranspose && _state.isTransposed) {
                return state.rows.map((_: DataGridRow, index: number) => index);
            }

            const explicitSortedRowIndexes = unref(options.sortedRowIndexes);

            if (explicitSortedRowIndexes?.length || (explicitSortedRowIndexes && state.rows.length === 0)) {
                return explicitSortedRowIndexes;
            }

            const rowIndexes = state.rows.map((_: DataGridRow, index: number) => index);
            const currentSort = state.sortState;

            if (!currentSort) {
                return rowIndexes;
            }

            return [...rowIndexes].sort((leftRowIndex, rightRowIndex) => {
                const comparison = compareGridValues(
                    state.getDisplayedCellValue(leftRowIndex, currentSort.columnName),
                    state.getDisplayedCellValue(rightRowIndex, currentSort.columnName)
                );
                return comparison === 0 ? leftRowIndex - rightRowIndex : currentSort.direction === 'asc' ? comparison : comparison * -1;
            });
        },
    });

    return state;
}

export function useDataGrid(_options: UseDataGridOptions) {
    const options = fillMissionOptions(_options);
    const contextMenu = useContextMenu();
    const baseState = createInternalState(options);
    const transposedState = createTransposedState(options, baseState);

    const syncOption = <TValue>(source: (() => TValue) | undefined, apply: (value: TValue) => void, watchOptions?: { immediate?: boolean; deep?: boolean }) => {
        if (!source) {
            return;
        }

        watch(source, apply, watchOptions);
    };

    syncOption(
        options.selectedRowIndexes === undefined ? undefined : () => unref(options.selectedRowIndexes),
        (value) => {
            baseState.selectedRowIndexes = value ?? [];
        },
        { deep: true, immediate: true }
    );

    syncOption(
        options.selectedCellRange === undefined ? undefined : () => unref(options.selectedCellRange),
        (value) => {
            baseState.selectedCellRange = value;
        },
        { deep: true, immediate: true }
    );

    syncOption(
        options.selectedColumnName === undefined ? undefined : () => unref(options.selectedColumnName),
        (value) => {
            baseState.selectedColumnName = value;
        },
        { immediate: true }
    );

    syncOption(
        options.isColumnListOpen === undefined ? undefined : () => unref(options.isColumnListOpen),
        (value) => {
            baseState.isColumnListOpen = value ?? false;
        },
        { immediate: true }
    );

    const getRow = (rowIndex: number) => baseState.sourceRows[rowIndex];
    const getRawCellValue = (rowIndex: number, columnName: string) => getRow(rowIndex)?.[columnName] ?? null;

    const getFormattedCellValue =
        options.getFormattedCellValue ?? ((rowIndex: number, columnName: string) => formatDefaultValue(transposedState.getDisplayedCellValue(rowIndex, columnName)));

    const searchMatches = computed<DataGridSearchMatch[]>(() => {
        const query = baseState.normalizedSearchQuery;

        if (!query) {
            return [];
        }

        const matches: DataGridSearchMatch[] = [];

        for (const rowIndex of transposedState.baseSortedRowIndexes) {
            for (let columnIndex = 0; columnIndex < transposedState.orderedColumns.length; columnIndex += 1) {
                const columnName = transposedState.orderedColumns[columnIndex];

                if (!columnName) {
                    continue;
                }

                const text = getFormattedCellValue(rowIndex, columnName).toLocaleLowerCase();

                if (!text.includes(query)) {
                    continue;
                }

                matches.push({ rowIndex, columnIndex });
            }
        }

        return matches;
    });
    const sortedRowIndexes = computed(() => {
        if (!baseState.normalizedSearchQuery) {
            return transposedState.baseSortedRowIndexes;
        }

        return Array.from(new Set(searchMatches.value.map((match) => match.rowIndex)));
    });
    const activeSearchMatchIndex = computed(() => {
        if (!searchMatches.value.length) {
            return -1;
        }

        return searchMatches.value.findIndex((match) => match.rowIndex === baseState.activeCell.rowIndex && match.columnIndex === baseState.activeCell.columnIndex);
    });
    const columnValueLengths = computed(() => {
        if (!options.enableTranspose || !baseState.isTransposed) {
            return unref(baseState.tableData.columnStats) ?? {};
        }

        return Object.fromEntries(
            transposedState.allColumns.map((columnName: string) => [
                columnName,
                transposedState.rows.reduce(
                    (maxLength: number, row: DataGridRow) => Math.max(maxLength, formatValue(row[columnName], { functionMode: 'name' }).length),
                    columnName.length
                ),
            ])
        );
    });

    function clearHistory() {
        baseState.undoStack = [];
        baseState.redoStack = [];
    }

    function clearPendingChanges() {
        baseState.pendingChanges = {};
    }

    function clearSavedChanges() {
        baseState.savedCellKeys = [];
        baseState.savedRowIndexes = [];
    }

    function setSavingChanges(value: boolean) {
        baseState.isSavingChanges = value;
    }

    function markSavedChanges(changes: Array<Pick<DataGridCellChange, 'rowIndex' | 'columnName'>>) {
        baseState.savedCellKeys = changes.map((change) => getCellKey(change.rowIndex, change.columnName));
        baseState.savedRowIndexes = [...new Set(changes.map((change) => change.rowIndex))];
    }

    function applyCellChange(change: DataGridCellChange, historyOptions?: { trackHistory?: boolean; clearRedo?: boolean }) {
        if (gridValuesEqual(change.previousValue, change.nextValue)) {
            return;
        }

        if (options.createPendingChange) {
            const rawValue = getRawCellValue(change.rowIndex, change.columnName);
            const changeKey = getCellKey(change.rowIndex, change.columnName);

            clearSavedChanges();

            if (gridValuesEqual(change.nextValue, rawValue)) {
                const { [changeKey]: _, ...rest } = baseState.pendingChanges;
                baseState.pendingChanges = rest;
            } else {
                baseState.pendingChanges = {
                    ...baseState.pendingChanges,
                    [changeKey]: options.createPendingChange({
                        ...change,
                        previousValue: rawValue,
                        rawValue,
                    }),
                };
            }
        }

        if (options.setSourceCellValue) {
            options.setSourceCellValue(change.rowIndex, change.columnName, change.nextValue, change.previousValue);
        } else if (!options.createPendingChange) {
            const sourceRow = baseState.tableData.rows[change.rowIndex];

            if (sourceRow) {
                sourceRow[change.columnName] = change.nextValue;
            }
        }

        if (historyOptions?.trackHistory) {
            baseState.undoStack = [...baseState.undoStack, change];
        }

        if (historyOptions?.clearRedo ?? historyOptions?.trackHistory) {
            baseState.redoStack = [];
        }
    }

    function undoChanges() {
        const change = baseState.undoStack.at(-1);

        if (!change) {
            return;
        }

        baseState.undoStack = baseState.undoStack.slice(0, -1);
        baseState.redoStack = [...baseState.redoStack, change];
        applyCellChange(
            {
                ...change,
                previousValue: change.nextValue,
                nextValue: change.previousValue,
            },
            { trackHistory: false, clearRedo: false }
        );
    }

    function redoChanges() {
        const change = baseState.redoStack.at(-1);

        if (!change) {
            return;
        }

        baseState.redoStack = baseState.redoStack.slice(0, -1);
        baseState.undoStack = [...baseState.undoStack, change];
        applyCellChange(change, { trackHistory: false, clearRedo: false });
    }

    function updateLayoutState(toUpdate: Partial<GridLayoutState>) {
        baseState.layoutStateCache = {
            ...baseState.layoutStateCache,
            ...toUpdate,
        };
    }

    function setFontFamily(fontFamily: DataGridFontFamily) {
        updateLayoutState({ fontFamily });
    }

    function setShowRowNumbers(show: boolean) {
        updateLayoutState({ showRowNumbers: show });
    }

    const navigation = createDataGridNavigation({
        options: options,
        internalState: baseState,
        transposedState: transposedState,
        applyCellChange: applyCellChange,
        clearHistory: clearHistory,
        clearPendingChanges: clearPendingChanges,
        clearSavedChanges: clearSavedChanges,
        activeSearchMatchIndex: activeSearchMatchIndex,
        searchMatches: searchMatches,
        sortedRowIndexes: sortedRowIndexes,
        updateLayoutState: updateLayoutState,
    });

    watch(
        () => [transposedState.rows.length, transposedState.allColumns.join('|'), transposedState.orderedColumns.join('|')],
        () => {
            navigation.clampViewState();
        },
        { immediate: true }
    );

    const clipboard = createDataGridClipboard({
        internalState: baseState,
        transposedState: transposedState,
        getVisualRowIndexForSourceRowIndex: navigation.getVisualRowIndexForSourceRowIndex,
        normalizeSelectedCellRange: navigation.normalizeSelectedCellRange,
        sortedRowIndexes: sortedRowIndexes,
    });

    const menus = createDataGridMenus({
        options: options,
        internalState: baseState,
        transposedState: transposedState,
        navigation: navigation,
        clipboard: clipboard,

        contextMenu: contextMenu,

        redoChanges: redoChanges,
        undoChanges: undoChanges,
        updateLayoutState: updateLayoutState,
    });

    function extend<TNextExtra extends object>(extra: TNextExtra): TDataGridState<TNextExtra> {
        Object.defineProperties(toRaw(state), Object.getOwnPropertyDescriptors(toRaw(extra)));
        return state as TDataGridState<TNextExtra>;
    }

    const state = reactive({
        tableData: computed(() => baseState.tableData),
        layoutState: computed(() => baseState.normalizedLayoutState),
        rows: computed(() => transposedState.rows),
        allColumns: computed(() => transposedState.allColumns),
        orderedColumns: computed(() => transposedState.orderedColumns ?? []),
        sortedRowIndexes: sortedRowIndexes,
        gridElement: computed(() => baseState.gridElement),
        tableElement: computed(() => baseState.tableElement),
        columnWidths: computed(() => transposedState.columnWidths),
        hiddenColumns: computed(() => transposedState.hiddenColumns),
        columnValueLengths: columnValueLengths,
        emptyText: computed(() => baseState.emptyText),
        renderVersion: computed(() => baseState.renderVersion),
        activeCell: computed(() => baseState.activeCell),
        editingCell: computed(() => baseState.editingCell),
        modalEditingCell: computed(() => baseState.modalEditingCell),
        selectedRowIndexes: computed(() => baseState.selectedRowIndexes),
        selectedCellRange: computed(() => baseState.selectedCellRange),
        selectedColumnName: computed(() => baseState.selectedColumnName),
        isColumnListOpen: computed(() => baseState.isColumnListOpen),
        sortState: computed(() => transposedState.sortState),
        gridFontFamily: computed(() => baseState.gridFontFamily),
        theme: computed(() => baseState.theme),
        contextMenu,
        showRowNumbers: computed(() => baseState.showRowNumbers),
        searchable: options.searchable ?? true,
        searchQuery: toRef(baseState, 'searchQuery'),
        searchMatchCount: computed(() => searchMatches.value.length),
        activeSearchMatchIndex: activeSearchMatchIndex,
        canGenerateSqlStatements: computed(
            () => !baseState.isTransposed && !!baseState.sqlInsertTableName && sortedRowIndexes.value.length > 0 && transposedState.orderedColumns.length > 0
        ),
        canUndo: computed(() => baseState.undoStack.length > 0),
        canRedo: computed(() => baseState.redoStack.length > 0),
        pendingChanges: computed(() => baseState.pendingChanges),
        dirtyChanges: computed(() => baseState.dirtyChanges),
        hasPendingChanges: computed(() => baseState.dirtyChanges),
        savedCellKeys: computed(() => baseState.savedCellKeys),
        savedRowIndexes: computed(() => baseState.savedRowIndexes),
        isSavingChanges: computed(() => baseState.isSavingChanges),
        activeCellScrollAlign: computed(() => baseState.activeCellScrollAlign),
        isTransposed: computed(() => baseState.isTransposed),
        toggleTranspose: options.enableTranspose ? menus.toggleTranspose : undefined,
        transposeTooltip: computed(() => baseState.transposeTooltip),
        cellContextMenuCustomItems: options.cellContextMenuCustomItems,
        headerContextMenuCustomItems: options.headerContextMenuCustomItems,
        canAddRow: computed(() => unref(options.canAddRow)),
        addRow: options.addRow,
        canDeleteSelectedRows: computed(() => unref(options.canDeleteSelectedRows)),
        deleteSelectedRows: options.deleteSelectedRows,
        getPendingRowState: options.getPendingRowState,
        editable: options.editable,
        resolveCell: transposedState.resolveCell,
        getRow: getRow,
        getColumnName: transposedState.getColumnName,
        getColumnIndex: transposedState.getColumnIndex,
        getSourceColumnNameForRow: transposedState.getSourceColumnNameForRow,
        getSourceColumnNameForColumn: transposedState.getSourceColumnNameForColumn,
        getSourceRowIndexForVisualRowIndex: navigation.getSourceRowIndexForVisualRowIndex,
        getVisualRowIndexForSourceRowIndex: navigation.getVisualRowIndexForSourceRowIndex,
        getDisplayedCellValue: transposedState.getDisplayedCellValue,
        getFormattedCellValue: getFormattedCellValue,
        updateLayoutState: updateLayoutState,
        handleGridKeydown: menus.handleGridKeydown,
        openCellContextMenu: menus.openCellContextMenu,
        openHeaderContextMenu: menus.openHeaderContextMenu,
        undoChanges: undoChanges,
        redoChanges: redoChanges,
        clearPendingChanges: clearPendingChanges,
        clearSavedChanges: clearSavedChanges,
        setSavingChanges: setSavingChanges,
        markSavedChanges: markSavedChanges,
        resetViewState: navigation.resetViewState,
        commitEditingCell: navigation.commitEditingCell,
        commitEditingCellAndContinue: navigation.commitEditingCellAndContinue,
        commitModalEditingCell: navigation.commitModalEditingCell,
        cancelEditingCell: navigation.cancelEditingCell,
        closeModalEditingCell: navigation.closeModalEditingCell,
        openModalEditingCell: navigation.openModalEditingCell,
        startEditingCell: navigation.startEditingCell,
        setEditingValue: navigation.setEditingValue,
        setModalEditingValue: navigation.setModalEditingValue,
        setGridElement: menus.setGridElement,
        setTableElement: menus.setTableElement,
        setActiveCell: navigation.setActiveCell,
        selectAllRows: navigation.selectAllRows,
        selectCellRange: navigation.selectCellRange,
        selectRow: navigation.selectRow,
        selectColumn: navigation.selectColumn,
        clearSelectedRows: navigation.clearSelectedRows,
        clearSelectedColumn: navigation.clearSelectedColumn,
        clearSelectedCellRange: navigation.clearSelectedCellRange,
        isSelectedRow: navigation.isSelectedRow,
        isSelectedColumn: navigation.isSelectedColumn,
        isSelectedCell: navigation.isSelectedCell,
        areAllRowsSelected: navigation.areAllRowsSelected,
        isActiveCell: navigation.isActiveCell,
        isEditingCell: navigation.isEditingCell,
        isDirtyCell: menus.isDirtyCell,
        isDirtyRow: menus.isDirtyRow,
        isSavedCell: menus.isSavedCell,
        isSavedRow: menus.isSavedRow,
        reorderColumnsAlphabetically: navigation.reorderColumnsAlphabetically,
        reorderColumns: navigation.reorderColumns,
        clearColumnReordering: navigation.clearColumnReordering,
        setColumnWidth: navigation.setColumnWidth,
        clearColumnWidth: navigation.clearColumnWidth,
        hideColumn: navigation.hideColumn,
        showColumn: navigation.showColumn,
        showAllColumns: navigation.showAllColumns,
        openColumnList: navigation.openColumnList,
        closeColumnList: navigation.closeColumnList,
        setSearchQuery: navigation.setSearchQuery,
        goToNextSearchMatch: navigation.goToNextSearchMatch,
        goToPreviousSearchMatch: navigation.goToPreviousSearchMatch,
        copyAllCellsAsJson: clipboard.copyAllCellsAsJson,
        copyAllCellsAsCsv: clipboard.copyAllCellsAsCsv,
        copyAllCellsAsSql: clipboard.copyAllCellsAsSql,
        copyAllCellsAsSqlInsert: clipboard.copyAllCellsAsSqlInsert,
        copyAllCellsAsSqlSelect: clipboard.copyAllCellsAsSqlSelect,
        toggleSort: menus.toggleSort,
        setFontFamily: setFontFamily,
        setShowRowNumbers: setShowRowNumbers,
        extend: extend,
        toGridViewState: (hasToolbar: boolean, withCheckboxes: boolean) => useDataGridView(state, hasToolbar, withCheckboxes),
    });

    return state;
}
