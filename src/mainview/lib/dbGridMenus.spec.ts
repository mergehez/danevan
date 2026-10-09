// The menu planners decide which grid context-menu entries exist and what each one does.
// They are pure, so the assertions below cover the planning directly instead of the canvas.
import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuEntry, ContextMenuItem } from '../../directives/contextMenuTypes';
import type { GridCustomFormatter } from '../../shared/types';
import {
    getDbGridCellMenuItems,
    getDbGridHeaderMenuItems,
    getDbGridRowMenuItems,
    getDbGridToolbarCopyItems,
    type DbGridCellMenuActions,
    type DbGridCellMenuParams,
    type DbGridHeaderMenuActions,
    type DbGridHeaderMenuParams,
    type DbGridRowMenuActions,
    type DbGridRowMenuParams,
} from './dbGridMenus';

const event = new MouseEvent('contextmenu');
const relation = { fromColumn: 'owner_id', targetTable: 'users', targetColumn: 'id' };

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

function cellParams(overrides: Partial<DbGridCellMenuParams> = {}): DbGridCellMenuParams {
    return {
        connectionId: 7,
        tableName: 'orders',
        rowIndex: 3,
        columnIndex: 1,
        columnName: 'owner_id',
        value: 42,
        isPrimaryKey: false,
        relation: undefined,
        event,
        ...overrides,
    };
}

function cellActions(overrides: Partial<DbGridCellMenuActions> = {}): DbGridCellMenuActions {
    return {
        onPeekRelation: vi.fn(async () => undefined),
        onPeekUsages: vi.fn(async () => undefined),
        openFkPeek: vi.fn(async () => undefined),
        getRowValues: vi.fn(() => ({ owner_id: 42, total: 10 })),
        ...overrides,
    };
}

function rowParams(overrides: Partial<DbGridRowMenuParams> = {}): DbGridRowMenuParams {
    return {
        connectionId: 7,
        tableName: 'orders',
        isTransposed: false,
        rowIndex: 2,
        selectedRowIndexes: [],
        selectedCellRange: undefined,
        primaryKeyColumns: ['id'],
        tableColumns: [{ name: 'id' }, { name: 'total' }, { name: 'note' }],
        sortedRowIndexes: [0, 1, 2, 3, 4],
        getCellValue: (rowIndex, columnName) => `${columnName}@${rowIndex}`,
        ...overrides,
    };
}

function rowActions(overrides: Partial<DbGridRowMenuActions> = {}): DbGridRowMenuActions {
    return {
        openEditRowDialog: vi.fn(),
        openDuplicateRowDialog: vi.fn(),
        selectRow: vi.fn(),
        clearSelectedRows: vi.fn(),
        selectAllRows: vi.fn(),
        deleteSelectedRows: vi.fn(),
        ...overrides,
    };
}

const formatters: GridCustomFormatter[] = [
    { id: 'upper', name: 'Upper case', template: '', createdAt: '', updatedAt: 'v1' },
    { id: 'link', name: 'Link', template: '', createdAt: '', updatedAt: 'v1' },
];

function headerParams(overrides: Partial<DbGridHeaderMenuParams> = {}): DbGridHeaderMenuParams {
    return {
        columnName: 'note',
        isIntegerColumn: false,
        assignedFormatterId: undefined,
        customFormatters: formatters,
        ...overrides,
    };
}

function headerActions(overrides: Partial<DbGridHeaderMenuActions> = {}): DbGridHeaderMenuActions {
    return {
        setColumnFormatter: vi.fn(),
        openFormatterManager: vi.fn(),
        ...overrides,
    };
}

