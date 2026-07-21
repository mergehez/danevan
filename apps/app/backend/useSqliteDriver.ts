import { BunTypeOrmSqliteDriver } from '@backend/bunTypeOrmSqliteDriver.ts';
import type { DriverTools, NormalizedApplyTableChanges, SortOrder } from '@backend/db-tools.ts';
import { mapTypeOrmColumns, mapTypeOrmForeignKeys, mapTypeOrmIndexesWithoutMetadata, mapTypeOrmTableMetadata } from '@backend/typeOrmMappers.ts';
import type {
    ApplyTableChangesResult,
    QueryExecutionResult,
    ServerSchemaRecord,
    SqlValue,
    TableColumnInfo,
    TableData,
    TableInfo,
    TableSummary,
    TestConnectionParams,
    TestConnectionResult,
    UpdateColumnParams,
} from '@utils/appClient';
import { Database } from 'bun:sqlite';
import 'reflect-metadata';
import { DataSource, type QueryRunner } from 'typeorm';

export type ModifySchemaColumn = {
    originalName?: string;
    name: string;
    type: string;
    notNull: boolean;
    defaultValue: string | null;
    isPrimaryKey: boolean;
    primaryKeyOrdinal: number | null;
    isAutoIncrement: boolean;
    comment: string | null;
    collation: string | null;
    onUpdate: string | null;
    hidden?: boolean;
    columnKind?: string | null;
};

export type ModifySchemaTable = {
    name: string;
    comment: string | null;
    engine: string | null;
    collation: string | null;
    options: string | null;
};

export type ModifySchemaKey = {
    originalName?: string;
    name: string;
    isPrimary: boolean;
    columns: Array<{
        columnName: string;
    }>;
};

export type ModifySchemaForeignKey = {
    originalName?: string;
    name: string;
    targetTable: string;
    columns: Array<{
        columnName: string;
        targetName: string;
    }>;
    onUpdate: string | null;
    onDelete: string | null;
    match: string | null;
};

export type ModifySchemaIndex = {
    originalName?: string;
    name: string;
    comment: string | null;
    isUnique: boolean;
    type: string | null;
    columns: Array<{
        columnName: string;
        order: string | null;
    }>;
};

export type ModifySchemaPlan = {
    table: ModifySchemaTable;
    columns: ModifySchemaColumn[];
    keys: ModifySchemaKey[];
    foreignKeys: ModifySchemaForeignKey[];
    indexes: ModifySchemaIndex[];
    allowTableRebuild?: boolean;
};

type SqliteSchemaHelperDeps = {
    escapeSqlString: (value: string) => string;
    quoteIdentifier: (identifier: string) => string;
    withSqliteDatabase: <T>(connectionId: number, callback: (database: Database) => T) => T;
};

type SqliteConnectionRecord = {
    id: number;
    server_id: number;
    name: string;
    database_name?: string | null;
};

type SqliteServerRecord = {
    driver: string;
    kind: string;
    file_path?: string | null;
    name: string;
};

type SqliteDriverToolsDeps = {
    getConnection: (connectionId: number) => SqliteConnectionRecord | undefined;
    getServer: (serverId: number) => SqliteServerRecord | undefined;
    listConnections: (serverId: number) => SqliteConnectionRecord[];
    escapeSqlString: (value: string) => string;
    quoteIdentifier: (identifier: string) => string;
    normalizeTableName: (tableName: string) => string;
    normalizeColumnName: (columnName: string, fieldName: string) => string;
    buildColumnStats: (columns: string[], rows: Array<Record<string, SqlValue>>) => Record<string, number>;
};

function normalizeOptionalText(value: string | null | undefined) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
}

