import {
    DATA_GRID_CELL_HORIZONTAL_PADDING,
    DATA_GRID_COLUMN_MAX_WIDTH,
    DATA_GRID_COLUMN_MIN_WIDTH,
    DATA_GRID_EDITING_TEXTAREA_MAX_GRID_HEIGHT_RATIO,
    DATA_GRID_EDITING_TEXTAREA_MAX_GRID_WIDTH_RATIO,
    DATA_GRID_EDITING_TEXTAREA_ROWS,
    DATA_GRID_HEADER_HEIGHT,
    DATA_GRID_ROW_HEADER_COMPACT_WIDTH,
    DATA_GRID_ROW_HEIGHT,
    DATA_GRID_ROW_NUMBER_MIN_WIDTH,
    DATA_GRID_TEXT_HORIZONTAL_INSET,
} from '@datagrid/dataGrid';
import { getDataGridCanvasFont, getDataGridFontFamilyCss, getDataGridThemeCssVariables } from '@datagrid/dataGridAppearance';
import type { TDataGridState } from '@datagrid/useDataGrid';
import { useDataGridCanvasPointerHandlers } from '@datagrid/useDataGridCanvasPointerHandlers';
import { useDataGridCanvasRuntime } from '@datagrid/useDataGridCanvasRuntime';
import { useDataGridCanvasViewport } from '@datagrid/useDataGridCanvasViewport';
import type { DataGridNormalizedCellRange } from '@datagrid/useDataGridHelperTypes';
import { useDataGridToolbarMenu } from '@datagrid/useDataGridToolbarMenu';
import { computed, onBeforeUnmount, reactive, ref, toRef, watch, type CSSProperties, type ComputedRef } from 'vue';

type DataGridCheckboxActions = {
    addRow?: () => void | Promise<void>;
    deleteSelectedRows?: () => void | Promise<void>;
    canAddRow?: boolean;
    canDeleteSelectedRows?: boolean;
};

type DataGridPendingRowsState = {
    getPendingRowState?: (rowIndex: number) => 'inserted' | 'deleted' | undefined;
};

type DataGridModalEditingState = {
    modalEditingCell: {
        open: boolean;
        rowIndex: number;
        columnIndex: number;
        draftValue: string;
    };
    setModalEditingValue?: (value: string) => void;
    closeModalEditingCell?: (options?: { focusGrid?: boolean }) => void;
    commitModalEditingCell?: () => void;
};

type DataGridEditorSizingState = {
    getColumnEditorInitialRows?: (columnName: string) => number;
};

type DataGridEditingTextareaSize = {
    key: string | undefined;
    width: number | undefined;
    height: number | undefined;
};

export type DataGridCanvasPointerDownCell =
    | {
          area: 'cell';
          rowIndex: number;
          visualRowIndex: number;
          columnIndex: number;
      }
    | {
          area: 'row-header';
          rowIndex: number;
          visualRowIndex: number;
      };

export type DataGridCanvasInternals = {
    activeResizeColumnIndex: number | undefined;
    bodyPointerDownCell: DataGridCanvasPointerDownCell | undefined;
    bodyPointerDownClientX: number;
    bodyPointerDownClientY: number;
    bodyPointerDownRowAnchorIndex: number | undefined;
    dragAutoScrollFrame: number;
    dragAutoScrollVelocity: number;
    dragPointerClientX: number;
    drawFrame: number;
    editingTextareaResizeObserver: ResizeObserver | undefined;
    isBodySelecting: boolean;
    isHeaderDragging: boolean;
    pointerDownClientX: number;
    pointerDownClientY: number;
    pointerDownColumnIndex: number | undefined;
    pointerDownOffsetX: number;
    resizeObserver: ResizeObserver | undefined;
    resizeStartClientX: number;
    resizeStartWidth: number;
    suppressNextBodyClick: boolean;
    suppressNextHeaderClick: boolean;
};

type DataGridHeaderCursor = 'default' | 'grab' | 'grabbing' | 'col-resize';

type DataGridResizeHandle = {
    columnIndex: number;
    boundaryX: number;
};

type DataGridHeaderCell = {
    columnIndex: number;
    localX: number;
    width: number;
};

