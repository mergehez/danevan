import {
    DATA_GRID_CHECKBOX_SIZE,
    DATA_GRID_COLUMN_MIN_WIDTH,
    DATA_GRID_HEADER_HEIGHT,
    DATA_GRID_MAX_DISPLAY_TEXT_LENGTH,
    DATA_GRID_NEWLINE_TOKEN,
    DATA_GRID_ROW_HEIGHT,
    DATA_GRID_TEXT_BASELINE_OFFSET,
    DATA_GRID_TEXT_HORIZONTAL_INSET,
} from '@datagrid/dataGrid';
import type { DataGridRuntimeArgs } from '@datagrid/useDataGridView';

export type DataGridTextRun = {
    text: string;
    isMarker: boolean;
    start: number;
    end: number;
};
function replaceDataGridNewlines(text: string) {
    return text.replaceAll(/\r?\n/g, DATA_GRID_NEWLINE_TOKEN);
}

function getDataGridTextRuns(text: string): DataGridTextRun[] {
    if (!text) {
        return [];
    }

    const runs: DataGridTextRun[] = [];
    let cursor = 0;

    while (cursor < text.length) {
        const markerIndex = text.indexOf(DATA_GRID_NEWLINE_TOKEN, cursor);

        if (markerIndex < 0) {
            runs.push({
                text: text.slice(cursor),
                isMarker: false,
                start: cursor,
                end: text.length,
            });
            break;
        }

        if (markerIndex > cursor) {
            runs.push({
                text: text.slice(cursor, markerIndex),
                isMarker: false,
                start: cursor,
                end: markerIndex,
            });
        }

        runs.push({
            text: DATA_GRID_NEWLINE_TOKEN,
            isMarker: true,
            start: markerIndex,
            end: markerIndex + DATA_GRID_NEWLINE_TOKEN.length,
        });
        cursor = markerIndex + DATA_GRID_NEWLINE_TOKEN.length;
    }

    return runs;
}

