import { describe, expect, it } from 'vitest';
import { parseSqlEditorTableDropPayload, serializeSqlEditorTableDropPayload, SQL_EDITOR_TABLE_DRAG_MIME } from './sqlEditorDnd';

describe('SQL editor table drag payload', () => {
    it('uses a private MIME type so foreign drags are ignored', () => {
        expect(SQL_EDITOR_TABLE_DRAG_MIME).toBe('application/x-danevan-sql-table');
    });

    it('round-trips a connection and table', () => {
        const payload = { connectionId: 7, tableName: 'order_items' };

        expect(parseSqlEditorTableDropPayload(serializeSqlEditorTableDropPayload(payload))).toEqual(payload);
    });

    it.each([
        ['undefined', undefined],
        ['an empty string', ''],
        ['invalid JSON', '{not json'],
    ])('rejects %s', (_case, rawValue) => {
        expect(parseSqlEditorTableDropPayload(rawValue)).toBeUndefined();
    });

    it.each([
        ['a string connection id', { connectionId: '7', tableName: 'users' }],
        ['a missing connection id', { tableName: 'users' }],
        ['a non-finite connection id', { connectionId: Number.NaN, tableName: 'users' }],
        ['a zero connection id', { connectionId: 0, tableName: 'users' }],
        ['a negative connection id', { connectionId: -1, tableName: 'users' }],
        ['a missing table name', { connectionId: 7 }],
        ['a numeric table name', { connectionId: 7, tableName: 12 }],
        ['a blank table name', { connectionId: 7, tableName: '   ' }],
    ])('rejects %s', (_case, payload) => {
        expect(parseSqlEditorTableDropPayload(JSON.stringify(payload))).toBeUndefined();
    });

    it('keeps a table name with surrounding spaces verbatim', () => {
        expect(parseSqlEditorTableDropPayload(JSON.stringify({ connectionId: 3, tableName: ' my table ' }))).toEqual({
            connectionId: 3,
            tableName: ' my table ',
        });
    });
});
