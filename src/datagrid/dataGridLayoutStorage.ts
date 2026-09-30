import type { GridLayoutState, GridSortState } from './useDataGridTypes';
import { normalizeGridLayoutState, pruneGridLayout } from './useDataGridTypes';

/**
 * localStorage key used by the data grid to persist its layout (including the
 * sort order) per connection + table.
 */
export function getDataGridLayoutStorageKey(connectionId: number, tableName: string) {
    return `data-grid-layout:${connectionId}:${tableName}`;
}

function getStorage() {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
}

/** Layout stored under `storageKey`, or undefined when there is none. */
export function readGridLayout(storageKey: string | undefined): GridLayoutState | undefined {
    const storage = getStorage();

    if (!storageKey || !storage) {
        return undefined;
    }

    const rawValue = storage.getItem(storageKey);

    if (!rawValue) {
        return undefined;
    }

    try {
        return normalizeGridLayoutState(JSON.parse(rawValue) as Partial<GridLayoutState>);
    } catch {
        return undefined;
    }
}

export function writeGridLayout(storageKey: string | undefined, layout: GridLayoutState) {
    const storage = getStorage();

    if (!storageKey || !storage) {
        return;
    }

    storage.setItem(storageKey, JSON.stringify(layout));
}

/**
 * Drops the stored layout entries for columns the table no longer has, so a
 * renamed or rebuilt table is never ordered by a column that is gone.
 */
export function prunePersistedGridLayout(connectionId: number | undefined, tableName: string | undefined, columnNames: string[]) {
    if (typeof connectionId !== 'number' || !tableName || columnNames.length === 0) {
        return;
    }

    const storageKey = getDataGridLayoutStorageKey(connectionId, tableName);
    const stored = readGridLayout(storageKey);

    if (!stored) {
        return;
    }

    writeGridLayout(storageKey, pruneGridLayout(stored, columnNames));
}

/**
 * Reads the persisted sort order for a table so data can be (re)loaded with the
 * same ordering the grid is showing — even when the caller doesn't pass an
 * explicit `orderBy` (reload, revisiting a table tab, etc.).
 */
export function readPersistedGridSort(connectionId: number | undefined, tableName: string | undefined): { column: string; direction: 'ASC' | 'DESC' } | undefined {
    if (typeof connectionId !== 'number' || !tableName) {
        return undefined;
    }

    const sort: GridSortState = readGridLayout(getDataGridLayoutStorageKey(connectionId, tableName))?.sort ?? null;

    if (!sort?.columnName) {
        return undefined;
    }

    return {
        column: sort.columnName,
        direction: sort.direction === 'asc' ? 'ASC' : 'DESC',
    };
}

export function clearPersistedGridSort(connectionId: number | undefined, tableName: string | undefined) {
    if (typeof connectionId !== 'number' || !tableName) {
        return;
    }

    const storageKey = getDataGridLayoutStorageKey(connectionId, tableName);
    const stored = readGridLayout(storageKey);

    if (stored) {
        writeGridLayout(storageKey, { ...stored, sort: null });
    }
}

/**
 * True when a failed query looks like the database rejecting the ORDER BY
 * column (a renamed or dropped column behind a persisted sort).
 */
export function isInvalidSortColumnError(error: unknown, columnName: string): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLocaleLowerCase();

    return message.includes(columnName.toLocaleLowerCase()) && /column|order clause/.test(message);
}
