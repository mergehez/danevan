// SQLite Modify Table rebuilds the table, and every other spec for that path builds a MySQL
// source, so a rename that strands child foreign keys, a restarted AUTOINCREMENT counter or a
// view over the table could pass the suite. These drive the real endpoint and read the file back.
import { expect, test, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { createFileSource, post } from './helpers';

function tableInfo(request: APIRequestContext, connectionId: number, tableName: string) {
    return post(request, 'getTableInfo', { connectionId, tableName });
}

function columnParams(column: any) {
    return {
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
        columnKind: 'NORMAL',
    };
}

function newColumnParams(name: string, type: string) {
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
        columnKind: 'NORMAL',
    };
}

/** The plan the dialog would post for the table's current metadata. */
function buildParams(info: any, connectionId: number, tableName: string) {
    const primaryKeyColumns = info.columns
        .filter((column: any) => column.isPrimaryKey)
        .sort((left: any, right: any) => (left.primaryKeyOrdinal ?? 0) - (right.primaryKeyOrdinal ?? 0));

    // What the dialog posts: the primary key as a key, every other index as an index.
    return {
        connectionId,
        tableName,
        table: { name: tableName, comment: info.comment ?? null, engine: info.engine ?? null, collation: info.collation ?? null, options: info.options ?? null },
        columns: info.columns.map(columnParams),
        keys: primaryKeyColumns.length
            ? [{ originalName: 'PRIMARY', name: 'PRIMARY', isPrimary: true, columns: primaryKeyColumns.map((column: any) => ({ columnName: column.name })) }]
            : [],
        foreignKeys: [],
        indexes: info.indexes.map((index: any) => ({
            originalName: index.name,
            name: index.name,
            comment: index.comment ?? null,
            isUnique: index.isUnique,
            type: index.type ?? null,
            columns: index.columns.map((columnName: string, position: number) => ({ columnName, order: index.orders?.[position] ?? null })),
        })),
    };
}

async function applyModify(request: APIRequestContext, connectionId: number, tableName: string, mutate: (params: any) => void) {
    const info = await tableInfo(request, connectionId, tableName);
    const params = buildParams(info, connectionId, tableName);
    mutate(params);

    return post(request, 'modifyTable', params);
}

/** Reads the modified file directly, with foreign keys enforced. */
function readFile<T>(databasePath: string, callback: (database: Database.Database) => T): T {
    const file = new Database(databasePath);
    file.pragma('foreign_keys = ON');

    try {
        return callback(file);
    } finally {
        file.close();
    }
}

