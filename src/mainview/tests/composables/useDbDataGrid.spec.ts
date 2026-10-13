// `useDbDataGrid` plans the grid's context menus from the real grid state (selection, table
// info, formatters) and hands the hooks to `useDataGrid`, which keeps them internal — the grid
// canvas consumes them. Capture that hand-off so the wiring can be asserted without the canvas.
// Only the process boundary (the app client) is stubbed; the grid itself is the real one.
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, nextTick, reactive, ref, unref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataGridCellContext, DataGridHeaderContext, DataGridRowContext } from '../../../datagrid';
import type { ContextMenuEntry, ContextMenuItem } from '../../../directives/contextMenuTypes';
import type { GridCustomFormatter, TableData, TableInfo } from '../../../shared/types';

const holders = vi.hoisted(() => ({
    formatters: [] as GridCustomFormatter[],
    gridOptions: undefined as unknown,
}));

vi.mock('../../appClient', () => ({
    appClientRpc: {
        request: {
            getGridCustomFormatters: async () => holders.formatters,
            // The grid loads its own table's formatter context, not just the formatter list.
            getGridFormatterState: async () => ({ formatters: holders.formatters, columnFormatterIds: {} }),
        },
    },
}));

vi.mock('../../../datagrid', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../datagrid')>();

    return {
        ...actual,
        useDataGrid: (options: Parameters<typeof actual.useDataGrid>[0]) => {
            holders.gridOptions = options;
            return actual.useDataGrid(options);
        },
    };
});

import { useDbDataGrid } from '../../composables/useDbDataGrid';
import { toast } from '../../../shared/utils/useToast';

const event = new MouseEvent('contextmenu');

const tableData: TableData = {
    columns: ['id', 'owner_id', 'note'],
    columnStats: {},
    rows: [
        { id: 1, owner_id: 11, note: 'first' },
        { id: 2, owner_id: 22, note: 'second' },
    ],
    rowCount: 2,
    limit: 100,
    offset: 0,
};

const tableInfo: TableInfo = {
    name: 'orders',
    columns: [
        {
            cid: 0,
            name: 'id',
            type: 'int',
            notNull: true,
            defaultValue: null,
            isPrimaryKey: true,
            primaryKeyOrdinal: 0,
            isAutoIncrement: false,
            comment: null,
            collation: null,
            onUpdate: null,
        },
        {
            cid: 1,
            name: 'owner_id',
            type: 'int',
            notNull: false,
            defaultValue: null,
            isPrimaryKey: false,
            primaryKeyOrdinal: null,
            isAutoIncrement: false,
            comment: null,
            collation: null,
            onUpdate: null,
        },
        {
            cid: 2,
            name: 'note',
            type: 'text',
            notNull: false,
            defaultValue: null,
            isPrimaryKey: false,
            primaryKeyOrdinal: null,
            isAutoIncrement: false,
            comment: null,
            collation: null,
            onUpdate: null,
        },
    ],
    indexes: [],
    foreignKeys: [{ id: 0, sequence: 0, table: 'users', from: 'owner_id', to: 'id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' }],
    rowCount: 2,
};

type GridMenuHooks = {
    cellContextMenuCustomItems: (context: DataGridCellContext) => ContextMenuEntry[];
    rowContextMenuCustomItems: (context: DataGridRowContext) => ContextMenuEntry[];
    headerContextMenuCustomItems: (context: DataGridHeaderContext) => ContextMenuEntry[];
};

function menuHooks() {
    if (!holders.gridOptions) {
        throw new Error('useDbDataGrid never handed its options to useDataGrid.');
    }

    return holders.gridOptions as GridMenuHooks;
}

function itemById(items: ContextMenuEntry[], id: string) {
    const item = items.find((entry): entry is ContextMenuItem => 'id' in entry && entry.id === id);

    if (!item) {
        throw new Error(`No menu item "${id}" in [${items.map((entry) => ('id' in entry ? entry.id : entry.type)).join(', ')}]`);
    }

    return item;
}

function idsOf(items: ContextMenuEntry[]) {
    return items.map((entry) => ('id' in entry ? entry.id : entry.type));
}

