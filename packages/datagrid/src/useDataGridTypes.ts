import { DEFAULT_DATA_GRID_FONT_FAMILY, DEFAULT_DATA_GRID_SHOW_ROW_NUMBERS, isDataGridFontFamily, type DataGridFontFamily, type DataGridTheme } from '@datagrid/dataGridAppearance';
import { formatDefaultEditingValue, parseDefaultEditingValue } from '@datagrid/useDataGridCoreUtils';
import type { ContextMenuEntry } from '@directives/contextMenuTypes';
import { DbType } from '@utils/appClient';
import type { ComputedRef, Ref } from 'vue';

export type DataGridCellValue = unknown;
export type DataGridRow = Record<string, DataGridCellValue>;
export type DataGridSqlDialect = 'sqlite' | 'mysql' | 'postgresql' | 'sqlserver' | 'msaccess' | (string & {});

export type GridSortDirection = 'asc' | 'desc';

export type GridSortState = {
    columnName: string;
    direction: GridSortDirection;
} | null;

export type GridCellRange = {
    startRowIndex: number;
    startColumnIndex: number;
    endRowIndex: number;
    endColumnIndex: number;
};

export type DataGridActiveCell = {
    rowIndex: number;
    columnIndex: number;
};

export type DataGridEditingCell = {
    rowIndex: number;
    columnIndex: number;
    draftValue: string;
};

export type DataGridModalEditingCell = {
    open: boolean;
    rowIndex: number;
    columnIndex: number;
    draftValue: string;
};

export type DataGridRowSelectionMode = 'replace' | 'toggle' | 'range';

export type DataGridCellFocusOptions = {
    focus?: boolean;
    align?: 'nearest' | 'center';
    preserveSelectedRows?: boolean;
};

export type DataGridRowSelectionOptions = {
    focus?: boolean;
    mode?: DataGridRowSelectionMode;
    anchorRowIndex?: number;
};

export type DataGridCellContext = {
    rowIndex: number;
    columnIndex: number;
    columnName: string;
    row: DataGridRow | undefined;
    value: DataGridCellValue;
    event: MouseEvent;
};

export type DataGridRowContext = {
    rowIndex: number;
    event: MouseEvent;
};

export type DataGridHeaderContext = {
    columnIndex: number;
    columnName: string;
    event: MouseEvent;
};

export type DataGridPendingChange = DataGridCellChange & Record<string, unknown>;

export type DataGridResolvedCell = {
    editable: boolean;
    sourceRowIndex: number;
    sourceColumnName: string | undefined;
    value: DataGridCellValue;
};

export type DataGridCellChange = {
    rowIndex: number;
    columnName: string;
    previousValue: DataGridCellValue;
    nextValue: DataGridCellValue;
};

export type TableData = {
    columns: string[];
    columnStats?: Record<string, number>;
    rows: DataGridRow[];
    rowCount?: number;
    limit?: number;
    offset?: number;
};

export type GridDisplayType = 'number' | 'timestamp-seconds' | 'timestamp-milliseconds' | 'timestamp-microseconds' | 'custom';
type BuiltinGridDisplayType = Exclude<GridDisplayType, 'custom'>;

export type GridLayoutState = {
    columnsOrderDirection: 'asc' | 'desc' | undefined;
    columnOrder: string[];
    columnWidths: Record<string, number>;
    hiddenColumns: string[];
    displayTypes: Record<string, GridDisplayType | undefined>;
    sort: GridSortState;
    fontFamily: DataGridFontFamily;
    showRowNumbers: boolean;
};

export type MaybeReactiveValue<T> = T | Ref<T> | ComputedRef<T>;

export type PendingRowState = 'inserted' | 'deleted' | undefined;

type SetSourceCellValue = (rowIndex: number, columnName: string, nextValue: DataGridCellValue, previousValue: DataGridCellValue) => void;

type DataGridCommandKeydownContext = {
    commitEditingCell: () => void;
    copySelection: (fallbackRowIndex?: number, fallbackColumnIndex?: number) => Promise<void>;
    isTextInputTarget: boolean;
};

type DataGridPendingChangeContext = DataGridCellChange & {
    rawValue: DataGridCellValue;
};

