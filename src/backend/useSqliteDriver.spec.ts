// @vitest-environment node
// The SQLite modify-table path recreates a table, and that is where a rename can strand a child
// table's foreign key, where the AUTOINCREMENT counter can restart (handing a deleted id out
// again) and where a view over the table can make the rebuild fail. These drive the real tools
// against a real file, then read the file back directly.
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TableInfo } from '../shared/types';
import { useSqliteDriverTools, type ModifySchemaColumn, type ModifySchemaPlan, type SqliteDriverToolsDeps } from './useSqliteDriver.ts';

let databasePath = '';
let tools: ReturnType<typeof useSqliteDriverTools>;

function createTools() {
    return useSqliteDriverTools({
        getConnection: (connectionId: number) => ({ id: connectionId, server_id: 1, name: 'fixture', database_name: null }),
        getServer: () => ({ driver: 'sqlite', kind: 'file', file_path: databasePath, name: 'fixture' }),
        listConnections: () => [],
        escapeSqlString: (value: string) => `'${value.replaceAll("'", "''")}'`,
        quoteIdentifier: (identifier: string) => `"${identifier.replaceAll('"', '""')}"`,
        normalizeTableName: (tableName: string) => tableName.trim(),
        normalizeColumnName: (columnName: string) => columnName.trim(),
        buildColumnStats: (columns: string[], rows: Array<Record<string, unknown>>) => Object.fromEntries(columns.map((column) => [column, rows.length])),
    } as unknown as SqliteDriverToolsDeps);
}

/** Runs `callback` against the file the app just modified, with foreign keys enforced. */
function probe<T>(callback: (database: Database.Database) => T): T {
    const file = new Database(databasePath);
    file.pragma('foreign_keys = ON');

    try {
        return callback(file);
    } finally {
        file.close();
    }
}

/** The plan the Modify Table dialog builds from a table's current metadata. */
function planFrom(info: TableInfo, mutate: (plan: ModifySchemaPlan) => void = () => {}) {
    const plan: ModifySchemaPlan = {
        table: { name: info.name, comment: info.comment ?? null, engine: null, collation: null, options: null },
        columns: info.columns.map((column) => ({
            originalName: column.name,
            name: column.name,
            type: column.type,
            notNull: column.notNull,
            defaultValue: column.defaultValue,
            isPrimaryKey: column.isPrimaryKey,
            primaryKeyOrdinal: column.primaryKeyOrdinal,
            isAutoIncrement: column.isAutoIncrement,
            comment: column.comment,
            collation: column.collation,
            onUpdate: column.onUpdate,
        })) satisfies ModifySchemaColumn[],
        keys: [],
        foreignKeys: info.foreignKeys.map((foreignKey) => ({
            originalName: foreignKey.name,
            name: foreignKey.name ?? '',
            targetTable: foreignKey.table,
            columns: [{ columnName: foreignKey.from, targetName: foreignKey.to }],
            onUpdate: foreignKey.onUpdate || null,
            onDelete: foreignKey.onDelete || null,
            match: foreignKey.match || null,
        })),
        indexes: [],
    };

    mutate(plan);
    return plan;
}

function newColumn(name: string, type: string): ModifySchemaColumn {
    return {
        name,
        type,
        notNull: false,
        defaultValue: null,
        isPrimaryKey: false,
        primaryKeyOrdinal: null,
        isAutoIncrement: false,
        comment: null,
        collation: null,
        onUpdate: null,
    };
}

beforeEach(() => {
    databasePath = join(mkdtempSync(join(tmpdir(), 'danevan-sqlite-modify-')), 'fixture.sqlite');
    tools = createTools();
});

afterEach(() => {
    rmSync(dirname(databasePath), { recursive: true, force: true });
});

describe('SQLite modify-table rebuild', () => {
    it('sends a table rename through SQLite so child foreign keys and views follow it', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE people (id integer primary key, name text not null);
            CREATE TABLE orders (id integer primary key, people_id integer REFERENCES people(id));
            CREATE VIEW people_view AS SELECT id, name FROM people;
            INSERT INTO people (id, name) VALUES (1, 'Ada');
        `);
        file.close();

        const info = await tools.getTableInfoFresh(1, 'people');
        const plan = planFrom(info, (nextPlan) => {
            nextPlan.table.name = 'persons';
        });

        await tools.modifyTable(1, 'people', info, plan);

        expect(
            probe((database) =>
                database
                    .prepare('PRAGMA foreign_key_list(orders)')
                    .all()
                    .map((foreignKey) => (foreignKey as { table: string }).table)
            )
        ).toEqual(['persons']);
        expect(probe((database) => database.prepare('SELECT name FROM people_view').all())).toEqual([{ name: 'Ada' }]);
        // The dangling reference used to make every child write fail with "no such table".
        probe((database) => database.exec('INSERT INTO orders (id, people_id) VALUES (1, 1)'));
        expect(probe((database) => database.prepare('SELECT people_id FROM orders').all())).toEqual([{ people_id: 1 }]);
    });

    it('keeps the AUTOINCREMENT counter so a deleted id is not handed out again', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE people (id integer primary key autoincrement, name text not null);
            INSERT INTO people (name) VALUES ('Ada'), ('Grace'), ('Alan');
            DELETE FROM people WHERE id = 3;
        `);
        file.close();

        const info = await tools.getTableInfoFresh(1, 'people');
        const plan = planFrom(info, (nextPlan) => {
            nextPlan.columns.push(newColumn('note', 'text'));
        });

        await tools.modifyTable(1, 'people', info, plan);

        expect(probe((database) => database.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('people'))).toEqual({ seq: 3 });
        expect(probe((database) => database.prepare('SELECT name FROM sqlite_sequence ORDER BY name').all())).toEqual([{ name: 'people' }]);
        probe((database) => database.exec("INSERT INTO people (name, note) VALUES ('Barbara', NULL)"));
        expect(probe((database) => database.prepare("SELECT id FROM people WHERE name = 'Barbara'").get())).toEqual({ id: 4 });
    });

    it('rebuilds a table a view selects from and leaves the view working', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE people (id integer primary key autoincrement, name text not null);
            CREATE TABLE orders (id integer primary key, people_id integer REFERENCES people(id));
            CREATE VIEW people_view AS SELECT id, name FROM people;
            INSERT INTO people (name) VALUES ('Ada');
            INSERT INTO orders (id, people_id) VALUES (1, 1);
        `);
        file.close();

        const info = await tools.getTableInfoFresh(1, 'people');
        const plan = planFrom(info, (nextPlan) => {
            nextPlan.columns.push(newColumn('note', 'text'));
        });

        await tools.modifyTable(1, 'people', info, plan);

        expect(
            probe((database) =>
                database
                    .prepare('PRAGMA table_info(people)')
                    .all()
                    .map((column) => (column as { name: string }).name)
            )
        ).toEqual(['id', 'name', 'note']);
        expect(probe((database) => database.prepare('SELECT name FROM people_view').all())).toEqual([{ name: 'Ada' }]);
        probe((database) => database.exec('INSERT INTO orders (id, people_id) VALUES (2, 1)'));
        expect(probe((database) => database.prepare('SELECT count(*) AS count FROM orders').get())).toEqual({ count: 2 });
    });
});
