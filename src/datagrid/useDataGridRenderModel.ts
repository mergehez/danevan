import { computed, type ComputedRef, type Ref } from 'vue';
import { DATA_GRID_CHECKBOX_SIZE, DATA_GRID_COLUMN_MIN_WIDTH, DATA_GRID_HEADER_HEIGHT, DATA_GRID_ROW_HEIGHT } from './dataGrid';
import { ellipsizeDataGridText, formatDataGridDisplayText, layoutDataGridCellText, type DataGridTextSegment } from './dataGridText';
import type { TDataGridState } from './useDataGrid';
import type { DataGridInternals, DataGridViewSharedState } from './useDataGridView';

export type DataGridCheckboxModel = {
    /** Offsets inside the gutter, so the checkbox sits where the canvas drew it. */
    left: number;
    top: number;
    checked: boolean;
    indeterminate: boolean;
};

export type DataGridHeaderCellModel = {
    columnIndex: number;
    columnName: string;
    left: number;
    width: number;
    text: string;
    textColor: string;
    background?: string;
};

export type DataGridHeaderDragPreviewModel = {
    left: number;
    width: number;
    text: string;
    textColor: string;
    background: string;
    borderColor: string;
};

export type DataGridCheckboxColors = {
    border: string;
    background: string;
    active: string;
    mark: string;
};

export type DataGridHeaderModel = {
    width: number;
    height: number;
    background: string;
    gutterWidth: number;
    gutterBackground: string;
    scrollLeft: number;
    selectedCell: string;
    draggingBorder: string;
    checkboxColors: DataGridCheckboxColors;
    checkbox?: DataGridCheckboxModel;
    cells: DataGridHeaderCellModel[];
    dragPreview?: DataGridHeaderDragPreviewModel;
    insertX?: number;
    resizeX?: number;
};

export type DataGridCellModel = {
    columnIndex: number;
    left: number;
    width: number;
    /** Row-level backgrounds are painted by the row; a cell only adds its own tint. */
    background?: string;
    /** The 1px ring of the active cell, drawn inside its box. */
    ringColor?: string;
    textSegments: DataGridTextSegment[];
    highlights: Array<{ left: number; width: number }>;
    textColor: string;
    strikethrough: boolean;
    markerOpacity: number;
};

export type DataGridRowGhostModel = {
    left: number;
    width: number;
    textSegments: DataGridTextSegment[];
    textColor: string;
    background: string;
    borderColor: string;
};

export type DataGridRowModel = {
    visualRowIndex: number;
    /** Position inside the rows layer, which is translated by `translateY` while scrolling. */
    top: number;
    gutterBackground: string;
    rowNumber?: { text: string; textColor: string };
    checkbox?: DataGridCheckboxModel;
    background?: string;
    cells: DataGridCellModel[];
    ghost?: DataGridRowGhostModel;
};

export type DataGridBodyModel = {
    width: number;
    height: number;
    background: string;
    gutterWidth: number;
    scrollLeft: number;
    translateX: number;
    translateY: number;
    draggingBorder: string;
    searchHighlight: string;
    searchHighlightText: string;
    checkboxColors: DataGridCheckboxColors;
    rows: DataGridRowModel[];
    insertX?: number;
};

type DataGridRenderModelArgs = {
    sharedState: DataGridViewSharedState;
    internals: DataGridInternals;
    gridState: ComputedRef<TDataGridState>;
    /** Bumped by the imperative paths that change paint-only state (a resize, a drag). */
    paintTick: Ref<number>;
    withCheckboxes?: boolean;
};

const SORT_ASC_INDICATOR = ' ▲';
const SORT_DESC_INDICATOR = ' ▼';
/** The newline marker is drawn dimmer than the value it belongs to. */
const MARKER_OPACITY = 0.58;
const DRAG_GHOST_BACKGROUND = 'rgba(15,23,28,0.95)';

