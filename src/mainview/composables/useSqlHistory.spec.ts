import { beforeEach, describe, expect, it } from 'vitest';
import { _useSqlHistory } from './useSqlHistory';

describe('useSqlHistory', () => {
    const history = _useSqlHistory();

    beforeEach(() => {
        history.clear();
    });

    it('records entries newest first', () => {
        history.record({ source: 'query', sql: 'SELECT 1', status: 'success' });
        history.record({ source: 'query', sql: 'SELECT 2', status: 'success' });

        expect(history.count).toBe(2);
        expect(history.entries[0].sql).toBe('SELECT 2');
        expect(history.entries[1].sql).toBe('SELECT 1');
    });

    it('caps history at 100 entries', () => {
        for (let i = 0; i < 105; i += 1) {
            history.record({ source: 'query', sql: `SELECT ${i}`, status: 'success' });
        }

        expect(history.count).toBe(100);
        expect(history.entries[0].sql).toBe('SELECT 104');
        expect(history.entries[99].sql).toBe('SELECT 5');
    });

    it('stores error status and message', () => {
        history.record({ source: 'drop-table', sql: 'DROP TABLE t', status: 'error', errorMessage: 'boom' });

        expect(history.entries[0].status).toBe('error');
        expect(history.entries[0].errorMessage).toBe('boom');
        expect(history.entries[0].source).toBe('drop-table');
    });

    it('stores metadata fields', () => {
        history.record({
            source: 'modify-table',
            sql: 'ALTER TABLE `t` ADD COLUMN `x` int',
            status: 'success',
            connectionId: 7,
            connectionLabel: 'mydb',
            dialect: 'mysql',
            durationMs: 25,
        });

        const entry = history.entries[0];
        expect(entry.connectionId).toBe(7);
        expect(entry.connectionLabel).toBe('mydb');
        expect(entry.dialect).toBe('mysql');
        expect(entry.durationMs).toBe(25);
        expect(typeof entry.id).toBe('string');
        expect(typeof entry.timestamp).toBe('number');
    });

    it('clears the history', () => {
        history.record({ source: 'query', sql: 'SELECT 1', status: 'success' });
        history.clear();

        expect(history.count).toBe(0);
    });
});
