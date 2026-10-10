// The batched SQLite metadata read is the sweep behind the comparison dialog, the SQL
// autocomplete and the schema hydration, so it has to answer exactly what the single-table
// read answers — for tables, for views, and for a name that does not exist.
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useSqliteDriverTools, type SqliteDriverToolsDeps } from '../../../backend/useSqliteDriver';

let directory = '';
let databasePath = '';
let tools: ReturnType<typeof useSqliteDriverTools>;

beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'danevan-sqlite-tableinfos-'));
    databasePath = join(directory, 'fixture.sqlite');

    const file = new Database(databasePath);
    file.exec(`
        CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, extra TEXT);
        CREATE TABLE pets (id INTEGER PRIMARY KEY, owner_id INTEGER REFERENCES people(id), species TEXT);
        CREATE INDEX pets_species_idx ON pets (species);
        CREATE VIEW pet_names AS SELECT species FROM pets;
        INSERT INTO people (name) VALUES ('Ada');
        INSERT INTO pets (species) VALUES ('cat');
    `);
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
    rmSync(directory, { recursive: true, force: true });
});

describe('sqlite getTableInfosFresh', () => {
    it('answers what the single-table read answers, for a table and for a view', async () => {
        for (const tableName of ['people', 'pets', 'pet_names']) {
            const single = await tools.getTableInfoFresh(1, tableName);
            const [batched] = await tools.getTableInfosFresh!(1, [tableName]);

            expect(batched).toEqual(single);
        }
    });

    it('reads every table when the caller does not name any', async () => {
        const infos = await tools.getTableInfosFresh!(1);

        expect(infos.map((info) => info.name).sort()).toEqual(['people', 'pets']);
    });

    it('keeps the requested order and names a table that does not exist', async () => {
        const infos = await tools.getTableInfosFresh!(1, ['pets', 'people']);

        expect(infos.map((info) => info.name)).toEqual(['pets', 'people']);
        await expect(tools.getTableInfosFresh!(1, ['missing'])).rejects.toThrow("Table 'missing' was not found.");
    });
});
