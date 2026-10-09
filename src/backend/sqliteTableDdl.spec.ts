// SQLite DDL is where a parsing or generation mistake silently mislabels a column, or rewrites a
// user's table into something else. These drive the real helpers with real statements.
import { describe, expect, it } from 'vitest';
import type { TableColumnInfo, TableInfo } from '../shared/types';
import type { ModifySchemaColumn, ModifySchemaPlan } from './useSqliteDriver.ts';
import {
    buildSqliteColumnDefinition,
    buildSqliteCreateTableSql,
    enrichSqliteColumns,
    extractSqliteColumnDefinition,
    normalizeCountValue,
    normalizeOptionalText,
    parseSqliteColumnMetadata,
    splitSqliteList,
} from './sqliteTableDdl.ts';

const quote = (identifier: string) => `"${identifier}"`;

const tableInfo: TableInfo = { name: 'orders', columns: [], indexes: [], foreignKeys: [], rowCount: 0 };

function column(overrides: Partial<ModifySchemaColumn> = {}): ModifySchemaColumn {
    return {
        name: 'name',
        type: 'TEXT',
        notNull: false,
        defaultValue: null,
        isPrimaryKey: false,
        primaryKeyOrdinal: null,
        isAutoIncrement: false,
        comment: null,
        collation: null,
        onUpdate: null,
        ...overrides,
    };
}

function plan(overrides: Partial<ModifySchemaPlan> = {}): ModifySchemaPlan {
    return {
        table: { name: 'orders', comment: null, engine: null, collation: null, options: null },
        columns: [],
        keys: [],
        foreignKeys: [],
        indexes: [],
        ...overrides,
    };
}

function columnInfo(overrides: Partial<TableColumnInfo> = {}): TableColumnInfo {
    return {
        cid: 0,
        name: 'name',
        type: 'TEXT',
        notNull: false,
        defaultValue: null,
        isPrimaryKey: false,
        primaryKeyOrdinal: null,
        isAutoIncrement: false,
        comment: null,
        collation: null,
        onUpdate: null,
        ...overrides,
    };
}

describe('splitSqliteList', () => {
    it('splits on top-level commas only', () => {
        expect(splitSqliteList('id INTEGER, name TEXT, age INT')).toEqual(['id INTEGER', 'name TEXT', 'age INT']);
    });

    it('keeps commas inside parentheses', () => {
        expect(splitSqliteList('amount DECIMAL(10, 2), note TEXT')).toEqual(['amount DECIMAL(10, 2)', 'note TEXT']);
        expect(splitSqliteList('id INT CHECK (id IN (1, 2)), note TEXT')).toEqual(['id INT CHECK (id IN (1, 2))', 'note TEXT']);
    });

    it('keeps commas inside string literals, including escaped quotes', () => {
        expect(splitSqliteList("a TEXT DEFAULT 'x,y', b TEXT")).toEqual(["a TEXT DEFAULT 'x,y'", 'b TEXT']);
        expect(splitSqliteList("a TEXT DEFAULT 'it''s, fine', b TEXT")).toEqual(["a TEXT DEFAULT 'it''s, fine'", 'b TEXT']);
    });

    it('keeps commas inside quoted identifiers', () => {
        expect(splitSqliteList('`a,b` TEXT, c TEXT')).toEqual(['`a,b` TEXT', 'c TEXT']);
        expect(splitSqliteList('"a,b" TEXT, c TEXT')).toEqual(['"a,b" TEXT', 'c TEXT']);
        expect(splitSqliteList('[a,b] TEXT, c TEXT')).toEqual(['[a,b] TEXT', 'c TEXT']);
    });

    it('drops empty entries and trims the rest', () => {
        expect(splitSqliteList('  a INT ,  , b INT  ')).toEqual(['a INT', 'b INT']);
        expect(splitSqliteList('   ')).toEqual([]);
    });

    it('keeps a column whose definition contains a bracket-quoted default', () => {
        // `[` opens a bracket quote, which would swallow the rest of the statement if the
        // bracket handling and the COMMA handling disagreed.
        expect(splitSqliteList('a TEXT DEFAULT "x", b TEXT')).toEqual(['a TEXT DEFAULT "x"', 'b TEXT']);
    });
});

