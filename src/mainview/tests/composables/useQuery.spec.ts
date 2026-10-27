// loadSelectedTable: the persisted grid sort must not be sent for a column the
// table does not have (renamed/dropped columns behind a stale layout), and a
// database rejection of the ordered column must not fail the grid.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { nextTick } from 'vue';

type TableDetailsState = { loaded: boolean; loading: boolean; info?: { columns: Array<{ name: string }> } };

const holders = vi.hoisted(() => ({
    tableDetails: {} as Record<string, TableDetailsState>,
    fetchedInfo: undefined as TableDetailsState['info'],
    getTableData: undefined as unknown as { run: (params: Record<string, unknown>) => Promise<unknown> },
    applyTableRowCount: undefined as unknown as Mock<(...args: unknown[]) => void>,
    /** The row limit a new settings store starts on, as the app DB would answer. */
    rowLimit: 100,
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
            applyTableRowCount: (...args: unknown[]) => holders.applyTableRowCount(...args),
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

    return {
        useDbSettings: () => {
            const state = reactive({ queryRowLimit: holders.rowLimit });

            return {
                state,
                setQueryRowLimit: async (limit: number) => {
                    state.queryRowLimit = limit;
                },
            };
        },
    };
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
        holders.applyTableRowCount = vi.fn();
    });

    it('reports the count of the rows it just loaded to the sidebar list', async () => {
        // The table was emptied elsewhere: the list's cached count is stale and the panel
        // measured zero rows, which is what the sidebar must show.
        holders.tableDetails['1:logins'] = { loaded: true, loading: false, info: { columns: [{ name: 'id' }] } };
        holders.getTableData = { run: vi.fn(async () => ({ ...tableDataResult([]), rowCount: 0 })) };

        const query = _useQuery();
        await query.loadSelectedTable(1, 'logins');

        expect(holders.applyTableRowCount).toHaveBeenCalledWith(1, 'logins', 0, false);
    });

    it('keeps a count the backend only estimated marked as an estimate', async () => {
        holders.tableDetails['1:logins'] = { loaded: true, loading: false, info: { columns: [{ name: 'id' }] } };
        holders.getTableData = { run: vi.fn(async () => ({ ...tableDataResult([{ id: 1 }]), rowCount: 4_000_000, rowCountIsEstimated: true })) };

        const query = _useQuery();
        await query.loadSelectedTable(1, 'logins');

        expect(holders.applyTableRowCount).toHaveBeenCalledWith(1, 'logins', 4_000_000, true);
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

describe('interactive query bar state', () => {
    beforeEach(() => {
        localStorage.clear();
        holders.tableDetails = {};
        holders.fetchedInfo = { columns: [{ name: 'id' }, { name: 'email' }] };
        holders.rowLimit = 100;
        holders.getTableData = { run: vi.fn(async () => tableDataResult([])) };
        holders.applyTableRowCount = vi.fn();
    });

    it('starts on the table columns and the grid row limit', async () => {
        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');

        expect(query.customQueryEditorMode).toBe('interactive');
        expect(query.interactiveDraft).toMatchObject({ selectMode: 'all', columns: ['id', 'email'], limit: 100, offset: '', where: [] });
    });

    it('runs the statement its controls describe and keeps it as the grid target', async () => {
        const runQuery = vi.fn();
        const { tasks } = await import('../../composables/useTasks');
        (tasks.runQuery as { run: unknown }).run = runQuery;

        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');

        query.interactiveDraft.selectMode = 'custom';
        query.interactiveDraft.columns = ['email'];
        query.interactiveDraft.where = ['id = 2'];
        query.interactiveDraft.orderBy = [{ column: 'email', direction: 'DESC' }];
        query.interactiveDraft.limit = 10;
        query.interactiveDraft.offset = 5;

        expect(query.buildInteractiveQuerySql('sqlite')).toBe('SELECT "email" FROM "logins" WHERE (id = 2) ORDER BY "email" DESC LIMIT 10 OFFSET 5');

        await query.runInteractiveQuery('sqlite');

        expect(runQuery).toHaveBeenCalledWith({ connectionId: 1, sql: 'SELECT "email" FROM "logins" WHERE (id = 2) ORDER BY "email" DESC LIMIT 10 OFFSET 5' });
        expect(query.customQueryText).toBe('SELECT "email" FROM "logins" WHERE (id = 2) ORDER BY "email" DESC LIMIT 10 OFFSET 5');
    });

    it('remembers the controls per table, so switching tabs does not drop them', async () => {
        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');

        query.interactiveDraft.where = ['id = 2'];
        await nextTick();

        query.selectedTableName = 'users';
        await query.loadSelectedTable(1, 'users');
        expect(query.interactiveDraft.where).toEqual([]);

        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');
        expect(query.interactiveDraft.where).toEqual(['id = 2']);
    });

    it('resets the controls to the generated query', async () => {
        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');

        query.interactiveDraft.where = ['id = 2'];
        query.interactiveDraft.selectMode = 'custom';
        query.interactiveDraft.columns = ['email'];

        query.clearCustomQuery();
        await nextTick();

        expect(query.interactiveDraft).toMatchObject({ selectMode: 'all', columns: ['id', 'email'], where: [] });
    });

    it('mirrors the page and sort the grid loaded into the controls', async () => {
        holders.tableDetails['1:logins'] = { loaded: true, loading: false, info: { columns: [{ name: 'id' }] } };
        holders.getTableData = {
            run: vi.fn(async (params: Record<string, any>) => ({ ...tableDataResult([{ id: 1 }]), limit: params.limit, offset: params.offset })),
        };
        persistSort('id');

        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins', { offset: 10 });

        // The toolbar shows page size 100 at offset 10, sorted by id DESC: the bar says the same.
        expect(query.interactiveDraft).toMatchObject({ limit: 100, offset: 10, orderBy: [{ column: 'id', direction: 'DESC' }] });
        expect(query.buildInteractiveQuerySql('sqlite')).toBe('SELECT * FROM "logins" ORDER BY "id" DESC LIMIT 100 OFFSET 10');
    });

    it('leaves a hand-built multi-column order alone when the grid reloads', async () => {
        holders.tableDetails['1:logins'] = { loaded: true, loading: false, info: { columns: [{ name: 'id' }, { name: 'email' }] } };

        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');

        query.interactiveDraft.orderBy = [
            { column: 'email', direction: 'DESC' },
            { column: 'id', direction: 'ASC' },
        ];
        await query.loadSelectedTable(1, 'logins');

        expect(query.interactiveDraft.orderBy).toHaveLength(2);
    });

    it('mirrors a sort the grid applied without fetching rows', async () => {
        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');

        query.syncInteractiveOrderBy({ column: 'email', direction: 'ASC' });
        expect(query.interactiveDraft.orderBy).toEqual([{ column: 'email', direction: 'ASC' }]);

        query.syncInteractiveOrderBy(undefined);
        expect(query.interactiveDraft.orderBy).toEqual([]);
    });

    it('keeps the page size and the limit field the same number', async () => {
        const run = vi.fn(async (params: Record<string, any>) => ({ ...tableDataResult([]), limit: params.limit, offset: params.offset }));
        holders.getTableData = { run };

        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');

        await query.setPageLimit(25);

        expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 25, offset: 0 }));
        expect(query.interactiveDraft.limit).toBe(25);
        expect(query.buildInteractiveQuerySql('sqlite')).toBe('SELECT * FROM "logins" LIMIT 25');
    });

    it('pages from the offset field, and reports the page it loads', async () => {
        const run = vi.fn(async (params: Record<string, any>) => ({ ...tableDataResult([]), limit: params.limit, offset: params.offset }));
        holders.getTableData = { run };

        const query = _useQuery();
        query.selectedTableName = 'logins';
        await query.loadSelectedTable(1, 'logins');

        await query.setPageOffset(20);

        expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100, offset: 20 }));
        expect(query.interactiveDraft.offset).toBe(20);
    });

    it('keeps the paging of a restored custom query instead of the base page', async () => {
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

        query.interactiveDraft.where = ['id = 2'];
        query.interactiveDraft.limit = 5;
        await query.runInteractiveQuery('sqlite');
        expect(query.isCustomQueryMode).toBe(true);

        // A reload (save, tab activation) restores the custom rows and their own controls.
        await query.loadSelectedTable(1, 'logins');

        expect(query.isCustomQueryMode).toBe(true);
        expect(query.interactiveDraft).toMatchObject({ where: ['id = 2'], limit: 5, offset: '' });
    });
});