test.describe('SQLite modify table', () => {
    test('a table rename keeps the child foreign keys and the views that pointed at it', async ({ request }) => {
        const source = await createFileSource(request, {
            label: 'sqlite-rename',
            schema: `
                CREATE TABLE people (id integer primary key, name text not null);
                CREATE TABLE orders (id integer primary key, people_id integer REFERENCES people(id));
                CREATE VIEW people_view AS SELECT id, name FROM people;
                INSERT INTO people (id, name) VALUES (1, 'Ada');
            `,
        });

        try {
            await applyModify(request, source.connectionId, 'people', (params) => {
                params.table.name = 'persons';
            });

            const ordersInfo = await tableInfo(request, source.connectionId, 'orders');
            expect(ordersInfo.foreignKeys.map((foreignKey: any) => foreignKey.table)).toEqual(['persons']);

            const view = await post(request, 'runQuery', { connectionId: source.connectionId, sql: 'SELECT name FROM people_view' });
            expect(view.rows).toEqual([{ name: 'Ada' }]);

            // The dangling reference used to make this insert fail with "no such table: main.people".
            await post(request, 'runQuery', { connectionId: source.connectionId, sql: 'INSERT INTO orders (id, people_id) VALUES (1, 1)' });
            const orders = await post(request, 'runQuery', { connectionId: source.connectionId, sql: 'SELECT people_id FROM orders' });
            // SQLite integers arrive as exact decimal text: a JS number cannot hold every 64-bit value.
            expect(orders.rows).toEqual([{ people_id: '1' }]);
        } finally {
            await source.cleanup();
        }
    });

    test('a column rename keeps the child foreign key that pointed at it', async ({ request }) => {
        const source = await createFileSource(request, {
            label: 'sqlite-column-rename',
            schema: `
                CREATE TABLE people (id integer primary key, code text not null);
                CREATE UNIQUE INDEX people_code_unique ON people(code);
                CREATE TABLE orders (id integer primary key, people_code text REFERENCES people(code));
                CREATE VIEW people_codes AS SELECT code FROM people;
                INSERT INTO people (id, code) VALUES (1, 'ada');
                INSERT INTO orders (id, people_code) VALUES (1, 'ada');
            `,
        });

        try {
            await applyModify(request, source.connectionId, 'people', (params) => {
                params.columns.find((column: any) => column.name === 'code').name = 'label';
            });

            const ordersInfo = await tableInfo(request, source.connectionId, 'orders');
            expect(ordersInfo.foreignKeys.map((foreignKey: any) => foreignKey.to)).toEqual(['label']);

            // The dangling reference used to fail this insert with "foreign key mismatch".
            await post(request, 'runQuery', { connectionId: source.connectionId, sql: "INSERT INTO orders (id, people_code) VALUES (2, 'ada')" });

            const renamed = await post(request, 'runQuery', { connectionId: source.connectionId, sql: 'SELECT label FROM people' });
            expect(renamed.rows).toEqual([{ label: 'ada' }]);

            const view = await post(request, 'runQuery', { connectionId: source.connectionId, sql: 'SELECT label FROM people_codes' });
            expect(view.rows).toEqual([{ label: 'ada' }]);
        } finally {
            await source.cleanup();
        }
    });

    test('a rebuild keeps the AUTOINCREMENT counter, so a deleted id is not handed out again', async ({ request }) => {
        const source = await createFileSource(request, {
            label: 'sqlite-autoincrement',
            schema: `
                CREATE TABLE people (id integer primary key autoincrement, name text not null);
                CREATE VIEW people_view AS SELECT id, name FROM people;
                INSERT INTO people (name) VALUES ('Ada'), ('Grace'), ('Alan');
                DELETE FROM people WHERE id = 3;
            `,
        });

        try {
            await applyModify(request, source.connectionId, 'people', (params) => {
                params.columns.push(newColumnParams('note', 'text'));
            });

            expect(readFile(source.databasePath, (file) => file.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('people'))).toEqual({ seq: 3 });

            await post(request, 'runQuery', { connectionId: source.connectionId, sql: "INSERT INTO people (name, note) VALUES ('Barbara', NULL)" });
            const inserted = await post(request, 'runQuery', { connectionId: source.connectionId, sql: "SELECT id FROM people WHERE name = 'Barbara'" });
            expect(inserted.rows).toEqual([{ id: '4' }]);

            const view = await post(request, 'runQuery', { connectionId: source.connectionId, sql: 'SELECT count(*) AS count FROM people_view' });
            expect(view.rows).toEqual([{ count: '3' }]);
        } finally {
            await source.cleanup();
        }
    });

    test('a rebuild of a table a view selects from succeeds and leaves the view working', async ({ request }) => {
        const source = await createFileSource(request, {
            label: 'sqlite-view',
            schema: `
                CREATE TABLE people (id integer primary key autoincrement, name text not null);
                CREATE VIEW people_view AS SELECT id, name FROM people;
                INSERT INTO people (name) VALUES ('Ada');
            `,
        });

        try {
            await applyModify(request, source.connectionId, 'people', (params) => {
                params.columns.push(newColumnParams('note', 'text'));
            });

            const info = await tableInfo(request, source.connectionId, 'people');
            expect(info.columns.map((column: any) => column.name)).toEqual(['id', 'name', 'note']);

            const view = await post(request, 'runQuery', { connectionId: source.connectionId, sql: 'SELECT name FROM people_view' });
            expect(view.rows).toEqual([{ name: 'Ada' }]);
        } finally {
            await source.cleanup();
        }
    });
});
