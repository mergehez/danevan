// Listing a SQL Server schema must not cost one COUNT(*) per table: the table list reads the
// sys.partitions row count in a single catalog query and only an opened table pays for an exact count.
import { describe, expect, it, vi } from 'vitest';
import { useSqlServerSchemaHelper } from '../../../backend/useSqlServerDriver';
import type { RemoteDriverClient } from '../../../backend/useRemoteDriverTools';

const schemaHelperDeps = {
    normalizeOptionalText: (value: string | null | undefined) => value ?? null,
};

type CatalogStatement = { sql: string; params?: unknown[] };
type SchemaObjects = {
    tables?: Array<{ schema?: string; name: string }>;
    views?: Array<{ schema?: string; name: string }>;
};

// A typed mock, so the issued statement can be read back with its SQL and params.
function rowsQuery(rows: unknown[]) {
    return vi.fn(async (_statement: CatalogStatement) => rows);
}

// The helper reads exactly the client fields getTableNames touches: the catalog query and the
// TypeORM query runner's table/view lists. SQL Server has no currentSchema field.
function createClient(queryRows: ReturnType<typeof rowsQuery>, objects: SchemaObjects = {}) {
    return {
        queryRows,
        queryRunner: {
            getTables: vi.fn(async () => objects.tables ?? []),
            getViews: vi.fn(async () => objects.views ?? []),
        },
    } as unknown as RemoteDriverClient;
}

describe('useSqlServerSchemaHelper.getTableNames', () => {
    it('answers the table list from one sys.partitions catalog query', async () => {
        // `SELECT o.name` returns the bare object name, while a TypeORM table carries
        // `schema: 'dbo'`, so the helper reports the schema-qualified name and finds no estimate.
        const queryRows = rowsQuery([
            { name: 'people', count: 120 },
            { name: 'etwp_big', count: 4_000_000 },
        ]);
        const tables = await useSqlServerSchemaHelper(schemaHelperDeps).getTableNames(
            createClient(queryRows, {
                tables: [
                    { schema: 'dbo', name: 'people' },
                    { schema: 'dbo', name: 'etwp_big' },
                ],
                views: [{ schema: 'dbo', name: 'people_view' }],
            })
        );

        // One sys.partitions query for the whole schema — no `SELECT COUNT(*)` per table.
        expect(queryRows).toHaveBeenCalledTimes(1);
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain('sys.partitions');
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain('sys.objects');
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain('p.index_id IN (0, 1)');
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain("o.type = 'U'");
        expect(queryRows.mock.calls[0]?.[0]?.sql).not.toContain('COUNT(*)');
        expect(queryRows.mock.calls[0]?.[0]?.params).toBeUndefined();
        expect(tables).toEqual([
            { name: 'dbo.etwp_big', type: 'table', rowCount: 0, rowCountIsEstimated: true },
            { name: 'dbo.people', type: 'table', rowCount: 0, rowCountIsEstimated: true },
            { name: 'dbo.people_view', type: 'view', rowCount: 0 },
        ]);
    });

    it('matches the catalog estimate only when the catalog name equals the table name', async () => {
        const queryRows = rowsQuery([
            { name: 'people', count: 120 },
            { name: 'orders', count: '8000' },
        ]);
        const tables = await useSqlServerSchemaHelper(schemaHelperDeps).getTableNames(
            createClient(queryRows, {
                tables: [{ name: 'people' }, { schema: 'sales', name: 'orders' }],
            })
        );

        expect(tables).toEqual([
            { name: 'people', type: 'table', rowCount: 120, rowCountIsEstimated: true },
            { name: 'sales.orders', type: 'table', rowCount: 0, rowCountIsEstimated: true },
        ]);
    });

    it('reports a table the catalog has no estimate for as an estimated zero', async () => {
        const queryRows = rowsQuery([]);
        const tables = await useSqlServerSchemaHelper(schemaHelperDeps).getTableNames(createClient(queryRows, { tables: [{ schema: 'dbo', name: 'fresh_table' }] }));

        expect(queryRows).toHaveBeenCalledTimes(1);
        expect(tables).toEqual([{ name: 'dbo.fresh_table', type: 'table', rowCount: 0, rowCountIsEstimated: true }]);
    });
});

describe('useSqlServerSchemaHelper row counts', () => {
    it('counts an opened table exactly with COUNT(*)', async () => {
        const queryRows = rowsQuery([{ count: 765_432n }]);
        const count = await useSqlServerSchemaHelper(schemaHelperDeps).queryRowCount(createClient(queryRows), 'dbo.people');

        expect(queryRows).toHaveBeenCalledTimes(1);
        expect(queryRows.mock.calls[0]?.[0]).toEqual({ sql: 'SELECT COUNT(*) AS count FROM [dbo].[people]' });
        expect(count).toBe(765_432);
    });

    it("reads an opened table's estimate from sys.partitions", async () => {
        const queryRows = rowsQuery([{ count: '1500' }]);
        const count = await useSqlServerSchemaHelper(schemaHelperDeps).estimateRowCount(createClient(queryRows), 'dbo.people');

        expect(queryRows).toHaveBeenCalledTimes(1);
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain('SUM(p.rows)');
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain('OBJECT_ID(?)');
        expect(queryRows.mock.calls[0]?.[0]?.params).toEqual(['dbo.people']);
        expect(queryRows.mock.calls[0]?.[0]?.sql).not.toContain('COUNT(*)');
        expect(count).toBe(1500);
    });
});
