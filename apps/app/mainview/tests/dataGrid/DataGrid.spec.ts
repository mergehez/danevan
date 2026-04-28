import { DATA_GRID_COLUMN_MIN_WIDTH, DATA_GRID_ROW_HEIGHT, DataGrid, useDataGrid, useDataGridView, type DataGridRow, type TDataGridState } from '@datagrid/index';
import { mount } from '@vue/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, ref, type PropType } from 'vue';

const writeClipboardText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
vi.stubGlobal('navigator', { clipboard: { writeText: writeClipboardText } });

type GridStateOptions = {
    columns?: string[];
    rows?: DataGridRow[];
    offset?: number;
    limit?: number;
    searchable?: boolean;
    sqlInsertTableName?: string;
    primaryKeyColumns?: string[];
    addRow?: () => void | Promise<void>;
    deleteSelectedRows?: () => void | Promise<void>;
    canAddRow?: boolean;
    canDeleteSelectedRows?: boolean;
    getPendingRowState?: (rowIndex: number) => 'inserted' | 'deleted' | undefined;
};

type MockCanvasContext = CanvasRenderingContext2D & {
    fillTextCalls: Array<{ text: string; x: number; y: number }>;
};

type GridViewHarnessVm = {
    state: TDataGridState;
    vs: ReturnType<typeof useDataGridView>;
};

const canvasContexts = new WeakMap<HTMLCanvasElement, MockCanvasContext>();
let layoutStorageCounter = 0;

const PointerEventCtor = window.PointerEvent ?? MouseEvent;

function createMockCanvasContext(): MockCanvasContext {
    const context = {
        fillTextCalls: [] as Array<{ text: string; x: number; y: number }>,
        beginPath: () => {},
        clearRect: () => {},
        clip: () => {},
        fill: () => {},
        fillRect: () => {},
        lineTo: () => {},
        measureText: (text: string) => ({ width: String(text).length * 7 }),
        moveTo: () => {},
        rect: () => {},
        restore: () => {},
        save: () => {},
        setTransform: () => {},
        stroke: () => {},
        strokeRect: () => {},
        fillText(text: string, x: number, y: number) {
            context.fillTextCalls.push({ text: String(text), x, y });
        },
        canvas: undefined,
        globalAlpha: 1,
        lineWidth: 1,
        fillStyle: '',
        strokeStyle: '',
        font: '',
        textAlign: 'left',
        textBaseline: 'alphabetic',
    } as unknown as MockCanvasContext;

    return context;
}

function setElementMetrics(element: HTMLElement, options: { width: number; height: number; left?: number; top?: number; scrollWidth?: number; scrollHeight?: number }) {
    const left = options.left ?? 0;
    const top = options.top ?? 0;
    const scrollWidth = options.scrollWidth ?? options.width;
    const scrollHeight = options.scrollHeight ?? options.height;

    Object.defineProperty(element, 'clientWidth', {
        configurable: true,
        get: () => options.width,
    });
    Object.defineProperty(element, 'clientHeight', {
        configurable: true,
        get: () => options.height,
    });
    Object.defineProperty(element, 'offsetWidth', {
        configurable: true,
        get: () => options.width,
    });
    Object.defineProperty(element, 'offsetHeight', {
        configurable: true,
        get: () => options.height,
    });
    Object.defineProperty(element, 'scrollWidth', {
        configurable: true,
        get: () => scrollWidth,
    });
    Object.defineProperty(element, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
    });

    element.getBoundingClientRect = () =>
        ({
            x: left,
            y: top,
            left,
            top,
            width: options.width,
            height: options.height,
            right: left + options.width,
            bottom: top + options.height,
            toJSON: () => ({}),
        }) as DOMRect;
}

