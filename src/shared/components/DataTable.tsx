import { formatValue as _formatValue } from '../utils/valueFormatting';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

export type CellValue = string | number | bigint | Uint8Array | Buffer | null | undefined;

type DataTableRow = Record<string, CellValue>;

type Props = {
    columns: string[];
    rows: DataTableRow[];
    emptyText?: string;
    formatValue?: (value: CellValue, context: { columnName: string; row: DataTableRow; rowIndex: number }) => string;
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
                                        <td class="max-w-70 px-3 py-2 text-default" key={column}>
                                            <div class="line-clamp-1">{getFormattedValue(row, column, rowIndex)}</div>
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
    { name: 'DataTable', props: ensureAllTsxProps<Props>()(['columns', 'rows', 'emptyText', 'formatValue', 'rowKey', 'stickyHeader', 'stripedRows']) }
);

export default DataTable;