function splitSqliteList(input: string) {
    const items: string[] = [];
    let buffer = '';
    let depth = 0;
    let quote: 'single' | 'double' | 'backtick' | 'bracket' | undefined;

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];

        if (quote === 'single') {
            buffer += char;
            if (char === "'" && input[index + 1] === "'") {
                buffer += input[index + 1];
                index += 1;
            } else if (char === "'") {
                quote = undefined;
            }
            continue;
        }

        if (quote === 'double') {
            buffer += char;
            if (char === '"' && input[index + 1] === '"') {
                buffer += input[index + 1];
                index += 1;
            } else if (char === '"') {
                quote = undefined;
            }
            continue;
        }

        if (quote === 'backtick') {
            buffer += char;
            if (char === '`' && input[index + 1] === '`') {
                buffer += input[index + 1];
                index += 1;
            } else if (char === '`') {
                quote = undefined;
            }
            continue;
        }

        if (quote === 'bracket') {
            buffer += char;
            if (char === ']') {
                quote = undefined;
            }
            continue;
        }

        if (char === "'") {
            quote = 'single';
            buffer += char;
            continue;
        }

        if (char === '"') {
            quote = 'double';
            buffer += char;
            continue;
        }

        if (char === '`') {
            quote = 'backtick';
            buffer += char;
            continue;
        }

        if (char === '[') {
            quote = 'bracket';
            buffer += char;
            continue;
        }

        if (char === '(') {
            depth += 1;
            buffer += char;
            continue;
        }

        if (char === ')') {
            depth = Math.max(0, depth - 1);
            buffer += char;
            continue;
        }

        if (char === ',' && depth === 0) {
            const item = buffer.trim();

            if (item) {
                items.push(item);
            }

            buffer = '';
            continue;
        }

        buffer += char;
    }

    const tail = buffer.trim();

    if (tail) {
        items.push(tail);
    }

    return items;
}

function extractLeadingIdentifier(input: string) {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
        return undefined;
    }

    const firstCharacter = trimmedInput[0];

    if (firstCharacter === '"') {
        const endIndex = trimmedInput.indexOf('"', 1);
        return endIndex >= 1 ? trimmedInput.slice(1, endIndex).replaceAll('""', '"') : undefined;
    }

    if (firstCharacter === '`') {
        const endIndex = trimmedInput.indexOf('`', 1);
        return endIndex >= 1 ? trimmedInput.slice(1, endIndex).replaceAll('``', '`') : undefined;
    }

    if (firstCharacter === '[') {
        const endIndex = trimmedInput.indexOf(']', 1);
        return endIndex >= 1 ? trimmedInput.slice(1, endIndex) : undefined;
    }

    const match = trimmedInput.match(/^([^\s(]+)/);
    return match?.[1];
}

function extractSqliteColumnDefinition(createTableSql: string | null | undefined, columnName: string) {
    if (!createTableSql) {
        return undefined;
    }

    const startIndex = createTableSql.indexOf('(');
    const endIndex = createTableSql.lastIndexOf(')');

    if (startIndex < 0 || endIndex <= startIndex) {
        return undefined;
    }

    const entries = splitSqliteList(createTableSql.slice(startIndex + 1, endIndex));
    return entries.find((entry) => extractLeadingIdentifier(entry)?.toLowerCase() === columnName.toLowerCase());
}

function parseSqliteColumnMetadata(createTableSql: string | null | undefined, columnName: string) {
    const definition = extractSqliteColumnDefinition(createTableSql, columnName);

    if (!definition) {
        return {
            isAutoIncrement: false,
            collation: null,
        };
    }

    const collationMatch = definition.match(/\bCOLLATE\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([^\s,]+))/i);

    return {
        isAutoIncrement: /\bAUTOINCREMENT\b/i.test(definition),
        collation: normalizeOptionalText(collationMatch?.[1] ?? collationMatch?.[2] ?? collationMatch?.[3] ?? collationMatch?.[4]),
    };
}

function enrichSqliteColumns(columns: TableColumnInfo[], createTableSql: string | null | undefined) {
    return columns.map((column) => {
        const metadata = parseSqliteColumnMetadata(createTableSql, column.name);

        return {
            ...column,
            isAutoIncrement: column.isAutoIncrement || metadata.isAutoIncrement,
            collation: column.collation ?? metadata.collation,
        } satisfies TableColumnInfo;
    });
}

