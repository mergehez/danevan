// useRemoteDriverTools.runQuery: statements returning rows must report their
// column names even when the result set is empty (no rows left to infer them
// from), falling back to the plain row query when a driver cannot supply them.
// It also decides when a table is too large to count exactly.
import { describe, expect, it, vi } from 'vitest';
import { isRowReturningSql, statementWrites, useRemoteDriverTools, type RemoteDriverClient, type RemoteDriverHelper } from '../../../backend/useRemoteDriverTools';

function createTools(client: Partial<RemoteDriverClient>, assertWritable?: (connectionId: number) => void) {
    const queryRows = vi.fn(async () => [{ id: 1 }]);

    return {
        queryRows,
        tools: useRemoteDriverTools({
            assertWritable,
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

    // The remote drivers only learn the result shape from the kind the statement is given, so a
    // read behind a comment used to come back as a mutation and the editor showed no rows.
    it('reads rows for a statement that a comment hides from the classifier', async () => {
        const queryRows = vi.fn(async () => [{ total: 3 }]);
        const execute = vi.fn(async () => ({ affectedRows: 0 }));
        const { tools } = createTools({ queryRows, execute } as Partial<RemoteDriverClient>);

        const result = await tools.runQuery(1, '-- monthly report\nSELECT COUNT(*) AS total FROM orders');

        expect(execute).not.toHaveBeenCalled();
        expect(queryRows).toHaveBeenCalledWith({ sql: '-- monthly report\nSELECT COUNT(*) AS total FROM orders', params: [] });
        expect(result).toMatchObject({ kind: 'rows', columns: ['total'], rows: [{ total: 3 }] });
    });

    it('reads rows behind a block or hash comment too', async () => {
        const queryRows = vi.fn(async () => [{ id: 1 }]);
        const { tools } = createTools({ queryRows } as Partial<RemoteDriverClient>);

        expect(await tools.runQuery(1, '/* overnight report */\nselect id from orders')).toMatchObject({ kind: 'rows' });
        expect(await tools.runQuery(1, '# overnight report\nselect id from orders')).toMatchObject({ kind: 'rows' });
    });

    it('still reports a write behind a comment as a mutation', async () => {
        const queryRows = vi.fn(async () => []);
        const execute = vi.fn(async () => ({ affectedRows: 2 }));
        const { tools } = createTools({ queryRows, execute } as Partial<RemoteDriverClient>);

        const result = await tools.runQuery(1, '/* cleanup */\nDELETE FROM orders');

        expect(queryRows).not.toHaveBeenCalled();
        expect(execute).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ kind: 'mutation' });
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

// A read-only connection is a policy, not a permission: the statement must not reach the server.
describe('statements that write', () => {
    it('reads the statements that only read', () => {
        expect(statementWrites('select 1')).toBe(false);
        expect(statementWrites('  -- overnight report\n SELECT count(*) FROM orders')).toBe(false);
        expect(statementWrites('PRAGMA table_info(orders)')).toBe(false);
        expect(statementWrites('EXPLAIN SELECT 1')).toBe(false);
        expect(statementWrites('with recent as (select 1) select * from recent')).toBe(false);
        expect(isRowReturningSql('with recent as (select 1) select * from recent')).toBe(true);
    });

    it('sees a write, behind a comment or inside a CTE', () => {
        expect(statementWrites('/* cleanup */ delete from orders')).toBe(true);
        expect(statementWrites('INSERT INTO orders VALUES (1)')).toBe(true);
        expect(statementWrites('create table orders (id int)')).toBe(true);
        expect(statementWrites('with recent as (select 1) insert into orders select * from recent')).toBe(true);
    });
});

describe('a read-only connection', () => {
    it('refuses a write before it reaches the server', async () => {
        const execute = vi.fn(async () => ({ affectedRows: 1 }));
        const queryRows = vi.fn(async () => [{ id: 1 }]);
        const assertWritable = vi.fn((connectionId: number) => {
            throw new Error(`connection ${connectionId} is read-only`);
        });
        const { tools } = createTools({ queryRows, execute } as Partial<RemoteDriverClient>, assertWritable);

        await expect(tools.runQuery(7, "update orders set name = 'Ada'")).rejects.toThrow('connection 7 is read-only');
        expect(execute).not.toHaveBeenCalled();
        expect(queryRows).not.toHaveBeenCalled();
    });

    it('still runs the reads', async () => {
        const execute = vi.fn(async () => ({ affectedRows: 0 }));
        const queryRows = vi.fn(async () => [{ id: 1 }]);
        const assertWritable = vi.fn();
        const { tools } = createTools({ queryRows, execute } as Partial<RemoteDriverClient>, assertWritable);

        expect(await tools.runQuery(7, 'SELECT id FROM orders')).toMatchObject({ kind: 'rows', rows: [{ id: 1 }] });
        expect(assertWritable).not.toHaveBeenCalled();
        expect(queryRows).toHaveBeenCalledOnce();
    });
});