describe('cell context menu planning', () => {
    it('adds nothing for a plain column without a relation', () => {
        expect(getDbGridCellMenuItems(cellParams(), cellActions())).toEqual([]);
    });

    it('adds Peek Relation for a foreign-key column', () => {
        const items = getDbGridCellMenuItems(cellParams({ relation }), cellActions());

        expect(idsOf(items)).toEqual(['peek-relation']);
        expect(itemById(items, 'peek-relation').label).toBe('Peek Relation');
    });

    it('sends the clicked cell and its relation to the peek handler', async () => {
        const actions = cellActions();
        const items = getDbGridCellMenuItems(cellParams({ relation }), actions);

        await itemById(items, 'peek-relation').action?.();

        expect(actions.onPeekRelation).toHaveBeenCalledWith({
            connectionId: 7,
            rowIndex: 3,
            columnIndex: 1,
            columnName: 'owner_id',
            relation,
            value: 42,
            event,
        });
        expect(actions.openFkPeek).not.toHaveBeenCalled();
    });

    it('falls back to the grid peek when there is no handler or connection', async () => {
        const withoutHandler = cellActions({ onPeekRelation: undefined });
        const withoutConnection = cellActions();

        await itemById(getDbGridCellMenuItems(cellParams({ relation }), withoutHandler), 'peek-relation').action?.();
        await itemById(getDbGridCellMenuItems(cellParams({ relation, connectionId: undefined }), withoutConnection), 'peek-relation').action?.();

        expect(withoutHandler.openFkPeek).toHaveBeenCalledTimes(1);
        expect(withoutConnection.openFkPeek).toHaveBeenCalledTimes(1);
    });

    it('adds Peek Usages for a non-null primary key with a connection and table', () => {
        const items = getDbGridCellMenuItems(cellParams({ isPrimaryKey: true }), cellActions());

        expect(idsOf(items)).toEqual(['peek-usages']);
        expect(itemById(items, 'peek-usages').label).toBe('Peek Usages');
    });

    it.each([
        ['a null value', { isPrimaryKey: true, value: null }],
        ['a non-primary column', { isPrimaryKey: false }],
        ['no connection', { isPrimaryKey: true, connectionId: undefined }],
        ['no table', { isPrimaryKey: true, tableName: undefined }],
    ])('omits Peek Usages for %s', (_case, overrides) => {
        const items = getDbGridCellMenuItems(cellParams(overrides as Partial<DbGridCellMenuParams>), cellActions());

        expect(idsOf(items)).toEqual([]);
    });

    it('omits Peek Usages when no usage handler is wired up', () => {
        const items = getDbGridCellMenuItems(cellParams({ isPrimaryKey: true }), cellActions({ onPeekUsages: undefined }));

        expect(idsOf(items)).toEqual([]);
    });

    it('sends the row values from the display function to the usage handler', async () => {
        const actions = cellActions({ getRowValues: vi.fn(() => ({ owner_id: 42, total: 10 })) });
        const items = getDbGridCellMenuItems(cellParams({ isPrimaryKey: true, columnName: 'id', value: 9 }), actions);

        await itemById(items, 'peek-usages').action?.();

        expect(actions.onPeekUsages).toHaveBeenCalledWith({
            connectionId: 7,
            tableName: 'orders',
            columnName: 'id',
            value: 9,
            rowValues: { owner_id: 42, total: 10 },
            event,
        });
    });

    it('lists the relation peek before the usage peek', () => {
        const items = getDbGridCellMenuItems(cellParams({ isPrimaryKey: true, relation }), cellActions());

        expect(idsOf(items)).toEqual(['peek-relation', 'peek-usages']);
    });
});

