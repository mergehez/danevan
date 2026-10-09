// Listing a PostgreSQL schema must not cost one COUNT(*) per table: the table list reads the
// pg_class planner estimate in a single catalog query and only an opened table pays for an exact count.
import { describe, expect, it, vi } from 'vitest';
import { usePostgresSchemaHelper } from '../../../backend/usePostgresDriver';
import type { RemoteDriverClient } from '../../../backend/useRemoteDriverTools';

const schemaHelperDeps = {
    escapeSqlString: (value: string) => value.replaceAll("'", "''"),
    normalizeOptionalText: (value: string | null | undefined) => value ?? null,
    quoteIdentifier: (identifier: string) => `"${identifier}"`,
};

type CatalogStatement = { sql: string; params?: unknown[] };
type SchemaObjects = {
    tables?: Array<{ schema?: string; name: string }>;
    views?: Array<{ schema?: string; name: string }>;
    currentSchema?: string;
};

// A typed mock, so the issued statement can be read back with its SQL and params.
function rowsQuery(rows: unknown[]) {
    return vi.fn(async (_statement: CatalogStatement) => rows);
}

// The helper reads exactly the client fields getTableNames touches: the catalog query, the
// TypeORM query runner's table/view lists and the connection's current schema.
function createClient(queryRows: ReturnType<typeof rowsQuery>, objects: SchemaObjects = {}) {
    return {
        queryRows,
        currentSchema: Promise.resolve(objects.currentSchema ?? 'public'),
        queryRunner: {
            getTables: vi.fn(async () => objects.tables ?? []),
            getViews: vi.fn(async () => objects.views ?? []),
        },
    } as unknown as RemoteDriverClient;
}

describe('usePostgresSchemaHelper.getTableNames', () => {
    it('answers the table list from one pg_class catalog query', async () => {
        const queryRows = rowsQuery([
            { name: 'people', count: 120 },
            { name: 'etwp_big', count: '4000000' },
        ]);
        const tables = await usePostgresSchemaHelper(schemaHelperDeps).getTableNames(
            createClient(queryRows, {
                tables: [
                    { schema: 'public', name: 'people' },
                    { schema: 'public', name: 'etwp_big' },
                ],
                views: [{ schema: 'public', name: 'people_view' }],
            })
        );

        // One pg_class query for the whole schema — no `SELECT COUNT(*)` per table.
        expect(queryRows).toHaveBeenCalledTimes(1);
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain('pg_class');
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain('pg_namespace');
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain("relkind IN ('r', 'p')");
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain('current_schema()');
        expect(queryRows.mock.calls[0]?.[0]?.sql).not.toContain('COUNT(*)');
        expect(queryRows.mock.calls[0]?.[0]?.params).toBeUndefined();
        expect(tables).toEqual([
            { name: 'etwp_big', type: 'table', rowCount: 4_000_000, rowCountIsEstimated: true },
            { name: 'people', type: 'table', rowCount: 120, rowCountIsEstimated: true },
            { name: 'people_view', type: 'view', rowCount: 0 },
        ]);
    });

    it('reports a table the catalog has no estimate for as an estimated zero', async () => {
        const queryRows = rowsQuery([]);
        const tables = await usePostgresSchemaHelper(schemaHelperDeps).getTableNames(createClient(queryRows, { tables: [{ schema: 'public', name: 'fresh_table' }] }));

        expect(queryRows).toHaveBeenCalledTimes(1);
        expect(tables).toEqual([{ name: 'fresh_table', type: 'table', rowCount: 0, rowCountIsEstimated: true }]);
    });

    it('reports a view as type view with a zero count, ignoring an estimate row of the same name', async () => {
        const queryRows = rowsQuery([{ name: 'monthly_totals', count: 9_999 }]);
        const tables = await usePostgresSchemaHelper(schemaHelperDeps).getTableNames(
            createClient(queryRows, {
                views: [{ schema: 'reporting', name: 'reporting.monthly_totals' }],
                currentSchema: 'reporting',
            })
        );

        // The view keeps only its base name, and its count stays exact-looking zero without an estimate flag.
        expect(tables).toEqual([{ name: 'monthly_totals', type: 'view', rowCount: 0 }]);
    });

    it('ignores tables and views that belong to another schema', async () => {
        const queryRows = rowsQuery([
            { name: 'people', count: 120 },
            { name: 'events', count: 99 },
            { name: 'audit_log', count: 12 },
        ]);
        const tables = await usePostgresSchemaHelper(schemaHelperDeps).getTableNames(
            createClient(queryRows, {
                tables: [
                    { schema: 'public', name: 'people' },
                    { schema: 'audit', name: 'events' },
                ],
                views: [{ schema: 'audit', name: 'audit_log' }],
                currentSchema: 'public',
            })
        );

        expect(tables).toEqual([{ name: 'people', type: 'table', rowCount: 120, rowCountIsEstimated: true }]);
    });
});

describe('usePostgresSchemaHelper row counts', () => {
    it('counts an opened table exactly with COUNT(*)', async () => {
        const queryRows = rowsQuery([{ count: 765_432n }]);
        const count = await usePostgresSchemaHelper(schemaHelperDeps).queryRowCount(createClient(queryRows), 'people');

        expect(queryRows).toHaveBeenCalledTimes(1);
        expect(queryRows.mock.calls[0]?.[0]).toEqual({ sql: 'SELECT COUNT(*) AS count FROM "people"' });
        expect(count).toBe(765_432);
    });

    it("reads an opened table's estimate from pg_class.reltuples", async () => {
        const queryRows = rowsQuery([{ count: '1500' }]);
        const count = await usePostgresSchemaHelper(schemaHelperDeps).estimateRowCount(createClient(queryRows), 'people');

        expect(queryRows).toHaveBeenCalledTimes(1);
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain('c.reltuples');
        expect(queryRows.mock.calls[0]?.[0]?.params).toEqual(['people']);
        expect(queryRows.mock.calls[0]?.[0]?.sql).not.toContain('COUNT(*)');
        expect(count).toBe(1500);
    });
});