export function useDataGridCanvasRuntime(args: DataGridRuntimeArgs) {
    const { gridState, internals, sharedState: shared } = args;

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

    function getDisplayedText(rowIndex: number, columnName: string) {
        const raw = gridState.value.getFormattedCellValue(rowIndex, columnName);

        // Truncate very long text to prevent expensive canvas measureText() calls
        // that would otherwise process multi-MB strings (e.g. large text/blob fields).
        if (raw.length > DATA_GRID_MAX_DISPLAY_TEXT_LENGTH) {
            return replaceDataGridNewlines(raw.slice(0, DATA_GRID_MAX_DISPLAY_TEXT_LENGTH) + '…');
        }

        return replaceDataGridNewlines(raw);
    }

    function getThemeColors() {
        return gridState.value.theme;
    }

    function getCheckboxMetrics(containerWidth: number, rowTop: number, rowHeight: number) {
        return {
            left: Math.floor((containerWidth - DATA_GRID_CHECKBOX_SIZE) / 2),
            top: rowTop + Math.floor((rowHeight - DATA_GRID_CHECKBOX_SIZE) / 2),
        };
    }

    function isCheckboxHit(localX: number, localY: number, options: { containerWidth: number; rowTop: number; rowHeight: number }) {
        const metrics = getCheckboxMetrics(options.containerWidth, options.rowTop, options.rowHeight);

        return localX >= metrics.left && localX <= metrics.left + DATA_GRID_CHECKBOX_SIZE && localY >= metrics.top && localY <= metrics.top + DATA_GRID_CHECKBOX_SIZE;
    }

    function drawCheckbox(
        context: CanvasRenderingContext2D,
        options: {
            containerWidth: number;
            rowTop: number;
            rowHeight: number;
            checked: boolean;
            indeterminate?: boolean;
        }
    ) {
        const colors = getThemeColors();
        const metrics = getCheckboxMetrics(options.containerWidth, options.rowTop, options.rowHeight);
        const fillChecked = options.checked || options.indeterminate;

        context.save();
        context.beginPath();
        context.rect(metrics.left + 0.5, metrics.top + 0.5, DATA_GRID_CHECKBOX_SIZE - 1, DATA_GRID_CHECKBOX_SIZE - 1);
        context.fillStyle = fillChecked ? colors.activeText : colors.checkboxBackground;
        context.fill();
        context.strokeStyle = fillChecked ? colors.activeText : colors.checkboxBorder;
        context.stroke();

        if (options.indeterminate) {
            context.fillStyle = colors.checkboxMark;
            context.fillRect(metrics.left + 3, metrics.top + 6, DATA_GRID_CHECKBOX_SIZE - 6, 2);
        } else if (options.checked) {
            context.strokeStyle = colors.checkboxMark;
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(metrics.left + 3, metrics.top + 7);
            context.lineTo(metrics.left + 6, metrics.top + 10);
            context.lineTo(metrics.left + 11, metrics.top + 4);
            context.stroke();
        }

        context.restore();
    }

    function findTextMatches(text: string, query: string) {
        if (!text || !query) {
            return [] as Array<{ start: number; end: number }>;
        }

        const normalizedText = text.toLocaleLowerCase();
        const matches: Array<{ start: number; end: number }> = [];
        let searchFrom = 0;

        while (searchFrom < normalizedText.length) {
            const index = normalizedText.indexOf(query, searchFrom);

            if (index < 0) {
                break;
            }

            matches.push({ start: index, end: index + query.length });
            searchFrom = index + Math.max(query.length, 1);
        }

        return matches;
    }

    function scheduleDraw() {
        if (internals.drawFrame) {
            return;
        }

        internals.drawFrame = requestAnimationFrame(() => {
            internals.drawFrame = 0;
            drawGrid();
        });
    }

    function cancelDraw() {
        if (internals.drawFrame) {
            cancelAnimationFrame(internals.drawFrame);
            internals.drawFrame = 0;
        }
    }

    function stopDragAutoScroll() {
        if (internals.dragAutoScrollFrame) {
            cancelAnimationFrame(internals.dragAutoScrollFrame);
            internals.dragAutoScrollFrame = 0;
        }

        internals.dragAutoScrollVelocity = 0;
    }

    function ensureCanvasContext(canvas: HTMLCanvasElement | undefined, cssWidth: number, cssHeight: number) {
        if (!canvas || cssWidth <= 0 || cssHeight <= 0) {
            return undefined;
        }

        const dpr = window.devicePixelRatio || 1;
        const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
        const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));

        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }

        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        const context = canvas.getContext('2d');

        if (!context) {
            return undefined;
        }

        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        return context;
    }

    function ellipsizeText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
        if (context.measureText(text).width <= maxWidth) {
            return text;
        }

        const ellipsis = '...';
        let low = 0;
        let high = text.length;

        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            const candidate = `${text.slice(0, middle)}${ellipsis}`;

            if (context.measureText(candidate).width <= maxWidth) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }

        return `${text.slice(0, Math.max(0, low - 1))}${ellipsis}`;
    }

    function getVisibleColumnRange() {
        const left = shared.scrollLeft;
        const right = shared.scrollLeft + Math.max(shared.viewportWidth - shared.gutterColumnWidth, 0);
        const start = findFirstColumnEndingAtOrAfter(left);
        const end = findFirstColumnStartingAfter(right) + 1;

        return { start: Math.max(start - 1, 0), end: Math.min(end + 1, shared.columns.length) };
    }

    function getVisibleRowRange() {
        const start = Math.max(Math.floor(shared.bodyScrollTop / DATA_GRID_ROW_HEIGHT) - 2, 0);
        const visibleRowCount = Math.max(Math.ceil(shared.bodyCanvasHeight / DATA_GRID_ROW_HEIGHT) + 4, 1);
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

    function shouldShowRangeRowSelection() {
        return !args.withCheckboxes;
    }

    function drawHeader() {
        const context = ensureCanvasContext(shared.headerCanvasElement, shared.viewportWidth, DATA_GRID_HEADER_HEIGHT);

        if (!context) {
            return;
        }

        const isAllSelected = gridState.value.areAllRowsSelected();
        const colors = getThemeColors();
        context.clearRect(0, 0, shared.viewportWidth, DATA_GRID_HEADER_HEIGHT);
        context.fillStyle = colors.headerBackground;
        context.fillRect(0, 0, shared.viewportWidth, DATA_GRID_HEADER_HEIGHT);
        context.strokeStyle = colors.border;
        context.beginPath();
        context.moveTo(0, DATA_GRID_HEADER_HEIGHT - 0.5);
        context.lineTo(shared.viewportWidth, DATA_GRID_HEADER_HEIGHT - 0.5);
        context.stroke();
        context.font = shared.headerCanvasFont;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillStyle = colors.text;
        const gutterWidth = shared.gutterColumnWidth;

        context.fillStyle = isAllSelected ? colors.activeCell : colors.rowNumberBackground;
        context.fillRect(0, 0, gutterWidth, DATA_GRID_HEADER_HEIGHT);
        context.strokeStyle = colors.border;
        context.beginPath();
        context.moveTo(gutterWidth - 0.5, 0);
        context.lineTo(gutterWidth - 0.5, DATA_GRID_HEADER_HEIGHT);
        context.stroke();
        context.fillStyle = colors.text;

        if (args.withCheckboxes) {
            drawCheckbox(context, {
                containerWidth: gutterWidth,
                rowTop: 0,
                rowHeight: DATA_GRID_HEADER_HEIGHT,
                checked: isAllSelected,
                indeterminate: !isAllSelected && gridState.value.selectedRowIndexes.length > 0,
            });
        }

        context.save();
        context.beginPath();
        context.rect(gutterWidth, 0, Math.max(shared.viewportWidth - gutterWidth, 0), DATA_GRID_HEADER_HEIGHT);
        context.clip();

        const { start, end } = getVisibleColumnRange();

        for (let columnIndex = start; columnIndex < end; columnIndex += 1) {
            const columnLeft = gutterWidth + (shared.columnOffsets[columnIndex] ?? 0) - shared.scrollLeft;
            const width = shared.resolvedColumnWidths[columnIndex] ?? 0;

            if (columnLeft + width < 0 || columnLeft > shared.viewportWidth) {
                continue;
            }

            context.strokeStyle = colors.border;
            context.beginPath();
            context.moveTo(columnLeft + width - 0.5, 0);
            context.lineTo(columnLeft + width - 0.5, DATA_GRID_HEADER_HEIGHT);
            context.stroke();

            const columnName = shared.columns[columnIndex] ?? '';
            const sortIndicator = gridState.value.sortState?.columnName === columnName ? (gridState.value.sortState.direction === 'asc' ? ' ▲' : ' ▼') : '';
            const isSelectedColumn = !isAllSelected && (columnName ? gridState.value.isSelectedColumn(columnName) : false);
            const isRangeColumn = !isAllSelected && isRangeSelectedColumn(columnIndex);
            const isActiveColumn = !isAllSelected && gridState.value.activeCell.columnIndex === columnIndex && !isSelectedColumn && !isRangeColumn;

            if (sortIndicator) {
                context.fillStyle = colors.sortedColumn;
            }
            if (isSelectedColumn || isRangeColumn || isActiveColumn) {
                context.fillStyle = colors.activeText;
            }
            if (shared.draggedColumnIndex === columnIndex) {
                context.fillStyle = colors.draggedColumn;
                context.fillRect(columnLeft, 0, width, DATA_GRID_HEADER_HEIGHT);
            }

            const indicatorWidth = sortIndicator ? context.measureText(sortIndicator).width : 0;
            const availableTextWidth = Math.max(width - 16 - indicatorWidth, 8);
            const label = ellipsizeText(context, columnName, availableTextWidth);
            const fullLabel = sortIndicator ? `${label}${sortIndicator}` : label;

            context.fillText(fullLabel, columnLeft + DATA_GRID_TEXT_HORIZONTAL_INSET, DATA_GRID_HEADER_HEIGHT / 2 + DATA_GRID_TEXT_BASELINE_OFFSET);
            context.fillStyle = colors.text;
        }

        if (shared.draggedColumnIndex != null && shared.dragPreviewLeft != null) {
            const draggedWidth = shared.resolvedColumnWidths[shared.draggedColumnIndex] ?? DATA_GRID_COLUMN_MIN_WIDTH;
            const draggedColumnName = shared.columns[shared.draggedColumnIndex] ?? '';
            const sortIndicator = gridState.value.sortState?.columnName === draggedColumnName ? (gridState.value.sortState.direction === 'asc' ? ' ▲' : ' ▼') : '';

            context.save();
            context.globalAlpha = 0.92;
            context.fillStyle = colors.selectedCell;
            context.fillRect(gutterWidth + shared.dragPreviewLeft, 0, draggedWidth, DATA_GRID_HEADER_HEIGHT);
            context.strokeStyle = colors.draggingBorder;
            context.strokeRect(gutterWidth + shared.dragPreviewLeft + 0.5, 0.5, Math.max(draggedWidth - 1, 0), Math.max(DATA_GRID_HEADER_HEIGHT - 1, 0));
            context.fillStyle = colors.text;

            const indicatorWidth = sortIndicator ? context.measureText(sortIndicator).width : 0;
            const availableTextWidth = Math.max(draggedWidth - 16 - indicatorWidth, 8);
            const label = ellipsizeText(context, draggedColumnName, availableTextWidth);
            const fullLabel = sortIndicator ? `${label}${sortIndicator}` : label;

            if (sortIndicator) {
                context.fillStyle = colors.sortedColumn;
            }

            context.fillText(fullLabel, gutterWidth + shared.dragPreviewLeft + DATA_GRID_TEXT_HORIZONTAL_INSET, DATA_GRID_HEADER_HEIGHT / 2 + DATA_GRID_TEXT_BASELINE_OFFSET);
            context.restore();
        }

        if (shared.dragInsertIndex != null) {
            const insertX =
                gutterWidth +
                (shared.dragInsertIndex >= shared.columns.length ? shared.totalMeasuredWidth : (shared.columnOffsets[shared.dragInsertIndex] ?? shared.totalMeasuredWidth)) -
                shared.scrollLeft;
            context.strokeStyle = colors.draggingBorder;
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(insertX, 0);
            context.lineTo(insertX, DATA_GRID_HEADER_HEIGHT);
            context.stroke();
            context.lineWidth = 1;
        }

        if (internals.activeResizeColumnIndex != null) {
            const resizeX =
                gutterWidth +
                (shared.columnOffsets[internals.activeResizeColumnIndex] ?? 0) +
                (shared.resolvedColumnWidths[internals.activeResizeColumnIndex] ?? 0) -
                shared.scrollLeft;
            context.strokeStyle = colors.selectedCell;
            context.beginPath();
            context.moveTo(resizeX - 0.5, 0);
            context.lineTo(resizeX - 0.5, DATA_GRID_HEADER_HEIGHT);
            context.stroke();
        }

        context.restore();
    }

    function drawCellText(
        context: CanvasRenderingContext2D,
        options: { rowTop: number; cellLeft: number; cellWidth: number; text: string; isNull: boolean; strikethrough?: boolean; textColor?: string }
    ) {
        const colors = getThemeColors();
        const maxTextWidth = Math.max(options.cellWidth - 16, 8);
        const visibleText = ellipsizeText(context, options.text, maxTextWidth);
        const textX = options.cellLeft + DATA_GRID_TEXT_HORIZONTAL_INSET;
        const textY = options.rowTop + DATA_GRID_ROW_HEIGHT / 2 + DATA_GRID_TEXT_BASELINE_OFFSET;
        const matches = findTextMatches(visibleText, shared.normalizedSearchQuery);
        const baseTextColor = options.textColor ?? (options.isNull ? colors.mutedText : colors.text);

        const drawTextSegment = (text: string, x: number, color: string, muted = false) => {
            context.save();
            context.fillStyle = color;
            if (muted) {
                context.globalAlpha = 0.58;
            }
            context.fillText(text, x, textY);
            context.restore();
        };

        const drawPlainRuns = (text: string, startX: number) => {
            let cursorX = startX;

            for (const run of getDataGridTextRuns(text)) {
                if (!run.text) {
                    continue;
                }

                drawTextSegment(run.text, cursorX, baseTextColor, run.isMarker);
                cursorX += context.measureText(run.text).width;
            }
        };

        if (!matches.length) {
            drawPlainRuns(visibleText, textX);
            if (options.strikethrough && visibleText) {
                const lineWidth = context.measureText(visibleText).width;
                context.strokeStyle = baseTextColor;
                context.beginPath();
                context.moveTo(textX, options.rowTop + DATA_GRID_ROW_HEIGHT / 2 + 0.5);
                context.lineTo(textX + lineWidth, options.rowTop + DATA_GRID_ROW_HEIGHT / 2 + 0.5);
                context.stroke();
            }
            return;
        }

        let cursorX = textX;
        let nextIndex = 0;

        for (const match of matches) {
            const prefix = visibleText.slice(nextIndex, match.start);

            if (prefix) {
                drawPlainRuns(prefix, cursorX);
                cursorX += context.measureText(prefix).width;
            }

            const matchedText = visibleText.slice(match.start, match.end);

            if (!matchedText) {
                nextIndex = match.end;
                continue;
            }

            const matchWidth = context.measureText(matchedText).width;
            context.fillStyle = colors.searchHighlight;
            context.fillRect(cursorX - 1, options.rowTop + 4, matchWidth + 2, DATA_GRID_ROW_HEIGHT - 8);
            context.fillStyle = colors.searchHighlightText;
            context.fillText(matchedText, cursorX, textY);
            cursorX += matchWidth;
            nextIndex = match.end;
        }

        const suffix = visibleText.slice(nextIndex);

        if (suffix) {
            drawPlainRuns(suffix, cursorX);
        }

        if (options.strikethrough && visibleText) {
            const lineWidth = context.measureText(visibleText).width;
            context.strokeStyle = baseTextColor;
            context.beginPath();
            context.moveTo(textX, options.rowTop + DATA_GRID_ROW_HEIGHT / 2 + 0.5);
            context.lineTo(textX + lineWidth, options.rowTop + DATA_GRID_ROW_HEIGHT / 2 + 0.5);
            context.stroke();
        }
    }

    function drawBody() {
        const context = ensureCanvasContext(shared.bodyCanvasElement, shared.viewportWidth, shared.bodyCanvasHeight);

        if (!context) {
            return;
        }

        const colors = getThemeColors();
        context.clearRect(0, 0, shared.viewportWidth, shared.bodyCanvasHeight);
        context.fillStyle = colors.bodyBackground;
        context.fillRect(0, 0, shared.viewportWidth, shared.bodyCanvasHeight);
        context.font = shared.bodyCanvasFont;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        const gutterWidth = shared.gutterColumnWidth;
        const contentWidth = Math.max(shared.viewportWidth - gutterWidth, 0);
        const visibleColumns = getVisibleColumnRange();
        const visibleRows = getVisibleRowRange();
        const isAllSelected = gridState.value.areAllRowsSelected();
        const rowNumberOffset = Math.max(0, Math.round(gridState.value.tableData.offset ?? 0));

        for (let visualRowIndex = visibleRows.start; visualRowIndex < visibleRows.end; visualRowIndex += 1) {
            const sourceRowIndex = shared.sortedRowIndexes[visualRowIndex];

            if (sourceRowIndex == null) {
                continue;
            }

            const rowTop = visualRowIndex * DATA_GRID_ROW_HEIGHT - shared.bodyScrollTop;
            const pendingRowState = gridState.value.getPendingRowState?.(sourceRowIndex);
            const isPendingInsertedRow = pendingRowState === 'inserted';
            const isPendingDeletedRow = pendingRowState === 'deleted';
            const isDirtyRow = gridState.value.isDirtyRow(sourceRowIndex);
            const isSavedRow = gridState.value.isSavedRow(sourceRowIndex);
            const isSelectedRow = !isAllSelected && gridState.value.isSelectedRow(sourceRowIndex);
            const isRangeRow = shouldShowRangeRowSelection() && !isAllSelected && isRangeSelectedRow(visualRowIndex) && !isSelectedRow;
            const isActiveRow = !isAllSelected && gridState.value.activeCell.rowIndex === sourceRowIndex && !isSelectedRow && !isRangeRow;

            context.fillStyle = isPendingDeletedRow
                ? colors.deletedRow
                : isPendingInsertedRow
                  ? colors.insertedRow
                  : isSelectedRow || isRangeRow || isActiveRow
                    ? colors.activeRowNumber
                    : colors.rowNumberBackground;
            context.fillRect(0, rowTop, gutterWidth, DATA_GRID_ROW_HEIGHT);

            if (args.withCheckboxes) {
                drawCheckbox(context, {
                    containerWidth: gutterWidth,
                    rowTop,
                    rowHeight: DATA_GRID_ROW_HEIGHT,
                    checked: isSelectedRow || isRangeRow,
                });
            } else if (gridState.value.showRowNumbers !== false) {
                context.fillStyle = isSelectedRow || isRangeRow || isActiveRow ? colors.activeText : colors.text;
                context.textAlign = 'right';
                context.fillText(
                    String(rowNumberOffset + visualRowIndex + 1),
                    gutterWidth - DATA_GRID_TEXT_HORIZONTAL_INSET,
                    rowTop + DATA_GRID_ROW_HEIGHT / 2 + DATA_GRID_TEXT_BASELINE_OFFSET
                );
                context.textAlign = 'left';
            }

            context.strokeStyle = colors.border;
            context.beginPath();
            context.moveTo(gutterWidth - 0.5, rowTop);
            context.lineTo(gutterWidth - 0.5, rowTop + DATA_GRID_ROW_HEIGHT);
            context.stroke();

            context.strokeStyle = colors.border;
            context.beginPath();
            context.moveTo(0, rowTop + DATA_GRID_ROW_HEIGHT - 0.5);
            context.lineTo(shared.viewportWidth, rowTop + DATA_GRID_ROW_HEIGHT - 0.5);
            context.stroke();

            context.save();
            context.beginPath();
            context.rect(gutterWidth, rowTop, contentWidth, DATA_GRID_ROW_HEIGHT);
            context.clip();

            if (isPendingDeletedRow) {
                context.fillStyle = colors.deletedRow;
                context.fillRect(0, rowTop, shared.viewportWidth, DATA_GRID_ROW_HEIGHT);
            } else if (isPendingInsertedRow) {
                context.fillStyle = colors.insertedRow;
                context.fillRect(0, rowTop, shared.viewportWidth, DATA_GRID_ROW_HEIGHT);
            } else if (isSelectedRow) {
                context.fillStyle = colors.selectedCell;
                context.fillRect(0, rowTop, shared.viewportWidth, DATA_GRID_ROW_HEIGHT);
            } else if (isRangeRow || isActiveRow) {
                context.fillStyle = colors.activeRow;
                context.fillRect(0, rowTop, shared.viewportWidth, DATA_GRID_ROW_HEIGHT);
            } else if (isDirtyRow) {
                context.fillStyle = colors.dirtyRow;
                context.fillRect(0, rowTop, shared.viewportWidth, DATA_GRID_ROW_HEIGHT);
            } else if (isSavedRow) {
                context.fillStyle = colors.savedRow;
                context.fillRect(0, rowTop, shared.viewportWidth, DATA_GRID_ROW_HEIGHT);
            }

            for (let columnIndex = visibleColumns.start; columnIndex < visibleColumns.end; columnIndex += 1) {
                const columnName = shared.columns[columnIndex];

                if (!columnName) {
                    continue;
                }

                const cellLeft = gutterWidth + (shared.columnOffsets[columnIndex] ?? 0) - shared.scrollLeft;
                const cellWidth = shared.resolvedColumnWidths[columnIndex] ?? 0;
                const isSelectedColumn = gridState.value.isSelectedColumn(columnName);
                const isSelectedCell = gridState.value.isSelectedCell(sourceRowIndex, columnIndex);

                if (cellLeft + cellWidth < 0 || cellLeft > shared.viewportWidth) {
                    continue;
                }

                if (!isPendingDeletedRow && !isPendingInsertedRow && (isSelectedColumn || (!isSelectedRow && isSelectedCell))) {
                    context.fillStyle = colors.selectedCell;
                    context.fillRect(cellLeft, rowTop, cellWidth, DATA_GRID_ROW_HEIGHT);
                }

                const isDirtyCell = gridState.value.isDirtyCell(sourceRowIndex, columnName);
                const isSavedCell = gridState.value.isSavedCell(sourceRowIndex, columnName);
                const isActiveCell = gridState.value.isActiveCell(sourceRowIndex, columnIndex);

                if (!isPendingDeletedRow && !isPendingInsertedRow && isDirtyCell) {
                    context.fillStyle = colors.dirtyCell;
                    context.fillRect(cellLeft, rowTop, cellWidth, DATA_GRID_ROW_HEIGHT);
                } else if (!isPendingDeletedRow && !isPendingInsertedRow && isSavedCell) {
                    context.fillStyle = colors.savedCell;
                    context.fillRect(cellLeft, rowTop, cellWidth, DATA_GRID_ROW_HEIGHT);
                }

                if (isActiveCell) {
                    context.fillStyle = colors.selectedCell;
                    context.fillRect(cellLeft, rowTop, cellWidth, DATA_GRID_ROW_HEIGHT);
                }

                context.strokeStyle = colors.border;
                context.beginPath();
                context.moveTo(cellLeft + cellWidth - 0.5, rowTop);
                context.lineTo(cellLeft + cellWidth - 0.5, rowTop + DATA_GRID_ROW_HEIGHT);
                context.stroke();

                if (isActiveCell) {
                    context.strokeStyle = colors.draggingBorder;
                    context.strokeRect(cellLeft + 1, rowTop + 1, Math.max(cellWidth - 2, 0), Math.max(DATA_GRID_ROW_HEIGHT - 2, 0));
                }

                if (!gridState.value.isEditingCell(sourceRowIndex, columnIndex)) {
                    drawCellText(context, {
                        rowTop,
                        cellLeft,
                        cellWidth,
                        text: getDisplayedText(sourceRowIndex, columnName),
                        isNull: gridState.value.getDisplayedCellValue(sourceRowIndex, columnName) == null,
                        strikethrough: isPendingDeletedRow,
                        textColor: isPendingDeletedRow ? colors.deletedText : undefined,
                    });
                }
            }

            context.restore();
        }

        if (shared.draggedColumnIndex != null && shared.dragPreviewLeft != null) {
            const draggedColumnName = shared.columns[shared.draggedColumnIndex];
            const draggedWidth = shared.resolvedColumnWidths[shared.draggedColumnIndex] ?? DATA_GRID_COLUMN_MIN_WIDTH;

            if (draggedColumnName) {
                context.save();
                context.globalAlpha = 0.9;
                context.beginPath();
                context.rect(gutterWidth, 0, contentWidth, shared.bodyCanvasHeight);
                context.clip();

                for (let visualRowIndex = visibleRows.start; visualRowIndex < visibleRows.end; visualRowIndex += 1) {
                    const sourceRowIndex = shared.sortedRowIndexes[visualRowIndex];

                    if (sourceRowIndex == null) {
                        continue;
                    }

                    const rowTop = visualRowIndex * DATA_GRID_ROW_HEIGHT - shared.bodyScrollTop;
                    context.fillStyle = 'rgba(15,23,28,0.95)';
                    context.fillRect(gutterWidth + shared.dragPreviewLeft, rowTop, draggedWidth, DATA_GRID_ROW_HEIGHT);
                    context.strokeStyle = colors.draggingBorder;
                    context.strokeRect(gutterWidth + shared.dragPreviewLeft + 0.5, rowTop + 0.5, Math.max(draggedWidth - 1, 0), Math.max(DATA_GRID_ROW_HEIGHT - 1, 0));
                    context.fillStyle = colors.text;
                    const text = ellipsizeText(context, getDisplayedText(sourceRowIndex, draggedColumnName), Math.max(draggedWidth - 16, 8));
                    context.fillText(
                        text,
                        gutterWidth + shared.dragPreviewLeft + DATA_GRID_TEXT_HORIZONTAL_INSET,
                        rowTop + DATA_GRID_ROW_HEIGHT / 2 + DATA_GRID_TEXT_BASELINE_OFFSET
                    );
                }

                context.restore();
            }
        }

        if (shared.dragInsertIndex != null) {
            const insertX =
                gutterWidth +
                (shared.dragInsertIndex >= shared.columns.length ? shared.totalMeasuredWidth : (shared.columnOffsets[shared.dragInsertIndex] ?? shared.totalMeasuredWidth)) -
                shared.scrollLeft;
            context.strokeStyle = colors.draggingBorder;
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(insertX, 0);
            context.lineTo(insertX, shared.bodyCanvasHeight);
            context.stroke();
            context.lineWidth = 1;
        }
    }

    function drawGrid() {
        drawHeader();
        drawBody();
    }

    return {
        cancelDraw,
        drawGrid,
        getDisplayedText,
        getNormalizedSelectedCellRange,
        getThemeColors,
        isCheckboxHit,
        scheduleDraw,
        stopDragAutoScroll,
    };
}
