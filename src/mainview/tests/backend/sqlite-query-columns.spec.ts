// Column metadata for statements that return no rows: the SQLite driver reads
// it from the prepared statement instead of the (empty) result rows.
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useSqliteDriverTools, type SqliteDriverToolsDeps } from '../../../backend/useSqliteDriver';

let databasePath = '';
let tools: ReturnType<typeof useSqliteDriverTools>;

beforeAll(() => {
    databasePath = join(mkdtempSync(join(tmpdir(), 'danevan-sqlite-columns-')), 'fixture.sqlite');

    const file = new Database(databasePath);
    file.exec('CREATE TABLE empty_log (id integer primary key, message text, created_at text)');
    file.exec('CREATE TABLE filled_log (id integer primary key, message text)');
    file.exec("INSERT INTO filled_log (message) VALUES ('hello')");
    file.close();

    const deps = {
        getConnection: (connectionId: number) => ({ id: connectionId, server_id: 1, name: 'fixture', database_name: null }),
        getServer: () => ({ driver: 'sqlite', kind: 'file', file_path: databasePath, name: 'fixture' }),
        listConnections: () => [],
        escapeSqlString: (value: string) => `'${value.replaceAll("'", "''")}'`,
        quoteIdentifier: (identifier: string) => `"${identifier.replaceAll('"', '""')}"`,
        normalizeTableName: (tableName: string) => tableName.trim(),
        normalizeColumnName: (columnName: string) => columnName.trim(),
        buildColumnStats: (columns: string[], rows: Array<Record<string, unknown>>) => Object.fromEntries(columns.map((column) => [column, rows.length])),
    } as unknown as SqliteDriverToolsDeps;

    tools = useSqliteDriverTools(deps);
});

afterAll(() => {
    rmSync(databasePath, { force: true });
});

describe('sqlite runQuery columns', () => {
    it('reports the column names of a statement that returns no rows', async () => {
        const result = await tools.runQuery(1, 'SELECT id, message, created_at FROM empty_log');

        expect(result.kind).toBe('rows');
        expect(result.kind === 'rows' ? result.columns : []).toEqual(['id', 'message', 'created_at']);
        expect(result.kind === 'rows' ? result.rows : []).toEqual([]);
    });

    it('uses the aliased names and ignores conditions', async () => {
        const result = await tools.runQuery(1, 'SELECT id AS ident, message FROM empty_log WHERE id = ?', [7]);

        expect(result.kind === 'rows' ? result.columns : []).toEqual(['ident', 'message']);
    });

    it('keeps using the rows for statements that do return them', async () => {
        const result = await tools.runQuery(1, 'SELECT id, message FROM filled_log');

        expect(result.kind === 'rows' ? result.columns : []).toEqual(['id', 'message']);
        expect(result.kind === 'rows' ? result.rows : []).toEqual([{ id: 1, message: 'hello' }]);
    });
});