function createGridState(options: GridStateOptions = {}) {
    const columns = ref(options.columns ?? ['id', 'name', 'city']);
    const rows = ref<DataGridRow[]>(
        options.rows ?? [
            { id: 1, name: 'Alpha', city: 'Paris' },
            { id: 2, name: 'Charlie', city: 'Berlin' },
            { id: 3, name: 'Bravo', city: 'Cairo' },
        ]
    );
    const layoutStorageKey = `data-grid-test-${layoutStorageCounter++}`;

    const state = useDataGrid({
        layoutStorageKey,
        searchable: options.searchable ?? true,
        editable: true,
        enableTranspose: true,
        sqlInsertTableName: options.sqlInsertTableName ?? 'people',
        primaryKeyColumns: options.primaryKeyColumns ?? ['id'],
        tableData: computed(() => ({
            columns: columns.value,
            rows: rows.value,
            rowCount: rows.value.length,
            limit: options.limit,
            offset: options.offset,
            columnStats: {},
        })),
        renderVersion: computed(() => `${columns.value.join('|')}:${rows.value.length}:${options.offset ?? 0}`),
        setSourceCellValue: (rowIndex, columnName, nextValue) => {
            rows.value = rows.value.map((row, currentRowIndex) =>
                currentRowIndex === rowIndex
                    ? {
                          ...row,
                          [columnName]: nextValue,
                      }
                    : row
            );
        },
        addRow: options.addRow,
        deleteSelectedRows: options.deleteSelectedRows,
        canAddRow: options.canAddRow,
        canDeleteSelectedRows: options.canDeleteSelectedRows,
        getPendingRowState: options.getPendingRowState,
    });

    return { columns, rows, state };
}

const GridViewHarness = defineComponent({
    name: 'GridViewHarness',
    props: {
        state: {
            type: Object as PropType<TDataGridState>,
            required: true,
        },
    },
    setup(props, { expose }) {
        const vs = useDataGridView(props.state, true, false);

        expose({
            state: props.state,
            vs,
        });

        return {
            state: props.state,
            vs,
        };
    },
    template: `
        <div :ref="(element) => (vs.containerElement = element)">
            <div :ref="(element) => (vs.viewportElement = element)" tabindex="0">
                <canvas :ref="(element) => (vs.headerCanvasElement = element)"></canvas>
                <canvas :ref="(element) => (vs.bodyCanvasElement = element)"></canvas>
            </div>
        </div>
    `,
});

async function mountGridViewHarness(state: TDataGridState) {
    const wrapper = mount(GridViewHarness, {
        attachTo: document.body,
        props: { state },
    });

    const vm = wrapper.vm as unknown as GridViewHarnessVm;
    const [headerCanvas, bodyCanvas] = wrapper.findAll('canvas').map((entry) => entry.element as HTMLCanvasElement);
    const viewportElement = wrapper.find('[tabindex="0"]').element as HTMLElement;
    const containerElement = wrapper.element as HTMLElement;

    setElementMetrics(containerElement, { width: 480, height: 320 });
    setElementMetrics(viewportElement, { width: 480, height: 320, scrollWidth: 640, scrollHeight: 640 });
    setElementMetrics(headerCanvas, { width: 480, height: 33, top: 0 });
    setElementMetrics(bodyCanvas, { width: 480, height: 287, top: 33 });

    (vm.vs.viewportHelpers.updateViewportMetrics as (...args: unknown[]) => void)({ drawNow: true });
    await nextTick();

    return { wrapper, vm, headerCanvas, bodyCanvas };
}

beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
        let context = canvasContexts.get(this);

        if (!context) {
            context = createMockCanvasContext();
            canvasContexts.set(this, context);
        }

        return context;
    });
});

