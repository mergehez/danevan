import { beforeEach, describe, expect, it } from 'vitest';
import { getDataGridLayoutStorageKey, readPersistedGridSort } from './dataGridLayoutStorage';

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
});
