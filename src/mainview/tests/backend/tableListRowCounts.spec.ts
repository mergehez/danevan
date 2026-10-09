// Listing a schema must not cost one COUNT(*) per table: the table list answers
// from the catalog and only an opened table pays for an exact count.
import { describe, expect, it, vi } from 'vitest';
import { useMySqlSchemaHelper } from '../../../backend/useMySqlDriver';
import { resolveListedRowCount, type RemoteDriverClient } from '../../../backend/useRemoteDriverTools';

const schemaHelperDeps = {
    escapeSqlString: (value: string) => value.replaceAll("'", "''"),
    normalizeOptionalText: (value: string | null | undefined) => value ?? null,
    quoteRemoteIdentifier: (_driver: 'mysql', identifier: string) => `\`${identifier}\``,
};

function createClient(queryRows: ReturnType<typeof vi.fn>) {
    return { queryRows, execute: vi.fn(), withTransaction: vi.fn() } as unknown as RemoteDriverClient;
}

describe('resolveListedRowCount', () => {
    // The "no COUNT(*) per table" guarantee lives in the getTableNames spec below; this only
    // pins how a catalog value is reported.
    it('always reports the catalog value as an estimate, even when the catalog has none', () => {
        expect(resolveListedRowCount(765_432)).toEqual({ rowCount: 765_432, rowCountIsEstimated: true });
        // 0 is a real estimate, not a missing one.
        expect(resolveListedRowCount(0)).toEqual({ rowCount: 0, rowCountIsEstimated: true });
        // A missing estimate is still an estimate; the opened table replaces it.
        expect(resolveListedRowCount(undefined)).toEqual({ rowCount: 0, rowCountIsEstimated: true });
    });
});

describe('useMySqlSchemaHelper.getTableNames', () => {
    it('answers the table list from one catalog query', async () => {
        const queryRows = vi.fn(async (_statement: { sql: string; params?: unknown[] }) => [
            { name: 'people', type: 'BASE TABLE', tableRows: 120 },
            { name: 'etwp_big', type: 'BASE TABLE', tableRows: 4_000_000 },
            { name: 'people_view', type: 'VIEW', tableRows: null },
        ]);
        const tables = await useMySqlSchemaHelper(schemaHelperDeps).getTableNames(createClient(queryRows));

        // One information_schema query — no `SELECT COUNT(*)` per table.
        expect(queryRows).toHaveBeenCalledTimes(1);
        expect(queryRows.mock.calls[0]?.[0]?.sql).toContain('information_schema.tables');
        expect(queryRows.mock.calls[0]?.[0]?.sql).not.toContain('COUNT(*)');
        expect(tables).toEqual([
            { name: 'etwp_big', type: 'table', rowCount: 4_000_000, rowCountIsEstimated: true },
            { name: 'people', type: 'table', rowCount: 120, rowCountIsEstimated: true },
            { name: 'people_view', type: 'view', rowCount: 0 },
        ]);
    });
});
