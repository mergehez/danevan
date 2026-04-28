import { DATA_GRID_COLUMN_MAX_WIDTH, DATA_GRID_COLUMN_MIN_WIDTH, DATA_GRID_HEADER_HEIGHT, DATA_GRID_ROW_HEIGHT } from '@datagrid/dataGrid';
import { DataGridInternalState, DataGridTransposedState } from '@datagrid/useDataGrid';
import type { DataGridHistoryOptions, DataGridNormalizedCellRange, DataGridSearchMatch, DataGridUpdateLayoutState } from '@datagrid/useDataGridHelperTypes';
import type { DataGridCellChange, DataGridCellFocusOptions, DataGridRowSelectionOptions, GridCellRange, UseDataGridFinalOptions } from '@datagrid/useDataGridTypes';
import { useKeyboardNavigation, type KeyboardNavigationPosition } from '@utils/useKeyboardNavigation';
import { ComputedRef, nextTick } from 'vue';

export interface DataGridNavigationArgs {
    options: UseDataGridFinalOptions;
    internalState: DataGridInternalState;
    transposedState: DataGridTransposedState;
    activeSearchMatchIndex: ComputedRef<number>;
    applyCellChange: (change: DataGridCellChange, historyOptions?: DataGridHistoryOptions) => void;
    clearHistory: () => void;
    clearPendingChanges: () => void;
    clearSavedChanges: () => void;
    searchMatches: ComputedRef<DataGridSearchMatch[]>;
    sortedRowIndexes: ComputedRef<number[]>;
    updateLayoutState: DataGridUpdateLayoutState;
}
export function createDataGridNavigation(args: DataGridNavigationArgs) {
    const { internalState, transposedState: trState, options } = args;
    function getSourceRowIndexForVisualRowIndex(visualRowIndex: number) {
        const rowIndexes = args.sortedRowIndexes.value;

        if (!rowIndexes.length) {
            return undefined;
        }

        const clampedRowIndex = Math.max(0, Math.min(visualRowIndex, rowIndexes.length - 1));
        return rowIndexes[clampedRowIndex];
    }

    function getVisualRowIndexForSourceRowIndex(sourceRowIndex: number) {
        const visualRowIndex = args.sortedRowIndexes.value.indexOf(sourceRowIndex);
        return visualRowIndex >= 0 ? visualRowIndex : Math.max(0, Math.min(sourceRowIndex, Math.max(args.sortedRowIndexes.value.length - 1, 0)));
    }

    function getVisualPosition(position?: { rowIndex: number; columnIndex: number }): KeyboardNavigationPosition {
        if (!position) {
            return {
                rowIndex: getVisualRowIndexForSourceRowIndex(internalState.activeCell.rowIndex),
                columnIndex: internalState.activeCell.columnIndex,
            };
        }

        return {
            rowIndex: getVisualRowIndexForSourceRowIndex(position.rowIndex),
            columnIndex: position.columnIndex,
        };
    }

    function setActiveCellFromVisualPosition(rowIndex: number, columnIndex: number, options?: DataGridCellFocusOptions) {
        const sourceRowIndex = getSourceRowIndexForVisualRowIndex(rowIndex);

        if (sourceRowIndex == null) {
            return;
        }

        setActiveCell(sourceRowIndex, columnIndex, options);
    }

    const keyboardNavigation = useKeyboardNavigation({
        getGrid: () => ({
            rowCount: trState.rows.length,
            columnCount: trState.orderedColumns.length,
        }),
        getPosition: () => getVisualPosition(),
        setActiveCell: setActiveCellFromVisualPosition,
    });

    function focusGrid() {
        internalState.gridElement?.focus({ preventScroll: true });
    }

    function ensureActiveCellRowVisible(rowIndex: number) {
        const element = internalState.gridElement;

        if (!element) {
            return;
        }

        const visualRowIndex = getVisualRowIndexForSourceRowIndex(rowIndex);
        const rowTop = DATA_GRID_HEADER_HEIGHT + visualRowIndex * DATA_GRID_ROW_HEIGHT;
        const rowBottom = rowTop + DATA_GRID_ROW_HEIGHT;
        const viewportTop = element.scrollTop + DATA_GRID_HEADER_HEIGHT;
        const viewportBottom = element.scrollTop + element.clientHeight;

        if (rowTop < viewportTop) {
            element.scrollTop = Math.max(visualRowIndex * DATA_GRID_ROW_HEIGHT, 0);
            return;
        }

        if (rowBottom > viewportBottom) {
            element.scrollTop = rowBottom - element.clientHeight;
        }
    }

    function setActiveCell(rowIndex: number, columnIndex: number, options?: DataGridCellFocusOptions) {
        const rowCount = trState.rows.length;
        const columnCount = trState.orderedColumns.length;

        if (rowCount === 0 || columnCount === 0) {
            return;
        }

        internalState.activeCell.rowIndex = Math.max(0, Math.min(rowIndex, rowCount - 1));
        internalState.activeCell.columnIndex = Math.max(0, Math.min(columnIndex, columnCount - 1));
        internalState.activeCellScrollAlign = options?.align ?? 'nearest';

        if (options?.focus) {
            ensureActiveCellRowVisible(internalState.activeCell.rowIndex);
            focusGrid();
        }
    }

    function clearSelectedRows() {
        internalState.selectedRowIndexes = [];
    }

    function clearSelectedColumn() {
        internalState.selectedColumnName = undefined;
    }

    function clearSelectedCellRange() {
        internalState.selectedCellRange = undefined;
    }

    function selectRow(rowIndex: number, options?: DataGridRowSelectionOptions) {
        if (rowIndex < 0 || rowIndex >= trState.rows.length) {
            return;
        }

        clearSelectedColumn();
        clearSelectedCellRange();

        if (options?.mode === 'toggle') {
            internalState.selectedRowIndexes = internalState.selectedRowIndexes.includes(rowIndex)
                ? internalState.selectedRowIndexes.filter((entry: number) => entry !== rowIndex)
                : [...internalState.selectedRowIndexes, rowIndex].sort(
                      (left: number, right: number) => getVisualRowIndexForSourceRowIndex(left) - getVisualRowIndexForSourceRowIndex(right)
                  );
        } else if (options?.mode === 'range' && (internalState.selectedRowIndexes.length || options?.anchorRowIndex != null)) {
            const anchorRowIndex = options?.anchorRowIndex ?? internalState.selectedRowIndexes[0];

            if (anchorRowIndex == null) {
                return;
            }

            const anchorVisualRowIndex = getVisualRowIndexForSourceRowIndex(anchorRowIndex);
            const nextVisualRowIndex = getVisualRowIndexForSourceRowIndex(rowIndex);
            const start = Math.min(anchorVisualRowIndex, nextVisualRowIndex);
            const end = Math.max(anchorVisualRowIndex, nextVisualRowIndex);
            internalState.selectedRowIndexes = args.sortedRowIndexes.value.slice(start, end + 1);
        } else {
            internalState.selectedRowIndexes = [rowIndex];
        }

        if (trState.orderedColumns.length > 0) {
            setActiveCell(rowIndex, internalState.activeCell.columnIndex, options);
        } else if (options?.focus) {
            focusGrid();
        }
    }

    function selectAllRows(options?: DataGridCellFocusOptions) {
        clearSelectedColumn();
        clearSelectedCellRange();
        internalState.selectedRowIndexes = args.sortedRowIndexes.value.slice();

        if (internalState.selectedRowIndexes.length && trState.orderedColumns.length > 0) {
            setActiveCell(internalState.selectedRowIndexes[0], internalState.activeCell.columnIndex, options);
        } else if (options?.focus) {
            focusGrid();
        }
    }

    function selectColumn(columnName: string, options?: DataGridCellFocusOptions) {
        const columnIndex = trState.getColumnIndex(columnName);

        if (columnIndex < 0) {
            return;
        }

        clearSelectedRows();
        clearSelectedCellRange();
        internalState.selectedColumnName = columnName;

        if (trState.rows.length > 0) {
            setActiveCell(getSourceRowIndexForVisualRowIndex(0) ?? 0, columnIndex, options);
            return;
        }

        internalState.activeCell.columnIndex = columnIndex;

        if (options?.focus) {
            focusGrid();
        }
    }

    function selectCellRange(startRowIndex: number, startColumnIndex: number, endRowIndex: number, endColumnIndex: number, options?: DataGridCellFocusOptions) {
        if (
            startRowIndex < 0 ||
            endRowIndex < 0 ||
            startColumnIndex < 0 ||
            endColumnIndex < 0 ||
            startRowIndex >= trState.rows.length ||
            endRowIndex >= trState.rows.length ||
            startColumnIndex >= trState.orderedColumns.length ||
            endColumnIndex >= trState.orderedColumns.length
        ) {
            return;
        }

        clearSelectedColumn();

        if (!options?.preserveSelectedRows) {
            clearSelectedRows();
        }

        internalState.selectedCellRange = { startRowIndex, startColumnIndex, endRowIndex, endColumnIndex };
        const sourceRowIndex = getSourceRowIndexForVisualRowIndex(endRowIndex);

        if (sourceRowIndex == null) {
            return;
        }

        setActiveCell(sourceRowIndex, endColumnIndex, options);
    }

    function normalizeSelectedCellRange(range: GridCellRange | undefined): DataGridNormalizedCellRange | undefined {
        if (!range) {
            return undefined;
        }

        return {
            topRowIndex: Math.min(range.startRowIndex, range.endRowIndex),
            bottomRowIndex: Math.max(range.startRowIndex, range.endRowIndex),
            leftColumnIndex: Math.min(range.startColumnIndex, range.endColumnIndex),
            rightColumnIndex: Math.max(range.startColumnIndex, range.endColumnIndex),
        };
    }

    function isSelectedRow(rowIndex: number) {
        return internalState.selectedRowIndexes.includes(rowIndex);
    }

    function isSelectedColumn(columnName: string) {
        return internalState.selectedColumnName === columnName;
    }

    function isSelectedCell(rowIndex: number, columnIndex: number) {
        if (isSelectedRow(rowIndex)) {
            return true;
        }

        const columnName = trState.getColumnName(columnIndex);
        if (columnName && isSelectedColumn(columnName)) {
            return true;
        }

        const range = normalizeSelectedCellRange(internalState.selectedCellRange);
        const visualRowIndex = getVisualRowIndexForSourceRowIndex(rowIndex);
        return (
            !!range &&
            visualRowIndex >= range.topRowIndex &&
            visualRowIndex <= range.bottomRowIndex &&
            columnIndex >= range.leftColumnIndex &&
            columnIndex <= range.rightColumnIndex
        );
    }

    function areAllRowsSelected() {
        return args.sortedRowIndexes.value.length > 0 && args.sortedRowIndexes.value.every((rowIndex: number) => internalState.selectedRowIndexes.includes(rowIndex));
    }

    function isActiveCell(rowIndex: number, columnIndex: number) {
        return internalState.activeCell.rowIndex === rowIndex && internalState.activeCell.columnIndex === columnIndex;
    }

    function isEditingCell(rowIndex: number, columnIndex: number) {
        return internalState.editingCell.rowIndex === rowIndex && internalState.editingCell.columnIndex === columnIndex;
    }

    function startEditingCell(rowIndex = internalState.activeCell.rowIndex, columnIndex = internalState.activeCell.columnIndex) {
        const columnName = trState.getColumnName(columnIndex);

        if (!columnName) {
            return;
        }

        const resolvedCell = trState.resolveCell(rowIndex, columnName);

        if (!resolvedCell.editable) {
            return;
        }

        setActiveCell(rowIndex, columnIndex);
        ensureActiveCellRowVisible(rowIndex);
        internalState.editingCell.rowIndex = rowIndex;
        internalState.editingCell.columnIndex = columnIndex;
        internalState.editingCell.draftValue = options.formatEditingValue(resolvedCell.value);

        void nextTick(() => {
            const input = internalState.gridElement?.querySelector(`[data-editor-key="${rowIndex}:${columnIndex}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
            input?.focus();

            if (input) {
                if (input.dataset.selectAllOnFocus !== 'false') {
                    input.select();
                } else if (input instanceof HTMLTextAreaElement) {
                    input.setSelectionRange(0, 0);
                }
            }

            if (input) {
                input.scrollLeft = 0;
            }
        });
    }

    function cancelEditingCell() {
        internalState.editingCell.rowIndex = -1;
        internalState.editingCell.columnIndex = -1;
        internalState.editingCell.draftValue = '';
        focusGrid();
    }

    function setModalEditingValue(value: string) {
        internalState.modalEditingCell.draftValue = value;
    }

    function closeModalEditingCell(options?: { focusGrid?: boolean }) {
        internalState.modalEditingCell.open = false;
        internalState.modalEditingCell.rowIndex = -1;
        internalState.modalEditingCell.columnIndex = -1;
        internalState.modalEditingCell.draftValue = '';

        if (options?.focusGrid ?? true) {
            focusGrid();
        }
    }

    function openModalEditingCell(rowIndex = internalState.activeCell.rowIndex, columnIndex = internalState.activeCell.columnIndex) {
        const columnName = trState.getColumnName(columnIndex);

        if (!columnName) {
            return;
        }

        const resolvedCell = trState.resolveCell(rowIndex, columnName);

        if (!resolvedCell.editable) {
            return;
        }

        cancelEditingCell();
        setActiveCell(rowIndex, columnIndex);
        ensureActiveCellRowVisible(rowIndex);
        internalState.modalEditingCell.open = true;
        internalState.modalEditingCell.rowIndex = rowIndex;
        internalState.modalEditingCell.columnIndex = columnIndex;
        internalState.modalEditingCell.draftValue = options.formatEditingValue(resolvedCell.value);
    }

    function commitModalEditingCell() {
        if (!internalState.modalEditingCell.open || internalState.modalEditingCell.rowIndex < 0 || internalState.modalEditingCell.columnIndex < 0) {
            return;
        }

        const rowIndex = internalState.modalEditingCell.rowIndex;
        const columnIndex = internalState.modalEditingCell.columnIndex;
        const columnName = trState.getColumnName(columnIndex);
        const resolvedCell = columnName ? trState.resolveCell(rowIndex, columnName) : undefined;

        if (!resolvedCell?.editable || !resolvedCell.sourceColumnName) {
            closeModalEditingCell();
            return;
        }

        const nextValue = options.parseEditingValue(internalState.modalEditingCell.draftValue, resolvedCell.value);
        args.applyCellChange(
            {
                rowIndex: resolvedCell.sourceRowIndex,
                columnName: resolvedCell.sourceColumnName,
                previousValue: resolvedCell.value,
                nextValue,
            },
            { trackHistory: true }
        );

        closeModalEditingCell();
    }

    function commitEditingCell() {
        if (internalState.editingCell.rowIndex < 0 || internalState.editingCell.columnIndex < 0) {
            return;
        }

        const rowIndex = internalState.editingCell.rowIndex;
        const columnIndex = internalState.editingCell.columnIndex;
        const columnName = trState.getColumnName(columnIndex);
        const resolvedCell = columnName ? trState.resolveCell(rowIndex, columnName) : undefined;

        if (!resolvedCell?.editable || !resolvedCell.sourceColumnName) {
            cancelEditingCell();
            return;
        }

        const nextValue = options.parseEditingValue(internalState.editingCell.draftValue, resolvedCell.value);
        args.applyCellChange(
            {
                rowIndex: resolvedCell.sourceRowIndex,
                columnName: resolvedCell.sourceColumnName,
                previousValue: resolvedCell.value,
                nextValue,
            },
            { trackHistory: true }
        );

        cancelEditingCell();
    }

    function commitEditingCellAndContinue(step: number) {
        if (internalState.editingCell.rowIndex < 0 || internalState.editingCell.columnIndex < 0) {
            return;
        }

        const nextPosition = keyboardNavigation.getHorizontalTarget(
            step,
            getVisualPosition({ rowIndex: internalState.editingCell.rowIndex, columnIndex: internalState.editingCell.columnIndex })
        );
        commitEditingCell();

        if (!nextPosition) {
            return;
        }

        const nextRowIndex = getSourceRowIndexForVisualRowIndex(nextPosition.rowIndex);

        if (nextRowIndex == null) {
            return;
        }

        startEditingCell(nextRowIndex, nextPosition.columnIndex);
    }

    function setEditingValue(value: string) {
        internalState.editingCell.draftValue = value;
    }

    function applyColumnOrder(nextColumnOrder: string[]) {
        const activeColumnName = trState.getColumnName(internalState.activeCell.columnIndex);
        const editingColumnName = trState.getColumnName(internalState.editingCell.columnIndex);

        args.updateLayoutState({ columnOrder: nextColumnOrder });

        if (activeColumnName) {
            internalState.activeCell.columnIndex = Math.max(0, trState.orderedColumns.indexOf(activeColumnName));
        }

        if (editingColumnName) {
            internalState.editingCell.columnIndex = Math.max(0, trState.orderedColumns.indexOf(editingColumnName));
        }
    }

    function reorderColumns(fromIndex: number, toIndex: number) {
        const nextColumns = [...trState.orderedColumns];
        const [movedColumn] = nextColumns.splice(fromIndex, 1);

        if (!movedColumn) {
            return;
        }

        const clampedTargetIndex = Math.max(0, Math.min(toIndex, nextColumns.length));
        nextColumns.splice(clampedTargetIndex, 0, movedColumn);
        applyColumnOrder(nextColumns);
    }

    function reorderColumnsAlphabetically(direction: 'asc' | 'desc') {
        const nextColumnOrder = [...trState.allColumns].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }));

        if (direction === 'desc') {
            nextColumnOrder.reverse();
        }

        applyColumnOrder(nextColumnOrder);
        args.updateLayoutState({ columnsOrderDirection: direction });
    }

    function clearColumnReordering() {
        applyColumnOrder([]);
        args.updateLayoutState({ columnsOrderDirection: undefined });
    }

    function setColumnWidth(columnName: string, width: number) {
        args.updateLayoutState({
            columnWidths: {
                ...internalState.normalizedLayoutState.columnWidths,
                [columnName]: Math.max(DATA_GRID_COLUMN_MIN_WIDTH, Math.min(Math.round(width), DATA_GRID_COLUMN_MAX_WIDTH)),
            },
        });
    }

    function clearColumnWidth(columnName: string) {
        const { [columnName]: _, ...nextColumnWidths } = internalState.normalizedLayoutState.columnWidths;
        args.updateLayoutState({ columnWidths: nextColumnWidths });
    }

    function setColumnHidden(columnName: string, hidden: boolean) {
        const isTransposeLabelColumn = internalState.isTransposed && columnName === internalState.transposeLabelColumnName;

        if (!trState.allColumns.includes(columnName) || isTransposeLabelColumn) {
            return;
        }

        const nextHiddenColumns = hidden ? Array.from(new Set([...trState.hiddenColumns, columnName])) : trState.hiddenColumns.filter((entry: string) => entry !== columnName);
        const nextVisibleColumns = [...internalState.normalizedLayoutState.columnOrder, ...trState.allColumns]
            .filter((entry, index, items) => items.indexOf(entry) === index)
            .filter((entry) => trState.allColumns.includes(entry) && !nextHiddenColumns.includes(entry));

        if (!nextVisibleColumns.length) {
            return;
        }

        const activeColumnName = trState.getColumnName(internalState.activeCell.columnIndex);
        const editingColumnName = trState.getColumnName(internalState.editingCell.columnIndex);

        args.updateLayoutState({ hiddenColumns: nextHiddenColumns });

        if (internalState.selectedColumnName && nextHiddenColumns.includes(internalState.selectedColumnName)) {
            internalState.selectedColumnName = undefined;
        }

        if (activeColumnName) {
            internalState.activeCell.columnIndex = Math.max(0, nextVisibleColumns.indexOf(activeColumnName));
        }

        if (!editingColumnName || !nextVisibleColumns.includes(editingColumnName)) {
            internalState.editingCell.rowIndex = -1;
            internalState.editingCell.columnIndex = -1;
            internalState.editingCell.draftValue = '';
        } else {
            internalState.editingCell.columnIndex = nextVisibleColumns.indexOf(editingColumnName);
        }
    }

    function hideColumn(columnName: string) {
        setColumnHidden(columnName, true);
    }

    function showColumn(columnName: string) {
        setColumnHidden(columnName, false);
    }

    function showAllColumns() {
        args.updateLayoutState({ hiddenColumns: [] });
    }

    function openColumnList() {
        internalState.isColumnListOpen = true;
    }

    function closeColumnList() {
        internalState.isColumnListOpen = false;
    }

    function setSearchQuery(value: string) {
        internalState.searchQuery = value;

        if (!internalState.normalizedSearchQuery || !args.searchMatches.value.length) {
            clearSelectedRows();
            clearSelectedColumn();
            clearSelectedCellRange();
            return;
        }

        const firstMatch = args.searchMatches.value[0];
        clearSelectedRows();
        clearSelectedColumn();
        clearSelectedCellRange();
        setActiveCell(firstMatch.rowIndex, firstMatch.columnIndex, { align: 'center' });
    }

    function goToSearchMatch(step: 1 | -1) {
        if (!args.searchMatches.value.length) {
            return;
        }

        const currentIndex = args.activeSearchMatchIndex.value;
        const nextIndex =
            currentIndex < 0 ? (step > 0 ? 0 : args.searchMatches.value.length - 1) : (currentIndex + step + args.searchMatches.value.length) % args.searchMatches.value.length;
        const nextMatch = args.searchMatches.value[nextIndex];

        if (!nextMatch) {
            return;
        }

        clearSelectedRows();
        clearSelectedColumn();
        clearSelectedCellRange();
        setActiveCell(nextMatch.rowIndex, nextMatch.columnIndex, { focus: true });
    }

    function goToNextSearchMatch() {
        goToSearchMatch(1);
    }

    function goToPreviousSearchMatch() {
        goToSearchMatch(-1);
    }

    function clampViewState() {
        if (internalState.selectedColumnName && !trState.orderedColumns.includes(internalState.selectedColumnName)) {
            internalState.selectedColumnName = undefined;
        }

        internalState.selectedRowIndexes = internalState.selectedRowIndexes.filter((rowIndex: number) => rowIndex >= 0 && rowIndex < trState.rows.length);

        if (internalState.selectedCellRange) {
            const { startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = internalState.selectedCellRange;

            if (
                startRowIndex < 0 ||
                endRowIndex < 0 ||
                startRowIndex >= trState.rows.length ||
                endRowIndex >= trState.rows.length ||
                startColumnIndex < 0 ||
                endColumnIndex < 0 ||
                startColumnIndex >= trState.orderedColumns.length ||
                endColumnIndex >= trState.orderedColumns.length
            ) {
                internalState.selectedCellRange = undefined;
            }
        }

        if (!trState.rows.length || !trState.orderedColumns.length) {
            internalState.activeCell.rowIndex = 0;
            internalState.activeCell.columnIndex = 0;
            internalState.editingCell.rowIndex = -1;
            internalState.editingCell.columnIndex = -1;
            internalState.editingCell.draftValue = '';
            return;
        }

        internalState.activeCell.rowIndex = Math.max(0, Math.min(internalState.activeCell.rowIndex, trState.rows.length - 1));
        internalState.activeCell.columnIndex = Math.max(0, Math.min(internalState.activeCell.columnIndex, trState.orderedColumns.length - 1));

        if (internalState.editingCell.rowIndex >= 0 && internalState.editingCell.columnIndex >= 0) {
            if (internalState.editingCell.rowIndex >= trState.rows.length || internalState.editingCell.columnIndex >= trState.orderedColumns.length) {
                internalState.editingCell.rowIndex = -1;
                internalState.editingCell.columnIndex = -1;
                internalState.editingCell.draftValue = '';
            }
        }
    }

    function resetViewState(resetOptions?: { clearColumnList?: boolean; clearHistory?: boolean }) {
        internalState.editingCell.rowIndex = -1;
        internalState.editingCell.columnIndex = -1;
        internalState.editingCell.draftValue = '';
        internalState.selectedRowIndexes = [];
        internalState.selectedColumnName = undefined;
        internalState.selectedCellRange = undefined;

        if (resetOptions?.clearColumnList) {
            internalState.isColumnListOpen = false;
        }

        if (resetOptions?.clearHistory) {
            args.clearHistory();
            args.clearPendingChanges();
            args.clearSavedChanges();
            internalState.isSavingChanges = false;
        }

        if (trState.rows.length && trState.orderedColumns.length) {
            internalState.activeCell.rowIndex = getSourceRowIndexForVisualRowIndex(0) ?? 0;
            internalState.activeCell.columnIndex = 0;
            return;
        }

        internalState.activeCell.rowIndex = 0;
        internalState.activeCell.columnIndex = 0;
    }

    return {
        keyboardNavigation,
        getSourceRowIndexForVisualRowIndex,
        getVisualRowIndexForSourceRowIndex,
        setActiveCell,
        clearSelectedRows,
        clearSelectedColumn,
        clearSelectedCellRange,
        selectRow,
        selectAllRows,
        selectColumn,
        selectCellRange,
        normalizeSelectedCellRange,
        isSelectedRow,
        isSelectedColumn,
        isSelectedCell,
        areAllRowsSelected,
        isActiveCell,
        isEditingCell,
        startEditingCell,
        cancelEditingCell,
        setModalEditingValue,
        closeModalEditingCell,
        openModalEditingCell,
        commitModalEditingCell,
        commitEditingCell,
        commitEditingCellAndContinue,
        setEditingValue,
        reorderColumns,
        reorderColumnsAlphabetically,
        clearColumnReordering,
        setColumnWidth,
        clearColumnWidth,
        hideColumn,
        showColumn,
        showAllColumns,
        openColumnList,
        closeColumnList,
        setSearchQuery,
        goToNextSearchMatch,
        goToPreviousSearchMatch,
        clampViewState,
        resetViewState,
        focusGrid,
    };
}
