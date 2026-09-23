import type { GridSortState } from './useDataGridTypes';

/**
 * localStorage key used by the data grid to persist its layout (including the
 * sort order) per connection + table.
 */
export function getDataGridLayoutStorageKey(connectionId: number, tableName: string) {
    return `data-grid-layout:${connectionId}:${tableName}`;
}

/**
 * Reads the persisted sort order for a table so data can be (re)loaded with the
 * same ordering the grid is showing — even when the caller doesn't pass an
 * explicit `orderBy` (reload, revisiting a table tab, etc.).
 */
export function readPersistedGridSort(connectionId: number | undefined, tableName: string | undefined): { column: string; direction: 'ASC' | 'DESC' } | undefined {
    if (typeof localStorage === 'undefined' || !connectionId || !tableName) {
        return undefined;
    }

    const rawValue = localStorage.getItem(getDataGridLayoutStorageKey(connectionId, tableName));

    if (!rawValue) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(rawValue) as { sort?: GridSortState };
        const sort = parsed?.sort;

        if (!sort?.columnName) {
            return undefined;
        }

        return {
            column: sort.columnName,
            direction: sort.direction === 'asc' ? 'ASC' : 'DESC',
        };
    } catch {
        return undefined;
    }
}
