import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearPersistedGridSort,
    getDataGridLayoutStorageKey,
    isInvalidSortColumnError,
    prunePersistedGridLayout,
    readGridLayout,
    readPersistedGridSort,
    writeGridLayout,
} from './dataGridLayoutStorage';

describe('dataGridLayoutStorage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('builds the layout key from connection + table', () => {
        expect(getDataGridLayoutStorageKey(3, 'users')).toBe('data-grid-layout:3:users');
    });

    it('reads a persisted descending sort', () => {
        localStorage.setItem(getDataGridLayoutStorageKey(3, 'users'), JSON.stringify({ sort: { columnName: 'name', direction: 'desc' } }));

        expect(readPersistedGridSort(3, 'users')).toEqual({ column: 'name', direction: 'DESC' });
    });

    it('reads a persisted ascending sort', () => {
        localStorage.setItem(getDataGridLayoutStorageKey(3, 'users'), JSON.stringify({ sort: { columnName: 'id', direction: 'asc' } }));

        expect(readPersistedGridSort(3, 'users')).toEqual({ column: 'id', direction: 'ASC' });
    });

    it('returns undefined when there is no persisted sort', () => {
        expect(readPersistedGridSort(3, 'users')).toBeUndefined();

        localStorage.setItem(getDataGridLayoutStorageKey(3, 'users'), JSON.stringify({ sort: null }));
        expect(readPersistedGridSort(3, 'users')).toBeUndefined();
    });

    it('returns undefined for missing identifiers or invalid JSON', () => {
        expect(readPersistedGridSort(undefined, 'users')).toBeUndefined();
        expect(readPersistedGridSort(3, undefined)).toBeUndefined();

        localStorage.setItem(getDataGridLayoutStorageKey(3, 'users'), 'not json');
        expect(readPersistedGridSort(3, 'users')).toBeUndefined();
    });

    it('round-trips a layout through the storage key', () => {
        const key = getDataGridLayoutStorageKey(3, 'users');
        const layout = readGridLayout(key) ?? { ...defaultLayout(), showRowNumbers: false };

        writeGridLayout(key, layout);

        expect(readGridLayout(key)).toEqual(layout);
    });

    it('clears only the sort', () => {
        const key = getDataGridLayoutStorageKey(3, 'users');
        writeGridLayout(key, { ...defaultLayout(), columnWidths: { name: 140 }, sort: { columnName: 'name', direction: 'asc' } });

        clearPersistedGridSort(3, 'users');

        expect(readGridLayout(key)).toMatchObject({ columnWidths: { name: 140 }, sort: null });
    });

    it('drops the stored entries of columns the table no longer has', () => {
        const key = getDataGridLayoutStorageKey(3, 'logins');
        writeGridLayout(key, {
            ...defaultLayout(),
            columnOrder: ['DateLastLogin', 'id'],
            columnWidths: { DateLastLogin: 180, id: 60 },
            hiddenColumns: ['DateLastLogin'],
            displayTypes: { DateLastLogin: 'timestamp-seconds' },
            sort: { columnName: 'DateLastLogin', direction: 'desc' },
        });

        prunePersistedGridLayout(3, 'logins', ['id', 'email']);

        expect(readGridLayout(key)).toMatchObject({
            columnOrder: ['id'],
            columnWidths: { id: 60 },
            hiddenColumns: [],
            displayTypes: {},
            sort: null,
        });
        expect(readPersistedGridSort(3, 'logins')).toBeUndefined();
    });

    it('does nothing when the columns are unknown', () => {
        const key = getDataGridLayoutStorageKey(3, 'logins');
        writeGridLayout(key, { ...defaultLayout(), sort: { columnName: 'DateLastLogin', direction: 'desc' } });

        prunePersistedGridLayout(3, 'logins', []);

        expect(readPersistedGridSort(3, 'logins')).toEqual({ column: 'DateLastLogin', direction: 'DESC' });
    });

    it('recognises database errors about the ordered column', () => {
        expect(isInvalidSortColumnError(new Error("Unknown column 'DateLastLogin' in 'order clause'"), 'DateLastLogin')).toBe(true);
        expect(isInvalidSortColumnError(new Error('column "datelastlogin" does not exist'), 'DateLastLogin')).toBe(true);
        expect(isInvalidSortColumnError('no such column: DateLastLogin', 'DateLastLogin')).toBe(true);
        expect(isInvalidSortColumnError(new Error('connect ECONNREFUSED'), 'DateLastLogin')).toBe(false);
        expect(isInvalidSortColumnError(new Error("Unknown column 'other' in 'order clause'"), 'DateLastLogin')).toBe(false);
    });
});

function defaultLayout() {
    return {
        columnsOrderDirection: undefined,
        columnOrder: [] as string[],
        columnWidths: {} as Record<string, number>,
        hiddenColumns: [] as string[],
        displayTypes: {},
        sort: null,
        fontFamily: 'roboto' as const,
        showRowNumbers: true,
    };
}
