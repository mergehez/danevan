import type {
    DataGridCellFocusOptions,
    DataGridCellValue,
    DataGridPendingChange,
    DataGridResolvedCell,
    DataGridRowSelectionOptions,
    GridCellRange,
    GridLayoutState,
    UseDataGridFinalOptions,
} from '@datagrid/useDataGridTypes';

export type DataGridSearchMatch = {
    rowIndex: number;
    columnIndex: number;
};

export type DataGridNormalizedCellRange = {
    topRowIndex: number;
    bottomRowIndex: number;
    leftColumnIndex: number;
    rightColumnIndex: number;
};

export type DataGridSelectionKind = 'rows' | 'column' | 'cells' | 'cell' | 'none';

export type DataGridSelectionBounds = {
    rowIndexes: number[];
    columnIndexes: number[];
    kind: DataGridSelectionKind;
};

export type DataGridHistoryOptions = {
    trackHistory?: boolean;
    clearRedo?: boolean;
};

export type DataGridKeyboardNavigation = {
    tryNavigate: (event: KeyboardEvent) => boolean;
    getHorizontalTarget: (step: number, position: { rowIndex: number; columnIndex: number }) => { rowIndex: number; columnIndex: number } | undefined;
};

export type DataGridCommandKeydownContext = Parameters<NonNullable<UseDataGridFinalOptions['handleGridCommandKeydown']>>[1];

export type DataGridUpdateLayoutState = (toUpdate: Partial<GridLayoutState>) => void;

export type { DataGridCellFocusOptions, DataGridCellValue, DataGridPendingChange, DataGridResolvedCell, DataGridRowSelectionOptions, GridCellRange };
