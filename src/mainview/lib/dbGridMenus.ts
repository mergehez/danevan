/**
 * Planning for the data grid's context menus: which items the database grid offers and
 * what each one does. Kept free of Vue state so the menus can be asserted directly.
 */
import type { ContextMenuEntry } from '../../directives/contextMenuTypes';
import type { GridCustomFormatter, SqlValue } from '../../shared/types';
import type { FkPeekRelation } from '../composables/useForeignKeyPeek';

export type DbGridPeekRelationParams = {
    connectionId: number;
    rowIndex: number;
    columnIndex: number;
    columnName: string;
    relation: FkPeekRelation;
    value: SqlValue;
    event: MouseEvent;
};

export type DbGridPeekUsagesParams = {
    connectionId: number;
    tableName: string;
    columnName: string;
    value: SqlValue;
    rowValues: Record<string, SqlValue>;
    event: MouseEvent;
};

export type DbGridCellMenuParams = {
    connectionId: number | undefined;
    tableName: string | undefined;
    rowIndex: number;
    columnIndex: number;
    columnName: string;
    value: SqlValue;
    isPrimaryKey: boolean;
    relation: FkPeekRelation | undefined;
    event: MouseEvent;
};

export type DbGridCellMenuActions = {
    onPeekRelation?: (params: DbGridPeekRelationParams) => void | Promise<void>;
    onPeekUsages?: (params: DbGridPeekUsagesParams) => void | Promise<void>;
    /** Used for the relation peek when no `onPeekRelation` handler is wired up. */
    openFkPeek: () => void | Promise<void>;
    getRowValues: () => Record<string, SqlValue>;
};

export function getDbGridCellMenuItems(params: DbGridCellMenuParams, actions: DbGridCellMenuActions) {
    const { connectionId, tableName, rowIndex, columnIndex, columnName, value, relation, event } = params;
    const { onPeekRelation, onPeekUsages, openFkPeek, getRowValues } = actions;
    const items: ContextMenuEntry[] = [];

    if (relation) {
        items.push({
            id: 'peek-relation',
            label: 'Peek Relation',
            action: async () => {
                if (connectionId && onPeekRelation) {
                    await onPeekRelation({ connectionId, rowIndex, columnIndex, columnName, relation, value, event });
                    return;
                }

                await openFkPeek();
            },
        });
    }

    if (params.isPrimaryKey && value != null && connectionId && tableName && onPeekUsages) {
        items.push({
            id: 'peek-usages',
            label: 'Peek Usages',
            action: async () => {
                await onPeekUsages({ connectionId, tableName, columnName, value, rowValues: getRowValues(), event });
            },
        });
    }

    return items;
}

export type DbGridRowMenuParams = {
    connectionId: number | undefined;
    tableName: string | undefined;
    isTransposed: boolean;
    rowIndex: number;
    selectedRowIndexes: number[];
    selectedCellRange: { startRowIndex: number; endRowIndex: number } | undefined;
    primaryKeyColumns: string[];
    tableColumns: Array<{ name: string }>;
    sortedRowIndexes: number[];
    getCellValue: (rowIndex: number, columnName: string) => SqlValue;
};

export type DbGridRowMenuActions = {
    openEditRowDialog: (rowIndex: number) => void;
    openDuplicateRowDialog: (rowValues: Record<string, SqlValue>) => void;
    selectRow: (rowIndex: number, options: { focus: boolean; mode?: 'range'; anchorRowIndex?: number }) => void;
    clearSelectedRows: () => void;
    selectAllRows: () => void;
    deleteSelectedRows: () => void;
};

