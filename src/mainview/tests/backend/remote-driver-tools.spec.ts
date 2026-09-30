// useRemoteDriverTools.runQuery: statements returning rows must report their
// column names even when the result set is empty (no rows left to infer them
// from), falling back to the plain row query when a driver cannot supply them.
import { describe, expect, it, vi } from 'vitest';
import { useRemoteDriverTools, type RemoteDriverClient, type RemoteDriverHelper } from '../../../backend/useRemoteDriverTools';

function createTools(client: Partial<RemoteDriverClient>) {
    const queryRows = vi.fn(async () => [{ id: 1 }]);

    return {
        queryRows,
        tools: useRemoteDriverTools({
            testConnection: vi.fn(),
            withRemoteClient: async <T>(_connectionId: number, callback: (remoteClient: RemoteDriverClient) => Promise<T>) =>
                callback({ queryRows, execute: vi.fn(), withTransaction: vi.fn(), ...client } as RemoteDriverClient),
            resolveServerConnectionId: () => undefined,
            normalizeTableName: (tableName) => tableName,
            normalizeColumnName: (columnName) => columnName,
            buildColumnStats: (columns, rows) => Object.fromEntries(columns.map((column) => [column, rows.length])),
            remoteMutationId: () => 0,
            helper: {} as RemoteDriverHelper,
        }),
    };
}

describe('useRemoteDriverTools.runQuery', () => {
    it('uses the driver column metadata when no rows come back', async () => {
        const queryRows = vi.fn(async () => []);
        const queryRowsWithFields = vi.fn(async () => ({ columns: ['id', 'message'], rows: [] as Array<Record<string, unknown>> }));
        const { tools } = createTools({ queryRows, queryRowsWithFields } as Partial<RemoteDriverClient>);

        const result = await tools.runQuery(1, 'SELECT id, message FROM empty_log');

        expect(queryRowsWithFields).toHaveBeenCalledWith({ sql: 'SELECT id, message FROM empty_log', params: [] });
        expect(queryRows).not.toHaveBeenCalled();
        expect(result).toMatchObject({ kind: 'rows', columns: ['id', 'message'], rows: [], columnStats: { id: 0, message: 0 } });
    });

    it('falls back to the row query when the driver has no field metadata', async () => {
        const queryRows = vi.fn(async () => []);
        const { tools } = createTools({ queryRows });

        const result = await tools.runQuery(1, 'SELECT id FROM empty_log');

        expect(result).toMatchObject({ kind: 'rows', columns: [], rows: [] });
    });

    it('falls back to the row query when the metadata query fails', async () => {
        const queryRowsWithFields = vi.fn(async () => {
            throw new Error('no fields for you');
        });
        const queryRows = vi.fn(async () => []);
        const { tools } = createTools({ queryRows, queryRowsWithFields } as Partial<RemoteDriverClient>);

        const result = await tools.runQuery(1, 'SELECT id FROM empty_log');

        expect(queryRows).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ kind: 'rows', columns: [], rows: [] });
    });

    it('falls back to the row names when the metadata query returns none', async () => {
        const queryRows = vi.fn(async () => [{ id: 1, message: 'hello' }]);
        const queryRowsWithFields = vi.fn(async () => ({ columns: [] as string[], rows: [{ id: 1, message: 'hello' }] }));
        const { tools } = createTools({ queryRows, queryRowsWithFields } as Partial<RemoteDriverClient>);

        const result = await tools.runQuery(1, 'SELECT id, message FROM filled_log');

        expect(result).toMatchObject({ kind: 'rows', columns: ['id', 'message'], rows: [{ id: 1, message: 'hello' }] });
    });
});
