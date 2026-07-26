import type { DataGridCellValue } from '@datagrid/useDataGridTypes';
import { formatValue } from '@utils/valueFormatting';

export function formatDefaultValue(value: DataGridCellValue) {
    return formatValue(value, { functionMode: 'name' });
}

export function formatDefaultEditingValue(value: DataGridCellValue) {
    if (value == null) {
        return '';
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        return value.toString();
    }

    return '';
}

export function parseDefaultEditingValue(draftValue: string) {
    return draftValue === '__NULL__' ? null : draftValue;
}

export function gridValuesEqual(left: DataGridCellValue, right: DataGridCellValue) {
    if (left instanceof Uint8Array && right instanceof Uint8Array) {
        return left.length === right.length && left.every((value, index) => value === right[index]);
    }

    return left === right;
}

export function compareGridValues(left: DataGridCellValue, right: DataGridCellValue) {
    if (left == null && right == null) {
        return 0;
    }

    if (left == null) {
        return 1;
    }

    if (right == null) {
        return -1;
    }

    const leftText = formatValue(left, { functionMode: 'name' });
    const rightText = formatValue(right, { functionMode: 'name' });
    const leftNumber = Number(leftText);
    const rightNumber = Number(rightText);

    if (leftText !== '' && rightText !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
    }

    return leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: 'base' });
}