function createGrid(extra: Partial<Parameters<typeof useDbDataGrid>[0]> = {}) {
    const onPeekRelation = vi.fn(async () => undefined);
    const onPeekUsages = vi.fn(async () => undefined);
    let grid!: ReturnType<typeof useDbDataGrid>;

    mount(
        defineComponent({
            setup() {
                grid = useDbDataGrid({
                    connectionId: () => 7,
                    tableData: () => tableData,
                    tableInfo: () => tableInfo,
                    tableName: () => 'orders',
                    onPeekRelation,
                    onPeekUsages,
                    ...extra,
                });

                return () => null;
            },
        })
    );

    return { grid, onPeekRelation, onPeekUsages };
}

function cellContext(columnName: string, columnIndex: number): DataGridCellContext {
    return { rowIndex: 0, columnIndex, columnName, row: tableData.rows[0], value: tableData.rows[0]![columnName], event };
}

beforeEach(() => {
    holders.formatters = [];
    holders.gridOptions = undefined;
    localStorage.clear();
});

describe('useDbDataGrid cell context menu', () => {
    it('offers Peek Relation for a column the table has a foreign key on', async () => {
        const { onPeekRelation } = createGrid();
        const items = menuHooks().cellContextMenuCustomItems(cellContext('owner_id', 1));

        expect(idsOf(items)).toEqual(['peek-relation']);

        await itemById(items, 'peek-relation').action?.();

        expect(onPeekRelation).toHaveBeenCalledWith({
            connectionId: 7,
            rowIndex: 0,
            columnIndex: 1,
            columnName: 'owner_id',
            relation: { fromColumn: 'owner_id', targetTable: 'users', targetColumn: 'id' },
            value: 11,
            event,
        });
    });

    it('offers Peek Usages for a primary-key cell and sends the displayed row', async () => {
        const { onPeekUsages } = createGrid();
        const items = menuHooks().cellContextMenuCustomItems(cellContext('id', 0));

        expect(idsOf(items)).toEqual(['peek-usages']);

        await itemById(items, 'peek-usages').action?.();

        expect(onPeekUsages).toHaveBeenCalledWith({
            connectionId: 7,
            tableName: 'orders',
            columnName: 'id',
            value: 1,
            rowValues: { id: 1, owner_id: 11, note: 'first' },
            event,
        });
    });

    it('adds no peek items for a plain column', () => {
        createGrid();

        expect(menuHooks().cellContextMenuCustomItems(cellContext('note', 2))).toEqual([]);
    });

    it('opens the grid popover when the page wires no peek handler', async () => {
        const { grid } = createGrid({ onPeekRelation: undefined, onPeekUsages: undefined });
        const items = menuHooks().cellContextMenuCustomItems(cellContext('owner_id', 1));

        await itemById(items, 'peek-relation').action?.();

        expect(grid.fkPeekPopover.open).toBe(true);
        expect(grid.fkPeekPopover.title).toBe('users');
        expect(grid.fkPeekPopover.anchorColumnName).toBe('owner_id');
    });
});

describe('useDbDataGrid row context menu', () => {
    it('plans the single-row menu and opens the edit dialog for the clicked row', () => {
        const { grid } = createGrid();
        const items = menuHooks().rowContextMenuCustomItems({ rowIndex: 1, event });

        expect(idsOf(items)).toEqual(['edit-row', 'duplicate-row', 'delete-row', 'select-all']);

        itemById(items, 'edit-row').action?.();

        expect(grid.isEditRowDialogOpen).toBe(true);
        expect(grid.editRowDialogRowIndex).toBe(1);
    });

    it('duplicates the row without its primary key', () => {
        const { grid } = createGrid();
        const items = menuHooks().rowContextMenuCustomItems({ rowIndex: 0, event });

        itemById(items, 'duplicate-row').action?.();

        expect(grid.isAddRowDialogOpen).toBe(true);
        expect(grid.addRowDialogValues).toEqual({ owner_id: 11, note: 'first' });
    });

    it('counts an explicit multi-row selection and stages one delete per row', () => {
        const { grid } = createGrid();

        grid.selectRow(0, { mode: 'toggle' });
        grid.selectRow(1, { mode: 'toggle' });

        const items = menuHooks().rowContextMenuCustomItems({ rowIndex: 1, event });

        expect(idsOf(items)).toEqual(['delete-row']);
        expect(itemById(items, 'delete-row').label).toBe('Delete 2 Rows');

        itemById(items, 'delete-row').action?.();

        expect(grid.pendingChangeCount).toBe(2);
        expect(grid.previewQueries.filter((query) => query.startsWith('DELETE FROM'))).toHaveLength(2);
    });

    it('keeps the single-row menu for one selected row', () => {
        const { grid } = createGrid();

        grid.selectRow(0, { mode: 'toggle' });

        const items = menuHooks().rowContextMenuCustomItems({ rowIndex: 0, event });

        expect(idsOf(items)).toEqual(['edit-row', 'duplicate-row', 'delete-row', 'select-all']);
        expect(itemById(items, 'delete-row').label).toBe('Delete Row');
    });

    it('deletes the clicked row after selecting it', () => {
        const { grid } = createGrid();
        const items = menuHooks().rowContextMenuCustomItems({ rowIndex: 0, event });

        itemById(items, 'delete-row').action?.();

        expect(grid.selectedRowIndexes).toEqual([0]);
        expect(grid.pendingChangeCount).toBe(1);
    });
});

