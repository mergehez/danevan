// @vitest-environment jsdom
import DataGrid from '#datagrid/DataGrid.tsx';
import { mount } from '@vue/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, ref, type PropType } from 'vue';
import {
    DATA_GRID_COLUMN_MIN_WIDTH,
    DATA_GRID_LAYOUT_SAVE_DEBOUNCE_MS,
    DATA_GRID_ROW_HEIGHT,
    DATA_GRID_SEARCH_DEBOUNCE_MS,
    useDataGrid,
    useDataGridView,
    type DataGridCellValue,
    type DataGridPendingChange,
    type DataGridPendingChangeContext,
    type DataGridRow,
    type TDataGridState,
} from '../../../datagrid';
import type { DbType } from '../../../shared/types';
import { DATA_GRID_MODAL_PREFERENCES_KEY } from '#datagrid/dataGridModalPreferences.ts';
import { resetCacheState } from '#shared/utils/useCache.ts';

const writeClipboardText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
vi.stubGlobal('navigator', { clipboard: { writeText: writeClipboardText } });

type GridStateOptions = {
    columns?: string[];
    rows?: DataGridRow[];
    offset?: number;
    limit?: number;
    searchable?: boolean;
    sqlInsertTableName?: string;
    sqlInsertDialect?: DbType;
    primaryKeyColumns?: string[];
    layoutStorageKey?: string;
    addRow?: () => void | Promise<void>;
    deleteSelectedRows?: () => void | Promise<void>;
    canAddRow?: boolean;
    canDeleteSelectedRows?: boolean;
    getPendingRowState?: (rowIndex: number) => 'inserted' | 'deleted' | undefined;
    parseEditingValue?: (draftValue: string, originalValue: DataGridCellValue) => DataGridCellValue;
    createPendingChange?: (change: DataGridPendingChangeContext) => DataGridPendingChange;
    getFormattedCellValue?: (rowIndex: number, columnName: string) => string;
};