describe('extractSqliteColumnDefinition', () => {
    const createSql = `CREATE TABLE "orders" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "my col" TEXT,
        [legacy col] INT,
        \`tick col\` INT,
        id2 INT,
        PRIMARY KEY ("id")
    )`;

    it('finds a column definition by name, case-insensitively', () => {
        expect(extractSqliteColumnDefinition(createSql, 'ID')).toBe('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
        expect(extractSqliteColumnDefinition(createSql, 'id2')).toBe('id2 INT');
    });

    it('does not match a column whose name only starts with the requested one', () => {
        expect(extractSqliteColumnDefinition('CREATE TABLE t (id2 INT, id INT)', 'id')).toBe('id INT');
    });

    it('reads quoted column names in every SQLite quoting style', () => {
        expect(extractSqliteColumnDefinition(createSql, 'my col')).toBe('"my col" TEXT');
        expect(extractSqliteColumnDefinition(createSql, 'legacy col')).toBe('[legacy col] INT');
        expect(extractSqliteColumnDefinition(createSql, 'tick col')).toBe('`tick col` INT');
    });

    it('still finds the column when the statement carries table-level constraints', () => {
        // The trailing PRIMARY KEY entry must not shadow the real column definition.
        expect(extractSqliteColumnDefinition('CREATE TABLE t (id INTEGER, PRIMARY KEY (id))', 'id')).toBe('id INTEGER');
        expect(extractSqliteColumnDefinition(createSql, 'id')).toBe('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    });

    it('returns undefined without a usable statement', () => {
        expect(extractSqliteColumnDefinition(undefined, 'id')).toBeUndefined();
        expect(extractSqliteColumnDefinition(null, 'id')).toBeUndefined();
        expect(extractSqliteColumnDefinition('CREATE TABLE t', 'id')).toBeUndefined();
    });
});

describe('parseSqliteColumnMetadata', () => {
    it('reports AUTOINCREMENT only for an inline autoincrement primary key', () => {
        expect(parseSqliteColumnMetadata('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, x INT)', 'id')).toEqual({ isAutoIncrement: true, collation: null });
        expect(parseSqliteColumnMetadata('CREATE TABLE t (id INTEGER PRIMARY KEY, x INT)', 'id')).toEqual({ isAutoIncrement: false, collation: null });
        expect(parseSqliteColumnMetadata('CREATE TABLE t (id INTEGER, x INT)', 'id')).toEqual({ isAutoIncrement: false, collation: null });
    });

    it('reads a COLLATE clause in every quoting style', () => {
        expect(parseSqliteColumnMetadata('CREATE TABLE t (name TEXT COLLATE NOCASE)', 'name').collation).toBe('NOCASE');
        expect(parseSqliteColumnMetadata('CREATE TABLE t (name TEXT COLLATE "NOCASE")', 'name').collation).toBe('NOCASE');
        expect(parseSqliteColumnMetadata('CREATE TABLE t (name TEXT COLLATE `NOCASE`)', 'name').collation).toBe('NOCASE');
        expect(parseSqliteColumnMetadata('CREATE TABLE t (name TEXT COLLATE [NOCASE])', 'name').collation).toBe('NOCASE');
    });

    it('reports nothing for a column the statement does not define', () => {
        expect(parseSqliteColumnMetadata('CREATE TABLE t (id INTEGER)', 'missing')).toEqual({ isAutoIncrement: false, collation: null });
        expect(parseSqliteColumnMetadata(undefined, 'id')).toEqual({ isAutoIncrement: false, collation: null });
    });
});

describe('enrichSqliteColumns', () => {
    const createSql = 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT COLLATE NOCASE)';

    it('fills in the metadata the ORM mapper cannot see', () => {
        const enriched = enrichSqliteColumns([columnInfo({ cid: 0, name: 'id', type: 'INTEGER' }), columnInfo({ cid: 1, name: 'name' })], createSql);

        expect(enriched.map((entry) => [entry.name, entry.isAutoIncrement, entry.collation])).toEqual([
            ['id', true, null],
            ['name', false, 'NOCASE'],
        ]);
        expect(enriched[0]).toMatchObject({ cid: 0, type: 'INTEGER', notNull: false });
    });

    it('keeps what the mapper already reported', () => {
        const enriched = enrichSqliteColumns([columnInfo({ name: 'name', isAutoIncrement: true, collation: 'BINARY' })], createSql);

        expect(enriched[0]).toMatchObject({ isAutoIncrement: true, collation: 'BINARY' });
    });

    it('returns the columns unchanged when there is no CREATE TABLE statement', () => {
        const columns = [columnInfo({ name: 'id', isAutoIncrement: true })];

        expect(enrichSqliteColumns(columns, undefined)).toEqual(columns);
    });
});

describe('normalizeCountValue', () => {
    it('converts bigint, string and null counts to numbers', () => {
        expect(normalizeCountValue(12n)).toBe(12);
        expect(normalizeCountValue('34')).toBe(34);
        expect(normalizeCountValue(null)).toBe(0);
        expect(normalizeCountValue(undefined)).toBe(0);
        expect(normalizeCountValue(7)).toBe(7);
    });
});

describe('normalizeOptionalText', () => {
    it('trims and turns blank values into null', () => {
        expect(normalizeOptionalText('  NOCASE ')).toBe('NOCASE');
        expect(normalizeOptionalText('')).toBeNull();
        expect(normalizeOptionalText('   ')).toBeNull();
        expect(normalizeOptionalText(null)).toBeNull();
        expect(normalizeOptionalText(undefined)).toBeNull();
    });
});

describe('buildSqliteColumnDefinition', () => {
    it('quotes the name and keeps the declared type', () => {
        expect(buildSqliteColumnDefinition(quote, column({ name: 'amount', type: 'DECIMAL(10, 2)' }), false)).toBe('"amount" DECIMAL(10, 2)');
    });

    it('writes an inline primary key, forcing INTEGER when it autoincrements', () => {
        expect(buildSqliteColumnDefinition(quote, column({ name: 'id', type: 'INT', isAutoIncrement: true }), true)).toBe('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
        expect(buildSqliteColumnDefinition(quote, column({ name: 'id', type: 'INT' }), true)).toBe('"id" INT PRIMARY KEY');
        // Not the inline primary key: the type and the key clause stay untouched.
        expect(buildSqliteColumnDefinition(quote, column({ name: 'code', type: 'TEXT', isAutoIncrement: true }), false)).toBe('"code" TEXT');
    });

    it('emits COLLATE, NOT NULL and DEFAULT in that order, verbatim', () => {
        const definition = buildSqliteColumnDefinition(
            quote,
            column({ name: 'created', type: 'TEXT', collation: 'NOCASE', notNull: true, defaultValue: "(datetime('now'))" }),
            false
        );

        expect(definition).toBe('"created" TEXT COLLATE "NOCASE" NOT NULL DEFAULT (datetime(\'now\'))');
    });
});

describe('buildSqliteCreateTableSql', () => {
    it('inlines a single primary key and keeps the column order', () => {
        const sql = buildSqliteCreateTableSql(
            quote,
            'orders',
            tableInfo,
            plan({
                columns: [column({ name: 'id', type: 'INT', isPrimaryKey: true, primaryKeyOrdinal: 1 }), column({ name: 'total', type: 'INT' })],
            })
        );

        expect(sql).toBe('CREATE TABLE "orders" (\n    "id" INT PRIMARY KEY,\n    "total" INT\n);');
    });

    it('emits a composite primary key and unique constraints as table clauses', () => {
        const sql = buildSqliteCreateTableSql(
            quote,
            'orders',
            tableInfo,
            plan({
                columns: [
                    column({ name: 'a', type: 'INT', isPrimaryKey: true, primaryKeyOrdinal: 1 }),
                    column({ name: 'b', type: 'INT', isPrimaryKey: true, primaryKeyOrdinal: 2 }),
                ],
                keys: [
                    { name: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'a' }, { columnName: 'b' }] },
                    { name: 'orders_code_key', isPrimary: false, columns: [{ columnName: 'b' }] },
                    { name: 'orders_missing_key', isPrimary: false, columns: [{ columnName: 'gone' }] },
                ],
            })
        );

        expect(sql).toBe('CREATE TABLE "orders" (\n    "a" INT,\n    "b" INT,\n    PRIMARY KEY ("a", "b"),\n    UNIQUE ("b")\n);');
    });

    it('emits foreign keys with their referential actions only when they differ from the default', () => {
        const sql = buildSqliteCreateTableSql(
            quote,
            'orders',
            tableInfo,
            plan({
                columns: [column({ name: 'owner_id', type: 'INT' })],
                foreignKeys: [
                    {
                        name: 'fk_owner',
                        targetTable: 'users',
                        columns: [{ columnName: 'owner_id', targetName: 'id' }],
                        onUpdate: 'NO ACTION',
                        onDelete: 'cascade',
                        match: 'NONE',
                    },
                    {
                        name: 'fk_other',
                        targetTable: 'teams',
                        columns: [{ columnName: 'owner_id', targetName: 'id' }],
                        onUpdate: 'set_null',
                        onDelete: null,
                        match: 'full',
                    },
                ],
            })
        );

        expect(sql).toBe(
            [
                'CREATE TABLE "orders" (',
                '    "owner_id" INT,',
                '    FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE CASCADE,',
                '    FOREIGN KEY ("owner_id") REFERENCES "teams" ("id") ON UPDATE SET NULL MATCH FULL',
                ');',
            ].join('\n')
        );
    });

    it('follows a rename and drops a foreign key whose columns left the plan', () => {
        const sql = buildSqliteCreateTableSql(
            quote,
            'orders',
            tableInfo,
            plan({
                columns: [column({ name: 'renamed_owner', originalName: 'owner_id', type: 'INT' }), column({ name: 'team_id', type: 'INT' })],
                foreignKeys: [
                    {
                        name: 'fk_owner',
                        targetTable: 'users',
                        columns: [{ columnName: 'owner_id', targetName: 'id' }],
                        onUpdate: null,
                        onDelete: null,
                        match: null,
                    },
                    {
                        name: 'fk_dropped',
                        targetTable: 'teams',
                        columns: [{ columnName: 'gone_id', targetName: 'id' }],
                        onUpdate: null,
                        onDelete: null,
                        match: null,
                    },
                ],
            })
        );

        expect(sql).toBe(
            ['CREATE TABLE "orders" (', '    "renamed_owner" INT,', '    "team_id" INT,', '    FOREIGN KEY ("renamed_owner") REFERENCES "users" ("id")', ');'].join('\n')
        );
    });
});
