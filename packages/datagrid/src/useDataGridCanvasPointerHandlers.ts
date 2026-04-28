import { DATA_GRID_COLUMN_MIN_WIDTH, DATA_GRID_HEADER_HEIGHT, DATA_GRID_ROW_HEIGHT } from '@datagrid/dataGrid';
import type { DataGridCanvasPointerHandlersArgs } from '@datagrid/useDataGridView';

export function useDataGridCanvasPointerHandlers(args: DataGridCanvasPointerHandlersArgs) {
    const { internals, runtime, viewportHelpers, gridState: props, sharedState: shared } = args;
    const scheduleDraw = runtime.scheduleDraw;

    function handleBodyClick(event: MouseEvent) {
        if (internals.suppressNextBodyClick) {
            internals.suppressNextBodyClick = false;
            return;
        }

        const cell = viewportHelpers.getBodyCellAtEvent(event);

        if (!cell) {
            return;
        }

        if (cell.area === 'row-header') {
            if (args.withCheckboxes) {
                const point = viewportHelpers.getBodyCanvasPoint(event);

                if (
                    !point ||
                    !runtime.isCheckboxHit(point.x, point.y, {
                        containerWidth: shared.gutterColumnWidth,
                        rowTop: cell.visualRowIndex * DATA_GRID_ROW_HEIGHT - shared.bodyScrollTop,
                        rowHeight: DATA_GRID_ROW_HEIGHT,
                    })
                ) {
                    viewportHelpers.focusViewport();
                    scheduleDraw();
                    return;
                }

                props.selectRow(cell.rowIndex, { focus: true, mode: 'toggle' });
                viewportHelpers.focusViewport();
                scheduleDraw();
                return;
            }

            props.selectRow(cell.rowIndex, { focus: true });
            viewportHelpers.focusViewport();
            scheduleDraw();
            return;
        }

        props.clearSelectedColumn();

        if (!args.withCheckboxes) {
            props.clearSelectedRows();
        }

        props.setActiveCell(cell.rowIndex, cell.columnIndex);
        viewportHelpers.focusViewport();
        scheduleDraw();
    }

    function isDeletedRow(rowIndex: number) {
        return args.stateWithPendingRows.value.getPendingRowState?.(rowIndex) === 'deleted';
    }

    function handleBodyDoubleClick(event: MouseEvent) {
        const cell = viewportHelpers.getBodyCellAtEvent(event);

        if (!cell || cell.area !== 'cell' || isDeletedRow(cell.rowIndex)) {
            return;
        }

        props.clearSelectedColumn();

        if (!args.withCheckboxes) {
            props.clearSelectedRows();
        }

        props.startEditingCell(cell.rowIndex, cell.columnIndex);
        scheduleDraw();
    }

    function handleBodyWindowPointerMove(event: PointerEvent) {
        if (!internals.bodyPointerDownCell) {
            return;
        }

        const movedX = Math.abs(event.clientX - internals.bodyPointerDownClientX);
        const movedY = Math.abs(event.clientY - internals.bodyPointerDownClientY);

        if (!internals.isBodySelecting && movedX < 4 && movedY < 4) {
            return;
        }

        const cell = viewportHelpers.getBodyCellAtEvent(event);

        if (!cell || cell.area !== 'cell') {
            if (!cell || internals.bodyPointerDownCell.area !== 'row-header') {
                return;
            }
        }

        internals.isBodySelecting = true;
        internals.suppressNextBodyClick = true;

        if (internals.bodyPointerDownCell.area === 'row-header') {
            props.selectRow(cell.rowIndex, { mode: 'range', focus: true, anchorRowIndex: internals.bodyPointerDownRowAnchorIndex });
            scheduleDraw();
            return;
        }

        if (cell.area !== 'cell') {
            return;
        }

        props.selectCellRange(internals.bodyPointerDownCell.visualRowIndex, internals.bodyPointerDownCell.columnIndex, cell.visualRowIndex, cell.columnIndex, {
            preserveSelectedRows: args.withCheckboxes,
        });
        scheduleDraw();
    }

    function handleBodyWindowPointerUp() {
        window.removeEventListener('pointermove', handleBodyWindowPointerMove);
        window.removeEventListener('pointerup', handleBodyWindowPointerUp);
        internals.bodyPointerDownCell = undefined;
        internals.bodyPointerDownRowAnchorIndex = undefined;
        internals.isBodySelecting = false;
    }

    function handleBodyPointerDown(event: PointerEvent) {
        if (event.button !== 0) {
            return;
        }

        const cell = viewportHelpers.getBodyCellAtEvent(event);

        if (!cell) {
            return;
        }

        viewportHelpers.focusViewport();

        if (cell.area === 'row-header') {
            internals.bodyPointerDownRowAnchorIndex = cell.rowIndex;

            if (args.withCheckboxes) {
                const point = viewportHelpers.getBodyCanvasPoint(event);

                if (
                    !point ||
                    !runtime.isCheckboxHit(point.x, point.y, {
                        containerWidth: shared.gutterColumnWidth,
                        rowTop: cell.visualRowIndex * DATA_GRID_ROW_HEIGHT - shared.bodyScrollTop,
                        rowHeight: DATA_GRID_ROW_HEIGHT,
                    })
                ) {
                    internals.bodyPointerDownCell = undefined;
                    internals.bodyPointerDownRowAnchorIndex = undefined;
                    viewportHelpers.focusViewport();
                    scheduleDraw();
                    return;
                }

                if (event.shiftKey) {
                    internals.suppressNextBodyClick = true;
                    props.selectRow(cell.rowIndex, { focus: true, mode: 'range' });
                    internals.bodyPointerDownCell = { area: 'row-header', rowIndex: cell.rowIndex, visualRowIndex: cell.visualRowIndex };
                } else {
                    internals.bodyPointerDownCell = { area: 'row-header', rowIndex: cell.rowIndex, visualRowIndex: cell.visualRowIndex };
                }
            } else if (event.shiftKey) {
                internals.suppressNextBodyClick = true;
                props.selectRow(cell.rowIndex, { focus: true, mode: 'range' });
                internals.bodyPointerDownCell = { area: 'row-header', rowIndex: cell.rowIndex, visualRowIndex: cell.visualRowIndex };
            } else if (event.metaKey || event.ctrlKey) {
                internals.suppressNextBodyClick = true;
                internals.bodyPointerDownCell = undefined;
                props.selectRow(cell.rowIndex, { focus: true, mode: 'toggle' });
            } else {
                internals.suppressNextBodyClick = true;
                props.selectRow(cell.rowIndex, { focus: true });
                internals.bodyPointerDownCell = { area: 'row-header', rowIndex: cell.rowIndex, visualRowIndex: cell.visualRowIndex };
            }

            if (internals.bodyPointerDownCell) {
                internals.bodyPointerDownClientX = event.clientX;
                internals.bodyPointerDownClientY = event.clientY;
                internals.isBodySelecting = false;
                window.addEventListener('pointermove', handleBodyWindowPointerMove);
                window.addEventListener('pointerup', handleBodyWindowPointerUp);
            }

            scheduleDraw();
            return;
        }

        props.clearSelectedColumn();

        if (!args.withCheckboxes) {
            props.clearSelectedRows();
        }

        props.clearSelectedCellRange();
        props.setActiveCell(cell.rowIndex, cell.columnIndex, { focus: true });
        internals.bodyPointerDownCell = { area: 'cell', rowIndex: cell.rowIndex, visualRowIndex: cell.visualRowIndex, columnIndex: cell.columnIndex };
        internals.bodyPointerDownRowAnchorIndex = undefined;
        internals.bodyPointerDownClientX = event.clientX;
        internals.bodyPointerDownClientY = event.clientY;
        internals.isBodySelecting = false;
        window.addEventListener('pointermove', handleBodyWindowPointerMove);
        window.addEventListener('pointerup', handleBodyWindowPointerUp);
        scheduleDraw();
    }

    function handleBodyContextMenu(event: MouseEvent) {
        const cell = viewportHelpers.getBodyCellAtEvent(event);

        if (!cell || cell.area !== 'cell') {
            return;
        }

        props.openCellContextMenu(cell.rowIndex, cell.columnIndex, event);
        viewportHelpers.focusViewport();
    }

    function isKeyboardDeleteTarget(event: KeyboardEvent) {
        return event.key === 'Delete' || event.key === 'Backspace';
    }

    function isEditableEventTarget(target: EventTarget | null) {
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
    }

    function selectRowsForDeleteShortcut() {
        if (props.selectedRowIndexes.length) {
            return { hasSelection: true, createdSelection: false };
        }

        const range = runtime.getNormalizedSelectedCellRange();

        if (range) {
            const startRowIndex = shared.sortedRowIndexes[range.topRowIndex];
            const endRowIndex = shared.sortedRowIndexes[range.bottomRowIndex];

            if (startRowIndex != null && endRowIndex != null) {
                props.selectRow(endRowIndex, { focus: true, mode: 'range', anchorRowIndex: startRowIndex });
                return { hasSelection: true, createdSelection: true };
            }
        }

        if (props.activeCell.rowIndex >= 0) {
            props.selectRow(props.activeCell.rowIndex, { focus: true });
            return { hasSelection: true, createdSelection: true };
        }

        return { hasSelection: false, createdSelection: false };
    }

    function handleViewportDeleteKeydown(event: KeyboardEvent) {
        if (!isKeyboardDeleteTarget(event) || isEditableEventTarget(event.target)) {
            return false;
        }

        if (!args.stateWithCheckboxActions.value.deleteSelectedRows) {
            return false;
        }

        const deleteShortcutSelection = selectRowsForDeleteShortcut();

        if (!deleteShortcutSelection.hasSelection) {
            return false;
        }

        event.preventDefault();
        void args.stateWithCheckboxActions.value.deleteSelectedRows();

        if (deleteShortcutSelection.createdSelection) {
            props.clearSelectedRows();
        }

        return true;
    }

    function handleViewportKeydown(event: KeyboardEvent) {
        if (handleViewportDeleteKeydown(event)) {
            return;
        }

        if (event.key === 'Enter' && isDeletedRow(props.activeCell.rowIndex)) {
            event.preventDefault();
            return;
        }

        props.handleGridKeydown(event);
    }

    function handleHeaderClick(event: MouseEvent) {
        if (internals.suppressNextHeaderClick) {
            internals.suppressNextHeaderClick = false;
            return;
        }

        const viewportX = viewportHelpers.getHeaderViewportX(event);

        if (viewportX != null && viewportHelpers.getResizeHandleAtViewportX(viewportX)) {
            return;
        }

        if (viewportX != null && viewportX < shared.gutterColumnWidth) {
            if (args.withCheckboxes) {
                const canvas = shared.headerCanvasElement;

                if (!canvas) {
                    return;
                }

                const rect = canvas.getBoundingClientRect();
                const localX = event.clientX - rect.left;
                const localY = event.clientY - rect.top;

                if (!runtime.isCheckboxHit(localX, localY, { containerWidth: shared.gutterColumnWidth, rowTop: 0, rowHeight: DATA_GRID_HEADER_HEIGHT })) {
                    viewportHelpers.focusViewport();
                    scheduleDraw();
                    return;
                }
            }

            if (props.areAllRowsSelected()) {
                props.clearSelectedRows();
            } else {
                props.selectAllRows({ focus: true });
            }

            viewportHelpers.focusViewport();
            scheduleDraw();
            return;
        }

        const canvas = shared.headerCanvasElement;

        if (!canvas) {
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const columnIndex = viewportHelpers.getColumnIndexAtViewportX(x);
        const columnName = columnIndex == null ? undefined : shared.columns[columnIndex];

        if (!args.withCheckboxes) {
            props.clearSelectedRows();
        }

        if (!columnName) {
            return;
        }

        props.selectColumn(columnName, { focus: true });
        props.toggleSort(columnName);
        viewportHelpers.focusViewport();
    }

    function handleHeaderContextMenu(event: MouseEvent) {
        event.preventDefault();

        const headerCell = viewportHelpers.getHeaderColumnAtEvent(event);

        if (!headerCell) {
            return;
        }

        props.openHeaderContextMenu(headerCell.columnIndex, event);
        viewportHelpers.focusViewport();
        scheduleDraw();
    }

    function clearHeaderPointerState() {
        internals.activeResizeColumnIndex = undefined;
        internals.pointerDownColumnIndex = undefined;
        internals.isHeaderDragging = false;
        internals.dragPointerClientX = 0;
        shared.draggedColumnIndex = null;
        shared.dragInsertIndex = null;
        shared.dragPreviewLeft = null;
        runtime.stopDragAutoScroll();
    }

    function handleWindowPointerMove(event: PointerEvent) {
        if (internals.activeResizeColumnIndex != null) {
            const columnName = shared.columns[internals.activeResizeColumnIndex];

            if (!columnName) {
                return;
            }

            props.setColumnWidth(columnName, internals.resizeStartWidth + event.clientX - internals.resizeStartClientX);
            viewportHelpers.updateHeaderCursor(event);
            scheduleDraw();
            return;
        }

        if (internals.pointerDownColumnIndex == null) {
            return;
        }

        if (!internals.isHeaderDragging) {
            const movedX = Math.abs(event.clientX - internals.pointerDownClientX);
            const movedY = Math.abs(event.clientY - internals.pointerDownClientY);

            if (movedX < 4 && movedY < 4) {
                return;
            }

            internals.isHeaderDragging = true;
            shared.draggedColumnIndex = internals.pointerDownColumnIndex;
            internals.suppressNextHeaderClick = true;
            viewportHelpers.updateHeaderCursor();
        }

        internals.dragPointerClientX = event.clientX;
        viewportHelpers.syncHeaderDragPreview(event.clientX);
        viewportHelpers.updateDragAutoScroll(event.clientX);
        scheduleDraw();
    }

    function handleWindowPointerUp() {
        window.removeEventListener('pointermove', handleWindowPointerMove);
        window.removeEventListener('pointerup', handleWindowPointerUp);

        if (internals.activeResizeColumnIndex != null) {
            internals.suppressNextHeaderClick = true;
            clearHeaderPointerState();
            viewportHelpers.updateHeaderCursor();
            scheduleDraw();
            return;
        }

        if (internals.isHeaderDragging && shared.draggedColumnIndex != null && shared.dragInsertIndex != null) {
            let nextIndex = shared.dragInsertIndex;

            if (nextIndex > shared.draggedColumnIndex) {
                nextIndex -= 1;
            }

            if (nextIndex !== shared.draggedColumnIndex) {
                props.reorderColumns(shared.draggedColumnIndex, nextIndex);
            }
        }

        clearHeaderPointerState();
        viewportHelpers.updateHeaderCursor();
        scheduleDraw();
    }

    function handleHeaderPointerDown(event: PointerEvent) {
        if (event.button !== 0) {
            return;
        }

        const viewportX = viewportHelpers.getHeaderViewportX(event);

        if (viewportX == null) {
            return;
        }

        const resizeHandle = viewportHelpers.getResizeHandleAtViewportX(viewportX);
        const headerCell = viewportHelpers.getHeaderColumnAtEvent(event);

        if (!resizeHandle && !headerCell) {
            return;
        }

        viewportHelpers.focusViewport();
        internals.pointerDownClientX = event.clientX;
        internals.pointerDownClientY = event.clientY;
        internals.dragPointerClientX = event.clientX;
        internals.pointerDownOffsetX = headerCell?.localX ?? 0;

        if (resizeHandle) {
            internals.activeResizeColumnIndex = resizeHandle.columnIndex;
            internals.resizeStartClientX = event.clientX;
            internals.resizeStartWidth = shared.resolvedColumnWidths[resizeHandle.columnIndex] ?? DATA_GRID_COLUMN_MIN_WIDTH;
            internals.suppressNextHeaderClick = true;
            viewportHelpers.updateHeaderCursor();
        } else if (headerCell) {
            internals.pointerDownColumnIndex = headerCell.columnIndex;
            shared.dragInsertIndex = viewportHelpers.getHeaderInsertIndexAtViewportX(viewportX);
            shared.dragPreviewLeft = viewportX - internals.pointerDownOffsetX;
            viewportHelpers.updateHeaderCursor(event);
        }

        window.addEventListener('pointermove', handleWindowPointerMove);
        window.addEventListener('pointerup', handleWindowPointerUp);
        scheduleDraw();
    }

    function handleHeaderDoubleClick(event: MouseEvent) {
        const viewportX = viewportHelpers.getHeaderViewportX(event);

        if (viewportX == null) {
            return;
        }

        const resizeHandle = viewportHelpers.getResizeHandleAtViewportX(viewportX);

        if (!resizeHandle) {
            return;
        }

        const columnName = shared.columns[resizeHandle.columnIndex];

        if (!columnName) {
            return;
        }

        props.clearColumnWidth(columnName);
        internals.suppressNextHeaderClick = true;
        scheduleDraw();
    }

    function handleHeaderPointerMove(event: PointerEvent) {
        viewportHelpers.updateHeaderCursor(event);
    }

    function handleHeaderPointerLeave() {
        if (!internals.isHeaderDragging && internals.activeResizeColumnIndex == null) {
            viewportHelpers.updateHeaderCursor();
        }
    }

    return {
        clearHeaderPointerState,
        handleBodyClick,
        handleBodyContextMenu,
        handleBodyDoubleClick,
        handleBodyPointerDown,
        handleBodyWindowPointerMove,
        handleBodyWindowPointerUp,
        handleHeaderClick,
        handleHeaderContextMenu,
        handleHeaderDoubleClick,
        handleHeaderPointerDown,
        handleHeaderPointerLeave,
        handleHeaderPointerMove,
        handleViewportKeydown,
        handleWindowPointerMove,
        handleWindowPointerUp,
        isDeletedRow,
    };
}
