// useRemoteDriverTools.runQuery: statements returning rows must report their
// column names even when the result set is empty (no rows left to infer them
// from), falling back to the plain row query when a driver cannot supply them.
// It also decides when a table is too large to count exactly.
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

function createRowCountTools(helper: Partial<RemoteDriverHelper>, rows: Array<Record<string, unknown>> = [{ id: 1 }]) {
    const queryRowCount = vi.fn(async () => 42);
    const estimateRowCount = vi.fn(async () => 1_000_000);
    const queryRows = vi.fn(async () => rows);
    const tools = useRemoteDriverTools({
        testConnection: vi.fn(),
        withRemoteClient: async <T>(_connectionId: number, callback: (remoteClient: RemoteDriverClient) => Promise<T>) =>
            callback({ queryRows, execute: vi.fn(), withTransaction: vi.fn() } as unknown as RemoteDriverClient),
        resolveServerConnectionId: () => undefined,
        normalizeTableName: (tableName) => tableName,
        normalizeColumnName: (columnName) => columnName,
        buildColumnStats: (columns) => Object.fromEntries(columns.map((column) => [column, 0])),
        remoteMutationId: () => 0,
        helper: {
            queryRowCount,
            estimateRowCount,
            getTableColumns: vi.fn(async () => [{ name: 'id' } as never]),
            getIndexes: vi.fn(async () => []),
            getForeignKeys: vi.fn(async () => []),
            getTableNames: vi.fn(async () => []),
            getServerSchemas: vi.fn(async () => []),
            buildCreateDatabaseStatement: () => '',
            buildReadTableStatement: (tableName: string) => ({ sql: `SELECT * FROM ${tableName}` }),
            buildWriteValueStatement: () => ({ sql: '' }),
            buildModifyTableStatements: () => [],
            ...helper,
        } as RemoteDriverHelper,
    });

    return { tools, queryRowCount, estimateRowCount };
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

// Counting every row of a huge table is a full scan (minutes on InnoDB), so those
// tables report the catalog estimate instead and only small tables pay for a count.
describe('useRemoteDriverTools row counts', () => {
    it('keeps the catalog estimate for a huge table and never counts it', async () => {
        const { tools, queryRowCount, estimateRowCount } = createRowCountTools({});

        const data = await tools.getTableData(1, 'words2', 100, 0);

        expect(estimateRowCount).toHaveBeenCalledOnce();
        expect(queryRowCount).not.toHaveBeenCalled();
        expect(data.rowCount).toBe(1_000_000);
        expect(data.rowCountIsEstimated).toBe(true);
        expect(data.rows).toEqual([{ id: 1 }]);
    });

    it('counts a small table exactly', async () => {
        const smallEstimate = vi.fn(async () => 120);
        const { tools, queryRowCount } = createRowCountTools({ estimateRowCount: smallEstimate });

        const data = await tools.getTableData(1, 'people', 100, 0);

        expect(smallEstimate).toHaveBeenCalledOnce();
        expect(queryRowCount).toHaveBeenCalledOnce();
        expect(data.rowCount).toBe(42);
        expect(data.rowCountIsEstimated).toBe(false);
    });

    it('counts exactly when the driver has no catalog estimate', async () => {
        const { tools, queryRowCount, estimateRowCount } = createRowCountTools({ estimateRowCount: undefined });

        const data = await tools.getTableData(1, 'people', 100, 0);

        expect(estimateRowCount).not.toHaveBeenCalled();
        expect(queryRowCount).toHaveBeenCalledOnce();
        expect(data.rowCount).toBe(42);
        expect(data.rowCountIsEstimated).toBe(false);
    });

    it('uses the estimate when loading table details too', async () => {
        const { tools, queryRowCount } = createRowCountTools({});

        const info = await tools.getTableInfoFresh(1, 'words2');

        expect(queryRowCount).not.toHaveBeenCalled();
        expect(info.rowCount).toBe(1_000_000);
        expect(info.columns).toEqual([{ name: 'id' }]);
    });
});