export type UseDataGridOptions = {
    layoutStorageKey?: MaybeReactiveValue<string | undefined>;
    tableData?: MaybeReactiveValue<TableData | undefined>;
    sortedRowIndexes?: MaybeReactiveValue<number[] | undefined>;
    emptyText?: MaybeReactiveValue<string | undefined>;
    renderVersion?: MaybeReactiveValue<string | number | undefined>;
    sqlInsertTableName?: MaybeReactiveValue<string | undefined>;
    sqlInsertDialect?: MaybeReactiveValue<DbType | undefined>;
    primaryKeyColumns?: MaybeReactiveValue<string[] | undefined>;
    searchable?: boolean;
    editable?: boolean;
    selectedRowIndexes?: MaybeReactiveValue<number[] | undefined>;
    selectedCellRange?: MaybeReactiveValue<GridCellRange | undefined>;
    selectedColumnName?: MaybeReactiveValue<string | undefined>;
    isColumnListOpen?: MaybeReactiveValue<boolean | undefined>;
    sortState?: MaybeReactiveValue<GridSortState | undefined>;
    cellContextMenuCustomItems?: (context: DataGridCellContext) => ContextMenuEntry[];
    rowContextMenuCustomItems?: (context: DataGridRowContext) => ContextMenuEntry[];
    headerContextMenuCustomItems?: (context: DataGridHeaderContext) => ContextMenuEntry[];
    getSourceCellValue?: (rowIndex: number, columnName: string) => DataGridCellValue;
    getDisplayedCellValue?: (rowIndex: number, columnName: string) => DataGridCellValue;
    getFormattedCellValue?: (rowIndex: number, columnName: string) => string;
    handleGridCommandKeydown?: (event: KeyboardEvent, context: DataGridCommandKeydownContext) => boolean | void;
    canUseTimestampDisplayTypes?: (columnName: string) => boolean;
    getColumnDisplayType?: (columnName: string) => GridDisplayType;
    setColumnDisplayType?: (columnName: string, displayType: BuiltinGridDisplayType) => void;
    formatEditingValue?: (value: DataGridCellValue) => string;
    parseEditingValue?: (draftValue: string, currentValue: DataGridCellValue) => DataGridCellValue;
    createPendingChange?: (change: DataGridPendingChangeContext) => DataGridPendingChange;
    setSourceCellValue?: SetSourceCellValue;
    transposeState?: Ref<boolean>;
    transposeTooltip?: MaybeReactiveValue<string | undefined>;
    transposeLabelColumnName?: MaybeReactiveValue<string | undefined>;
    getTransposeColumnName?: (rowIndex: number, total: number) => string;
    enableTranspose?: boolean;

    canDeleteSelectedRows?: MaybeReactiveValue<boolean | undefined>;
    deleteSelectedRows?: () => Promise<void> | void;
    canAddRow?: MaybeReactiveValue<boolean | undefined>;
    addRow?: () => Promise<void> | void;
    getPendingRowState?: (rowIndex: number) => PendingRowState;
    theme?: MaybeReactiveValue<Partial<DataGridTheme> | undefined>;
    toolbarCopyAsCustomItems?: MaybeReactiveValue<ContextMenuEntry[] | undefined>;
    copyTableAsDdl?: () => Promise<void>;
    showTableDdl?: () => Promise<void>;
};
export type UseDataGridFinalOptions = ReturnType<typeof fillMissionOptions>;
export function fillMissionOptions(options: UseDataGridOptions) {
    return {
        ...options,
        editable: options.editable ?? false,
        getTransposeColumnName: options.getTransposeColumnName ?? ((rowIndex: number) => `Row ${rowIndex + 1}`),
        formatEditingValue: options.formatEditingValue ?? formatDefaultEditingValue,
        parseEditingValue: options.parseEditingValue ?? ((draftValue: string, _currentValue: DataGridCellValue) => parseDefaultEditingValue(draftValue)),
    } as const;
}

export function normalizeGridLayoutState(value: Partial<GridLayoutState> | null | undefined): GridLayoutState {
    const sort = value?.sort && typeof value.sort.columnName === 'string' && (value.sort.direction === 'asc' || value.sort.direction === 'desc') ? value.sort : null;

    return {
        columnsOrderDirection: value?.columnsOrderDirection === 'asc' || value?.columnsOrderDirection === 'desc' ? value.columnsOrderDirection : undefined,
        columnOrder: Array.isArray(value?.columnOrder) ? value.columnOrder.filter((columnName): columnName is string => typeof columnName === 'string') : [],
        columnWidths:
            value?.columnWidths && typeof value.columnWidths === 'object'
                ? Object.fromEntries(
                      Object.entries(value.columnWidths).filter(
                          (entry): entry is [string, number] => typeof entry[0] === 'string' && typeof entry[1] === 'number' && Number.isFinite(entry[1])
                      )
                  )
                : {},
        hiddenColumns: Array.isArray(value?.hiddenColumns) ? value.hiddenColumns.filter((columnName): columnName is string => typeof columnName === 'string') : [],
        displayTypes:
            value?.displayTypes && typeof value.displayTypes === 'object'
                ? Object.fromEntries(
                      Object.entries(value.displayTypes).filter(
                          (entry): entry is [string, GridDisplayType] =>
                              typeof entry[0] === 'string' &&
                              (entry[1] === 'number' || entry[1] === 'timestamp-seconds' || entry[1] === 'timestamp-milliseconds' || entry[1] === 'timestamp-microseconds')
                      )
                  )
                : {},
        sort,
        fontFamily: isDataGridFontFamily(value?.fontFamily) ? value.fontFamily : DEFAULT_DATA_GRID_FONT_FAMILY,
        showRowNumbers: typeof value?.showRowNumbers === 'boolean' ? value.showRowNumbers : DEFAULT_DATA_GRID_SHOW_ROW_NUMBERS,
    };
}