describe('useDbDataGrid header context menu', () => {
    it('lists the loaded custom formatters and hides Default on integer columns', async () => {
        holders.formatters = [{ id: 'upper', name: 'Upper case', template: '', createdAt: '', updatedAt: 'v1' }];
        createGrid();

        await flushPromises();

        expect(idsOf(menuHooks().headerContextMenuCustomItems({ columnIndex: 2, columnName: 'note', event }))).toEqual([
            'display-type-custom-default',
            'display-type-custom-upper',
            'display-type-custom-manage',
        ]);
        expect(idsOf(menuHooks().headerContextMenuCustomItems({ columnIndex: 0, columnName: 'id', event }))).toEqual(['display-type-custom-upper', 'display-type-custom-manage']);
    });
});

// The WHERE clause a save builds for an edited row comes from this change: with no primary key the
// old fallback named the first column, which matches every row that shares its value.
describe('useDbDataGrid pending changes', () => {
    type PendingChangeOptions = {
        createPendingChange: (change: { rowIndex: number; columnName: string; nextValue: string; previousValue: string; rawValue: string }) => unknown;
    };

    function pendingChange(columnName: string, nextValue: string, rowIndex = 0) {
        if (!holders.gridOptions) {
            throw new Error('useDbDataGrid never handed its options to useDataGrid.');
        }

        return (holders.gridOptions as PendingChangeOptions).createPendingChange({
            rowIndex,
            columnName,
            nextValue,
            previousValue: 'first',
            rawValue: 'first',
        });
    }

    function keylessTableInfo(): TableInfo {
        return { ...tableInfo, columns: tableInfo.columns.map((column) => ({ ...column, isPrimaryKey: false, primaryKeyOrdinal: null })) };
    }

    beforeEach(() => {
        toast.dismissToast();
    });

    it('names the edited row by its primary key', () => {
        createGrid();

        expect(pendingChange('note', 'changed')).toMatchObject({ columnName: 'note', matchColumn: 'id', matchValue: 1, nextValue: 'changed' });
    });

    it('refuses the edit when the table has no primary key', () => {
        createGrid({ tableInfo: keylessTableInfo });

        expect(pendingChange('note', 'changed')).toBeUndefined();
        expect(toast.message).toBe('Editing needs a primary key: without one, a save would overwrite every row that looks the same.');
    });

    it('still stages a value on a row that is not in the table yet', async () => {
        const { grid } = createGrid({ tableInfo: keylessTableInfo });

        // Row 2 is the pending insert: it has no stored row to match, so no key is needed.
        await grid.addRow?.();

        expect(pendingChange('note', 'changed', 2)).toMatchObject({ rowIndex: 2, columnName: 'note', nextValue: 'changed' });
        expect(toast.message).toBeUndefined();
    });
});

// A display-type switch changes no row and no formatter: the canvas repaints off the render
// version, so the switch has to be part of it or the grid keeps showing the cached text.
describe('useDbDataGrid display types', () => {
    it('bumps the render version when a column display type changes', () => {
        const { grid } = createGrid();
        const before = grid.renderVersion;

        (holders.gridOptions as unknown as { setColumnDisplayType: (columnName: string, displayType: string) => void }).setColumnDisplayType('owner_id', 'timestamp-seconds');

        expect(grid.renderVersion).not.toBe(before);
    });
});

