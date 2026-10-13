// loadSelectedTable: the persisted grid sort must not be sent for a column the
// table does not have (renamed/dropped columns behind a stale layout), and a
// database rejection of the ordered column must not fail the grid.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TableDetailsState = { loaded: boolean; loading: boolean; info?: { columns: Array<{ name: string }> } };

const holders = vi.hoisted(() => ({
    tableDetails: {} as Record<string, TableDetailsState>,
    fetchedInfo: undefined as TableDetailsState['info'],
    getTableData: undefined as unknown as { run: (params: Record<string, unknown>) => Promise<unknown> },
}));

vi.mock('../../composables/useConnections', async () => {
    const { reactive } = await import('vue');
    const store = reactive({ selectedConnectionId: 1 as number | undefined });

    return {
        useConnections: () => ({
            get selectedConnectionId() {
                return store.selectedConnectionId;
            },
            get connections() {
                return [];
            },
            getConnectionTablesState: () => ({ loaded: true, loading: false, tables: [] }),
            getTableDetailsState: (connectionId: number, tableName: string) => holders.tableDetails[`${connectionId}:${tableName}`] ?? { loaded: false, loading: false },
            ensureTableDetails: vi.fn(async (connectionId: number, tableName: string) => {
                if (holders.fetchedInfo) {
                    holders.tableDetails[`${connectionId}:${tableName}`] = { loaded: true, loading: false, info: holders.fetchedInfo };
                }
            }),
            ensureConnectionTables: vi.fn(async () => {}),
        }),
    };
});

vi.mock('../../composables/useDbSettings', async () => {
    const { reactive } = await import('vue');

    return { useDbSettings: () => ({ state: reactive({ queryRowLimit: 100 }) }) };
});

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        getTableData: { run: (params: Record<string, unknown>) => holders.getTableData.run(params) },
        getTables: { run: vi.fn(async () => []) },
        runQuery: { run: vi.fn() },
        dismissError: vi.fn(),
        reportError: vi.fn(),
    },
}));

import { _useQuery } from '../../composables/useQuery';

const LAYOUT_KEY = 'data-grid-layout:1:logins';

function tableDataResult(rows: Array<Record<string, unknown>>) {
    return { columns: ['id'], rows, columnStats: {}, rowCount: rows.length, limit: 100, offset: 0 };
}

function persistSort(columnName: string) {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sort: { columnName, direction: 'desc' } }));
}

describe('loadSelectedTable order by', () => {
    beforeEach(() => {
        localStorage.clear();
        holders.tableDetails = {};
        holders.fetchedInfo = { columns: [{ name: 'id' }] };
        holders.getTableData = { run: vi.fn(async () => tableDataResult([])) };
    });

    it('does not send a persisted sort for a column the table does not have', async () => {
        holders.tableDetails['1:logins'] = { loaded: true, loading: false, info: { columns: [{ name: 'id' }, { name: 'email' }] } };
        persistSort('DateLastLogin');

        const query = _useQuery();
        await query.loadSelectedTable(1, 'logins');

        expect(holders.getTableData.run).toHaveBeenCalledWith(expect.objectContaining({ orderBy: undefined }));
        expect(localStorage.getItem(LAYOUT_KEY)).toContain('"sort":null');
    });

    it('sends a persisted sort whose column exists', async () => {
        holders.tableDetails['1:logins'] = { loaded: true, loading: false, info: { columns: [{ name: 'id' }, { name: 'email' }] } };
        persistSort('email');

        const query = _useQuery();
        await query.loadSelectedTable(1, 'logins');

        expect(holders.getTableData.run).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { column: 'email', direction: 'DESC' } }));
    });

    it('retries without the sort when the database rejects the ordered column', async () => {
        // The front-end knows nothing about the table yet, so the sort can only
        // be caught by the database itself.
        persistSort('DateLastLogin');
        const run = vi
            .fn()
            .mockRejectedValueOnce(new Error('Backend error (500): {"error":"Unknown column \'DateLastLogin\' in \'order clause\'"}'))
            .mockResolvedValueOnce(tableDataResult([{ id: 1 }]));
        holders.getTableData = { run };

        const query = _useQuery();
        await query.loadSelectedTable(1, 'logins');

        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls[0]?.[0]).toMatchObject({ orderBy: { column: 'DateLastLogin', direction: 'DESC' } });
        expect(run.mock.calls[1]?.[0]).toMatchObject({ orderBy: undefined });
        expect(query.tableData.rows).toEqual([{ id: 1 }]);
        expect(localStorage.getItem(LAYOUT_KEY)).toContain('"sort":null');
    });

    it('leaves other failures alone', async () => {
        persistSort('id');
        const run = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 172.16.42.21:3306'));
        holders.getTableData = { run };

        const query = _useQuery();
        await query.loadSelectedTable(1, 'logins');

        expect(run).toHaveBeenCalledTimes(1);
        expect(query.tableData.rows).toEqual([]);
    });

    it('remembers the custom query per table', async () => {
        holders.tableDetails['1:logins'] = { loaded: true, loading: false, info: { columns: [{ name: 'id' }] } };

        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');

        query.setCustomQueryText('SELECT 1');

        query.selectedTableName = 'users';
        await query.loadSelectedTable(1, 'users');
        expect(query.customQueryText).toBe('');

        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');
        expect(query.customQueryText).toBe('SELECT 1');
    });

    it('re-runs the custom query when a reload restores custom mode', async () => {
        holders.tableDetails['1:logins'] = { loaded: true, loading: false, info: { columns: [{ name: 'id' }] } };
        holders.getTableData = {
            run: vi.fn(async () => ({ ...tableDataResult([{ id: 1 }, { id: 2 }]), sql: 'SELECT * FROM "logins" LIMIT 100 OFFSET 0' })),
        };
        const runQuery = vi.fn(async () => ({ kind: 'rows', columns: ['id'], rows: [{ id: 2 }], columnStats: {} }));
        const { tasks } = await import('../../composables/useTasks');
        (tasks.runQuery as { run: unknown }).run = runQuery;

        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');
        expect(query.tableData.rows).toEqual([{ id: 1 }, { id: 2 }]);

        query.setCustomQueryText('select * from logins where id = 2');
        await query.runCustomQuery();
        expect(query.isCustomQueryMode).toBe(true);
        expect(query.tableData.rows).toEqual([{ id: 2 }]);

        // A stale reload (tab switch, save, manual refresh) must bring the custom rows back,
        // not leave the base rows under the custom query's text.
        runQuery.mockClear();
        await query.loadSelectedTable(1, 'logins');

        expect(runQuery).toHaveBeenCalledTimes(1);
        expect(query.isCustomQueryMode).toBe(true);
        expect(query.customQuerySourceSql).toBe('select * from logins where id = 2');
        expect(query.tableData.rows).toEqual([{ id: 2 }]);
    });

    it('does not re-run when the restored text matches the generated query', async () => {
        holders.tableDetails['1:logins'] = { loaded: true, loading: false, info: { columns: [{ name: 'id' }] } };
        holders.getTableData = {
            run: vi.fn(async () => ({ ...tableDataResult([{ id: 1 }]), sql: 'SELECT * FROM "logins" LIMIT 100 OFFSET 0' })),
        };
        const runQuery = vi.fn();
        const { tasks } = await import('../../composables/useTasks');
        (tasks.runQuery as { run: unknown }).run = runQuery;

        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');

        expect(query.isCustomQueryMode).toBe(false);
        expect(runQuery).not.toHaveBeenCalled();
        expect(query.tableData.rows).toEqual([{ id: 1 }]);
    });
});
