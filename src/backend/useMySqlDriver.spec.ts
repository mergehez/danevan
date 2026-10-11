// @vitest-environment node
// The MySQL tools reach a server through one pooled TypeORM client. That client is the socket
// boundary, so this spec records the statements it would send and answers each catalog by hand —
// the code under test is the real driver. (`db-tools.spec.ts` replaces this whole module with a
// mock, which is why none of these paths had a unit spec.)
import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeAnswer = { match: RegExp; rows?: Array<Record<string, unknown>>; throws?: string };

const fake = vi.hoisted(() => {
    const state = {
        calls: [] as Array<{ sql: string; params: unknown[] }>,
        answers: [] as FakeAnswer[],
        fields: [] as Array<{ name: string }>,
        queryRunner: undefined as unknown,
    };

    async function query(sql: string, params: unknown[] = []) {
        state.calls.push({ sql, params });
        const answer = [...state.answers].reverse().find((candidate) => candidate.match.test(sql));

        if (answer?.throws) {
            throw new Error(answer.throws);
        }

        return answer?.rows ?? [];
    }

    state.queryRunner = {
        isTransactionActive: false,
        query,
        async connect() {
            return {
                promise: () => ({
                    // `queryRowsWithFields` asks the connection itself, which is where mysql2 hands
                    // back the result fields TypeORM's query runner drops.
                    query: async (sql: string, params: unknown[] = []) => [await query(sql, params), state.fields],
                }),
            };
        },
        async startTransaction() {},
        async commitTransaction() {},
        async rollbackTransaction() {},
    };

    return state;
});

vi.mock('./remoteDataSourcePool.ts', () => ({
    connectionPoolKey: (connectionId: number) => `connection:${connectionId}`,
    serverPoolKey: (serverId: number) => `server:${serverId}`,
    remoteDataSourcePool: {
        // The driver only ever asks the pool for a query runner.
        withDataSource: async (_key: string, _create: unknown, callback: (dataSource: unknown, queryRunner: unknown) => Promise<unknown>) =>
            callback({ isInitialized: true }, fake.queryRunner),
    },
}));

import { useMySqlDriverTools } from './useMySqlDriver.ts';

function createTools() {
    return useMySqlDriverTools({
        escapeSqlString: (value: string) => `'${value.replaceAll("'", "''")}'`,
        normalizeOptionalText: (value: string | null | undefined) => (typeof value === 'string' && value.length > 0 ? value : null),
        getRemoteConnectionTarget: (connectionId: number) => ({ hostname: '127.0.0.1', port: 3306, database: `db_${connectionId}`, username: 'root' }),
        getRemoteServerTarget: () => ({ hostname: '127.0.0.1', port: 3306, username: 'root' }),
        resolveServerConnectionId: (_serverId: number, connectionId?: number) => connectionId,
        readConnectionPassword: async () => '',
        readServerPassword: async () => '',
        normalizeTableName: (tableName: string) => tableName.trim(),
        normalizeColumnName: (columnName: string) => columnName.trim(),
        buildColumnStats: (columns: string[], rows: Array<Record<string, unknown>>) => Object.fromEntries(columns.map((column) => [column, rows.length])),
        remoteMutationId: (result: Record<string, unknown>) => Number(result.affectedRows ?? 0),
    } as unknown as Parameters<typeof useMySqlDriverTools>[0]);
}

let tools: ReturnType<typeof useMySqlDriverTools>;

/** The statements that reached the fake query runner, whitespace collapsed for readability. */
function statements() {
    return fake.calls.map((call) => call.sql.replace(/\s+/gu, ' ').trim());
}

function required<T>(value: T | undefined, what: string): T {
    if (value === undefined) {
        throw new Error(`The MySQL driver must expose ${what}.`);
    }

    return value;
}

beforeEach(() => {
    fake.calls.length = 0;
    fake.answers.length = 0;
    fake.fields = [];
    tools = createTools();
});