function normalizeCountValue(value: number | bigint | string | null | undefined) {
    if (typeof value === 'bigint') {
        return Number(value);
    }

    if (typeof value === 'string') {
        return Number(value);
    }

    return value ?? 0;
}

type SqliteTypeOrmClient = {
    dataSource: DataSource;
    queryRunner: QueryRunner;
};

function createSqliteDataSource(databasePath: string) {
    return new DataSource({
        type: 'better-sqlite3',
        database: databasePath,
        fileMustExist: databasePath !== ':memory:',
        timeout: 5000,
        driver: BunTypeOrmSqliteDriver,
        entities: [],
        subscribers: [],
        migrations: [],
        synchronize: false,
        logging: false,
    });
}

function buildSqliteColumnDefinition(quoteIdentifier: SqliteSchemaHelperDeps['quoteIdentifier'], column: ModifySchemaColumn, inlinePrimaryKey: boolean) {
    const parts = [quoteIdentifier(column.name), inlinePrimaryKey && column.isAutoIncrement ? 'INTEGER' : column.type];

    if (inlinePrimaryKey) {
        parts.push('PRIMARY KEY');

        if (column.isAutoIncrement) {
            parts.push('AUTOINCREMENT');
        }
    }

    if (column.collation) {
        parts.push(`COLLATE ${quoteIdentifier(column.collation)}`);
    }

    if (column.notNull) {
        parts.push('NOT NULL');
    }

    if (column.defaultValue) {
        parts.push(`DEFAULT ${column.defaultValue}`);
    }

    return parts.join(' ');
}

function buildSqliteCreateTableSql(quoteIdentifier: SqliteSchemaHelperDeps['quoteIdentifier'], tableName: string, _currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
    const nextColumns = nextPlan.columns;
    const renamedColumnNames = new Map(nextColumns.filter((column) => column.originalName).map((column) => [column.originalName!, column.name]));
    const nextColumnNames = new Set(nextColumns.map((column) => column.name));
    const explicitPrimaryKey = nextPlan.keys.find((key) => key.isPrimary);
    const primaryKeyColumns = explicitPrimaryKey
        ? explicitPrimaryKey.columns.map((column, index) => ({ name: column.columnName, primaryKeyOrdinal: index + 1 }))
        : nextColumns
              .filter((column) => column.isPrimaryKey)
              .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER));
    const inlinePrimaryKeyColumnName = primaryKeyColumns.length === 1 ? primaryKeyColumns[0]?.name : undefined;
    const parts = nextColumns.map((column) => buildSqliteColumnDefinition(quoteIdentifier, column, column.name === inlinePrimaryKeyColumnName));

    if (primaryKeyColumns.length > 1) {
        parts.push(`PRIMARY KEY (${primaryKeyColumns.map((column) => quoteIdentifier(column.name)).join(', ')})`);
    }

    const uniqueConstraints = nextPlan.keys
        .filter((key) => !key.isPrimary)
        .map((key) => key.columns.map((column) => column.columnName))
        .filter((columnNames) => columnNames.every((columnName) => nextColumnNames.has(columnName)));

    uniqueConstraints.forEach((columnNames) => {
        parts.push(`UNIQUE (${columnNames.map((columnName) => quoteIdentifier(columnName)).join(', ')})`);
    });

    for (const foreignKey of nextPlan.foreignKeys) {
        const mappedFromColumns = foreignKey.columns.map((column) => renamedColumnNames.get(column.columnName) ?? column.columnName);

        if (!mappedFromColumns.every((columnName) => nextColumnNames.has(columnName))) {
            continue;
        }

        const clauses = [
            `FOREIGN KEY (${mappedFromColumns.map((columnName) => quoteIdentifier(columnName)).join(', ')})`,
            `REFERENCES ${quoteIdentifier(foreignKey.targetTable)} (${foreignKey.columns.map((column) => quoteIdentifier(column.targetName)).join(', ')})`,
        ];

        if (foreignKey.onUpdate && foreignKey.onUpdate.toUpperCase() !== 'NO ACTION') {
            clauses.push(`ON UPDATE ${foreignKey.onUpdate.replaceAll('_', ' ').toUpperCase()}`);
        }

        if (foreignKey.onDelete && foreignKey.onDelete.toUpperCase() !== 'NO ACTION') {
            clauses.push(`ON DELETE ${foreignKey.onDelete.replaceAll('_', ' ').toUpperCase()}`);
        }

        if (foreignKey.match && foreignKey.match.toUpperCase() !== 'NONE') {
            clauses.push(`MATCH ${foreignKey.match.toUpperCase()}`);
        }

        parts.push(clauses.join(' '));
    }

    return `CREATE TABLE ${quoteIdentifier(tableName)} (\n    ${parts.join(',\n    ')}\n);`;
}