afterEach(() => {
    writeClipboardText.mockClear();
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('DataGrid', () => {
    it('covers sorting, column ordering, visibility, and appearance settings through grid state', () => {
        const { state } = createGridState();

        expect(state.orderedColumns).toEqual(['id', 'name', 'city']);
        expect(state.sortedRowIndexes).toEqual([0, 1, 2]);

        state.toggleSort('name');
        expect(state.sortState).toEqual({ columnName: 'name', direction: 'desc' });
        expect(state.sortedRowIndexes).toEqual([1, 2, 0]);

        state.toggleSort('name');
        expect(state.sortState).toEqual({ columnName: 'name', direction: 'asc' });
        expect(state.sortedRowIndexes).toEqual([0, 2, 1]);

        state.reorderColumns(2, 0);
        expect(state.orderedColumns).toEqual(['city', 'id', 'name']);

        state.hideColumn('id');
        expect(state.hiddenColumns).toContain('id');
        expect(state.orderedColumns).toEqual(['city', 'name']);

        state.showColumn('id');
        expect(state.hiddenColumns).not.toContain('id');

        state.setFontFamily('jetbrains-mono');
        state.setShowRowNumbers(false);

        expect(state.gridFontFamily).toBe('jetbrains-mono');
        expect(state.showRowNumbers).toBe(false);
    });

    it('covers search navigation, cell-range selection, and transpose mode', () => {
        const { state } = createGridState({
            rows: [
                { id: 1, name: 'Alpha', city: 'Berlin' },
                { id: 2, name: 'Alphabet', city: 'Boston' },
                { id: 3, name: 'Zulu', city: 'Cairo' },
            ],
        });

        state.setSearchQuery('alp');

        expect(state.searchQuery).toBe('alp');
        expect(state.searchMatchCount).toBe(2);
        expect(state.activeCell.rowIndex).toBe(0);
        expect(state.activeCell.columnIndex).toBe(1);
        expect(state.activeSearchMatchIndex).toBe(0);

        state.goToNextSearchMatch();
        expect(state.activeCell.rowIndex).toBe(1);
        expect(state.activeCell.columnIndex).toBe(1);
        expect(state.activeSearchMatchIndex).toBe(1);

        state.selectCellRange(0, 0, 1, 1);
        expect(state.selectedCellRange).toEqual({
            startRowIndex: 0,
            startColumnIndex: 0,
            endRowIndex: 1,
            endColumnIndex: 1,
        });

        state.toggleTranspose?.();
        expect(state.isTransposed).toBe(true);
        expect(state.orderedColumns[0]).toBe('Column');
        expect(state.rows.length).toBe(3);

        state.toggleTranspose?.();
        expect(state.isTransposed).toBe(false);
        expect(state.orderedColumns).toEqual(['id', 'name', 'city']);
    });

    it('covers inline editing, modal editing, and clipboard exports', async () => {
        const { rows, state } = createGridState();

        state.startEditingCell(0, 1);
        state.setEditingValue('Updated Alpha');
        state.commitEditingCell();

        expect(rows.value[0]?.name).toBe('Updated Alpha');

        state.openModalEditingCell?.(1, 2);
        expect(state.modalEditingCell.open).toBe(true);
        state.setModalEditingValue?.('Updated Berlin');
        state.commitModalEditingCell?.();

        expect(rows.value[1]?.city).toBe('Updated Berlin');

        await state.copyAllCellsAsJson?.();
        expect(writeClipboardText).toHaveBeenLastCalledWith(JSON.stringify(rows.value, null, 2));

        await state.copyAllCellsAsCsv?.();
        expect(writeClipboardText.mock.calls.at(-1)?.[0]).toContain('Updated Alpha');

        await state.copyAllCellsAsSql?.();
        expect(writeClipboardText.mock.calls.at(-1)?.[0]).toContain('Updated Berlin');

        await state.copyAllCellsAsSqlInsert?.();
        expect(writeClipboardText.mock.calls.at(-1)?.[0]).toContain('INSERT INTO');

        await state.copyAllCellsAsSqlSelect?.();
        expect(writeClipboardText.mock.calls.at(-1)?.[0]).toContain('SELECT');
        expect(writeClipboardText.mock.calls.at(-1)?.[0]).toContain('WHERE');
    });

    it('falls back to execCommand copy when async clipboard access is denied', async () => {
        const { state } = createGridState();
        const execCommandStub = vi.fn().mockReturnValue(true);

        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: execCommandStub,
        });

        writeClipboardText.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));

        await state.copyAllCellsAsJson?.();

        expect(execCommandStub).toHaveBeenCalledWith('copy');
    });

    it('fits empty-cell editors to the cell size', async () => {
        const { state } = createGridState({
            rows: [
                { id: 1, name: '', city: 'A relatively long city value to keep the measured column wide' },
                { id: 2, name: 'Filled value', city: 'Berlin' },
            ],
        });
        const { vm, wrapper } = await mountGridViewHarness(state);

        state.startEditingCell(0, 1);
        await nextTick();

        const emptyWidth = Number.parseFloat(String(vm.vs.editingInputStyle.width ?? '0'));
        const emptyMinWidth = Number.parseFloat(String(vm.vs.editingInputStyle.minWidth ?? '0'));
        const emptyHeight = Number.parseFloat(String(vm.vs.editingInputStyle.height ?? '0'));
        const emptyMinHeight = Number.parseFloat(String(vm.vs.editingInputStyle.minHeight ?? '0'));

        state.commitEditingCell();
        state.startEditingCell(1, 1);
        await nextTick();

        const filledWidth = Number.parseFloat(String(vm.vs.editingInputStyle.width ?? '0'));

        expect(emptyWidth).toBe(DATA_GRID_COLUMN_MIN_WIDTH);
        expect(emptyMinWidth).toBe(DATA_GRID_COLUMN_MIN_WIDTH);
        expect(emptyHeight).toBe(DATA_GRID_ROW_HEIGHT);
        expect(emptyMinHeight).toBe(DATA_GRID_ROW_HEIGHT);
        expect(filledWidth).toBeGreaterThanOrEqual(emptyWidth);

        wrapper.unmount();
    });

    it('adds right and bottom padding when the editor grows beyond the cell', async () => {
        const { state } = createGridState({
            rows: [{ id: 1, name: '', city: 'Paris' }],
        });
        const { vm, wrapper } = await mountGridViewHarness(state);

        state.startEditingCell(0, 1);
        await nextTick();

        expect(vm.vs.editingInputStyle.paddingRight).toBe('8px');
        expect(vm.vs.editingInputStyle.paddingBottom).toBe('0px');

        const resizedTextarea = document.createElement('textarea');
        Object.defineProperty(resizedTextarea, 'offsetWidth', {
            configurable: true,
            get: () => DATA_GRID_COLUMN_MIN_WIDTH + 40,
        });
        Object.defineProperty(resizedTextarea, 'offsetHeight', {
            configurable: true,
            get: () => DATA_GRID_ROW_HEIGHT + 30,
        });

        vm.vs.viewportHelpers.rememberEditingTextareaSize(resizedTextarea);
        await nextTick();

        expect(vm.vs.editingInputStyle.paddingRight).toBe('16px');
        expect(vm.vs.editingInputStyle.paddingBottom).toBe('8px');

        wrapper.unmount();
    });

    it('traps editor wheel scrolling so it does not bubble into the grid viewport', async () => {
        const { state } = createGridState({
            rows: [{ id: 1, name: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6', city: 'Paris' }],
        });
        const wrapper = mount(DataGrid, {
            attachTo: document.body,
            props: {
                state,
                hasToolbar: true,
            },
            global: {
                directives: {
                    menu: {},
                    tooltip: {},
                },
                stubs: {
                    CenteredModal: {
                        template: '<div><slot /></div>',
                    },
                    IconButton: {
                        template: '<button type="button"><slot /></button>',
                    },
                },
            },
        });

        state.startEditingCell(0, 1);
        await nextTick();

        const viewport = wrapper.find('[tabindex="0"]').element as HTMLElement;
        const textarea = wrapper.find('textarea[data-editor-key]').element as HTMLTextAreaElement;
        const viewportWheelListener = vi.fn();

        viewport.addEventListener('wheel', viewportWheelListener);

        Object.defineProperty(textarea, 'clientHeight', {
            configurable: true,
            get: () => 50,
        });
        Object.defineProperty(textarea, 'scrollHeight', {
            configurable: true,
            get: () => 200,
        });
        Object.defineProperty(textarea, 'clientWidth', {
            configurable: true,
            get: () => 100,
        });
        Object.defineProperty(textarea, 'scrollWidth', {
            configurable: true,
            get: () => 100,
        });

        textarea.scrollTop = 0;

        const topEdgeWheel = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: -120,
        });

        expect(textarea.dispatchEvent(topEdgeWheel)).toBe(false);
        expect(textarea.scrollTop).toBe(0);
        expect(viewportWheelListener).not.toHaveBeenCalled();

        textarea.scrollTop = 150;

        const bottomEdgeWheel = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: 120,
        });

        expect(textarea.dispatchEvent(bottomEdgeWheel)).toBe(false);
        expect(textarea.scrollTop).toBe(150);
        expect(viewportWheelListener).not.toHaveBeenCalled();

        viewport.removeEventListener('wheel', viewportWheelListener);
        wrapper.unmount();
    });

    it('covers optional row actions and pending row state', async () => {
        const addRow = vi.fn();
        const deleteSelectedRows = vi.fn();
        const { state } = createGridState({
            addRow,
            deleteSelectedRows,
            canAddRow: true,
            canDeleteSelectedRows: true,
            getPendingRowState: (rowIndex) => (rowIndex === 1 ? 'deleted' : rowIndex === 2 ? 'inserted' : undefined),
        });

        await state.addRow?.();
        expect(addRow).toHaveBeenCalledTimes(1);
        expect(state.canAddRow).toBe(true);

        state.selectRow(1);
        await state.deleteSelectedRows?.();
        expect(deleteSelectedRows).toHaveBeenCalledTimes(1);
        expect(state.canDeleteSelectedRows).toBe(true);
        expect(state.getPendingRowState?.(1)).toBe('deleted');
        expect(state.getPendingRowState?.(2)).toBe('inserted');
    });

    it('routes header click and drag interactions through the view layer and paints paginated row numbers', async () => {
        const { state } = createGridState({
            columns: ['a', 'b', 'c'],
            rows: [
                { a: 'alpha', b: 'bravo', c: 'charlie' },
                { a: 'delta', b: 'echo', c: 'foxtrot' },
                { a: 'golf', b: 'hotel', c: 'india' },
            ],
            offset: 200,
            limit: 100,
        });
        const { wrapper, vm, bodyCanvas } = await mountGridViewHarness(state);
        const bodyContext = canvasContexts.get(bodyCanvas);

        if (!bodyContext) {
            throw new Error('Expected body canvas context to be available.');
        }

        const gutterWidth = Number(vm.vs.gutterColumnWidth);

        vm.vs.pointerHandlers.handleHeaderClick(
            new MouseEvent('click', {
                clientX: gutterWidth + 12,
                clientY: 12,
                bubbles: true,
            })
        );
        await nextTick();

        expect(state.sortState).toEqual({ columnName: 'a', direction: 'desc' });

        vm.vs.pointerHandlers.handleHeaderPointerDown(
            new PointerEventCtor('pointerdown', {
                button: 0,
                clientX: gutterWidth + 12,
                clientY: 12,
                bubbles: true,
            }) as PointerEvent
        );
        vm.vs.pointerHandlers.handleWindowPointerMove(
            new PointerEventCtor('pointermove', {
                clientX: gutterWidth + 150,
                clientY: 12,
                bubbles: true,
            }) as PointerEvent
        );
        vm.vs.pointerHandlers.handleWindowPointerUp();
        await nextTick();

        expect(state.orderedColumns).toEqual(['b', 'a', 'c']);

        (vm.vs.viewportHelpers.updateViewportMetrics as (...args: unknown[]) => void)({ drawNow: true });

        const paintedRowNumbers = bodyContext.fillTextCalls
            .map((entry) => entry.text)
            .filter((text) => /^\d+$/.test(text))
            .slice(0, 3);

        expect(paintedRowNumbers).toEqual(['201', '202', '203']);

        wrapper.unmount();
    });

    it('mounts the public DataGrid component with the current state contract', () => {
        const { state } = createGridState();
        const wrapper = mount(DataGrid, {
            attachTo: document.body,
            props: {
                state,
                hasToolbar: true,
            },
            global: {
                directives: {
                    menu: {},
                    tooltip: {},
                },
                stubs: {
                    CenteredModal: {
                        template: '<div><slot /></div>',
                    },
                    IconButton: {
                        template: '<button type="button"><slot /></button>',
                    },
                },
            },
        });

        const searchInput = wrapper.find('input[type="search"]');

        expect(searchInput.exists()).toBe(true);
        expect(searchInput.attributes('placeholder')).toBe('Search grid');

        wrapper.unmount();
    });
});