describe('row context menu planning', () => {
    it('offers the single-row actions for one clicked row', () => {
        const items = getDbGridRowMenuItems(rowParams(), rowActions());

        expect(idsOf(items)).toEqual(['edit-row', 'duplicate-row', 'delete-row', 'select-all']);
        expect(items.map((entry) => ('label' in entry ? entry.label : ''))).toEqual(['Edit Row', 'Duplicate Row', 'Delete Row', 'Select All Rows']);
    });

    it('switches to a counted delete for an explicit multi-row selection', () => {
        const items = getDbGridRowMenuItems(rowParams({ selectedRowIndexes: [1, 4] }), rowActions());

        expect(idsOf(items)).toEqual(['delete-row']);
        expect(itemById(items, 'delete-row').label).toBe('Delete 2 Rows');
    });

    it('switches to a counted delete for a cell range', () => {
        const range = { startRowIndex: 1, startColumnIndex: 0, endRowIndex: 3, endColumnIndex: 2 };
        const reversed = { startRowIndex: 3, startColumnIndex: 0, endRowIndex: 1, endColumnIndex: 2 };

        expect(itemById(getDbGridRowMenuItems(rowParams({ selectedCellRange: range }), rowActions()), 'delete-row').label).toBe('Delete 3 Rows');
        expect(itemById(getDbGridRowMenuItems(rowParams({ selectedCellRange: reversed }), rowActions()), 'delete-row').label).toBe('Delete 3 Rows');
    });

    it('prefers the explicit selection over a wider cell range', () => {
        const range = { startRowIndex: 0, startColumnIndex: 0, endRowIndex: 4, endColumnIndex: 1 };
        const items = getDbGridRowMenuItems(rowParams({ selectedRowIndexes: [2], selectedCellRange: range }), rowActions());

        expect(idsOf(items)).toEqual(['edit-row', 'duplicate-row', 'delete-row', 'select-all']);
        expect(itemById(items, 'delete-row').label).toBe('Delete Row');
    });

    it.each([
        ['a transposed grid', { isTransposed: true }],
        ['no connection', { connectionId: undefined }],
        ['no table', { tableName: undefined }],
    ])('offers nothing for %s', (_case, overrides) => {
        expect(getDbGridRowMenuItems(rowParams(overrides as Partial<DbGridRowMenuParams>), rowActions())).toEqual([]);
    });

    it('opens the edit dialog for the clicked row', () => {
        const actions = rowActions();
        const items = getDbGridRowMenuItems(rowParams({ rowIndex: 3 }), actions);

        itemById(items, 'edit-row').action?.();

        expect(actions.openEditRowDialog).toHaveBeenCalledWith(3);
    });

    it('duplicates the clicked row without its primary key columns', () => {
        const actions = rowActions();
        const items = getDbGridRowMenuItems(rowParams(), actions);

        itemById(items, 'duplicate-row').action?.();

        expect(actions.openDuplicateRowDialog).toHaveBeenCalledWith({ total: 'total@2', note: 'note@2' });
    });

    it('selects the clicked row before deleting it', () => {
        const calls: string[] = [];
        const actions = rowActions({
            clearSelectedRows: vi.fn(() => calls.push('clear')),
            selectRow: vi.fn(() => calls.push('select')),
            deleteSelectedRows: vi.fn(() => calls.push('delete')),
        });
        const items = getDbGridRowMenuItems(rowParams({ rowIndex: 2 }), actions);

        itemById(items, 'delete-row').action?.();

        expect(actions.clearSelectedRows).toHaveBeenCalledTimes(1);
        expect(actions.selectRow).toHaveBeenCalledWith(2, { focus: true });
        expect(calls).toEqual(['clear', 'select', 'delete']);
    });

    it('maps a cell range through the sorted indexes before deleting', () => {
        const range = { startRowIndex: 1, startColumnIndex: 0, endRowIndex: 3, endColumnIndex: 1 };
        const actions = rowActions();
        const items = getDbGridRowMenuItems(rowParams({ selectedCellRange: range, sortedRowIndexes: [4, 5, 6, 7, 8] }), actions);

        itemById(items, 'delete-row').action?.();

        expect(actions.selectRow).toHaveBeenCalledWith(7, { focus: true, mode: 'range', anchorRowIndex: 5 });
        expect(actions.clearSelectedRows).not.toHaveBeenCalled();
        expect(actions.deleteSelectedRows).toHaveBeenCalledTimes(1);
    });

    it('deletes a stale cell range without selecting anything', () => {
        const range = { startRowIndex: 1, startColumnIndex: 0, endRowIndex: 3, endColumnIndex: 1 };
        const actions = rowActions();
        const items = getDbGridRowMenuItems(rowParams({ selectedCellRange: range, sortedRowIndexes: [] }), actions);

        itemById(items, 'delete-row').action?.();

        expect(actions.selectRow).not.toHaveBeenCalled();
        expect(actions.deleteSelectedRows).toHaveBeenCalledTimes(1);
    });

    it('deletes an explicit multi-row selection without re-selecting', () => {
        const actions = rowActions();
        const items = getDbGridRowMenuItems(rowParams({ selectedRowIndexes: [1, 2] }), actions);

        itemById(items, 'delete-row').action?.();

        expect(actions.clearSelectedRows).not.toHaveBeenCalled();
        expect(actions.selectRow).not.toHaveBeenCalled();
        expect(actions.deleteSelectedRows).toHaveBeenCalledTimes(1);
    });

    it('selects every row from the select-all entry', () => {
        const actions = rowActions();
        const items = getDbGridRowMenuItems(rowParams(), actions);

        itemById(items, 'select-all').action?.();

        expect(actions.selectAllRows).toHaveBeenCalledTimes(1);
    });
});