export function useSqliteSchemaHelper(deps: SqliteSchemaHelperDeps) {
    function applyModifyTable(connectionId: number, tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
        return deps.withSqliteDatabase(connectionId, (database) => {
            const nextColumns = nextPlan.columns;
            const partialIndex = currentInfo.indexes.find((index) => index.isPartial);

            if (partialIndex) {
                throw new Error(`SQLite modify-table does not support partial index ${partialIndex.name} yet.`);
            }

            const triggerCountRow = database
                .query(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ${deps.escapeSqlString(tableName)}`)
                .get() as { count: number } | null;

            if ((triggerCountRow?.count ?? 0) > 0) {
                throw new Error('SQLite modify-table does not support tables with triggers yet.');
            }

            const nextColumnNames = new Set(nextColumns.map((column) => column.name));
            const transferableColumns = nextColumns
                .filter((column) => column.originalName && currentInfo.columns.some((currentColumn) => currentColumn.name === column.originalName))
                .map((column) => ({ target: column.name, source: column.originalName! }))
                .filter((column) => nextColumnNames.has(column.target));

            if (transferableColumns.length === 0 && currentInfo.rowCount > 0) {
                throw new Error('SQLite modify-table cannot rebuild a populated table when every existing column has been removed.');
            }

            const tempTableName = `__danevan_modify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const createSql = buildSqliteCreateTableSql(deps.quoteIdentifier, tempTableName, currentInfo, nextPlan);
            const recreateIndexes = nextPlan.indexes.filter((index) => !nextPlan.keys.some((key) => key.name.toLowerCase() === index.name.toLowerCase()));
            const renamedColumnNames = new Map(nextColumns.filter((column) => column.originalName).map((column) => [column.originalName!, column.name]));

            database.exec('PRAGMA foreign_keys = OFF;');

            try {
                database.exec('BEGIN IMMEDIATE;');
                database.exec(createSql);

                if (transferableColumns.length > 0) {
                    database.exec(
                        `INSERT INTO ${deps.quoteIdentifier(tempTableName)} (${transferableColumns.map((column) => deps.quoteIdentifier(column.target)).join(', ')}) ` +
                            `SELECT ${transferableColumns.map((column) => deps.quoteIdentifier(column.source)).join(', ')} FROM ${deps.quoteIdentifier(tableName)};`
                    );
                }

                database.exec(`DROP TABLE ${deps.quoteIdentifier(tableName)};`);
                database.exec(`ALTER TABLE ${deps.quoteIdentifier(tempTableName)} RENAME TO ${deps.quoteIdentifier(nextPlan.table.name)};`);

                recreateIndexes.forEach((index) => {
                    const mappedColumns = index.columns.map((column) => renamedColumnNames.get(column.columnName) ?? column.columnName);

                    if (!mappedColumns.every((columnName) => nextColumnNames.has(columnName))) {
                        return;
                    }

                    const createIndexSql = `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${deps.quoteIdentifier(index.name)} ON ${deps.quoteIdentifier(nextPlan.table.name)} (${mappedColumns
                        .map(
                            (columnName, indexPosition) =>
                                `${deps.quoteIdentifier(columnName)}${index.columns[indexPosition]?.order && index.columns[indexPosition]?.order !== 'NONE' ? ` ${index.columns[indexPosition]!.order}` : ''}`
                        )
                        .join(', ')});`;
                    database.exec(createIndexSql);
                });

                database.exec('COMMIT;');
            } catch (error) {
                try {
                    database.exec('ROLLBACK;');
                } catch {
                    // ignore rollback failures after sqlite aborts the transaction itself
                }
                throw error;
            } finally {
                database.exec('PRAGMA foreign_keys = ON;');
            }
        });
    }

    return {
        applyModifyTable,
    };
}

export function useSqliteDriverTools(deps: SqliteDriverToolsDeps): DriverTools {
    function getSqliteFilePath(connectionId: number) {
        const connection = deps.getConnection(connectionId);

        if (!connection) {
            throw new Error('The selected connection could not be found.');
        }

        const server = deps.getServer(connection.server_id);

        if (!server) {
            throw new Error('The selected server could not be found.');
        }

        if (server.driver !== 'sqlite') {
            throw new Error(`The '${server.driver}' driver is not implemented yet.`);
        }

        if (server.kind !== 'file') {
            throw new Error('Server-based SQLite connections are not supported. Use a file-based SQLite server entry.');
        }

        if (!server.file_path) {
            throw new Error('The selected SQLite server is missing its file path.');
        }

        return server.file_path;
    }

    function withSqliteDatabase<T>(connectionId: number, callback: (database: Database) => T): T {
        const sqlite = new Database(getSqliteFilePath(connectionId), {
            readonly: false,
            create: false,
            readwrite: true,
            strict: true,
        });

        try {
            sqlite.exec('PRAGMA foreign_keys = ON;');
            sqlite.exec('PRAGMA busy_timeout = 5000;');
            return callback(sqlite);
        } finally {
            sqlite.close();
        }
    }

    async function withSqliteTypeOrm<T>(connectionId: number, callback: (client: SqliteTypeOrmClient) => Promise<T>) {
        const dataSource = createSqliteDataSource(getSqliteFilePath(connectionId));
        await dataSource.initialize();

        const queryRunner = dataSource.createQueryRunner();
        await queryRunner.connect();

        try {
            return await callback({
                dataSource,
                queryRunner,
            });
        } finally {
            try {
                if (!queryRunner.isReleased) {
                    await queryRunner.release();
                }
            } finally {
                if (dataSource.isInitialized) {
                    await dataSource.destroy();
                }
            }
        }
    }

    async function queryRowCount(queryRunner: QueryRunner, tableName: string) {
        const rows = (await queryRunner.query(`SELECT COUNT(*) AS count FROM ${deps.quoteIdentifier(tableName)}`)) as Array<{
            count: number | bigint | string;
        }>;

        return normalizeCountValue(rows[0]?.count);
    }

    function buildSqliteOrderBy(orderBy: SortOrder | undefined, quoteIdentifier: (name: string) => string): string {
        if (!orderBy) {
            return '';
        }

        return ` ORDER BY ${quoteIdentifier(orderBy.column)} ${orderBy.direction}`;
    }

    async function getSqliteTableData(queryRunner: QueryRunner, tableName: string, limit: number, offset: number, orderBy?: SortOrder): Promise<TableData> {
        const columns = (await queryRunner.query(`PRAGMA table_info(${deps.quoteIdentifier(tableName)})`)) as Array<{ name: string }>;
        const orderClause = buildSqliteOrderBy(orderBy, deps.quoteIdentifier);
        const rows = (await queryRunner.query(`SELECT * FROM ${deps.quoteIdentifier(tableName)}${orderClause} LIMIT ? OFFSET ?`, [limit, offset])) as Array<
            Record<string, SqlValue>
        >;
        const columnNames = columns.map((column) => column.name);

        return {
            columns: columnNames,
            columnStats: deps.buildColumnStats(columnNames, rows),
            rows,
            rowCount: await queryRowCount(queryRunner, tableName),
            limit,
            offset,
        };
    }

    async function collectSqliteForeignKeyViolationMessages(queryRunner: QueryRunner, tableName: string) {
        const rows = (await queryRunner.query(`PRAGMA foreign_key_check(${deps.quoteIdentifier(tableName)})`)) as Array<{
            table: string;
            rowid: number | bigint | null;
            parent: string;
            fkid: number;
        }>;

        const groups = new Map<string, { count: number; parent: string; rowIds: Array<number | bigint | null>; fkid: number }>();

        for (const row of rows) {
            const key = `${row.parent}:${row.fkid}`;
            const group = groups.get(key) ?? {
                count: 0,
                parent: row.parent,
                rowIds: [],
                fkid: row.fkid,
            };
            group.count += 1;
            group.rowIds.push(row.rowid);
            groups.set(key, group);
        }

        return [...groups.values()].map((group) => {
            const rowIds = group.rowIds
                .filter((rowId): rowId is number | bigint => rowId != null)
                .slice(0, 5)
                .join(', ');
            const suffix = group.rowIds.length > 5 ? ', ...' : '';
            const rowIdText = rowIds ? ` Row IDs: ${rowIds}${suffix}.` : '';
            return `${tableName} has ${group.count} foreign key violation${group.count === 1 ? '' : 's'} referencing ${group.parent} (constraint #${group.fkid}).${rowIdText}`;
        });
    }

    function sqliteMutationId(result: { lastInsertRowid: number | bigint }) {
        return result.lastInsertRowid;
    }

    function testConnection(params: TestConnectionParams): TestConnectionResult {
        const filePath = params.filePath?.trim();

        if (!filePath) {
            throw new Error('A file path is required to test a SQLite source.');
        }

        const sqlite = new Database(filePath, {
            readonly: false,
            create: false,
            readwrite: true,
            strict: true,
        });

        try {
            sqlite.exec('PRAGMA foreign_keys = ON;');
            sqlite.query('SELECT 1 AS connected').get();

            return {
                ok: true,
                driver: 'sqlite',
                message: `Connected to SQLite file ${filePath}.`,
            };
        } finally {
            sqlite.close();
        }
    }

    const sqliteSchemaHelper = useSqliteSchemaHelper({
        escapeSqlString: deps.escapeSqlString,
        quoteIdentifier: deps.quoteIdentifier,
        withSqliteDatabase,
    });

    return {
        testConnection,
        async getTablesFresh(connectionId: number): Promise<TableSummary[]> {
            return withSqliteTypeOrm(connectionId, async ({ queryRunner }) => {
                const tables = (await queryRunner.getTables()).map((table) => table.name).filter((name) => !name.startsWith('sqlite_'));
                const views = (await queryRunner.query(
                    `
                        SELECT name
                        FROM sqlite_master
                        WHERE type = 'view'
                          AND name NOT LIKE 'sqlite_%'
                        ORDER BY name ASC
                    `
                )) as Array<{ name: string }>;

                const tableSummaries = await Promise.all(
                    tables.map(async (name) => ({
                        name,
                        type: 'table' as const,
                        rowCount: await queryRowCount(queryRunner, name),
                    }))
                );

                return [...tableSummaries, ...views.map((view) => ({ name: view.name, type: 'view' as const, rowCount: 0 }))].sort(
                    (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name)
                );
            });
        },
        async getTableInfoFresh(connectionId: number, tableName: string): Promise<TableInfo> {
            return withSqliteTypeOrm(connectionId, async ({ queryRunner }) => {
                const table = await queryRunner.getTable(tableName);

                if (table) {
                    const tableCreateEntries = (await queryRunner.query(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, [table.name])) as Array<{
                        sql: string | null;
                    }>;
                    const metadata = mapTypeOrmTableMetadata(table, normalizeOptionalText);

                    return {
                        name: table.name,
                        columns: enrichSqliteColumns(mapTypeOrmColumns(table, normalizeOptionalText), tableCreateEntries[0]?.sql),
                        indexes: mapTypeOrmIndexesWithoutMetadata(table.indices, table.uniques, normalizeOptionalText),
                        foreignKeys: mapTypeOrmForeignKeys(table.foreignKeys),
                        rowCount: await queryRowCount(queryRunner, table.name),
                        comment: metadata.comment,
                        engine: metadata.engine,
                        collation: null,
                        options: null,
                    } satisfies TableInfo;
                }

                const views = (await queryRunner.query(`SELECT name FROM sqlite_master WHERE type = 'view' AND name = ?`, [tableName])) as Array<{ name: string }>;

                if (views.length === 0) {
                    throw new Error(`Table '${tableName}' was not found.`);
                }

                const columns = (await queryRunner.query(`PRAGMA table_xinfo(${deps.quoteIdentifier(tableName)})`)) as Array<{
                    cid: number;
                    name: string;
                    type: string;
                    notnull: number;
                    dflt_value: string | null;
                    pk: number;
                    hidden: number;
                }>;

                return {
                    name: tableName,
                    columns: columns
                        .filter((column) => column.hidden !== 1)
                        .map(
                            (column) =>
                                ({
                                    cid: column.cid,
                                    name: column.name,
                                    type: column.type,
                                    notNull: column.notnull === 1,
                                    defaultValue: column.dflt_value,
                                    isPrimaryKey: column.pk > 0,
                                    primaryKeyOrdinal: column.pk > 0 ? column.pk : null,
                                    isAutoIncrement: false,
                                    comment: null,
                                    collation: null,
                                    onUpdate: null,
                                }) satisfies TableColumnInfo
                        ),
                    indexes: [],
                    foreignKeys: [],
                    rowCount: await queryRowCount(queryRunner, tableName),
                    comment: null,
                    engine: null,
                    collation: null,
                    options: null,
                } satisfies TableInfo;
            });
        },
        async getTableDdl(connectionId: number, tableName: string): Promise<string> {
            return withSqliteTypeOrm(connectionId, async ({ queryRunner }) => {
                const entries = (await queryRunner.query(
                    `
                        SELECT type, sql
                        FROM sqlite_master
                        WHERE name = ?
                          AND type IN ('table', 'view')
                    `,
                    [tableName]
                )) as Array<{ type: 'table' | 'view'; sql: string | null }>;
                const entry = entries[0];

                if (!entry?.sql) {
                    throw new Error(`Table '${tableName}' was not found.`);
                }

                const statements = [entry.sql.trim()];

                if (entry.type === 'table') {
                    const indexEntries = (await queryRunner.query(
                        `
                            SELECT sql
                            FROM sqlite_master
                            WHERE type = 'index'
                              AND tbl_name = ?
                              AND sql IS NOT NULL
                            ORDER BY name ASC
                        `,
                        [tableName]
                    )) as Array<{ sql: string | null }>;

                    statements.push(...indexEntries.map((indexEntry) => indexEntry.sql?.trim()).filter((statement): statement is string => !!statement));
                }

                return statements.map((statement) => (statement.endsWith(';') ? statement : `${statement};`)).join('\n');
            });
        },
        async listServerSchemas(serverId: number, connectionId?: number): Promise<ServerSchemaRecord[]> {
            const server = deps.getServer(serverId);

            if (!server) {
                throw new Error('The selected server could not be found.');
            }

            const connection = typeof connectionId === 'number' ? deps.getConnection(connectionId) : deps.listConnections(serverId)[0];
            const schemaName = connection?.database_name || connection?.name || server.name;

            return [{ name: schemaName }];
        },
        async getTableData(connectionId: number, tableName: string, limit: number, offset: number, orderBy?: SortOrder): Promise<TableData> {
            return withSqliteTypeOrm(connectionId, async ({ queryRunner }) => getSqliteTableData(queryRunner, tableName, limit, offset, orderBy));
        },
        async runQuery(connectionId: number, sql: string, params?: SqlValue[]): Promise<QueryExecutionResult> {
            return withSqliteTypeOrm(connectionId, async ({ queryRunner }) => {
                const result = (await queryRunner.query(sql, params ?? [], true)) as {
                    raw: unknown;
                    records?: Array<Record<string, SqlValue>>;
                };
                const rows = Array.isArray(result.records) ? result.records : Array.isArray(result.raw) ? (result.raw as Array<Record<string, SqlValue>>) : undefined;

                if (rows) {
                    const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];

                    return {
                        kind: 'rows',
                        columns,
                        columnStats: deps.buildColumnStats(columns, rows),
                        rows,
                    } satisfies QueryExecutionResult;
                }

                return {
                    kind: 'mutation',
                    lastInsertRowid: sqliteMutationId({ lastInsertRowid: (result.raw as number | bigint | undefined) ?? 0 }),
                } satisfies QueryExecutionResult;
            });
        },
        async validateSql(connectionId: number, sql: string): Promise<void> {
            withSqliteDatabase(connectionId, (database) => {
                database.prepare(sql);
            });
        },
        async modifyTable(connectionId: number, tableName: string, currentInfo: TableInfo, nextColumns) {
            sqliteSchemaHelper.applyModifyTable(connectionId, tableName, currentInfo, nextColumns);
        },
        async updateColumn(params: UpdateColumnParams): Promise<TableData> {
            const normalizedTableName = deps.normalizeTableName(params.tableName);
            const normalizedTargetColumn = deps.normalizeColumnName(params.targetColumn, 'Target column');
            const normalizedMatchColumn = deps.normalizeColumnName(params.matchColumn, 'Match column');

            return withSqliteTypeOrm(params.connectionId, async ({ queryRunner }) => {
                await queryRunner.query(
                    `
                        UPDATE ${deps.quoteIdentifier(normalizedTableName)}
                        SET ${deps.quoteIdentifier(normalizedTargetColumn)} = ?
                        WHERE ${deps.quoteIdentifier(normalizedMatchColumn)} = ?
                    `,
                    [params.value, params.matchValue]
                );

                return getSqliteTableData(queryRunner, normalizedTableName, 100, 0);
            });
        },
        async applyTableChanges(params: NormalizedApplyTableChanges): Promise<ApplyTableChangesResult> {
            return withSqliteTypeOrm(params.connectionId, async ({ queryRunner }) => {
                let transactionOpen = false;

                if (params.disableForeignKeyChecks) {
                    await queryRunner.query('PRAGMA foreign_keys = OFF;');
                }

                try {
                    await queryRunner.query('BEGIN IMMEDIATE;');
                    transactionOpen = true;

                    for (const change of params.changes) {
                        await queryRunner.query(
                            `
                                UPDATE ${deps.quoteIdentifier(params.tableName)}
                                SET ${deps.quoteIdentifier(change.targetColumn)} = ?
                                WHERE ${deps.quoteIdentifier(change.matchColumn)} = ?
                            `,
                            [change.value, change.matchValue]
                        );
                    }

                    await queryRunner.query('COMMIT;');
                    transactionOpen = false;

                    return {
                        tableData: await getSqliteTableData(queryRunner, params.tableName, params.limit, params.offset),
                        foreignKeyViolations: params.disableForeignKeyChecks ? await collectSqliteForeignKeyViolationMessages(queryRunner, params.tableName) : [],
                    } satisfies ApplyTableChangesResult;
                } catch (error) {
                    if (transactionOpen) {
                        await queryRunner.query('ROLLBACK;');
                    }

                    throw error;
                } finally {
                    if (params.disableForeignKeyChecks) {
                        await queryRunner.query('PRAGMA foreign_keys = ON;');
                    }
                }
            });
        },
    } satisfies DriverTools;
}
