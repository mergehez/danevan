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
import type { NormalizedApplyTableChanges } from './db-tools.ts';
import type { SqlValue, TableInfo } from '../shared/types';
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

    it('renames a column so a child foreign key follows it', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE people (id integer primary key, code text not null);
            CREATE UNIQUE INDEX people_code_unique ON people(code);
            CREATE TABLE orders (id integer primary key, people_code text REFERENCES people(code));
            CREATE VIEW people_codes AS SELECT code FROM people;
            INSERT INTO people (id, code) VALUES (1, 'ada');
            INSERT INTO orders (id, people_code) VALUES (1, 'ada');
        `);
        file.close();

        const info = await tools.getTableInfoFresh(1, 'people');
        const plan = planFrom(info, (nextPlan) => {
            nextPlan.columns.find((column) => column.name === 'code')!.name = 'label';
            nextPlan.indexes.push({
                originalName: 'people_code_unique',
                name: 'people_code_unique',
                comment: null,
                isUnique: true,
                type: null,
                columns: [{ columnName: 'code', order: null }],
            });
        });

        await tools.modifyTable(1, 'people', info, plan);

        // A rebuild alone leaves the child's REFERENCES naming the column that no longer exists,
        // which makes every write to `orders` fail with "foreign key mismatch".
        expect(probe((database) => database.prepare('PRAGMA foreign_key_list(orders)').all())).toMatchObject([{ table: 'people', from: 'people_code', to: 'label' }]);
        expect(probe((database) => database.prepare('SELECT label FROM people').all())).toEqual([{ label: 'ada' }]);
        expect(probe((database) => database.prepare('SELECT label FROM people_codes').all())).toEqual([{ label: 'ada' }]);
        probe((database) => database.exec("INSERT INTO orders (id, people_code) VALUES (2, 'ada')"));
    });

    it('refuses a rename whose target name is still held by another column', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE people (id integer primary key, code text not null, legacy text);
            INSERT INTO people (id, code, legacy) VALUES (1, 'ada', 'old');
        `);
        file.close();

        const info = await tools.getTableInfoFresh(1, 'people');
        const plan = planFrom(info, (nextPlan) => {
            nextPlan.columns = nextPlan.columns.filter((column) => column.name !== 'legacy');
            nextPlan.columns.find((column) => column.name === 'code')!.name = 'legacy';
        });

        // SQLite cannot rename onto a name the table still holds, and rebuilding alone would
        // silently point a "REFERENCES people(legacy)" at the renamed column instead.
        await expect(tools.modifyTable(1, 'people', info, plan)).rejects.toThrow(/another column still holds the target name/);
        expect(probe((database) => database.prepare('SELECT code, legacy FROM people').all())).toEqual([{ code: 'ada', legacy: 'old' }]);
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