// The grid is one shared instance behind every tab: leaving a tab parks its pending edits,
// position and selection under the tab's key, and coming back restores them.
describe('useDbDataGrid tab state', () => {
    it("keeps a tab's pending edit and position across a tab switch", async () => {
        const keyRef = ref('tab-a-stash-display');
        const { grid } = createGrid({ stateKey: () => keyRef.value });
        await nextTick();

        grid.startEditingCell(0, 2);
        grid.setEditingValue('changed');
        grid.commitEditingCell();
        expect(grid.pendingChangeCount).toBe(1);

        keyRef.value = 'tab-b-stash-display';
        await nextTick();
        expect(grid.pendingChangeCount).toBe(0);

        keyRef.value = 'tab-a-stash-display';
        await nextTick();
        expect(grid.pendingChangeCount).toBe(1);
        expect(grid.activeCell).toMatchObject({ rowIndex: 0, columnIndex: 2 });
    });

    it('drops the parked edit when the rows changed while away', async () => {
        const liveTable = reactive({ ...tableData, rows: tableData.rows.map((row) => ({ ...row })) });
        const keyRef = ref('tab-a-stash-drop');
        const { grid } = createGrid({ stateKey: () => keyRef.value, tableData: () => liveTable });
        await nextTick();

        grid.startEditingCell(0, 2);
        grid.setEditingValue('changed');
        grid.commitEditingCell();
        expect(grid.pendingChangeCount).toBe(1);

        // Leaving parks the edit; the rows then change (a save, a refresh), so the staged row
        // indexes no longer address the rows on screen and the edit must not come back.
        keyRef.value = 'tab-b-stash-drop';
        await nextTick();

        liveTable.rows = [...liveTable.rows, { id: 3, owner_id: 33, note: 'third' }];
        liveTable.rowCount = 3;
        await nextTick();

        keyRef.value = 'tab-a-stash-drop';
        await nextTick();
        expect(grid.pendingChangeCount).toBe(0);

        // And it stays gone on later visits: the stash is not waiting to reappear.
        keyRef.value = 'tab-b-stash-drop';
        await nextTick();
        keyRef.value = 'tab-a-stash-drop';
        await nextTick();
        expect(grid.pendingChangeCount).toBe(0);
    });

    it('parks the leaving tab when the panel unmounts before the watcher runs', async () => {
        const keyRef = ref('tab-a-unmount-park');
        let grid!: ReturnType<typeof useDbDataGrid>;

        const wrapper = mount(
            defineComponent({
                setup() {
                    grid = useDbDataGrid({
                        connectionId: () => 7,
                        tableData: () => tableData,
                        tableInfo: () => tableInfo,
                        tableName: () => 'orders',
                        stateKey: () => keyRef.value,
                    });

                    return () => null;
                },
            })
        );
        await nextTick();

        grid.startEditingCell(0, 2);
        grid.setEditingValue('changed');
        grid.commitEditingCell();
        expect(grid.pendingChangeCount).toBe(1);

        // A table-to-script switch unmounts the panel in the same tick the key changes, taking
        // the watcher with it before it can park the leaving view.
        keyRef.value = 'tab-b-unmount-park';
        wrapper.unmount();
        await nextTick();

        mount(
            defineComponent({
                setup() {
                    grid = useDbDataGrid({
                        connectionId: () => 7,
                        tableData: () => tableData,
                        tableInfo: () => tableInfo,
                        tableName: () => 'orders',
                        stateKey: () => 'tab-a-unmount-park',
                    });

                    return () => null;
                },
            })
        );
        await nextTick();

        expect(grid.pendingChangeCount).toBe(1);
        expect(grid.activeCell).toMatchObject({ rowIndex: 0, columnIndex: 2 });
    });
});

// NULL is the smallest value on every supported dialect except PostgreSQL, so the client-side
// sort has to place it first on ASC and last on DESC everywhere else.
describe('useDbDataGrid null ordering', () => {
    it('sorts nulls low for the default sqlite-flavoured dialect', async () => {
        createGrid();
        await nextTick();

        const options = holders.gridOptions as unknown as { sortNullOrdering?: unknown };

        expect(unref(options.sortNullOrdering as never)).toBe('nulls-low');
    });
});
