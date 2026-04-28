import { useDataGrid, type DataGridCellContext, type DataGridRow, type MaybeReactiveValue, type TDataGridState } from '@datagrid/useDataGrid';
import type { ContextMenuEntry } from '@directives/contextMenuTypes';
import { confirmAction } from '@utils/confirmAction';
import { formatValue as formatDefaultValue } from '@utils/valueFormatting';
import { computed, nextTick, ref, unref, watch, type Ref } from 'vue';

export type EditableGridContext = DataGridCellContext & {
    isTransposed: boolean;
    isEditable: boolean;
    sourceColumnName: string;
    sourceRowIndex: number;
};

type EditableDataGridOptions = {
    columns: MaybeReactiveValue<string[]>;
    rows: MaybeReactiveValue<DataGridRow[]>;
    columnStats?: MaybeReactiveValue<Record<string, number> | undefined>;
    emptyText?: MaybeReactiveValue<string | undefined>;
    defaultTransposed?: boolean;
    transposeState?: Ref<boolean>;
    transposeTooltip?: MaybeReactiveValue<string | undefined>;
    getTransposeColumnName?: (rowIndex: number, total: number) => string;
    searchable?: MaybeReactiveValue<boolean | undefined>;
    formatValue?: (value: unknown, context: { columnName: string; row: DataGridRow; rowIndex: number; isTransposed: boolean }) => string;
    cellContextMenuItems?: (context: EditableGridContext) => ContextMenuEntry[];
};

export type EditableDataGridState = TDataGridState<{
    addRow: () => void;
    deleteSelectedRows: () => Promise<void>;
    canAddRow: boolean;
    canDeleteSelectedRows: boolean;
}>;

const TRANSPOSE_LABEL_COLUMN = 'Column';

export function useEditableDataGridState(options: EditableDataGridOptions) {
    const sourceColumns = ref<string[]>([]);
    const sourceRows = ref<DataGridRow[]>([]);
    const isTransposed = options.transposeState ?? ref(options.defaultTransposed ?? false);
    let state!: EditableDataGridState;
    const canAddRow = computed(() => !isTransposed.value);
    const canDeleteSelectedRows = computed(() => !isTransposed.value && state.selectedRowIndexes.length > 0);

    watch(
        () => unref(options.columns),
        (value) => {
            sourceColumns.value = [...(value ?? [])];
        },
        { immediate: true, deep: true }
    );

    watch(
        () => unref(options.rows),
        (value) => {
            sourceRows.value = (value ?? []).map((row) => ({ ...row }));
        },
        { immediate: true, deep: true }
    );

    function resolveSourceCell(rowIndex: number, columnName: string) {
        const resolvedCell = state.resolveCell(rowIndex, columnName);

        return {
            editable: resolvedCell.editable,
            rowIndex: resolvedCell.sourceRowIndex,
            columnName: resolvedCell.sourceColumnName ?? columnName,
            value: resolvedCell.value,
        };
    }

    state = useDataGrid({
        searchable: unref(options.searchable) ?? false,
        tableData: computed(() => ({
            columns: sourceColumns.value,
            columnStats: unref(options.columnStats) ?? {},
            rows: sourceRows.value,
        })),
        emptyText: computed(() => unref(options.emptyText)),
        renderVersion: computed(() => `${sourceColumns.value.join('|')}:${sourceRows.value.length}`),
        editable: true,
        getSourceCellValue: (rowIndex: number, columnName: string) => sourceRows.value[rowIndex]?.[columnName],
        getFormattedCellValue: (rowIndex: number, columnName: string) => {
            const sourceCell = resolveSourceCell(rowIndex, columnName);
            const value = sourceCell.value;
            const sourceRow = sourceCell.editable ? sourceRows.value[sourceCell.rowIndex] : undefined;

            if (options.formatValue && sourceRow) {
                return options.formatValue(value, {
                    columnName: sourceCell.columnName,
                    row: sourceRow,
                    rowIndex: sourceCell.rowIndex,
                    isTransposed: isTransposed.value,
                });
            }

            return formatDefaultValue(value);
        },
        setSourceCellValue: (rowIndex: number, columnName: string, nextValue: DataGridRow[string]) => {
            sourceRows.value = sourceRows.value.map((row, currentRowIndex) =>
                currentRowIndex === rowIndex
                    ? {
                          ...row,
                          [columnName]: nextValue,
                      }
                    : row
            );
        },
        cellContextMenuCustomItems: (context) => {
            const sourceCell = resolveSourceCell(context.rowIndex, context.columnName);

            return (
                options.cellContextMenuItems?.({
                    ...context,
                    isTransposed: isTransposed.value,
                    isEditable: sourceCell.editable,
                    sourceColumnName: sourceCell.columnName,
                    sourceRowIndex: sourceCell.rowIndex,
                }) ?? []
            );
        },
        transposeTooltip: computed(() => unref(options.transposeTooltip)),
        transposeLabelColumnName: computed(() => TRANSPOSE_LABEL_COLUMN),
        getTransposeColumnName: options.getTransposeColumnName,
        transposeState: isTransposed,
        enableTranspose: true,
        canAddRow: canAddRow,
        canDeleteSelectedRows: canDeleteSelectedRows,
        addRow: () => {
            const nextRow = Object.fromEntries(sourceColumns.value.map((columnName) => [columnName, null]));
            const nextRowIndex = sourceRows.value.length;

            sourceRows.value = [...sourceRows.value, nextRow];

            void nextTick(() => {
                state.clearSelectedColumn();
                state.clearSelectedCellRange();
                state.selectRow(nextRowIndex, { focus: true });
            });
        },
        deleteSelectedRows: async () => {
            if (!state.selectedRowIndexes.length) {
                return;
            }

            const rowCount = state.selectedRowIndexes.length;

            if (
                !(await confirmAction({
                    title: rowCount === 1 ? 'Delete row?' : 'Delete rows?',
                    message: `This will permanently remove ${rowCount} ${rowCount === 1 ? 'row' : 'rows'} from the grid.`,
                    detail: 'This action only affects the in-memory editable grid data.',
                    confirmLabel: 'Delete',
                }))
            ) {
                return;
            }

            const selectedRowIndexes = new Set(state.selectedRowIndexes);
            const nextActiveRowIndex = Math.max(0, Math.min(state.selectedRowIndexes[0] ?? 0, sourceRows.value.length - selectedRowIndexes.size - 1));
            sourceRows.value = sourceRows.value.filter((_, rowIndex) => !selectedRowIndexes.has(rowIndex));

            void nextTick(() => {
                state.clearSelectedRows();
                state.clearSelectedColumn();
                state.clearSelectedCellRange();

                if (!sourceRows.value.length || !sourceColumns.value.length) {
                    return;
                }

                state.setActiveCell(nextActiveRowIndex, Math.min(state.activeCell.columnIndex, sourceColumns.value.length - 1), { focus: true });
            });
        },
    }) as EditableDataGridState;

    return {
        state,
        isTransposed,
        sourceColumns,
        sourceRows,
    };
}