export function useDataGridRenderModel(args: DataGridRenderModelArgs) {
    const { sharedState: shared, internals, gridState, paintTick } = args;

    /** Formatted text of a cell, kept until its value or the render version changes. */
    let formattedTextCache = new Map<string, { value: unknown; text: string }>();
    let formattedTextCacheVersion: string | undefined;

    function getDisplayedText(rowIndex: number, columnName: string) {
        const renderVersion = String(gridState.value.renderVersion);
        const cacheKey = `${rowIndex}:${columnName}`;

        if (formattedTextCacheVersion !== renderVersion) {
            formattedTextCacheVersion = renderVersion;
            formattedTextCache = new Map();
        }

        const displayedValue = gridState.value.getDisplayedCellValue(rowIndex, columnName);
        const cached = formattedTextCache.get(cacheKey);

        if (cached && cached.value === displayedValue) {
            return cached.text;
        }

        const text = formatDataGridDisplayText(gridState.value.getFormattedCellValue(rowIndex, columnName));

        formattedTextCache.set(cacheKey, { value: displayedValue, text });
        return text;
    }

    function measureBodyText(text: string) {
        return shared.measureGridTextPrecise(text, false);
    }

    function measureHeaderText(text: string) {
        return shared.measureGridTextPrecise(text, true);
    }

    function getHeaderModel(): DataGridHeaderModel {
        // The resize line and the drag preview live in `internals`, which is deliberately not
        // reactive; the tick is what tells this model that one of them changed.
        void paintTick.value;

        const theme = gridState.value.theme;
        const state = gridState.value;
        const gutterWidth = shared.gutterColumnWidth;
        const isAllSelected = state.areAllRowsSelected();
        const visibleColumns = getVisibleColumnRange();
        const cells: DataGridHeaderCellModel[] = [];
        const sortColumnName = state.sortState?.columnName;
        const sortIndicator = sortColumnName ? (state.sortState?.direction === 'asc' ? SORT_ASC_INDICATOR : SORT_DESC_INDICATOR) : '';

        for (let columnIndex = visibleColumns.start; columnIndex < visibleColumns.end; columnIndex += 1) {
            const columnName = shared.columns[columnIndex] ?? '';
            const left = shared.columnOffsets[columnIndex] ?? 0;
            const width = shared.resolvedColumnWidths[columnIndex] ?? 0;

            if (left + width < 0 || left > shared.viewportWidth) {
                continue;
            }

            const isSorted = columnName !== '' && columnName === sortColumnName;
            const indicator = isSorted ? sortIndicator : '';
            const isSelectedColumn = !isAllSelected && (columnName ? state.isSelectedColumn(columnName) : false);
            const isRangeColumn = !isAllSelected && isRangeSelectedColumn(columnIndex);
            const isActiveColumn = !isAllSelected && state.activeCell.columnIndex === columnIndex && !isSelectedColumn && !isRangeColumn;
            const isDragged = shared.draggedColumnIndex === columnIndex;
            const indicatorWidth = indicator ? measureHeaderText(indicator) : 0;
            const availableTextWidth = Math.max(width - 16 - indicatorWidth, 8);
            const label = ellipsizeDataGridText(columnName, availableTextWidth, measureHeaderText);

            let textColor = theme.text;

            if (indicator) {
                textColor = theme.sortedColumn;
            }

            if (isSelectedColumn || isRangeColumn || isActiveColumn) {
                textColor = theme.activeText;
            }

            // A dragged column is drawn as a flat ghost of itself: the canvas paints the text with
            // the ghost's own colour, so the label all but disappears under the floating preview.
            if (isDragged) {
                textColor = theme.draggedColumn;
            }

            cells.push({
                columnIndex,
                columnName,
                left,
                width,
                text: indicator ? `${label}${indicator}` : label,
                textColor,
                background: isDragged ? theme.draggedColumn : undefined,
            });
        }

        const model: DataGridHeaderModel = {
            width: shared.viewportWidth,
            height: DATA_GRID_HEADER_HEIGHT,
            background: theme.headerBackground,
            gutterWidth,
            gutterBackground: isAllSelected ? theme.activeCell : theme.rowNumberBackground,
            scrollLeft: shared.scrollLeft,
            selectedCell: theme.selectedCell,
            draggingBorder: theme.draggingBorder,
            checkboxColors: getCheckboxColors(),
            cells,
            checkbox: args.withCheckboxes
                ? {
                      ...getCheckboxPlacement(gutterWidth, 0, DATA_GRID_HEADER_HEIGHT),
                      checked: isAllSelected,
                      indeterminate: !isAllSelected && state.selectedRowIndexes.length > 0,
                  }
                : undefined,
        };

        if (shared.draggedColumnIndex != null && shared.dragPreviewLeft != null) {
            const draggedColumnName = shared.columns[shared.draggedColumnIndex] ?? '';
            const draggedWidth = shared.resolvedColumnWidths[shared.draggedColumnIndex] ?? DATA_GRID_COLUMN_MIN_WIDTH;
            const indicator = draggedColumnName !== '' && draggedColumnName === sortColumnName ? sortIndicator : '';
            const indicatorWidth = indicator ? measureHeaderText(indicator) : 0;
            const label = ellipsizeDataGridText(draggedColumnName, Math.max(draggedWidth - 16 - indicatorWidth, 8), measureHeaderText);

            model.dragPreview = {
                left: shared.dragPreviewLeft,
                width: draggedWidth,
                text: indicator ? `${label}${indicator}` : label,
                textColor: indicator ? theme.sortedColumn : theme.text,
                background: theme.selectedCell,
                borderColor: theme.draggingBorder,
            };
        }

        if (shared.dragInsertIndex != null) {
            model.insertX =
                shared.dragInsertIndex >= shared.columns.length ? shared.totalMeasuredWidth : (shared.columnOffsets[shared.dragInsertIndex] ?? shared.totalMeasuredWidth);
        }

        if (internals.activeResizeColumnIndex != null) {
            model.resizeX = (shared.columnOffsets[internals.activeResizeColumnIndex] ?? 0) + (shared.resolvedColumnWidths[internals.activeResizeColumnIndex] ?? 0);
        }

        return model;
    }

    function getBodyModel(): DataGridBodyModel {
        const theme = gridState.value.theme;
        const state = gridState.value;
        const gutterWidth = shared.gutterColumnWidth;
        const visibleColumns = getVisibleColumnRange();
        const visibleRows = getVisibleRowRange();
        const isAllSelected = state.areAllRowsSelected();
        const showRangeRowSelection = !args.withCheckboxes;
        const rowNumberOffset = Math.max(0, Math.round(state.tableData.offset ?? 0));
        const draggedColumnIndex = shared.draggedColumnIndex;
        const draggedColumnName = draggedColumnIndex != null ? shared.columns[draggedColumnIndex] : undefined;
        const draggedColumnWidth = draggedColumnIndex != null ? (shared.resolvedColumnWidths[draggedColumnIndex] ?? DATA_GRID_COLUMN_MIN_WIDTH) : 0;
        const showDragGhost = draggedColumnName != null && shared.dragPreviewLeft != null;
        const rows: DataGridRowModel[] = [];

        for (let visualRowIndex = visibleRows.start; visualRowIndex < visibleRows.end; visualRowIndex += 1) {
            const sourceRowIndex = shared.sortedRowIndexes[visualRowIndex];

            if (sourceRowIndex == null) {
                continue;
            }

            const rowTop = visualRowIndex * DATA_GRID_ROW_HEIGHT;
            const pendingRowState = state.getPendingRowState?.(sourceRowIndex);
            const isPendingInsertedRow = pendingRowState === 'inserted';
            const isPendingDeletedRow = pendingRowState === 'deleted';
            const isDirtyRow = state.isDirtyRow(sourceRowIndex);
            const isSavedRow = state.isSavedRow(sourceRowIndex);
            const isSelectedRow = !isAllSelected && state.isSelectedRow(sourceRowIndex);
            const isRangeRow = showRangeRowSelection && !isAllSelected && isRangeSelectedRow(visualRowIndex) && !isSelectedRow;
            const isActiveRow = !isAllSelected && state.activeCell.rowIndex === sourceRowIndex && !isSelectedRow && !isRangeRow;
            const isHighlightedRow = isSelectedRow || isRangeRow || isActiveRow;

            const row: DataGridRowModel = {
                visualRowIndex,
                top: rowTop,
                gutterBackground: isPendingDeletedRow
                    ? theme.deletedRow
                    : isPendingInsertedRow
                      ? theme.insertedRow
                      : isHighlightedRow
                        ? theme.activeRowNumber
                        : theme.rowNumberBackground,
                cells: [],
            };

            if (args.withCheckboxes) {
                row.checkbox = {
                    ...getCheckboxPlacement(gutterWidth, 0, DATA_GRID_ROW_HEIGHT),
                    checked: isSelectedRow || isRangeRow,
                    indeterminate: false,
                };
            } else if (state.showRowNumbers !== false) {
                row.rowNumber = {
                    text: String(rowNumberOffset + visualRowIndex + 1),
                    textColor: isHighlightedRow ? theme.activeText : theme.text,
                };
            }

            if (isPendingDeletedRow) {
                row.background = theme.deletedRow;
            } else if (isPendingInsertedRow) {
                row.background = theme.insertedRow;
            } else if (isSelectedRow) {
                row.background = theme.selectedCell;
            } else if (isRangeRow || isActiveRow) {
                row.background = theme.activeRow;
            } else if (isDirtyRow) {
                row.background = theme.dirtyRow;
            } else if (isSavedRow) {
                row.background = theme.savedRow;
            }

            for (let columnIndex = visibleColumns.start; columnIndex < visibleColumns.end; columnIndex += 1) {
                const columnName = shared.columns[columnIndex];

                if (!columnName) {
                    continue;
                }

                const cellLeft = shared.columnOffsets[columnIndex] ?? 0;
                const cellWidth = shared.resolvedColumnWidths[columnIndex] ?? 0;

                if (cellLeft + cellWidth < 0 || cellLeft > shared.viewportWidth) {
                    continue;
                }

                const isSelectedColumn = state.isSelectedColumn(columnName);
                const isSelectedCell = state.isSelectedCell(sourceRowIndex, columnIndex);
                const isDirtyCell = state.isDirtyCell(sourceRowIndex, columnName);
                const isSavedCell = state.isSavedCell(sourceRowIndex, columnName);
                const isActiveCell = state.isActiveCell(sourceRowIndex, columnIndex);
                const isEditing = state.isEditingCell(sourceRowIndex, columnIndex);
                const displayedValue = state.getDisplayedCellValue(sourceRowIndex, columnName);
                const cell: DataGridCellModel = {
                    columnIndex,
                    left: cellLeft,
                    width: cellWidth,
                    ringColor: isActiveCell ? theme.draggingBorder : undefined,
                    textSegments: [],
                    highlights: [],
                    textColor: theme.text,
                    strikethrough: isPendingDeletedRow,
                    markerOpacity: MARKER_OPACITY,
                };

                if (!isPendingDeletedRow && !isPendingInsertedRow && (isSelectedColumn || (!isSelectedRow && isSelectedCell))) {
                    cell.background = theme.selectedCell;
                }

                if (!isPendingDeletedRow && !isPendingInsertedRow && isDirtyCell) {
                    cell.background = theme.dirtyCell;
                } else if (!isPendingDeletedRow && !isPendingInsertedRow && isSavedCell) {
                    cell.background = theme.savedCell;
                }

                if (isActiveCell) {
                    cell.background = theme.selectedCell;
                }

                if (isPendingDeletedRow) {
                    cell.textColor = theme.deletedText;
                } else if (displayedValue == null) {
                    cell.textColor = theme.mutedText;
                }

                // The cell being edited is covered by the textarea the view overlays on it.
                if (!isEditing) {
                    const text = getDisplayedText(sourceRowIndex, columnName);
                    const layout = layoutDataGridCellText(ellipsizeDataGridText(text, Math.max(cellWidth - 16, 8), measureBodyText), shared.normalizedSearchQuery, measureBodyText);

                    cell.textSegments = layout.segments;
                    cell.highlights = layout.highlights;
                }

                row.cells.push(cell);
            }

            if (showDragGhost && draggedColumnName != null) {
                const layout = layoutDataGridCellText(
                    ellipsizeDataGridText(getDisplayedText(sourceRowIndex, draggedColumnName), Math.max(draggedColumnWidth - 16, 8), measureBodyText),
                    '',
                    measureBodyText
                );

                row.ghost = {
                    left: shared.dragPreviewLeft ?? 0,
                    width: draggedColumnWidth,
                    textSegments: layout.segments,
                    textColor: theme.text,
                    background: DRAG_GHOST_BACKGROUND,
                    borderColor: theme.draggingBorder,
                };
            }

            rows.push(row);
        }

        const model: DataGridBodyModel = {
            width: shared.viewportWidth,
            height: shared.bodyHeight,
            background: theme.bodyBackground,
            gutterWidth,
            scrollLeft: shared.scrollLeft,
            translateX: -shared.scrollLeft,
            translateY: -shared.bodyScrollTop,
            draggingBorder: theme.draggingBorder,
            searchHighlight: theme.searchHighlight,
            searchHighlightText: theme.searchHighlightText,
            checkboxColors: getCheckboxColors(),
            rows,
        };

        if (shared.dragInsertIndex != null) {
            model.insertX =
                shared.dragInsertIndex >= shared.columns.length ? shared.totalMeasuredWidth : (shared.columnOffsets[shared.dragInsertIndex] ?? shared.totalMeasuredWidth);
        }

        return model;
    }

    function findFirstColumnEndingAtOrAfter(x: number) {
        let low = 0;
        let high = shared.columnRightEdges.length - 1;
        let result = shared.columnRightEdges.length;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const rightEdge = shared.columnRightEdges[middle] ?? 0;

            if (rightEdge >= x) {
                result = middle;
                high = middle - 1;
            } else {
                low = middle + 1;
            }
        }

        return result;
    }

    function findFirstColumnStartingAfter(x: number) {
        let low = 0;
        let high = shared.columnOffsets.length - 1;
        let result = shared.columnOffsets.length;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const offset = shared.columnOffsets[middle] ?? 0;

            if (offset > x) {
                result = middle;
                high = middle - 1;
            } else {
                low = middle + 1;
            }
        }

        return result;
    }

    /** The columns that touch the viewport, plus one on each side so a scroll paints instantly. */
    function getVisibleColumnRange() {
        const left = shared.scrollLeft;
        const right = shared.scrollLeft + Math.max(shared.viewportWidth - shared.gutterColumnWidth, 0);
        const start = findFirstColumnEndingAtOrAfter(left);
        const end = findFirstColumnStartingAfter(right) + 1;

        return { start: Math.max(start - 1, 0), end: Math.min(end + 1, shared.columns.length) };
    }

    /** The rows that touch the viewport, plus two on each side. */
    function getVisibleRowRange() {
        const start = Math.max(Math.floor(shared.bodyScrollTop / DATA_GRID_ROW_HEIGHT) - 2, 0);
        const visibleRowCount = Math.max(Math.ceil(shared.bodyHeight / DATA_GRID_ROW_HEIGHT) + 4, 1);

        return { start, end: Math.min(start + visibleRowCount, shared.rowCount) };
    }

    function getNormalizedSelectedCellRange() {
        const range = gridState.value.selectedCellRange;

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

    function isRangeSelectedRow(visualRowIndex: number) {
        const range = getNormalizedSelectedCellRange();
        return !!range && visualRowIndex >= range.topRowIndex && visualRowIndex <= range.bottomRowIndex;
    }

    function isRangeSelectedColumn(columnIndex: number) {
        const range = getNormalizedSelectedCellRange();
        return !!range && columnIndex >= range.leftColumnIndex && columnIndex <= range.rightColumnIndex;
    }

    function getCheckboxColors(): DataGridCheckboxColors {
        const theme = gridState.value.theme;

        return {
            border: theme.checkboxBorder,
            background: theme.checkboxBackground,
            active: theme.activeText,
            mark: theme.checkboxMark,
        };
    }

    /** Where the checkbox of a gutter-sized area sits, in the coordinates the grid has always used. */
    function getCheckboxPlacement(containerWidth: number, rowTop: number, rowHeight: number) {
        return {
            left: Math.floor((containerWidth - DATA_GRID_CHECKBOX_SIZE) / 2),
            top: rowTop + Math.floor((rowHeight - DATA_GRID_CHECKBOX_SIZE) / 2),
        };
    }

    const header = computed(getHeaderModel);
    const body = computed(getBodyModel);

    return { header, body, getNormalizedSelectedCellRange };
}
