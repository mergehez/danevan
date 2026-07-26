<script setup lang="ts">
import { formatValue as _formatValue } from '@utils/valueFormatting';

export type CellValue = string | number | bigint | Uint8Array | Buffer | null | undefined;

type DataTableRow = Record<string, CellValue>;

const props = defineProps<{
    columns: string[];
    rows: DataTableRow[];
    emptyText?: string;
    formatValue?: (value: CellValue, context: { columnName: string; row: DataTableRow; rowIndex: number }) => string;
    rowKey?: (row: DataTableRow, rowIndex: number) => string | number;
    stickyHeader?: boolean;
    stripedRows?: boolean;
}>();

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
</script>

<template>
    <div class="min-h-0 overflow-auto">
        <table v-if="props.rows.length" class="w-full border-collapse text-left text-xs">
            <thead :class="props.stickyHeader === false ? 'bg-x3 opacity-80' : 'sticky top-0 bg-x3 opacity-80'">
                <tr>
                    <th v-for="column in props.columns" :key="column" class="border-b border-x4 px-3 py-2 font-medium">
                        {{ column }}
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="(row, rowIndex) in props.rows"
                    :key="getRowKey(row, rowIndex)"
                    :class="props.stripedRows === false ? 'border-b border-x3' : 'border-b border-x3 odd:bg-x1'"
                >
                    <td v-for="column in props.columns" :key="column" class="max-w-70 px-3 py-2 text-default">
                        <div class="line-clamp-1">
                            {{ getFormattedValue(row, column, rowIndex) }}
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
        <div v-else class="px-4 py-3 text-xs opacity-60">{{ props.emptyText || 'No rows to display.' }}</div>
    </div>
</template>
