import type { VNodeChild } from 'vue';
import { formatValue as _formatValue } from '../utils/valueFormatting';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

export type CellValue = string | number | bigint | Uint8Array | Buffer | null | undefined;

type DataTableRow = Record<string, CellValue>;

type CellContext = { columnName: string; row: DataTableRow; rowIndex: number };

type Props = {
    columns: string[];
    rows: DataTableRow[];
    emptyText?: string;
    formatValue?: (value: CellValue, context: CellContext) => string;
    /** Replaces the formatted cell content; return undefined to keep the default rendering. */
    cellContent?: (value: CellValue, context: CellContext) => VNodeChild;
    cellClass?: (value: CellValue, context: CellContext) => string | undefined;
    rowKey?: (row: DataTableRow, rowIndex: number) => string | number;
    stickyHeader?: boolean;
    stripedRows?: boolean;
};

export const DataTable = component(
    (props: Props) => {
        function getRowKey(row: DataTableRow, rowIndex: number) {
            return props.rowKey ? props.rowKey(row, rowIndex) : rowIndex;
        }

        function getFormattedValue(row: DataTableRow, columnName: string, rowIndex: number) {
            const value = row[columnName] ?? null;

            if (!props.formatValue) {
                return _formatValue(value);
            }

            return props.formatValue(value, { columnName, row, rowIndex });
        }

        function getCellContent(row: DataTableRow, columnName: string, rowIndex: number) {
            const value = row[columnName] ?? null;
            const content = props.cellContent?.(value, { columnName, row, rowIndex });

            return content === undefined ? getFormattedValue(row, columnName, rowIndex) : content;
        }

        return () => (
            <div class="min-h-0 overflow-auto">
                {props.rows.length ? (
                    <table class="w-full border-collapse text-left text-xs">
                        <thead class={props.stickyHeader === false ? 'bg-x3 opacity-80' : 'sticky top-0 bg-x3 opacity-80'}>
                            <tr>
                                {(props.columns ?? []).map((column) => (
                                    <th class="border-b border-x4 px-3 py-2 font-medium" key={column}>
                                        {column}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {(props.rows ?? []).map((row, rowIndex) => (
                                <tr class={props.stripedRows === false ? 'border-b border-x3' : 'border-b border-x3 odd:bg-x1'} key={getRowKey(row, rowIndex)}>
                                    {(props.columns ?? []).map((column) => (
                                        <td class={['max-w-70 px-3 py-2 text-default', props.cellClass?.(row[column] ?? null, { columnName: column, row, rowIndex })]} key={column}>
                                            <div class="line-clamp-1">{getCellContent(row, column, rowIndex)}</div>
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div class="px-4 py-3 text-xs opacity-60">{props.emptyText || 'No rows to display.'}</div>
                )}
            </div>
        );
    },
    { name: 'DataTable', props: ensureAllTsxProps<Props>()(['columns', 'rows', 'emptyText', 'formatValue', 'cellContent', 'cellClass', 'rowKey', 'stickyHeader', 'stripedRows']) }
);

export default DataTable;