export function getDbGridRowMenuItems(params: DbGridRowMenuParams, actions: DbGridRowMenuActions) {
    const { connectionId, tableName, isTransposed, rowIndex, selectedRowIndexes, selectedCellRange, primaryKeyColumns, tableColumns, sortedRowIndexes, getCellValue } = params;
    const items: ContextMenuEntry[] = [];

    if (isTransposed || !connectionId || !tableName) {
        return items;
    }

    const pkColumns = new Set(primaryKeyColumns);
    const rowValues = Object.fromEntries(tableColumns.filter((column) => !pkColumns.has(column.name)).map((column) => [column.name, getCellValue(rowIndex, column.name)]));

    // Compute effective multi-row selection: explicit row selection
    // OR a cell-range spanning multiple rows (which the Delete key handler also recognises).
    const explicitSelectedRowCount = selectedRowIndexes.length;
    const cellRangeRowCount = selectedCellRange != null ? Math.abs(selectedCellRange.endRowIndex - selectedCellRange.startRowIndex) + 1 : 0;
    const effectiveSelectedRowCount = explicitSelectedRowCount > 0 ? explicitSelectedRowCount : cellRangeRowCount;
    const isMultiSelect = effectiveSelectedRowCount > 1;

    if (!isMultiSelect) {
        items.push({
            id: 'edit-row',
            label: 'Edit Row',
            action: () => actions.openEditRowDialog(rowIndex),
        });
    }

    if (!isMultiSelect) {
        items.push({
            id: 'duplicate-row',
            label: 'Duplicate Row',
            action: () => actions.openDuplicateRowDialog(rowValues),
        });
    }

    items.push({
        id: 'delete-row',
        label: isMultiSelect ? `Delete ${effectiveSelectedRowCount} Rows` : 'Delete Row',
        action: () => {
            if (explicitSelectedRowCount === 0 && selectedCellRange != null) {
                // Select rows from cell range (same logic as the Delete key handler).
                const startRowIndex = sortedRowIndexes[selectedCellRange.startRowIndex];
                const endRowIndex = sortedRowIndexes[selectedCellRange.endRowIndex];
                if (startRowIndex != null && endRowIndex != null) {
                    actions.selectRow(endRowIndex, { focus: true, mode: 'range', anchorRowIndex: startRowIndex });
                }
            } else if (!isMultiSelect) {
                actions.clearSelectedRows();
                actions.selectRow(rowIndex, { focus: true });
            }
            actions.deleteSelectedRows();
        },
    });

    if (!isMultiSelect) {
        items.push({
            id: 'select-all',
            label: 'Select All Rows',
            action: () => actions.selectAllRows(),
        });
    }

    return items;
}

export type DbGridHeaderMenuParams = {
    columnName: string;
    isIntegerColumn: boolean;
    assignedFormatterId: string | undefined;
    customFormatters: GridCustomFormatter[];
};

export type DbGridHeaderMenuActions = {
    setColumnFormatter: (columnName: string, formatterId: string | undefined) => void;
    openFormatterManager: () => void;
};

export function getDbGridHeaderMenuItems(params: DbGridHeaderMenuParams, actions: DbGridHeaderMenuActions) {
    const { columnName, isIntegerColumn, assignedFormatterId, customFormatters } = params;

    return [
        ...(isIntegerColumn
            ? []
            : [
                  {
                      id: 'display-type-custom-default',
                      label: 'Default',
                      checked: !assignedFormatterId,
                      action: () => actions.setColumnFormatter(columnName, undefined),
                  } satisfies ContextMenuEntry,
              ]),
        ...customFormatters.map(
            (formatter) =>
                ({
                    id: `display-type-custom-${formatter.id}`,
                    label: formatter.name,
                    checked: assignedFormatterId === formatter.id,
                    action: () => actions.setColumnFormatter(columnName, formatter.id),
                }) satisfies ContextMenuEntry
        ),
        {
            id: 'display-type-custom-manage',
            label: 'Manage Formatters...',
            action: () => actions.openFormatterManager(),
        },
    ];
}

export type DbGridToolbarCopyParams = {
    connectionId: number | undefined;
    tableName: string | undefined;
    onCopyAsDdl: () => void | Promise<void>;
};

export function getDbGridToolbarCopyItems(params: DbGridToolbarCopyParams) {
    if (!params.connectionId || !params.tableName) {
        return [] as ContextMenuEntry[];
    }

    return [
        {
            id: 'toolbar-copy-all-as-ddl',
            label: 'As DDL',
            action: () => params.onCopyAsDdl(),
        } satisfies ContextMenuEntry,
    ];
}