type DataGridBodyCell =
    | {
          rowIndex: number;
          visualRowIndex: number;
          columnIndex: number;
          area: 'cell';
      }
    | {
          rowIndex: number;
          visualRowIndex: number;
          columnIndex: undefined;
          area: 'row-header';
      };

export interface DataGridRuntimeArgs {
    sharedState: DataGridViewSharedState;
    internals: DataGridCanvasInternals;
    gridState: ComputedRef<TDataGridState<DataGridPendingRowsState>>;
    withCheckboxes?: boolean;
    hasToolbar?: boolean;
}

export interface DataGridCanvasViewportArgs {
    sharedState: DataGridViewSharedState;
    internals: DataGridCanvasInternals;
    gridState: ComputedRef<TDataGridState<DataGridPendingRowsState>>;
    runtime: ReturnType<typeof useDataGridCanvasRuntime>;
    withCheckboxes?: boolean;
    hasToolbar?: boolean;
}

export interface DataGridCanvasRuntimeHelpers {
    cancelDraw: () => void;
    drawGrid: () => void;
    getNormalizedSelectedCellRange: () => DataGridNormalizedCellRange | undefined;
    getThemeColors: () => { headerBackground: string; bodyBackground: string } & Record<string, string>;
    isCheckboxHit: (localX: number, localY: number, options: { containerWidth: number; rowTop: number; rowHeight: number }) => boolean;
    scheduleDraw: () => void;
    stopDragAutoScroll: () => void;
}

export interface DataGridCanvasViewportHelpers {
    disconnectEditingTextareaObserver: () => void;
    disconnectViewportObserver: () => void;
    ensureActiveCellVisible: () => void;
    focusViewport: () => void;
    getBodyCanvasPoint: (event: MouseEvent | PointerEvent) => { x: number; y: number } | undefined;
    getBodyCellAtEvent: (event: MouseEvent | PointerEvent) => DataGridBodyCell | undefined;
    getColumnIndexAtViewportX: (x: number) => number | undefined;
    getHeaderColumnAtEvent: (event: MouseEvent | PointerEvent) => DataGridHeaderCell | undefined;
    getHeaderInsertIndexAtViewportX: (x: number) => number;
    getHeaderViewportX: (event: MouseEvent | PointerEvent) => number | undefined;
    getResizeHandleAtViewportX: (x: number) => DataGridResizeHandle | undefined;
    handleViewportScroll: () => void;
    rememberEditingTextareaSize: (element: HTMLTextAreaElement) => void;
    syncContainerElement: (element: HTMLElement | undefined) => void;
    syncEditingTextareaElement: (element: HTMLTextAreaElement | undefined) => void;
    syncHeaderDragPreview: (clientX: number) => void;
    syncViewportElement: (element: HTMLElement | undefined) => void;
    updateDragAutoScroll: (clientX: number) => void;
    updateHeaderCursor: (event?: MouseEvent | PointerEvent) => void;
}

export interface DataGridCanvasPointerHandlersArgs {
    sharedState: DataGridViewSharedState;
    internals: DataGridCanvasInternals;
    gridState: TDataGridState;
    withCheckboxes?: boolean;
    hasToolbar?: boolean;
    runtime: DataGridCanvasRuntimeHelpers;
    stateWithCheckboxActions: ComputedRef<TDataGridState<DataGridCheckboxActions>>;
    stateWithPendingRows: ComputedRef<TDataGridState<DataGridPendingRowsState>>;
    viewportHelpers: DataGridCanvasViewportHelpers;
}

export type DataGridViewState = ReturnType<typeof useDataGridView>;
export type DataGridViewSharedState = ReturnType<typeof getSharedState>;

let textMeasureCanvasContext: CanvasRenderingContext2D | undefined;