describe('MySQL table listing', () => {
    it('answers a schema list from the catalog, estimated, without a COUNT(*) per table', async () => {
        fake.answers.push({
            match: /table_rows AS tableRows/u,
            rows: [
                { name: 'zebra', type: 'BASE TABLE', tableRows: 250_000 },
                { name: 'alpha', type: 'BASE TABLE', tableRows: 3 },
                { name: 'alpha_view', type: 'VIEW', tableRows: null },
            ],
        });

        expect(await tools.getTablesFresh(1)).toEqual([
            { name: 'alpha', type: 'table', rowCount: 3, rowCountIsEstimated: true },
            { name: 'zebra', type: 'table', rowCount: 250_000, rowCountIsEstimated: true },
            { name: 'alpha_view', type: 'view', rowCount: 0 },
        ]);

        expect(statements()).toEqual([expect.stringContaining('FROM information_schema.tables')]);
        expect(statements().some((sql) => /COUNT\(\*\)/iu.test(sql))).toBe(false);
    });
});

describe('MySQL table data', () => {
    /** The three catalogs a page read asks for. */
    function answerPage() {
        fake.answers.push(
            {
                match: /information_schema\.columns/u,
                rows: [
                    {
                        name: 'id',
                        ordinalPosition: 1,
                        columnType: 'int',
                        isNullable: 'NO',
                        columnDefault: null,
                        columnKey: 'PRI',
                        extra: '',
                        comment: '',
                        collation: null,
                    },
                ],
            },
            { match: /table_rows AS count/u, rows: [{ count: 250_000 }] },
            { match: /^SELECT \* FROM/u, rows: [{ id: 7 }] }
        );
    }

    it('reads a page with LIMIT/OFFSET and trusts the catalog estimate over the table', async () => {
        answerPage();

        const data = await tools.getTableData(1, 'people', 100, 20, undefined, true);

        expect(data.columns).toEqual(['id']);
        expect(data.rows).toEqual([{ id: 7 }]);
        expect(data.rowCount).toBe(250_000);
        expect(data.rowCountIsEstimated).toBe(true);
        expect(data.sql).toBe('SELECT * FROM `people` LIMIT 100 OFFSET 20');
        expect(statements().some((sql) => /COUNT\(\*\)/iu.test(sql))).toBe(false);
    });

    it('reads the rows after the last page with the unbounded LIMIT the driver builds', async () => {
        answerPage();

        await tools.getTableData(1, 'people', -1, 5);
        await tools.getTableData(1, 'people', -1, 0);

        expect(statements()).toContain('SELECT * FROM `people` LIMIT 18446744073709551615 OFFSET 5');
        expect(statements()).toContain('SELECT * FROM `people`');
    });
});

describe('MySQL query execution', () => {
    it('returns the columns mysql2 reports for a read', async () => {
        fake.fields = [{ name: 'id' }, { name: 'name' }];
        fake.answers.push({ match: /^SELECT/u, rows: [{ id: 1, name: 'Ada' }] });

        expect(await tools.runQuery(1, 'SELECT id, name FROM people')).toEqual({
            kind: 'rows',
            columns: ['id', 'name'],
            columnStats: { id: 1, name: 1 },
            rows: [{ id: 1, name: 'Ada' }],
        });
    });
});

describe('MySQL DDL copy', () => {
    it('copies the server own CREATE TABLE, semicolon included', async () => {
        fake.answers.push(
            { match: /table_type AS type/u, rows: [{ type: 'BASE TABLE' }] },
            { match: /^SHOW CREATE TABLE/u, rows: [{ 'Create Table': 'CREATE TABLE `people` (\n  `id` int NOT NULL\n)' }] }
        );

        expect(await tools.getTableDdl(1, 'people')).toBe('CREATE TABLE `people` (\n  `id` int NOT NULL\n);');
        expect(statements()).toEqual([expect.stringContaining('table_type AS type'), 'SHOW CREATE TABLE `people`']);
    });

    it('copies a view with SHOW CREATE VIEW', async () => {
        fake.answers.push(
            { match: /table_type AS type/u, rows: [{ type: 'VIEW' }] },
            { match: /^SHOW CREATE VIEW/u, rows: [{ 'Create View': 'CREATE VIEW `people_view` AS select 1' }] }
        );

        expect(await tools.getTableDdl(1, 'people_view')).toBe('CREATE VIEW `people_view` AS select 1;');
    });
});

