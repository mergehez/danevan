import { DATA_GRID_FONT_OPTIONS } from '@datagrid/dataGridAppearance';
import type { TDataGridState } from '@datagrid/useDataGrid';
import type { UseDataGridOptions } from '@datagrid/useDataGridTypes';
import type { ContextMenuEntry } from '@directives/contextMenuTypes';
import { computed } from 'vue';

export function useDataGridToolbarMenu(state: TDataGridState) {
    const toolbarMenuItems = computed<ContextMenuEntry[]>(() => {
        const toolbarCopyAsCustomItems = ((state as TDataGridState<{ toolbarCopyAsCustomItems?: ContextMenuEntry[] }>).toolbarCopyAsCustomItems ?? []) as ContextMenuEntry[];
        const ddlState = state as TDataGridState<Pick<UseDataGridOptions, 'copyTableAsDdl' | 'showTableDdl'>>;

        const items: ContextMenuEntry[] = [
            {
                id: 'toolbar-column-ordering',
                label: 'Order columns...',
                children: [
                    {
                        id: 'toolbar-clear-column-reordering',
                        label: 'No ordering',
                        action: () => state.clearColumnReordering?.(),
                        checked: state.layoutState.columnsOrderDirection == undefined,
                        type: 'checkbox',
                    },
                    {
                        id: 'toolbar-reorder-columns-asc',
                        label: 'A-Z',
                        action: () => state.reorderColumnsAlphabetically?.('asc'),
                        checked: state.layoutState.columnsOrderDirection === 'asc',
                        type: 'checkbox',
                    },
                    {
                        id: 'toolbar-reorder-columns-desc',
                        label: 'Z-A',
                        action: () => state.reorderColumnsAlphabetically?.('desc'),
                        checked: state.layoutState.columnsOrderDirection === 'desc',
                        type: 'checkbox',
                    },
                ],
            },

            { type: 'separator', id: 'toolbar-separator-columns' },
            {
                id: 'toolbar-change-font',
                label: 'Change font...',
                children: DATA_GRID_FONT_OPTIONS.map((font) => ({
                    id: `toolbar-font-${font.id}`,
                    label: font.label,
                    checked: state.gridFontFamily === font.id,
                    action: () => state.setFontFamily?.(font.id),
                })),
            },
            {
                id: 'toolbar-toggle-row-count',
                label: 'Toggle row count',
                checked: state.showRowNumbers !== false,
                action: () => state.setShowRowNumbers?.(state.showRowNumbers === false),
            },
            {
                id: 'toolbar-select-all-cells',
                label: 'Select all cells',
                action: () => state.selectAllRows({ focus: true }),
            },
        ];

        const copyAsItems: ContextMenuEntry[] = [
            {
                id: 'toolbar-copy-all-as-json',
                label: 'As JSON',
                action: async () => state.copyAllCellsAsJson?.(),
            },
            {
                id: 'toolbar-copy-all-as-sql',
                label: 'As SQL Literal',
                action: async () => state.copyAllCellsAsSql?.(),
            },
            ...toolbarCopyAsCustomItems,
        ];

        if (state.orderedColumns.length > 1) {
            copyAsItems.push({
                id: 'toolbar-copy-all-as-csv',
                label: 'As CSV',
                action: async () => state.copyAllCellsAsCsv?.(),
            });
        }

        if (state.canGenerateSqlStatements) {
            copyAsItems.push(
                {
                    id: 'toolbar-copy-all-as-sql-insert',
                    label: 'As SQL INSERT Statement',
                    action: async () => state.copyAllCellsAsSqlInsert?.(),
                },
                {
                    id: 'toolbar-copy-all-as-sql-select',
                    label: 'As SQL SELECT Statement',
                    action: async () => state.copyAllCellsAsSqlSelect?.(),
                }
            );
        }

        items.push({
            id: 'toolbar-copy-all-cells-as',
            label: 'Copy all cells as',
            children: copyAsItems,
        });

        if (ddlState.copyTableAsDdl) {
            items.push({ type: 'separator', id: 'toolbar-separator-ddl' });
            items.push({
                id: 'toolbar-copy-table-as-ddl',
                label: 'Copy table as DDL',
                action: async () => ddlState.copyTableAsDdl?.(),
            });
            items.push({
                id: 'toolbar-show-table-ddl',
                label: 'Show DDL',
                action: async () => ddlState.showTableDdl?.(),
            });
        }

        return items;
    });

    return toolbarMenuItems;
}
