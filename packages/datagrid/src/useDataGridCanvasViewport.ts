import { DATA_GRID_COLUMN_MIN_WIDTH, DATA_GRID_HEADER_HEIGHT, DATA_GRID_ROW_HEIGHT } from '@datagrid/dataGrid';
import type { DataGridCanvasViewportArgs } from '@datagrid/useDataGridView';

export function useDataGridCanvasViewport(args: DataGridCanvasViewportArgs) {
    const { runtime: canvasRuntime, sharedState: shared } = args;

    function findColumnIndexAtContentX(contentX: number) {
        let low = 0;
        let high = shared.columnRightEdges.length - 1;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const left = shared.columnOffsets[middle] ?? 0;
            const right = shared.columnRightEdges[middle] ?? 0;

            if (contentX < left) {
                high = middle - 1;
                continue;
            }

            if (contentX >= right) {
                low = middle + 1;
                continue;
            }

            return middle;
        }

        return undefined;
    }

    function findFirstColumnStartingAfter(contentX: number) {
        let low = 0;
        let high = shared.columnOffsets.length - 1;
        let result = shared.columnOffsets.length;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const offset = shared.columnOffsets[middle] ?? 0;

            if (offset > contentX) {
                result = middle;
                high = middle - 1;
            } else {
                low = middle + 1;
            }
        }

        return result;
    }

    function updateViewportMetrics(options?: { drawNow?: boolean }) {
        const nextViewportHeight = shared.viewportElement?.clientHeight ?? 0;
        const nextViewportWidth = shared.viewportElement?.clientWidth ?? 0;
        const sizeChanged = nextViewportHeight !== shared.viewportHeight || nextViewportWidth !== shared.viewportWidth;
        shared.viewportHeight = nextViewportHeight;
        shared.viewportWidth = nextViewportWidth;
        shared.scrollTop = shared.viewportElement?.scrollTop ?? 0;
        shared.scrollLeft = shared.viewportElement?.scrollLeft ?? 0;

        if (options?.drawNow || sizeChanged) {
            canvasRuntime.cancelDraw();
            canvasRuntime.drawGrid();
            return;
        }

        canvasRuntime.scheduleDraw();
    }

    function ensureActiveCellVisible() {
        const element = shared.viewportElement;
        const activeColumnIndex = args.gridState.value.activeCell.columnIndex;
        const activeRowIndex = args.gridState.value.activeCell.rowIndex;
        const scrollAlign = args.gridState.value.activeCellScrollAlign ?? 'nearest';

        if (!element || activeColumnIndex < 0 || activeRowIndex < 0) {
            return;
        }

        const visualRowIndex = shared.sortedRowIndexes.indexOf(activeRowIndex);

        if (visualRowIndex < 0) {
            return;
        }

        const rowTop = DATA_GRID_HEADER_HEIGHT + visualRowIndex * DATA_GRID_ROW_HEIGHT;
        const rowBottom = rowTop + DATA_GRID_ROW_HEIGHT;
        const viewportTop = element.scrollTop + DATA_GRID_HEADER_HEIGHT;
        const viewportBottom = element.scrollTop + element.clientHeight;
        const bodyViewportHeight = Math.max(element.clientHeight - DATA_GRID_HEADER_HEIGHT, 0);

        if (scrollAlign === 'center' && bodyViewportHeight > 0) {
            const centeredScrollTop = rowTop - DATA_GRID_HEADER_HEIGHT - Math.max((bodyViewportHeight - DATA_GRID_ROW_HEIGHT) / 2, 0);
            const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0);
            element.scrollTop = Math.max(0, Math.min(centeredScrollTop, maxScrollTop));
        } else if (rowTop < viewportTop) {
            element.scrollTop = Math.max(rowTop - DATA_GRID_HEADER_HEIGHT, 0);
        } else if (rowBottom > viewportBottom) {
            element.scrollTop = rowBottom - element.clientHeight;
        }

        const columnLeft = shared.columnOffsets[activeColumnIndex] ?? 0;
        const columnWidth = shared.resolvedColumnWidths[activeColumnIndex] ?? DATA_GRID_COLUMN_MIN_WIDTH;
        const columnRight = columnLeft + columnWidth;
        const viewportLeft = element.scrollLeft;
        const viewportRight = element.scrollLeft + Math.max(element.clientWidth - shared.gutterColumnWidth, 0);
        const bodyViewportWidth = Math.max(element.clientWidth - shared.gutterColumnWidth, 0);

        if (scrollAlign === 'center' && bodyViewportWidth > 0) {
            const centeredScrollLeft = columnLeft - Math.max((bodyViewportWidth - columnWidth) / 2, 0);
            const maxScrollLeft = Math.max(element.scrollWidth - element.clientWidth, 0);
            element.scrollLeft = Math.max(0, Math.min(centeredScrollLeft, maxScrollLeft));
        } else if (columnLeft < viewportLeft) {
            element.scrollLeft = columnLeft;
        } else if (columnRight > viewportRight) {
            element.scrollLeft = columnRight - element.clientWidth;
        }
    }

    function observeViewport(element: HTMLElement) {
        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        args.internals.resizeObserver ??= new ResizeObserver(() => updateViewportMetrics({ drawNow: true }));
        args.internals.resizeObserver.observe(element);
    }

    function syncContainerElement(element: HTMLElement | undefined) {
        if (element) {
            observeViewport(element);
        }
    }

    function disconnectEditingTextareaObserver() {
        args.internals.editingTextareaResizeObserver?.disconnect();
        args.internals.editingTextareaResizeObserver = undefined;
    }

    function syncEditingTextareaElement(element: HTMLTextAreaElement | undefined) {
        if (!element) {
            disconnectEditingTextareaObserver();
            shared.editingTextareaElement = undefined;
            return;
        }

        shared.editingTextareaElement = element;

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        disconnectEditingTextareaObserver();
        args.internals.editingTextareaResizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];

            if (!entry || !shared.editingCellKey) {
                return;
            }

            shared.editingTextareaSize = {
                key: shared.editingCellKey,
                width: Math.round(entry.contentRect.width),
                height: Math.round(entry.contentRect.height),
            };
        });
        args.internals.editingTextareaResizeObserver.observe(element);
    }

    function rememberEditingTextareaSize(element: HTMLTextAreaElement) {
        if (!shared.editingCellKey) {
            return;
        }

        shared.editingTextareaSize = {
            key: shared.editingCellKey,
            width: element.offsetWidth,
            height: element.offsetHeight,
        };
    }

    function disconnectViewportObserver() {
        args.internals.resizeObserver?.disconnect();
        args.internals.resizeObserver = undefined;
    }

    function syncViewportElement(element: HTMLElement | undefined) {
        if (shared.viewportElement !== element) {
            disconnectViewportObserver();
            shared.viewportElement = element;

            if (element) {
                observeViewport(element);
            }
        }

        args.gridState.value.setGridElement(element);
        args.gridState.value.setTableElement(element);
        updateViewportMetrics();
    }

    function handleViewportScroll() {
        updateViewportMetrics();
    }

    function getColumnIndexAtViewportX(x: number) {
        const contentX = x - shared.gutterColumnWidth + shared.scrollLeft;

        if (contentX < 0) {
            return undefined;
        }

        return findColumnIndexAtContentX(contentX);
    }

    function getHeaderViewportX(event: MouseEvent | PointerEvent) {
        const canvas = shared.headerCanvasElement;

        if (!canvas) {
            return undefined;
        }

        const rect = canvas.getBoundingClientRect();
        return event.clientX - rect.left;
    }

    function getResizeHandleAtViewportX(x: number) {
        const contentX = x - shared.gutterColumnWidth + shared.scrollLeft;

        if (contentX < 0) {
            return undefined;
        }

        const columnIndex = findFirstColumnStartingAfter(contentX) - 1;

        if (columnIndex < 0 || columnIndex >= shared.columns.length - 1) {
            return undefined;
        }

        const boundaryX = shared.columnRightEdges[columnIndex] ?? 0;

        if (Math.abs(contentX - boundaryX) <= 6) {
            return { columnIndex, boundaryX };
        }

        return undefined;
    }

    function getHeaderInsertIndexAtViewportX(x: number) {
        const contentX = x - shared.gutterColumnWidth + shared.scrollLeft;

        if (contentX <= 0) {
            return 0;
        }

        const columnIndex = findColumnIndexAtContentX(contentX);

        if (columnIndex == null) {
            return shared.columns.length;
        }

        const columnLeft = shared.columnOffsets[columnIndex] ?? 0;
        const width = shared.resolvedColumnWidths[columnIndex] ?? 0;

        return contentX < columnLeft + width / 2 ? columnIndex : columnIndex + 1;
    }

    function syncHeaderDragPreview(clientX: number) {
        const viewportX = getHeaderViewportX({ clientX, clientY: 0 } as PointerEvent);

        if (viewportX == null) {
            return;
        }

        shared.dragInsertIndex = getHeaderInsertIndexAtViewportX(viewportX);
        shared.dragPreviewLeft = viewportX - args.internals.pointerDownOffsetX;
    }

    function updateDragAutoScroll(clientX: number) {
        const element = shared.viewportElement;

        if (!element || !args.internals.isHeaderDragging) {
            canvasRuntime.stopDragAutoScroll();
            return;
        }

        const rect = element.getBoundingClientRect();
        const threshold = 56;
        const maxVelocity = 20;
        let nextVelocity = 0;

        if (clientX < rect.left + threshold) {
            nextVelocity = -Math.ceil(((rect.left + threshold - clientX) / threshold) * maxVelocity);
        } else if (clientX > rect.right - threshold) {
            nextVelocity = Math.ceil(((clientX - (rect.right - threshold)) / threshold) * maxVelocity);
        }

        args.internals.dragAutoScrollVelocity = nextVelocity;

        if (!args.internals.dragAutoScrollVelocity) {
            canvasRuntime.stopDragAutoScroll();
            return;
        }

        if (args.internals.dragAutoScrollFrame) {
            return;
        }

        const step = () => {
            args.internals.dragAutoScrollFrame = 0;

            const currentElement = shared.viewportElement;

            if (!currentElement || !args.internals.isHeaderDragging || !args.internals.dragAutoScrollVelocity) {
                canvasRuntime.stopDragAutoScroll();
                return;
            }

            const maxScrollLeft = Math.max(currentElement.scrollWidth - currentElement.clientWidth, 0);
            const nextScrollLeft = Math.max(0, Math.min(currentElement.scrollLeft + args.internals.dragAutoScrollVelocity, maxScrollLeft));

            if (nextScrollLeft === currentElement.scrollLeft) {
                canvasRuntime.stopDragAutoScroll();
                return;
            }

            currentElement.scrollLeft = nextScrollLeft;
            updateViewportMetrics();
            syncHeaderDragPreview(args.internals.dragPointerClientX);
            canvasRuntime.scheduleDraw();
            args.internals.dragAutoScrollFrame = requestAnimationFrame(step);
        };

        args.internals.dragAutoScrollFrame = requestAnimationFrame(step);
    }

    function updateHeaderCursor(event?: MouseEvent | PointerEvent) {
        if (args.internals.activeResizeColumnIndex != null) {
            shared.headerCursor = 'col-resize';
            return;
        }

        if (args.internals.isHeaderDragging) {
            shared.headerCursor = 'grabbing';
            return;
        }

        if (!event) {
            shared.headerCursor = 'default';
            return;
        }

        const viewportX = getHeaderViewportX(event);

        if (viewportX == null || viewportX < shared.gutterColumnWidth) {
            shared.headerCursor = 'default';
            return;
        }

        shared.headerCursor = getResizeHandleAtViewportX(viewportX) ? 'col-resize' : 'grab';
    }

    function getHeaderColumnAtEvent(event: MouseEvent | PointerEvent) {
        const canvas = shared.headerCanvasElement;

        if (!canvas) {
            return undefined;
        }

        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;

        if (x < shared.gutterColumnWidth) {
            return undefined;
        }

        const columnIndex = getColumnIndexAtViewportX(x);

        if (columnIndex == null) {
            return undefined;
        }

        const columnLeft = shared.gutterColumnWidth + (shared.columnOffsets[columnIndex] ?? 0) - shared.scrollLeft;
        const width = shared.resolvedColumnWidths[columnIndex] ?? DATA_GRID_COLUMN_MIN_WIDTH;
        return { columnIndex, localX: x - columnLeft, width };
    }

    function getBodyCellAtEvent(event: MouseEvent | PointerEvent) {
        const canvas = shared.bodyCanvasElement;

        if (!canvas) {
            return undefined;
        }

        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const visualRowIndex = Math.floor((y + shared.bodyScrollTop) / DATA_GRID_ROW_HEIGHT);
        const rowIndex = shared.sortedRowIndexes[visualRowIndex];

        if (rowIndex == null) {
            return undefined;
        }

        if (x < shared.gutterColumnWidth) {
            return { rowIndex, visualRowIndex, columnIndex: undefined, area: 'row-header' as const };
        }

        const columnIndex = getColumnIndexAtViewportX(x);

        if (columnIndex == null) {
            return undefined;
        }

        return { rowIndex, visualRowIndex, columnIndex, area: 'cell' as const };
    }

    function getBodyCanvasPoint(event: MouseEvent | PointerEvent) {
        const canvas = shared.bodyCanvasElement;

        if (!canvas) {
            return undefined;
        }

        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function focusViewport() {
        shared.viewportElement?.focus({ preventScroll: true });
    }

    return {
        disconnectEditingTextareaObserver,
        disconnectViewportObserver,
        ensureActiveCellVisible,
        focusViewport,
        getBodyCanvasPoint,
        getBodyCellAtEvent,
        getColumnIndexAtViewportX,
        getHeaderColumnAtEvent,
        getHeaderInsertIndexAtViewportX,
        getHeaderViewportX,
        getResizeHandleAtViewportX,
        handleViewportScroll,
        rememberEditingTextareaSize,
        syncContainerElement,
        syncEditingTextareaElement,
        syncHeaderDragPreview,
        syncViewportElement,
        updateDragAutoScroll,
        updateHeaderCursor,
        updateViewportMetrics,
    };
}