describe('MySQL SQL validation', () => {
    function validateSql() {
        return required(tools.validateSql, 'validateSql');
    }

    it('prepares every statement and deallocates it again', async () => {
        await validateSql()(1, 'select 1;\nselect 2;');

        expect(statements()).toEqual([
            'SET @danevan_validation_sql = ?',
            'PREPARE danevan_validate_stmt FROM @danevan_validation_sql',
            'DEALLOCATE PREPARE danevan_validate_stmt',
            'SET @danevan_validation_sql = ?',
            'PREPARE danevan_validate_stmt FROM @danevan_validation_sql',
            'DEALLOCATE PREPARE danevan_validate_stmt',
        ]);
        expect(fake.calls.filter((call) => call.sql.startsWith('SET @danevan_validation_sql')).map((call) => call.params)).toEqual([['select 1'], ['select 2']]);
    });

    it('accepts a statement the prepared protocol refuses to handle', async () => {
        fake.answers.push({ match: /^PREPARE/u, throws: 'This command is not supported in the prepared statement protocol yet' });

        await expect(validateSql()(1, 'DROP TABLE people')).resolves.toBeUndefined();
    });

    it('reports the statement the database rejects', async () => {
        fake.answers.push({ match: /^PREPARE/u, throws: 'You have an error in your SQL syntax near FROM' });

        await expect(validateSql()(1, 'SELECT FROM')).rejects.toThrow(/You have an error in your SQL syntax/);
    });
});

describe('MySQL metadata sweep', () => {
    it('reads four catalogs for a batch of tables and takes the row counts from the estimate', async () => {
        fake.answers.push(
            {
                match: /information_schema\.columns/u,
                rows: [
                    {
                        batchTable: 'people',
                        name: 'id',
                        ordinalPosition: 1,
                        columnType: 'int',
                        isNullable: 'NO',
                        columnDefault: null,
                        columnKey: 'PRI',
                        extra: '',
                        comment: '',
                        collation: null,
                    },
                ],
            },
            { match: /information_schema\.statistics/u, rows: [] },
            { match: /key_column_usage/u, rows: [] },
            {
                match: /table_rows AS tableRows/u,
                rows: [
                    { batchTable: 'people', tableRows: 250_000, comment: null, engine: 'InnoDB', collation: 'utf8mb4_general_ci', options: null },
                    { batchTable: 'pets', tableRows: 12, comment: 'the pets', engine: 'InnoDB', collation: 'utf8mb4_general_ci', options: null },
                ],
            }
        );

        const getTableInfosFresh = required(tools.getTableInfosFresh, 'getTableInfosFresh');
        const infos = await getTableInfosFresh(1, ['people', 'pets']);

        expect(infos.map((info) => ({ name: info.name, rowCount: info.rowCount, columns: info.columns.map((column) => column.name), engine: info.engine }))).toEqual([
            { name: 'people', rowCount: 250_000, columns: ['id'], engine: 'InnoDB' },
            { name: 'pets', rowCount: 12, columns: [], engine: 'InnoDB' },
        ]);

        // Four catalogs, bounded no matter how many tables are asked for — not five queries per table.
        expect(fake.calls).toHaveLength(4);
        expect(statements().every((sql) => sql.includes('information_schema'))).toBe(true);
        expect(statements().some((sql) => /COUNT\(\*\)/iu.test(sql))).toBe(false);
        expect(fake.calls[0]!.params).toEqual(['people', 'pets']);
    });
});