// A SQLite integer holds 64 bits, but a JS number only counts to 2^53 exactly. Without
// `safeIntegers` a value above that came back rounded and a saved edit wrote the rounded value.
describe('SQLite 64-bit integers', () => {
    it('reads a value above 2^53 exactly and writes an edited value back unrounded', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE readings (id integer primary key, value integer);
            INSERT INTO readings (id, value) VALUES (1, 9007199254740993);
        `);
        file.close();

        expect((await tools.getTableData(1, 'readings', 100, 0)).rows).toEqual([{ id: '1', value: '9007199254740993' }]);

        await tools.updateColumn({
            connectionId: 1,
            tableName: 'readings',
            targetColumn: 'value',
            matchColumn: 'id',
            value: '9007199254740995',
            matchValue: '1',
        });

        expect((await tools.getTableData(1, 'readings', 100, 0)).rows).toEqual([{ id: '1', value: '9007199254740995' }]);
        expect(probe((database) => database.prepare('SELECT value FROM readings WHERE id = 1').safeIntegers(true).get())).toEqual({ value: 9007199254740995n });
    });

    it('reports the values a query returns exactly, up to the largest 64-bit integer', async () => {
        const file = new Database(databasePath);
        file.exec('CREATE TABLE readings (value integer); INSERT INTO readings (value) VALUES (9223372036854775807);');
        file.close();

        expect(await tools.runQuery(1, 'SELECT value FROM readings')).toEqual({
            kind: 'rows',
            columns: ['value'],
            columnStats: { value: 1 },
            rows: [{ value: '9223372036854775807' }],
        });
    });
});

// The surfaces the app drives that no spec executed: opening a source, listing a schema,
// validating a statement, copying DDL, and the batched save with its transaction.
describe('SQLite driver surfaces', () => {
    it('names the file it connected to, and refuses a blank path or an absent file', () => {
        new Database(databasePath).close();

        expect(tools.testConnection({ kind: 'file', driver: 'sqlite', filePath: databasePath })).toEqual({
            ok: true,
            driver: 'sqlite',
            message: `Connected to SQLite file ${databasePath}.`,
        });
        expect(() => tools.testConnection({ kind: 'file', driver: 'sqlite', filePath: '   ' })).toThrow('A file path is required to test a SQLite source.');
        expect(() => tools.testConnection({ kind: 'file', driver: 'sqlite', filePath: join(dirname(databasePath), 'absent.sqlite') })).toThrow(/unable to open database file/);
    });

    it('lists every table and view with the row count it holds', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE alpha (id integer primary key, name text);
            CREATE TABLE beta (id integer primary key);
            CREATE VIEW alpha_view AS SELECT id FROM alpha;
            INSERT INTO alpha (id, name) VALUES (1, 'Ada'), (2, 'Grace');
        `);
        file.close();

        expect(await tools.getTablesFresh(1)).toEqual([
            { name: 'alpha', type: 'table', rowCount: 2 },
            { name: 'beta', type: 'table', rowCount: 0 },
            { name: 'alpha_view', type: 'view', rowCount: 0 },
        ]);
    });

    it('accepts a statement the database can prepare and rejects one it cannot', async () => {
        const file = new Database(databasePath);
        file.exec('CREATE TABLE people (id integer primary key)');
        file.close();

        const validateSql = tools.validateSql;

        if (!validateSql) {
            throw new Error('The SQLite driver must expose validateSql.');
        }

        await expect(validateSql(1, 'SELECT id FROM people')).resolves.toBeUndefined();
        await expect(validateSql(1, 'SELECT FROM')).rejects.toThrow(/syntax error/);
    });

    it('copies a table with its index, a view, and says so for a name it does not hold', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE people (id integer primary key, name text);
            CREATE INDEX people_name_idx ON people(name);
            CREATE VIEW people_view AS SELECT name FROM people;
        `);
        file.close();

        expect(await tools.getTableDdl(1, 'people')).toBe('CREATE TABLE people (id integer primary key, name text);\nCREATE INDEX people_name_idx ON people(name);');
        expect(await tools.getTableDdl(1, 'people_view')).toBe('CREATE VIEW people_view AS SELECT name FROM people;');
        await expect(tools.getTableDdl(1, 'missing')).rejects.toThrow("Table 'missing' was not found.");
    });
});

// One save is one transaction: either every staged change lands, or the file keeps the values it
// had, and a save that broke a foreign key has to say which rows it broke.
describe('SQLite batched save', () => {
    function saveParams(
        tableName: string,
        changes: Array<{ targetColumn: string; value: SqlValue; matchColumn: string; matchValue: SqlValue }>,
        disableForeignKeyChecks = false
    ): NormalizedApplyTableChanges {
        return { connectionId: 1, tableName, changes, disableForeignKeyChecks, limit: 100, offset: 0 };
    }

    it('applies every change and returns the table it re-read', async () => {
        const file = new Database(databasePath);
        file.exec("CREATE TABLE people (id integer primary key, name text); INSERT INTO people (id, name) VALUES (1, 'Ada'), (2, 'Grace');");
        file.close();

        const result = await tools.applyTableChanges(
            saveParams('people', [
                { targetColumn: 'name', value: 'Ada Lovelace', matchColumn: 'id', matchValue: 1 },
                { targetColumn: 'name', value: 'Grace Hopper', matchColumn: 'id', matchValue: 2 },
            ])
        );

        expect(result.foreignKeyViolations).toEqual([]);
        expect(result.tableData.rows).toEqual([
            { id: '1', name: 'Ada Lovelace' },
            { id: '2', name: 'Grace Hopper' },
        ]);
        expect(probe((database) => database.prepare('SELECT name FROM people ORDER BY id').all())).toEqual([{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }]);
    });

    it('rolls the whole save back when one change fails', async () => {
        const file = new Database(databasePath);
        file.exec("CREATE TABLE people (id integer primary key, name text); INSERT INTO people (id, name) VALUES (1, 'Ada');");
        file.close();

        await expect(
            tools.applyTableChanges(
                saveParams('people', [
                    { targetColumn: 'name', value: 'Changed', matchColumn: 'id', matchValue: 1 },
                    { targetColumn: 'missing_column', value: 'x', matchColumn: 'id', matchValue: 1 },
                ])
            )
        ).rejects.toThrow(/no such column/);

        // The first change must not survive the second one's failure.
        expect(probe((database) => database.prepare('SELECT name FROM people').all())).toEqual([{ name: 'Ada' }]);
    });

    it('reports the foreign key a save broke, with the row that broke it', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE people (id integer primary key, name text);
            CREATE TABLE children (id integer primary key, people_id integer REFERENCES people(id));
            INSERT INTO people (id, name) VALUES (1, 'Ada');
            INSERT INTO children (id, people_id) VALUES (1, 1);
        `);
        file.close();

        const result = await tools.applyTableChanges(saveParams('children', [{ targetColumn: 'people_id', value: 99, matchColumn: 'id', matchValue: 1 }], true));

        expect(result.foreignKeyViolations).toEqual(['children has 1 foreign key violation referencing people (constraint #0). Row IDs: 1.']);
        expect(probe((database) => database.prepare('SELECT people_id FROM children').all())).toEqual([{ people_id: 99 }]);
    });
});