function getSharedState(state: TDataGridState, _hasToolbar: boolean, withCheckboxes: boolean) {
    const measureGridText = (value: string, isHeader: boolean) => {
        const context = getTextMeasureContext();

        if (!context) {
            return value.length * 8;
        }

        context.font = getDataGridCanvasFont(isHeader, state.gridFontFamily);
        return Math.ceil(context.measureText(value).width);
    };

    const clampColumnWidth = (width: number) => Math.max(DATA_GRID_COLUMN_MIN_WIDTH, Math.min(width, DATA_GRID_COLUMN_MAX_WIDTH));
    const measuredColumnWidths = computed((): Record<string, number> => {
        const columnValueLengths = state.columnValueLengths;
        const averageCharacterWidth = measureGridText('0123456789', false) / 10;

        if (!state.orderedColumns.length) {
            return {};
        }

        return Object.fromEntries(
            state.orderedColumns.map((columnName) => {
                let width = measureGridText(columnName, true) + DATA_GRID_CELL_HORIZONTAL_PADDING;
                const maxValueLength = columnValueLengths?.[columnName] ?? 0;

                if (maxValueLength > 0) {
                    width = Math.max(width, Math.ceil(maxValueLength * averageCharacterWidth) + DATA_GRID_CELL_HORIZONTAL_PADDING);
                }

                return [columnName, clampColumnWidth(width)];
            })
        );
    });
    const resolvedColumnWidths = computed((): number[] =>
        state.orderedColumns.map((columnName) => {
            const customWidth = state.columnWidths?.[columnName];
            return typeof customWidth === 'number' ? clampColumnWidth(customWidth) : (measuredColumnWidths.value[columnName] ?? DATA_GRID_COLUMN_MIN_WIDTH);
        })
    );
    const totalMeasuredWidth = computed((): number => resolvedColumnWidths.value.reduce((sum: number, width: number) => sum + width, 0));
    const columnOffsets = computed(() => {
        const offsets: number[] = [];
        let runningWidth = 0;

        for (const width of resolvedColumnWidths.value) {
            offsets.push(runningWidth);
            runningWidth += width;
        }

        return offsets;
    });
    const columnRightEdges = computed(() => columnOffsets.value.map((offset: number, index: number) => offset + (resolvedColumnWidths.value[index] ?? 0)));

    const _state = reactive({
        viewportElement: undefined as undefined | HTMLElement,
        containerElement: undefined as undefined | HTMLElement,
        bodyCanvasElement: undefined as undefined | HTMLCanvasElement,
        headerCanvasElement: undefined as undefined | HTMLCanvasElement,
        editingTextareaElement: undefined as undefined | HTMLTextAreaElement,
        isModalEditTextWrap: false,
        viewportHeight: 0,
        viewportWidth: 0,
        scrollTop: 0,
        scrollLeft: 0,
        draggedColumnIndex: null as number | null,
        dragInsertIndex: null as number | null,
        dragPreviewLeft: null as number | null,
        headerCursor: 'default' as DataGridHeaderCursor,

        columns: computed(() => state.orderedColumns),
        sortedRowIndexes: computed(() => state.sortedRowIndexes),
        rowCount: computed(() => state.sortedRowIndexes.length),
        bodyCanvasHeight: computed((): number => Math.max(_state.viewportHeight - DATA_GRID_HEADER_HEIGHT, 0)),
        totalBodyHeight: computed((): number => _state.rowCount * DATA_GRID_ROW_HEIGHT),
        totalScrollHeight: computed((): number => DATA_GRID_HEADER_HEIGHT + _state.totalBodyHeight),
        bodyScrollTop: computed((): number => _state.scrollTop),
        normalizedSearchQuery: computed(() => state.searchQuery.trim().toLocaleLowerCase()),
        gridFontFamilyCss: computed(() => getDataGridFontFamilyCss(state.gridFontFamily)),
        headerCanvasFont: computed(() => getDataGridCanvasFont(true, state.gridFontFamily)),
        bodyCanvasFont: computed(() => getDataGridCanvasFont(false, state.gridFontFamily)),
        rowNumberColumnWidth: computed((): number => Math.max(DATA_GRID_ROW_NUMBER_MIN_WIDTH, measureGridText(String(Math.max(_state.rowCount, 1)), false) + 18)),
        gutterColumnWidth: computed((): number => (withCheckboxes ? 36 : state.showRowNumbers === false ? DATA_GRID_ROW_HEADER_COMPACT_WIDTH : _state.rowNumberColumnWidth)),

        measuredColumnWidths: measuredColumnWidths,
        resolvedColumnWidths: resolvedColumnWidths,
        measureGridText,

        totalMeasuredWidth: totalMeasuredWidth,
        editingCellKey: computed(() =>
            state.editingCell.rowIndex >= 0 && state.editingCell.columnIndex >= 0 ? `${state.editingCell.rowIndex}:${state.editingCell.columnIndex}` : undefined
        ),
        editingTextareaSize: ref<DataGridEditingTextareaSize>({
            key: undefined,
            width: undefined,
            height: undefined,
        }),
        columnOffsets: columnOffsets,
        columnRightEdges: columnRightEdges,
    });

    return _state;
}
export function useDataGridView(state: TDataGridState, hasToolbar: boolean, withCheckboxes: boolean) {
    const _state = getSharedState(state, hasToolbar, withCheckboxes);

    const internals: DataGridCanvasInternals = {
        activeResizeColumnIndex: undefined,
        bodyPointerDownCell: undefined,
        bodyPointerDownClientX: 0,
        bodyPointerDownClientY: 0,
        bodyPointerDownRowAnchorIndex: undefined,
        dragAutoScrollFrame: 0,
        dragAutoScrollVelocity: 0,
        dragPointerClientX: 0,
        drawFrame: 0,
        editingTextareaResizeObserver: undefined,
        isBodySelecting: false,
        isHeaderDragging: false,
        pointerDownClientX: 0,
        pointerDownClientY: 0,
        pointerDownColumnIndex: undefined,
        pointerDownOffsetX: 0,
        resizeObserver: undefined,
        resizeStartClientX: 0,
        resizeStartWidth: 0,
        suppressNextBodyClick: false,
        suppressNextHeaderClick: false,
    };

    const editingVisualRowIndex = computed(() => _state.sortedRowIndexes.indexOf(state.editingCell.rowIndex));
    const stateWithCheckboxActions = computed(() => state as TDataGridState<DataGridCheckboxActions>);
    const stateWithPendingRows = computed(() => state as TDataGridState<DataGridPendingRowsState>);
    const stateWithModalEditing = computed(() => state as TDataGridState<DataGridModalEditingState>);
    const stateWithEditorSizing = computed(() => state as TDataGridState<DataGridEditorSizingState>);
    const canAddCheckboxRow = computed(() => !!stateWithCheckboxActions.value.addRow && stateWithCheckboxActions.value.canAddRow !== false);
    const canDeleteCheckboxSelection = computed(() => !!stateWithCheckboxActions.value.deleteSelectedRows && stateWithCheckboxActions.value.canDeleteSelectedRows !== false);
    const toolbarMenuItems = useDataGridToolbarMenu(state);

    const runtime = useDataGridCanvasRuntime({
        sharedState: _state,
        internals: internals,
        gridState: stateWithPendingRows,
        withCheckboxes: withCheckboxes,
        hasToolbar: hasToolbar,
    });
    const themeCssVars = computed<CSSProperties>(() => getDataGridThemeCssVariables(state.theme));
    const canvasColors = computed(() => ({
        headerBackground: runtime.getThemeColors().headerBackground,
        bodyBackground: runtime.getThemeColors().bodyBackground,
    }));

    const viewportHelpers = useDataGridCanvasViewport({
        sharedState: _state,
        internals: internals,
        gridState: stateWithPendingRows,
        runtime: runtime,
        withCheckboxes: withCheckboxes,
        hasToolbar: hasToolbar,
    });

    const pointerHandlers = useDataGridCanvasPointerHandlers({
        sharedState: _state,
        internals: internals,
        gridState: state,
        withCheckboxes: withCheckboxes,
        hasToolbar: hasToolbar,
        runtime: runtime,
        stateWithCheckboxActions: stateWithCheckboxActions,
        stateWithPendingRows: stateWithPendingRows,
        viewportHelpers: viewportHelpers,
    });

    function getEditingInputInitialSize(columnIndex: number) {
        const columnName = _state.columns[columnIndex];
        const cellWidth = _state.resolvedColumnWidths[columnIndex] ?? DATA_GRID_COLUMN_MIN_WIDTH;
        const bodyWidth = Math.max(_state.viewportWidth - _state.gutterColumnWidth, 0);
        const maxWidth = Math.max(cellWidth, Math.floor(bodyWidth * DATA_GRID_EDITING_TEXTAREA_MAX_GRID_WIDTH_RATIO));
        const draftValue = state.editingCell.draftValue ?? '';
        const hasText = draftValue.length > 0;

        if (!hasText) {
            return {
                defaultWidth: Math.min(cellWidth, maxWidth),
                defaultHeight: DATA_GRID_ROW_HEIGHT,
                initialRows: 1,
            };
        }

        const textLines = draftValue.split('\n');
        const longestLineWidth = textLines.reduce((maxWidth, line) => Math.max(maxWidth, _state.measureGridText(line || ' ', false)), 0);
        const fittedWidth = Math.ceil(longestLineWidth + DATA_GRID_TEXT_HORIZONTAL_INSET * 2 + 2);
        const defaultWidth = Math.max(cellWidth, Math.min(fittedWidth, maxWidth));
        const availableTextWidth = Math.max(defaultWidth - DATA_GRID_TEXT_HORIZONTAL_INSET * 2, 1);
        const fittedLineCount = textLines.reduce((lineCount, line) => {
            const lineWidth = _state.measureGridText(line || ' ', false);
            return lineCount + Math.max(1, Math.ceil(lineWidth / availableTextWidth));
        }, 0);
        const fallbackRows = columnName ? (stateWithEditorSizing.value.getColumnEditorInitialRows?.(columnName) ?? 1) : 1;
        const minHeight = DATA_GRID_ROW_HEIGHT;
        const maxHeight = Math.max(
            minHeight,
            Math.min(DATA_GRID_ROW_HEIGHT * DATA_GRID_EDITING_TEXTAREA_ROWS, Math.floor(_state.bodyCanvasHeight * DATA_GRID_EDITING_TEXTAREA_MAX_GRID_HEIGHT_RATIO))
        );
        const fittedHeight = Math.max(minHeight, Math.min(Math.max(fittedLineCount, fallbackRows) * DATA_GRID_ROW_HEIGHT, maxHeight));
        const initialRows = Math.max(1, Math.min(Math.round(fittedHeight / DATA_GRID_ROW_HEIGHT), DATA_GRID_EDITING_TEXTAREA_ROWS));

        return {
            defaultWidth,
            defaultHeight: fittedHeight,
            initialRows,
        };
    }

    function shouldSelectEditingInputText(columnIndex: number) {
        if (columnIndex < 0) {
            return true;
        }

        const { defaultWidth, defaultHeight } = getEditingInputInitialSize(columnIndex);
        const cellWidth = _state.resolvedColumnWidths[columnIndex] ?? DATA_GRID_COLUMN_MIN_WIDTH;
        return defaultWidth <= cellWidth && defaultHeight <= DATA_GRID_ROW_HEIGHT;
    }

    const editingInputStyle = computed<CSSProperties>(() => {
        const columnIndex = state.editingCell.columnIndex;
        const visualRowIndex = editingVisualRowIndex.value;

        if (columnIndex < 0 || visualRowIndex < 0) {
            return { display: 'none' };
        }

        const top = DATA_GRID_HEADER_HEIGHT + visualRowIndex * DATA_GRID_ROW_HEIGHT - _state.bodyScrollTop;
        const left = _state.gutterColumnWidth + (_state.columnOffsets[columnIndex] ?? 0) - _state.scrollLeft;
        const { defaultWidth, defaultHeight } = getEditingInputInitialSize(columnIndex);
        const width = _state.editingTextareaSize.key === _state.editingCellKey ? (_state.editingTextareaSize.width ?? defaultWidth) : defaultWidth;
        const height = _state.editingTextareaSize.key === _state.editingCellKey ? (_state.editingTextareaSize.height ?? defaultHeight) : defaultHeight;
        const cellWidth = _state.resolvedColumnWidths[columnIndex] ?? DATA_GRID_COLUMN_MIN_WIDTH;

        return {
            appearance: 'none',
            top: `${top + 2}px`,
            left: `${left}px`,
            width: `${width}px`,
            minWidth: `${defaultWidth}px`,
            minHeight: `${defaultHeight}px`,
            height: `${height}px`,
            margin: '0px',
            paddingTop: '0px',
            paddingBottom: height > DATA_GRID_ROW_HEIGHT ? `${DATA_GRID_TEXT_HORIZONTAL_INSET}px` : '0px',
            paddingLeft: `${DATA_GRID_TEXT_HORIZONTAL_INSET}px`,
            paddingRight: width > cellWidth ? `${DATA_GRID_TEXT_HORIZONTAL_INSET * 2}px` : `${DATA_GRID_TEXT_HORIZONTAL_INSET}px`,
            lineHeight: `${DATA_GRID_ROW_HEIGHT - 2}px`,
            fontSize: '12px',
            fontWeight: 400,
            fontFamily: _state.gridFontFamilyCss,
            textIndent: '0px',
            overflowX: 'auto',
            overflowY: 'auto',
            whiteSpace: 'pre',
            resize: 'both',
        };
    });

    function onInput(event: Event) {
        const target = event.target;

        if (target instanceof HTMLTextAreaElement) {
            viewportHelpers.rememberEditingTextareaSize(target);
        }

        state.setEditingValue((event.target as HTMLInputElement | HTMLTextAreaElement).value);
    }

    function handleEditingInputWheel(event: WheelEvent) {
        const target = event.currentTarget;

        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
            return;
        }

        const maxScrollLeft = Math.max(target.scrollWidth - target.clientWidth, 0);
        const maxScrollTop = Math.max(target.scrollHeight - target.clientHeight, 0);
        const deltaX = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
        const deltaY = target instanceof HTMLTextAreaElement ? (Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : 0) : 0;

        if (deltaX) {
            target.scrollLeft = Math.max(0, Math.min(target.scrollLeft + deltaX, maxScrollLeft));
        }

        if (deltaY) {
            target.scrollTop = Math.max(0, Math.min(target.scrollTop + deltaY, maxScrollTop));
        }

        if (!deltaX && !deltaY) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
    }

    function getEditPlaceholder() {
        const columnName = _state.columns[state.editingCell.columnIndex];

        if (!columnName) {
            return undefined;
        }

        return state.getDisplayedCellValue(state.editingCell.rowIndex, columnName) == null ? 'NULL' : undefined;
    }

    function getEditingInputRows() {
        const columnIndex = state.editingCell.columnIndex;

        if (columnIndex < 0) {
            return 1;
        }

        return getEditingInputInitialSize(columnIndex).initialRows;
    }

    function getModalEditColumnName() {
        const columnIndex = stateWithModalEditing.value.modalEditingCell.rowIndex >= 0 ? stateWithModalEditing.value.modalEditingCell.columnIndex : -1;
        return columnIndex >= 0 ? _state.columns[columnIndex] : undefined;
    }

    function getModalEditPlaceholder() {
        const rowIndex = stateWithModalEditing.value.modalEditingCell.rowIndex;
        const columnName = getModalEditColumnName();

        if (rowIndex < 0 || !columnName) {
            return undefined;
        }

        return state.getDisplayedCellValue(rowIndex, columnName) == null ? 'NULL' : undefined;
    }

    function toggleModalEditTextWrap() {
        _state.isModalEditTextWrap = !_state.isModalEditTextWrap;
    }

    watch(
        () => [
            _state.viewportWidth,
            _state.viewportHeight,
            _state.bodyScrollTop,
            _state.scrollLeft,
            _state.rowCount,
            _state.gutterColumnWidth,
            _state.totalMeasuredWidth,
            state.activeCell.rowIndex,
            state.activeCell.columnIndex,
            state.editingCell.rowIndex,
            state.editingCell.columnIndex,
            state.editingCell.draftValue,
            state.selectedRowIndexes.join(','),
            state.selectedCellRange?.startRowIndex,
            state.selectedCellRange?.startColumnIndex,
            state.selectedCellRange?.endRowIndex,
            state.selectedCellRange?.endColumnIndex,
            state.selectedColumnName,
            state.sortState?.columnName,
            state.sortState?.direction,
            state.searchQuery,
            state.gridFontFamily,
            state.showRowNumbers,
            state.renderVersion,
        ],
        () => runtime.scheduleDraw(),
        { immediate: true }
    );

    watch(
        () => [state.activeCell.rowIndex, state.activeCell.columnIndex, state.activeCellScrollAlign],
        () => {
            viewportHelpers.ensureActiveCellVisible();
            runtime.scheduleDraw();
        }
    );

    watch(
        () => state.rows,
        () => runtime.scheduleDraw(),
        { deep: true }
    );

    watch(
        () => _state.viewportElement,
        (element) => {
            viewportHelpers.syncViewportElement(element);
        },
        { immediate: true }
    );

    watch(
        () => _state.containerElement,
        (element) => {
            viewportHelpers.syncContainerElement(element);
        },
        { immediate: true }
    );

    watch(
        () => _state.editingTextareaElement,
        (element) => {
            viewportHelpers.syncEditingTextareaElement(element);
        },
        { immediate: true }
    );

    watch(
        () => _state.editingCellKey,
        (key) => {
            if (!key) {
                _state.editingTextareaSize = { key: undefined, width: undefined, height: undefined };
                return;
            }

            if (_state.editingTextareaSize.key !== key) {
                _state.editingTextareaSize = { key, width: undefined, height: undefined };
            }
        },
        { immediate: true }
    );

    watch(
        () => stateWithModalEditing.value.modalEditingCell.open,
        (open) => {
            if (open) {
                _state.isModalEditTextWrap = false;
            }
        }
    );

    onBeforeUnmount(() => {
        runtime.cancelDraw();
        runtime.stopDragAutoScroll();
        viewportHelpers.disconnectViewportObserver();
        viewportHelpers.disconnectEditingTextareaObserver();
        window.removeEventListener('pointermove', pointerHandlers.handleBodyWindowPointerMove);
        window.removeEventListener('pointerup', pointerHandlers.handleBodyWindowPointerUp);
        window.removeEventListener('pointermove', pointerHandlers.handleWindowPointerMove);
        window.removeEventListener('pointerup', pointerHandlers.handleWindowPointerUp);
    });

    return reactive({
        bodyCanvasElement: toRef(_state, 'bodyCanvasElement'),
        bodyCanvasHeight: computed(() => _state.bodyCanvasHeight),
        canvasColors,
        canAddCheckboxRow,
        canDeleteCheckboxSelection,
        containerElement: toRef(_state, 'containerElement'),
        editingInputStyle: editingInputStyle,
        editingTextareaElement: toRef(_state, 'editingTextareaElement'),
        editingVisualRowIndex,
        getEditPlaceholder,
        getEditingInputRows,
        getModalEditColumnName,
        getModalEditPlaceholder,
        gridFontFamilyCss: computed(() => _state.gridFontFamilyCss),
        gutterColumnWidth: computed(() => _state.gutterColumnWidth),
        handleEditingInputWheel,
        headerCanvasElement: toRef(_state, 'headerCanvasElement'),
        headerCursor: computed(() => _state.headerCursor),
        isModalEditTextWrap: computed(() => _state.isModalEditTextWrap),
        onInput,
        pointerHandlers,
        rowCount: computed(() => _state.rowCount),
        shouldSelectEditingInputText,
        state,
        stateWithCheckboxActions,
        stateWithModalEditing,
        toolbarMenuItems: toolbarMenuItems,
        toggleModalEditTextWrap,
        totalMeasuredWidth: computed(() => _state.totalMeasuredWidth),
        totalScrollHeight: computed(() => _state.totalScrollHeight),
        themeCssVars,
        viewportElement: toRef(_state, 'viewportElement'),
        viewportHelpers,
        viewportWidth: computed(() => _state.viewportWidth),
    });
}

function getTextMeasureContext() {
    if (textMeasureCanvasContext) {
        return textMeasureCanvasContext;
    }

    const canvas = document.createElement('canvas');
    textMeasureCanvasContext = canvas.getContext('2d') ?? undefined;
    return textMeasureCanvasContext;
}
