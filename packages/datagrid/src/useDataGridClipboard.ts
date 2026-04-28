import { writeClipboardText } from '@utils/clipboard';
import { quoteSqlIdentifier } from '@utils/sqlIdentifiers';
import { formatValue } from '@utils/valueFormatting';
import { ComputedRef } from 'vue';
import { DataGridInternalState, DataGridTransposedState } from '@datagrid/useDataGrid';
import type { DataGridNormalizedCellRange, DataGridSelectionBounds } from '@datagrid/useDataGridHelperTypes';
import type { DataGridCellValue, GridCellRange } from '@datagrid/useDataGridTypes';

export interface DataGridClipboardArgs {
    internalState: DataGridInternalState;
    transposedState: DataGridTransposedState;
    getVisualRowIndexForSourceRowIndex: (sourceRowIndex: number) => number;
    normalizeSelectedCellRange: (range: GridCellRange | undefined) => DataGridNormalizedCellRange | undefined;
    sortedRowIndexes: ComputedRef<number[]>;
}
export function createDataGridClipboard(args: DataGridClipboardArgs) {
    const { internalState, transposedState } = args;
    function getSelectionBounds(fallbackRowIndex?: number, fallbackColumnIndex?: number): DataGridSelectionBounds {
        if (internalState.selectedRowIndexes.length) {
            return {
                rowIndexes: [...internalState.selectedRowIndexes].sort(
                    (left: number, right: number) => args.getVisualRowIndexForSourceRowIndex(left) - args.getVisualRowIndexForSourceRowIndex(right)
                ),
                columnIndexes: transposedState.orderedColumns.map((_: unknown, columnIndex: number) => columnIndex),
                kind: 'rows' as const,
            };
        }

        if (internalState.selectedColumnName) {
            const selectedColumnIndex = transposedState.getColumnIndex(internalState.selectedColumnName);

            if (selectedColumnIndex >= 0) {
                return {
                    rowIndexes: args.sortedRowIndexes.value.slice(),
                    columnIndexes: [selectedColumnIndex],
                    kind: 'column' as const,
                };
            }
        }

        const range = args.normalizeSelectedCellRange(internalState.selectedCellRange);

        if (range) {
            return {
                rowIndexes: args.sortedRowIndexes.value.slice(range.topRowIndex, range.bottomRowIndex + 1),
                columnIndexes: transposedState.orderedColumns
                    .map((_: unknown, columnIndex: number) => columnIndex)
                    .filter((columnIndex: number) => columnIndex >= range.leftColumnIndex && columnIndex <= range.rightColumnIndex),
                kind: 'cells' as const,
            };
        }

        if (fallbackRowIndex != null && fallbackColumnIndex != null) {
            return {
                rowIndexes: [fallbackRowIndex],
                columnIndexes: [fallbackColumnIndex],
                kind: 'cell' as const,
            };
        }

        if (transposedState.rows.length && transposedState.orderedColumns.length) {
            return {
                rowIndexes: [internalState.activeCell.rowIndex],
                columnIndexes: [internalState.activeCell.columnIndex],
                kind: 'cell' as const,
            };
        }

        return { rowIndexes: [], columnIndexes: [], kind: 'none' as const };
    }

    function getAllCellsSelectionBounds(): DataGridSelectionBounds {
        if (!args.sortedRowIndexes.value.length || !transposedState.orderedColumns.length) {
            return { rowIndexes: [], columnIndexes: [], kind: 'none' as const };
        }

        return {
            rowIndexes: args.sortedRowIndexes.value.slice(),
            columnIndexes: transposedState.orderedColumns.map((_: unknown, columnIndex: number) => columnIndex),
            kind: 'cells' as const,
        };
    }

    function selectionContainsCell(rowIndex: number, columnIndex: number) {
        const selection = getSelectionBounds();
        return selection.rowIndexes.includes(rowIndex) && selection.columnIndexes.includes(columnIndex);
    }

    function buildSelectionText(
        formatter: (value: DataGridCellValue, rowIndex: number, columnName: string, selectionKind: 'rows' | 'column' | 'cells' | 'cell') => string,
        fallbackRowIndex?: number,
        fallbackColumnIndex?: number
    ) {
        const selection = getSelectionBounds(fallbackRowIndex, fallbackColumnIndex);

        if (!selection.rowIndexes.length || !selection.columnIndexes.length || selection.kind === 'none') {
            return '';
        }

        const selectionKind = selection.kind;

        if (selectionKind === 'cell') {
            const rowIndex = selection.rowIndexes[0];
            const columnName = transposedState.getColumnName(selection.columnIndexes[0]);

            if (!columnName) {
                return '';
            }

            return formatter(transposedState.getDisplayedCellValue(rowIndex, columnName), rowIndex, columnName, selectionKind);
        }

        return selection.rowIndexes
            .map((rowIndex: number) =>
                selection.columnIndexes
                    .map((columnIndex: number) => {
                        const columnName = transposedState.getColumnName(columnIndex);
                        return columnName ? formatter(transposedState.getDisplayedCellValue(rowIndex, columnName), rowIndex, columnName, selectionKind) : '';
                    })
                    .join('\t')
            )
            .join('\n');
    }

    async function copySelection(fallbackRowIndex?: number, fallbackColumnIndex?: number, formatter?: (value: DataGridCellValue) => string) {
        const text = buildSelectionText(
            (value) =>
                formatter
                    ? formatter(value)
                    : value == null
                      ? 'NULL'
                      : typeof value === 'object'
                        ? JSON.stringify(value)
                        : typeof value === 'string'
                          ? value
                          : typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean'
                            ? value.toString()
                            : '',
            fallbackRowIndex,
            fallbackColumnIndex
        );

        if (!text) {
            return;
        }

        await writeClipboardText(text);
    }

    async function copySelectionAsJson(fallbackRowIndex?: number, fallbackColumnIndex?: number) {
        const selection = getSelectionBounds(fallbackRowIndex, fallbackColumnIndex);

        if (!selection.rowIndexes.length || !selection.columnIndexes.length || selection.kind === 'none') {
            return;
        }

        if (selection.kind === 'cell') {
            const columnName = transposedState.getColumnName(selection.columnIndexes[0]);

            if (!columnName) {
                return;
            }

            await writeClipboardText(JSON.stringify(transposedState.getDisplayedCellValue(selection.rowIndexes[0], columnName)));
            return;
        }

        const columnNames = selection.columnIndexes
            .map((columnIndex: number) => transposedState.getColumnName(columnIndex))
            .filter((columnName: string | undefined): columnName is string => !!columnName);
        const selectionRows = selection.rowIndexes.map((rowIndex: number) =>
            Object.fromEntries(columnNames.map((columnName: string) => [columnName, transposedState.getDisplayedCellValue(rowIndex, columnName)]))
        );
        await writeClipboardText(JSON.stringify(selectionRows, null, 2));
    }

    async function copyAllCellsAsJson() {
        const selection = getAllCellsSelectionBounds();

        if (!selection.rowIndexes.length || !selection.columnIndexes.length || selection.kind === 'none') {
            return;
        }

        const columnNames = selection.columnIndexes
            .map((columnIndex: number) => transposedState.getColumnName(columnIndex))
            .filter((columnName: string | undefined): columnName is string => !!columnName);
        const selectionRows = selection.rowIndexes.map((rowIndex: number) =>
            Object.fromEntries(columnNames.map((columnName: string) => [columnName, transposedState.getDisplayedCellValue(rowIndex, columnName)]))
        );
        await writeClipboardText(JSON.stringify(selectionRows, null, 2));
    }

    function escapeCsvCell(text: string) {
        if (!/[",\n\r]/.test(text)) {
            return text;
        }

        return `"${text.replaceAll('"', '""')}"`;
    }

    async function copySelectionAsCsv(fallbackRowIndex?: number, fallbackColumnIndex?: number) {
        const selection = getSelectionBounds(fallbackRowIndex, fallbackColumnIndex);

        if (!selection.rowIndexes.length || selection.columnIndexes.length < 2 || selection.kind === 'none') {
            return;
        }

        const text = selection.rowIndexes
            .map((rowIndex: number) =>
                selection.columnIndexes
                    .map((columnIndex: number) => {
                        const columnName = transposedState.getColumnName(columnIndex);
                        return columnName ? escapeCsvCell(formatValue(transposedState.getDisplayedCellValue(rowIndex, columnName))) : '';
                    })
                    .join(',')
            )
            .join('\n');

        if (!text) {
            return;
        }

        await writeClipboardText(text);
    }

    async function copyAllCellsAsCsv() {
        const selection = getAllCellsSelectionBounds();

        if (!selection.rowIndexes.length || selection.columnIndexes.length < 2 || selection.kind === 'none') {
            return;
        }

        const text = selection.rowIndexes
            .map((rowIndex: number) =>
                selection.columnIndexes
                    .map((columnIndex: number) => {
                        const columnName = transposedState.getColumnName(columnIndex);
                        return columnName ? escapeCsvCell(formatValue(transposedState.getDisplayedCellValue(rowIndex, columnName))) : '';
                    })
                    .join(',')
            )
            .join('\n');

        if (!text) {
            return;
        }

        await writeClipboardText(text);
    }

    async function copySelectionAsSql(fallbackRowIndex?: number, fallbackColumnIndex?: number) {
        const text = buildSelectionText((value) => formatValue(value, { mode: 'sql' }), fallbackRowIndex, fallbackColumnIndex);

        if (!text) {
            return;
        }

        await writeClipboardText(text);
    }

    async function copyAllCellsAsSql() {
        const selection = getAllCellsSelectionBounds();

        if (!selection.rowIndexes.length || !selection.columnIndexes.length || selection.kind === 'none') {
            return;
        }

        const text = selection.rowIndexes
            .map((rowIndex: number) =>
                selection.columnIndexes
                    .map((columnIndex: number) => {
                        const columnName = transposedState.getColumnName(columnIndex);
                        return columnName ? formatValue(transposedState.getDisplayedCellValue(rowIndex, columnName), { mode: 'sql' }) : '';
                    })
                    .join('\t')
            )
            .join('\n');

        if (!text) {
            return;
        }

        await writeClipboardText(text);
    }

    async function copySelectionAsSqlInsert(fallbackRowIndex?: number, fallbackColumnIndex?: number) {
        const selection = getSelectionBounds(fallbackRowIndex, fallbackColumnIndex);

        if (!internalState.sqlInsertTableName || !selection.rowIndexes.length || !selection.columnIndexes.length || selection.kind === 'none') {
            return;
        }

        const columnNames = selection.columnIndexes
            .map((columnIndex: number) => transposedState.getColumnName(columnIndex))
            .filter((columnName: string | undefined): columnName is string => !!columnName);

        if (!columnNames.length) {
            return;
        }

        const insertRows = selection.rowIndexes.map((rowIndex: number) => {
            const values = columnNames.map((columnName: string) => formatValue(transposedState.getDisplayedCellValue(rowIndex, columnName), { mode: 'sql' }));
            return `(${values.join(', ')})`;
        });

        if (!insertRows.length) {
            return;
        }

        const statement = [
            `INSERT INTO ${quoteSqlIdentifier(internalState.sqlInsertTableName, internalState.sqlInsertDialect)}`,
            `(${columnNames.map((columnName: string) => quoteSqlIdentifier(columnName, internalState.sqlInsertDialect)).join(', ')})`,
            'VALUES',
            `${insertRows.join(',\n')};`,
        ].join('\n');

        await writeClipboardText(statement);
    }

    async function copyAllCellsAsSqlInsert() {
        const selection = getAllCellsSelectionBounds();

        if (!internalState.sqlInsertTableName || !selection.rowIndexes.length || !selection.columnIndexes.length || selection.kind === 'none') {
            return;
        }

        const columnNames = selection.columnIndexes
            .map((columnIndex: number) => transposedState.getColumnName(columnIndex))
            .filter((columnName: string | undefined): columnName is string => !!columnName);

        if (!columnNames.length) {
            return;
        }

        const insertRows = selection.rowIndexes.map((rowIndex: number) => {
            const values = columnNames.map((columnName: string) => formatValue(transposedState.getDisplayedCellValue(rowIndex, columnName), { mode: 'sql' }));
            return `(${values.join(', ')})`;
        });

        if (!insertRows.length) {
            return;
        }

        const statement = [
            `INSERT INTO ${quoteSqlIdentifier(internalState.sqlInsertTableName, internalState.sqlInsertDialect)}`,
            `(${columnNames.map((columnName: string) => quoteSqlIdentifier(columnName, internalState.sqlInsertDialect)).join(', ')})`,
            'VALUES',
            `${insertRows.join(',\n')};`,
        ].join('\n');

        await writeClipboardText(statement);
    }

    async function copySelectionAsSqlSelect(fallbackRowIndex?: number, fallbackColumnIndex?: number) {
        const selection = getSelectionBounds(fallbackRowIndex, fallbackColumnIndex);

        if (!internalState.sqlInsertTableName || !selection.rowIndexes.length || !selection.columnIndexes.length || selection.kind === 'none') {
            return;
        }

        const allColumnsSelected = selection.columnIndexes.length === transposedState.orderedColumns.length;
        const columnNames = selection.columnIndexes
            .map((columnIndex: number) => transposedState.getColumnName(columnIndex))
            .filter((columnName: string | undefined): columnName is string => !!columnName);

        if (!columnNames.length) {
            return;
        }

        const selectColumns = allColumnsSelected ? '*' : columnNames.map((columnName: string) => quoteSqlIdentifier(columnName, internalState.sqlInsertDialect)).join(', ');
        const tableName = quoteSqlIdentifier(internalState.sqlInsertTableName, internalState.sqlInsertDialect);
        const resolvedPks = internalState.primaryKeyColumns.length ? internalState.primaryKeyColumns : columnNames[0] ? [columnNames[0]] : [];

        let statement = '';
        if (resolvedPks.length === 1) {
            const pkColumn = resolvedPks[0] as string;
            const pkIdentifier = quoteSqlIdentifier(pkColumn, internalState.sqlInsertDialect);
            const inValues = selection.rowIndexes.map((rowIndex: number) => formatValue(transposedState.getDisplayedCellValue(rowIndex, pkColumn), { mode: 'sql' }));
            statement = `SELECT ${selectColumns} FROM ${tableName} WHERE ${pkIdentifier} IN (${inValues.join(', ')});`;
        } else {
            const whereClauses = selection.rowIndexes.map((rowIndex: number) => {
                const conditions = resolvedPks.map((pkColumn: string) => {
                    const val = formatValue(transposedState.getDisplayedCellValue(rowIndex, pkColumn), { mode: 'sql' });
                    return `${quoteSqlIdentifier(pkColumn, internalState.sqlInsertDialect)} = ${val}`;
                });
                return `(${conditions.join(' AND ')})`;
            });
            statement = `SELECT ${selectColumns} FROM ${tableName} WHERE ${whereClauses.join(' OR ')};`;
        }

        await writeClipboardText(statement);
    }

    async function copyAllCellsAsSqlSelect() {
        const selection = getAllCellsSelectionBounds();

        if (!internalState.sqlInsertTableName || !selection.rowIndexes.length || !selection.columnIndexes.length || selection.kind === 'none') {
            return;
        }

        const allColumnsSelected = selection.columnIndexes.length === transposedState.orderedColumns.length;
        const columnNames = selection.columnIndexes
            .map((columnIndex: number) => transposedState.getColumnName(columnIndex))
            .filter((columnName: string | undefined): columnName is string => !!columnName);

        if (!columnNames.length) {
            return;
        }

        const selectColumns = allColumnsSelected ? '*' : columnNames.map((columnName: string) => quoteSqlIdentifier(columnName, internalState.sqlInsertDialect)).join(', ');
        const tableName = quoteSqlIdentifier(internalState.sqlInsertTableName, internalState.sqlInsertDialect);
        const resolvedPks = internalState.primaryKeyColumns.length ? internalState.primaryKeyColumns : columnNames[0] ? [columnNames[0]] : [];

        let statement = '';
        if (resolvedPks.length === 1) {
            const pkColumn = resolvedPks[0] as string;
            const pkIdentifier = quoteSqlIdentifier(pkColumn, internalState.sqlInsertDialect);
            const inValues = selection.rowIndexes.map((rowIndex: number) => formatValue(transposedState.getDisplayedCellValue(rowIndex, pkColumn), { mode: 'sql' }));
            statement = `SELECT ${selectColumns} FROM ${tableName} WHERE ${pkIdentifier} IN (${inValues.join(', ')});`;
        } else {
            const whereClauses = selection.rowIndexes.map((rowIndex: number) => {
                const conditions = resolvedPks.map((pkColumn: string) => {
                    const val = formatValue(transposedState.getDisplayedCellValue(rowIndex, pkColumn), { mode: 'sql' });
                    return `${quoteSqlIdentifier(pkColumn, internalState.sqlInsertDialect)} = ${val}`;
                });
                return `(${conditions.join(' AND ')})`;
            });
            statement = `SELECT ${selectColumns} FROM ${tableName} WHERE ${whereClauses.join(' OR ')};`;
        }

        await writeClipboardText(statement);
    }

    return {
        getSelectionBounds,
        getAllCellsSelectionBounds,
        selectionContainsCell,
        copySelection,
        copySelectionAsJson,
        copyAllCellsAsJson,
        copySelectionAsCsv,
        copyAllCellsAsCsv,
        copySelectionAsSql,
        copyAllCellsAsSql,
        copySelectionAsSqlInsert,
        copyAllCellsAsSqlInsert,
        copySelectionAsSqlSelect,
        copyAllCellsAsSqlSelect,
    };
}