describe('header context menu planning', () => {
    it('offers Default, every custom formatter and the manager for a text column', () => {
        const items = getDbGridHeaderMenuItems(headerParams(), headerActions());

        expect(idsOf(items)).toEqual(['display-type-custom-default', 'display-type-custom-upper', 'display-type-custom-link', 'display-type-custom-manage']);
        expect(items.map((entry) => ('label' in entry ? entry.label : ''))).toEqual(['Default', 'Upper case', 'Link', 'Manage Formatters...']);
    });

    it('omits Default for an integer column', () => {
        const items = getDbGridHeaderMenuItems(headerParams({ isIntegerColumn: true }), headerActions());

        expect(idsOf(items)).toEqual(['display-type-custom-upper', 'display-type-custom-link', 'display-type-custom-manage']);
    });

    it('checks the assigned formatter, or Default when none is assigned', () => {
        const unassigned = getDbGridHeaderMenuItems(headerParams(), headerActions());
        const assigned = getDbGridHeaderMenuItems(headerParams({ assignedFormatterId: 'link' }), headerActions());

        expect([itemById(unassigned, 'display-type-custom-default').checked, itemById(unassigned, 'display-type-custom-upper').checked]).toEqual([true, false]);
        expect([
            itemById(assigned, 'display-type-custom-default').checked,
            itemById(assigned, 'display-type-custom-upper').checked,
            itemById(assigned, 'display-type-custom-link').checked,
        ]).toEqual([false, false, true]);
    });

    it('assigns a formatter and clears it back to Default', () => {
        const actions = headerActions();
        const items = getDbGridHeaderMenuItems(headerParams(), actions);

        itemById(items, 'display-type-custom-upper').action?.();
        itemById(items, 'display-type-custom-default').action?.();

        expect(actions.setColumnFormatter).toHaveBeenNthCalledWith(1, 'note', 'upper');
        expect(actions.setColumnFormatter).toHaveBeenNthCalledWith(2, 'note', undefined);
    });

    it('opens the formatter manager', () => {
        const actions = headerActions();
        const items = getDbGridHeaderMenuItems(headerParams(), actions);

        itemById(items, 'display-type-custom-manage').action?.();

        expect(actions.openFormatterManager).toHaveBeenCalledTimes(1);
    });
});

describe('toolbar copy planning', () => {
    it('offers Copy as DDL for a table-bound grid', async () => {
        const onCopyAsDdl = vi.fn(async () => undefined);
        const items = getDbGridToolbarCopyItems({ connectionId: 7, tableName: 'orders', onCopyAsDdl });

        expect(idsOf(items)).toEqual(['toolbar-copy-all-as-ddl']);
        expect(itemById(items, 'toolbar-copy-all-as-ddl').label).toBe('As DDL');

        await itemById(items, 'toolbar-copy-all-as-ddl').action?.();

        expect(onCopyAsDdl).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['no connection', { connectionId: undefined, tableName: 'orders' }],
        ['no table', { connectionId: 7, tableName: undefined }],
    ])('offers nothing with %s', (_case, overrides) => {
        const items = getDbGridToolbarCopyItems({ ...overrides, onCopyAsDdl: vi.fn() });

        expect(items).toEqual([]);
    });
});