type MockCanvasContext = CanvasRenderingContext2D & {
    fillTextCalls: Array<{ text: string; x: number; y: number }>;
    measureTextCalls: string[];
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
        measureTextCalls: [] as string[],
        beginPath: () => {},
        clearRect: () => {},
        clip: () => {},
        fill: () => {},
        fillRect: () => {},
        lineTo: () => {},
        measureText(text: string) {
            context.measureTextCalls.push(String(text));
            return { width: String(text).length * 7 };
        },
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
    const layoutStorageKey = options.layoutStorageKey ?? `data-grid-test-${layoutStorageCounter++}`;

    const state = useDataGrid({
        layoutStorageKey,
        searchable: options.searchable ?? true,
        editable: true,
        enableTranspose: true,
        sqlInsertTableName: options.sqlInsertTableName ?? 'people',
        sqlInsertDialect: options.sqlInsertDialect ?? 'sqlite',
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
        parseEditingValue: options.parseEditingValue,
        createPendingChange: options.createPendingChange,
        getFormattedCellValue: options.getFormattedCellValue,
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
            // oxlint-disable-next-line vue/no-dupe-keys
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

function mountDataGrid(state: TDataGridState) {
    return mount(DataGrid, {
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
}

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
    // The modal preferences are a module-level singleton; reset it so one test
    // cannot leak a toggle into the next.
    resetCacheState(DATA_GRID_MODAL_PREFERENCES_KEY);
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

    it('covers search navigation, cell-range selection, and transpose mode', async () => {
        vi.useFakeTimers();

        try {
            const { state } = createGridState({
                rows: [
                    { id: 1, name: 'Alpha', city: 'Berlin' },
                    { id: 2, name: 'Alphabet', city: 'Boston' },
                    { id: 3, name: 'Zulu', city: 'Cairo' },
                ],
            });

            state.setSearchQuery('alp');

            // The input updates immediately; matching waits for typing to pause.
            expect(state.searchQuery).toBe('alp');
            await nextTick();
            expect(state.searchMatchCount).toBe(0);

            vi.advanceTimersByTime(DATA_GRID_SEARCH_DEBOUNCE_MS);
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
        } finally {
            vi.useRealTimers();
        }
    });

    it('formats each cell once for a search instead of on every keystroke', async () => {
        vi.useFakeTimers();

        try {
            const values: Record<string, string[]> = {
                id: ['1', '2', '3'],
                name: ['Alpha', 'Alphabet', 'Zulu'],
                city: ['Berlin', 'Boston', 'Cairo'],
            };
            const formatCell = vi.fn((rowIndex: number, columnName: string) => values[columnName]?.[rowIndex] ?? '');
            const { state } = createGridState({
                columns: ['id', 'name', 'city'],
                rows: [
                    { id: 1, name: 'Alpha', city: 'Berlin' },
                    { id: 2, name: 'Alphabet', city: 'Boston' },
                    { id: 3, name: 'Zulu', city: 'Cairo' },
                ],
                getFormattedCellValue: formatCell,
            });

            // Nothing is formatted while the user is only typing.
            state.setSearchQuery('zulu');
            await nextTick();
            expect(formatCell).not.toHaveBeenCalled();

            // The first committed query builds the index: rows × columns, once.
            vi.advanceTimersByTime(DATA_GRID_SEARCH_DEBOUNCE_MS);
            expect(formatCell).toHaveBeenCalledTimes(9);
            expect(state.searchMatchCount).toBe(1);

            // Every further keystroke reuses it.
            state.setSearchQuery('a');
            await nextTick();
            vi.advanceTimersByTime(DATA_GRID_SEARCH_DEBOUNCE_MS);
            expect(formatCell).toHaveBeenCalledTimes(9);
            expect(state.searchMatchCount).toBe(3);

            // Clearing is immediate and does not wait for the debounce.
            state.setSearchQuery('');
            await nextTick();
            expect(state.searchMatchCount).toBe(0);
            expect(state.sortedRowIndexes).toEqual([0, 1, 2]);
        } finally {
            vi.useRealTimers();
        }
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

    it('writes the copied statements as literals the target dialect reads back', async () => {
        // MySQL reads a backslash as an escape, so a copied INSERT for it has to double it; the
        // standard-conforming drivers keep it, and doubling there would change the value.
        const { state: mysqlState } = createGridState({ rows: [{ id: 1, name: 'C:\\temp', city: 'Paris' }], sqlInsertDialect: 'mysql' });
        await mysqlState.copyAllCellsAsSqlInsert?.();
        expect(writeClipboardText.mock.calls.at(-1)?.[0]).toBe("INSERT INTO `people`\n(`id`, `name`, `city`)\nVALUES\n(1, 'C:\\\\temp', 'Paris');");

        const { state: sqliteState } = createGridState({ rows: [{ id: 1, name: 'C:\\temp', city: 'Paris' }] });
        await sqliteState.copyAllCellsAsSqlInsert?.();
        expect(writeClipboardText.mock.calls.at(-1)?.[0]).toBe(`INSERT INTO "people"\n("id", "name", "city")\nVALUES\n(1, 'C:\\temp', 'Paris');`);
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

    it('writes the grid layout once at the end of a column resize', () => {
        vi.useFakeTimers();

        try {
            const layoutStorageKey = 'data-grid-test-resize-save';
            const { state } = createGridState({ layoutStorageKey });
            const setItem = vi.spyOn(Storage.prototype, 'setItem');

            // A resize drag updates the width on every pointermove.
            for (let width = DATA_GRID_COLUMN_MIN_WIDTH + 5; width < DATA_GRID_COLUMN_MIN_WIDTH + 45; width += 5) {
                state.setColumnWidth('name', width);
            }

            expect(setItem).not.toHaveBeenCalled();

            vi.advanceTimersByTime(DATA_GRID_LAYOUT_SAVE_DEBOUNCE_MS);

            expect(setItem).toHaveBeenCalledTimes(1);
            expect(JSON.parse(localStorage.getItem(layoutStorageKey) ?? '{}').columnWidths.name).toBe(DATA_GRID_COLUMN_MIN_WIDTH + 40);

            // Every other layout change is still persisted immediately.
            setItem.mockClear();
            state.hideColumn('city');

            expect(setItem).toHaveBeenCalledTimes(1);
            expect(JSON.parse(localStorage.getItem(layoutStorageKey) ?? '{}').hiddenColumns).toContain('city');
        } finally {
            vi.useRealTimers();
        }
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
        const wrapper = mountDataGrid(state);

        const searchInput = wrapper.find('input[type="search"]');

        expect(searchInput.exists()).toBe(true);
        expect(searchInput.attributes('placeholder')).toBe('Search grid');
        // Columns are loaded, so the grid draws a viewport rather than the "no table" message.
        expect(wrapper.find('[data-testid="data-grid-viewport"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Select a table to preview rows.');

        wrapper.unmount();
    });

    it('shows the placeholder instead of a viewport when no table is loaded', () => {
        const { state } = createGridState({ columns: [] });
        const wrapper = mountDataGrid(state);

        expect(wrapper.find('[data-testid="data-grid-viewport"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Select a table to preview rows.');

        wrapper.unmount();
    });

    it('keeps the column headers and shows a no-rows message for an empty table', async () => {
        vi.useFakeTimers();

        try {
            const { state } = createGridState({ rows: [] });
            const wrapper = mount(DataGrid, {
                attachTo: document.body,
                props: { state },
                global: { directives: { menu: {}, tooltip: {} } },
            });

            // Header canvas only: no rows, so no body canvas to paint.
            expect(wrapper.findAll('canvas')).toHaveLength(1);
            expect(wrapper.text()).toContain('No rows');

            state.setSearchQuery('zzz');
            await nextTick();
            vi.advanceTimersByTime(DATA_GRID_SEARCH_DEBOUNCE_MS);
            await nextTick();

            expect(wrapper.text()).toContain('No matching rows.');

            wrapper.unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it('shows the empty hint instead of headers when there is no result set', () => {
        const { state } = createGridState({ columns: [], rows: [] });
        const wrapper = mount(DataGrid, {
            attachTo: document.body,
            props: { state },
            global: { directives: { menu: {}, tooltip: {} } },
        });

        expect(wrapper.findAll('canvas')).toHaveLength(0);
        expect(wrapper.text()).toContain('Select a table to preview rows.');

        wrapper.unmount();
    });

    it('keeps each grid instance on its own layout for the same table', () => {
        const layoutStorageKey = 'data-grid-test-shared';
        const first = createGridState({ layoutStorageKey, columns: ['id', 'DateLastLogin'] });

        first.state.toggleSort('DateLastLogin');
        expect(first.state.sortState).toMatchObject({ columnName: 'DateLastLogin' });

        // A second grid for the same storage key but a different result set
        // (e.g. a script result for that table) neither inherits nor clobbers
        // the first grid's layout.
        const second = createGridState({ layoutStorageKey, columns: ['id', 'email'] });

        expect(second.state.sortState).toBeNull();
        expect(first.state.sortState).toMatchObject({ columnName: 'DateLastLogin' });
        expect(localStorage.getItem(layoutStorageKey) ?? '').not.toContain('DateLastLogin');
    });

    it('keeps arrow keys and Enter in the inline cell editor', async () => {
        const { state } = createGridState();
        const wrapper = mount(DataGrid, {
            attachTo: document.body,
            props: { state },
            global: { directives: { menu: {}, tooltip: {} } },
        });

        state.startEditingCell(0, 1);
        await nextTick();

        const viewport = wrapper.find('[tabindex="0"]').element as HTMLElement;
        const editor = wrapper.find('textarea').element as HTMLTextAreaElement;

        const typedEvent = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
        editor.dispatchEvent(typedEvent);
        expect(typedEvent.defaultPrevented).toBe(false);

        const gridKeydown = vi.fn();
        viewport.addEventListener('keydown', gridKeydown);

        // The arrows belong to the caret: not cancelled (that would break the caret)
        // and not propagated (that would move the grid's active cell).
        for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
            const arrowEvent = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
            editor.dispatchEvent(arrowEvent);
            expect(arrowEvent.defaultPrevented).toBe(false);
        }

        expect(gridKeydown).not.toHaveBeenCalled();
        expect(state.activeCell).toMatchObject({ rowIndex: 0, columnIndex: 1 });
        expect(state.editingCell).toMatchObject({ rowIndex: 0, columnIndex: 1 });

        // Escape abandons the draft without touching the grid.
        const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        editor.dispatchEvent(escapeEvent);
        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(state.editingCell.rowIndex).toBe(-1);
        expect(state.activeCell).toMatchObject({ rowIndex: 0, columnIndex: 1 });

        // Enter commits and moves the active cell one row down.
        state.startEditingCell(0, 1);
        await nextTick();
        const reopened = wrapper.find('textarea').element as HTMLTextAreaElement;
        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        reopened.dispatchEvent(enterEvent);
        expect(enterEvent.defaultPrevented).toBe(true);
        expect(gridKeydown).not.toHaveBeenCalled();
        expect(state.editingCell.rowIndex).toBe(-1);
        expect(state.activeCell).toMatchObject({ rowIndex: 1, columnIndex: 1 });

        viewport.removeEventListener('keydown', gridKeydown);
        wrapper.unmount();
    });

    it('does not stage a change when the inline editor is closed without typing', () => {
        const binary = new Uint8Array([137, 80, 78, 71]);
        const { rows, state } = createGridState({
            columns: ['id', 'board', 'score', 'doc'],
            rows: [{ id: 1, board: binary, score: 42, doc: '{"a":1}' }],
            parseEditingValue: (draftValue, originalValue) => (typeof originalValue === 'number' ? Number(draftValue) : draftValue),
            createPendingChange: ({ rowIndex, columnName, nextValue, rawValue }) => ({ rowIndex, columnName, previousValue: rawValue, nextValue, rawValue }),
        });

        // A binary value is formatted as JSON and parsed back to a string, and a
        // numeric value coerces — both used to look like edits on a mere blur.
        for (const columnIndex of [1, 2, 3]) {
            state.startEditingCell(0, columnIndex);
            state.commitEditingCell();
        }

        expect(state.dirtyChanges).toHaveLength(0);
        expect(rows.value[0]?.board).toBe(binary);
        expect(rows.value[0]?.score).toBe(42);

        // Typing still stages a change.
        state.startEditingCell(0, 2);
        state.setEditingValue('43');
        state.commitEditingCell();

        expect(state.dirtyChanges).toHaveLength(1);
        expect(state.dirtyChanges[0]).toMatchObject({ columnName: 'score', nextValue: 43 });
    });

    it('does not mark a binary cell changed when the editor is blurred without typing', () => {
        const binary = new Uint8Array([1, 2, 3]);
        const { rows, state } = createGridState({
            columns: ['id', 'board'],
            rows: [{ id: 1, board: binary }],
        });

        state.startEditingCell(0, 1);
        state.commitEditingCell();

        expect(rows.value[0]?.board).toBe(binary);
    });

    it('remembers the modal editor text wrap preference across dialogs', async () => {
        const { state } = createGridState();
        const { vm, wrapper } = await mountGridViewHarness(state);

        expect(vm.vs.isModalEditTextWrap).toBe(false);

        vm.vs.toggleModalEditTextWrap();
        await nextTick();

        state.openModalEditingCell?.(0, 1);
        await nextTick();
        expect(vm.vs.isModalEditTextWrap).toBe(true);

        state.closeModalEditingCell?.();
        state.openModalEditingCell?.(0, 1);
        await nextTick();

        expect(vm.vs.isModalEditTextWrap).toBe(true);
        expect(JSON.parse(localStorage.getItem(DATA_GRID_MODAL_PREFERENCES_KEY) ?? 'null')).toEqual({ textWrap: true });

        wrapper.unmount();
    });

    it('offers JSON prettify and compact only for a value that is a JSON object', async () => {
        const { state } = createGridState({
            columns: ['id', 'payload'],
            rows: [
                { id: 1, payload: '{"a":1,"b":[2,3]}' },
                { id: 2, payload: 'hello' },
                { id: 3, payload: '{not json}' },
            ],
        });
        const { vm, wrapper } = await mountGridViewHarness(state);

        state.openModalEditingCell?.(0, 1);
        await nextTick();
        expect(vm.vs.isModalEditJson).toBe(true);

        vm.vs.prettifyModalEditValue();
        expect(state.modalEditingCell.draftValue).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));

        vm.vs.compactModalEditValue();
        expect(state.modalEditingCell.draftValue).toBe('{"a":1,"b":[2,3]}');

        // Typing must not re-evaluate JSON-ness: the flag stays as it was at open time.
        state.setModalEditingValue?.('definitely not json');
        await nextTick();
        expect(vm.vs.isModalEditJson).toBe(true);

        // Clicking with an invalid draft is a no-op instead of throwing.
        vm.vs.prettifyModalEditValue();
        expect(state.modalEditingCell.draftValue).toBe('definitely not json');

        for (const rowIndex of [1, 2]) {
            state.closeModalEditingCell?.();
            state.openModalEditingCell?.(rowIndex, 1);
            await nextTick();
            expect(vm.vs.isModalEditJson).toBe(false);
        }

        wrapper.unmount();
    });

    it('renders the JSON actions in the modal editor only for JSON values', async () => {
        const { state } = createGridState({
            columns: ['id', 'payload'],
            rows: [
                { id: 1, payload: '{"a":1}' },
                { id: 2, payload: 'hello' },
            ],
        });
        const wrapper = mount(DataGrid, {
            attachTo: document.body,
            props: { state },
            global: {
                directives: { menu: {}, tooltip: {} },
                stubs: {
                    CenteredModal: { template: '<div><slot /></div>' },
                    IconButton: { template: '<button type="button"><slot /></button>' },
                },
            },
        });

        state.openModalEditingCell?.(0, 1);
        await nextTick();

        await wrapper.get('[data-testid="modal-edit-prettify"]').trigger('click');
        expect((wrapper.get('[data-testid="modal-edit-value"]').element as HTMLTextAreaElement).value).toBe(JSON.stringify({ a: 1 }, null, 2));

        await wrapper.get('[data-testid="modal-edit-compact"]').trigger('click');
        expect((wrapper.get('[data-testid="modal-edit-value"]').element as HTMLTextAreaElement).value).toBe('{"a":1}');

        state.closeModalEditingCell?.();
        state.openModalEditingCell?.(1, 1);
        await nextTick();

        expect(wrapper.find('[data-testid="modal-edit-prettify"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="modal-edit-compact"]').exists()).toBe(false);

        wrapper.unmount();
    });

    it('never sorts by a column the result set does not have', () => {
        const layoutStorageKey = 'data-grid-test-stale-sort';

        localStorage.setItem(layoutStorageKey, JSON.stringify({ columnWidths: { DateLastLogin: 180 }, sort: { columnName: 'DateLastLogin', direction: 'desc' } }));

        const { state } = createGridState({ layoutStorageKey, columns: ['id', 'email'] });

        expect(state.sortState).toBeNull();
        expect(localStorage.getItem(layoutStorageKey) ?? '').not.toContain('DateLastLogin');
    });

    // The draw pass asks these per visible cell, so they must not walk the row
    // list or the selection arrays on every call.
    it('answers selection queries without scanning the rows per cell', () => {
        const rowCount = 2000;
        const { state } = createGridState({
            columns: ['id', 'name', 'city'],
            rows: Array.from({ length: rowCount }, (_, index) => ({ id: index + 1, name: `Row ${index}`, city: `City ${index}` })),
        });

        state.selectCellRange(10, 0, 20, 2);

        const indexOf = vi.spyOn(Array.prototype, 'indexOf');
        const includes = vi.spyOn(Array.prototype, 'includes');

        // A real answer first: the range, its edges, and the columns outside it.
        expect(state.isSelectedCell(10, 0)).toBe(true);
        expect(state.isSelectedCell(15, 1)).toBe(true);
        expect(state.isSelectedCell(20, 2)).toBe(true);
        expect(state.isSelectedCell(9, 1)).toBe(false);
        expect(state.isSelectedCell(21, 1)).toBe(false);
        expect(state.isSelectedCell(15, 3)).toBe(false);

        // Then the cost: one index build, not one scan per row.
        indexOf.mockClear();
        includes.mockClear();

        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
            state.isSelectedCell(rowIndex, 1);
        }

        expect(indexOf.mock.calls.length).toBeLessThanOrEqual(2);
        expect(includes.mock.calls.length).toBeLessThanOrEqual(2);

        indexOf.mockRestore();
        includes.mockRestore();
    });

    it('keeps the all-rows-selected answer cached across frames', () => {
        const { state } = createGridState({
            columns: ['id', 'name'],
            rows: Array.from({ length: 2000 }, (_, index) => ({ id: index + 1, name: `Row ${index}` })),
        });

        state.selectAllRows();
        expect(state.areAllRowsSelected()).toBe(true);

        const every = vi.spyOn(Array.prototype, 'every');

        for (let frame = 0; frame < 50; frame += 1) {
            expect(state.areAllRowsSelected()).toBe(true);
        }

        // The 2000-row `every` runs once, not once per frame.
        expect(every.mock.calls.length).toBeLessThanOrEqual(1);
        every.mockRestore();

        // ...and it is a real answer, not a constant: dropping one row flips it back.
        state.selectRow(0, { mode: 'toggle' });
        expect(state.areAllRowsSelected()).toBe(false);

        state.selectAllRows();
        expect(state.areAllRowsSelected()).toBe(true);

        state.clearSelectedRows();
        expect(state.areAllRowsSelected()).toBe(false);
    });

    it('does not re-measure the same text on every frame', async () => {
        const suffix = `unique-${Date.now()}`;
        const { state } = createGridState({
            columns: ['id', 'name', 'city'],
            rows: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `${suffix}-${index}`, city: `${suffix}-city-${index}` })),
        });
        const { vm, bodyCanvas, wrapper } = await mountGridViewHarness(state);
        const context = canvasContexts.get(bodyCanvas)!;

        // Column widths are measured once; the body text is what repeats per frame.
        vm.vs.viewportHelpers.updateViewportMetrics({ drawNow: true });
        context.measureTextCalls.length = 0;
        vm.vs.viewportHelpers.updateViewportMetrics({ drawNow: true });
        const warmFrameMeasurements = context.measureTextCalls.length;

        context.measureTextCalls.length = 0;
        vm.vs.viewportHelpers.updateViewportMetrics({ drawNow: true });
        const secondWarmFrameMeasurements = context.measureTextCalls.length;

        expect(warmFrameMeasurements).toBe(0);
        expect(secondWarmFrameMeasurements).toBe(0);

        wrapper.unmount();
    });

    it('formats each cell once and still shows an edited value', async () => {
        const suffix = `fmt-${Date.now()}`;
        const values: Record<string, string[]> = {
            id: Array.from({ length: 12 }, (_, index) => String(index + 1)),
            name: Array.from({ length: 12 }, (_, index) => `${suffix}-${index}`),
            city: Array.from({ length: 12 }, (_, index) => `${suffix}-city-${index}`),
        };
        const formatCell = vi.fn((rowIndex: number, columnName: string) => values[columnName]?.[rowIndex] ?? '');
        const { state } = createGridState({
            columns: ['id', 'name', 'city'],
            rows: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: values.name?.[index], city: values.city?.[index] })),
            getFormattedCellValue: formatCell,
        });
        const { vm, wrapper } = await mountGridViewHarness(state);

        vm.vs.viewportHelpers.updateViewportMetrics({ drawNow: true });
        formatCell.mockClear();
        vm.vs.viewportHelpers.updateViewportMetrics({ drawNow: true });

        expect(formatCell).not.toHaveBeenCalled();

        // Editing the cell must invalidate its cached text.
        state.startEditingCell(0, 1);
        state.setEditingValue('EDITED-VALUE');
        state.commitEditingCell();
        if (values.name) {
            values.name[0] = 'EDITED-VALUE';
        }

        vm.vs.viewportHelpers.updateViewportMetrics({ drawNow: true });

        expect(formatCell).toHaveBeenCalledWith(0, 'name');

        wrapper.unmount();
    });
});