// A rebuild recreates the table, so anything the plan cannot carry has to stop the rebuild
// instead of quietly changing the schema.
describe('SQLite modify-table refusals', () => {
    it('refuses a table with a partial index instead of rebuilding it without the predicate', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE people (id integer primary key, name text, active integer);
            CREATE INDEX people_active_idx ON people(name) WHERE active = 1;
            INSERT INTO people (id, name, active) VALUES (1, 'Ada', 1);
        `);
        file.close();

        const info = await tools.getTableInfoFresh(1, 'people');
        const plan = planFrom(info, (nextPlan) => {
            nextPlan.columns.push(newColumn('note', 'text'));
        });

        await expect(tools.modifyTable(1, 'people', info, plan)).rejects.toThrow(/partial index people_active_idx/);
        expect(probe((database) => database.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get('people_active_idx'))).toEqual({
            sql: 'CREATE INDEX people_active_idx ON people(name) WHERE active = 1',
        });
    });

    it('refuses a table with a trigger instead of dropping it in the rebuild', async () => {
        const file = new Database(databasePath);
        file.exec(`
            CREATE TABLE people (id integer primary key, name text);
            CREATE TABLE audit (id integer primary key, name text);
            CREATE TRIGGER people_audit AFTER UPDATE ON people BEGIN INSERT INTO audit (name) VALUES (NEW.name); END;
            INSERT INTO people (id, name) VALUES (1, 'Ada');
        `);
        file.close();

        const info = await tools.getTableInfoFresh(1, 'people');
        const plan = planFrom(info, (nextPlan) => {
            nextPlan.columns.push(newColumn('note', 'text'));
        });

        await expect(tools.modifyTable(1, 'people', info, plan)).rejects.toThrow(/does not support tables with triggers/);
        expect(probe((database) => database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all())).toEqual([{ name: 'people_audit' }]);
    });

    it('refuses to rebuild a populated table that would lose every column', async () => {
        const file = new Database(databasePath);
        file.exec("CREATE TABLE people (id integer primary key, name text); INSERT INTO people (id, name) VALUES (1, 'Ada');");
        file.close();

        const info = await tools.getTableInfoFresh(1, 'people');
        const plan = planFrom(info, (nextPlan) => {
            nextPlan.columns = [];
        });

        await expect(tools.modifyTable(1, 'people', info, plan)).rejects.toThrow(/cannot rebuild a populated table when every existing column has been removed/);
        expect(probe((database) => database.prepare('SELECT name FROM people').all())).toEqual([{ name: 'Ada' }]);
    });
});
