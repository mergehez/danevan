import 'reflect-metadata';
import { DataSource, type QueryRunner, type Table, type View } from 'typeorm';
import type { ServerSchemaRecord, SqlValue, TableColumnInfo, TableForeignKeyInfo, TableInfo, TableSummary, TestConnectionParams, TestConnectionResult } from '../shared/types';
import { splitSqlStatements } from '../shared/utils/sqlStatements';
import type { DriverTools, RemoteConnectionTarget, SortOrder } from './db-tools.ts';
import { createTypeOrmForeignKey, formatMySqlDefaultValue, normalizeCountValue, normalizeMySqlIndexOrder, quoteMySqlIdentifier } from './dialectSql.ts';
import { buildAlterStatements, buildDropForeignKeyStatement, buildTableOptionStatements, type MySqlTableDdlDeps } from './mysqlTableDdl.ts';
import { foreignKeySignature, getCurrentPrimaryKey, getDesiredPrimaryKey, groupCurrentForeignKeys, keySignature } from './remoteTableDdl.ts';
import { resolveListedRowCount, useRemoteDriverTools, type RemoteDriverClient, type RemoteDriverHelper, type RemoteStatement } from './useRemoteDriverTools.ts';
import { connectionPoolKey, remoteDataSourcePool, serverPoolKey } from './remoteDataSourcePool.ts';
import type { ModifySchemaPlan, ModifySchemaTable } from './useSqliteDriver.ts';

type MySqlSchemaHelperDeps = {
    escapeSqlString: (value: string) => string;
    normalizeOptionalText: (value: string | null | undefined) => string | null;
    quoteRemoteIdentifier: (driver: 'mysql', identifier: string) => string;
};

type MySqlTableRow = {
    name: string | null;
    type: string | null;
    tableRows: number | bigint | string | null;
};

type MySqlColumnRow = {
    ordinalPosition: number | string | null;
    name: string | null;
    columnType: string | null;
    isNullable: string | null;
    columnDefault: string | null;
    columnKey: string | null;
    extra: string | null;
    comment: string | null;
    collation: string | null;
};

type MySqlIndexRow = {
    name: string | null;
    columnName: string | null;
    comment: string | null;
    type: string | null;
    nonUnique: number | string | null;
    seqInIndex: number | string | null;
    columnOrder: string | null;
};

type MySqlForeignKeyRow = {
    name: string | null;
    sequence: number | string | null;
    tableName: string | null;
    fromColumn: string | null;
    toColumn: string | null;
    onUpdate: string | null;
    onDelete: string | null;
    matchOption: string | null;
};

type MySqlDriverToolsDeps = {
    escapeSqlString: (value: string) => string;
    normalizeOptionalText: (value: string | null | undefined) => string | null;
    getRemoteConnectionTarget: (connectionId: number) => RemoteConnectionTarget;
    getRemoteServerTarget: (serverId: number) => RemoteConnectionTarget;
    resolveServerConnectionId: (serverId: number, connectionId?: number) => number | undefined;
    readConnectionPassword: (connectionId: number) => Promise<string | null>;
    readServerPassword: (serverId: number) => Promise<string | null>;
    normalizeTableName: (tableName: string) => string;
    normalizeColumnName: (columnName: string, fieldName: string) => string;
    buildColumnStats: (columns: string[], rows: Array<Record<string, SqlValue>>) => Record<string, number>;
    remoteMutationId: (result: Record<string, unknown>) => number | bigint;
};

type MySqlDataSourceConfig = {
    host: string;
    port?: number;
    database?: string;
    username?: string;
    password: string;
};

function createMySqlDataSource(config: MySqlDataSourceConfig) {
    return new DataSource({
        type: 'mysql',
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        entities: [],
        subscribers: [],
        migrations: [],
        synchronize: false,
        logging: false,
        extra: {
            connectionLimit: 1,
            supportBigNumbers: true,
            bigNumberStrings: true,
        },
    });
}

function getConnectedDatabaseName(dataSource: DataSource) {
    const driver = dataSource.driver as { database?: string | null };
    const databaseName = driver.database?.trim();

    return databaseName && databaseName.length > 0 ? databaseName : null;
}

type MySqlQueryRunnerClient = RemoteDriverClient & {
    dataSource: DataSource;
    queryRunner: QueryRunner;
    tableCache: Map<string, Promise<Table | undefined>>;
};

type MySqlNativeConnection = {
    promise: () => {
        query: (sql: string, params: SqlValue[]) => Promise<[Array<Record<string, SqlValue>>, Array<{ name: string }> | undefined]>;
    };
};

type TypeOrmMemoryQueryRunner = QueryRunner & {
    enableSqlMemory(): void;
    disableSqlMemory(): void;
    getMemorySql(): { upQueries: Array<{ query: string }> };
    createTable(table: Table, ifNotExist?: boolean, createForeignKeys?: boolean, createIndices?: boolean): Promise<void>;
    createView(view: View, syncWithMetadata?: boolean): Promise<void>;
    getView(viewPath: string): Promise<View | undefined>;
};

function getMySqlQueryRunnerClient(client: RemoteDriverClient): MySqlQueryRunnerClient {
    return client as MySqlQueryRunnerClient;
}

async function loadTypeOrmTable(client: RemoteDriverClient, tableName: string) {
    const queryRunnerClient = getMySqlQueryRunnerClient(client);
    const cacheKey = tableName.toLowerCase();
    const cachedTable = queryRunnerClient.tableCache.get(cacheKey);

    if (cachedTable) {
        return cachedTable;
    }

    const nextTable = queryRunnerClient.queryRunner.getTable(tableName);
    queryRunnerClient.tableCache.set(cacheKey, nextTable);
    return nextTable;
}

function normalizeMemoryStatements(queryRunner: QueryRunner) {
    return queryRunner.getMemorySql().upQueries.map(({ query }) => {
        const trimmed = query.trim();
        return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
    });
}

function getTypeOrmMemoryQueryRunner(queryRunner: QueryRunner) {
    return queryRunner as TypeOrmMemoryQueryRunner;
}

async function collectSqlMemoryStatements(queryRunner: QueryRunner, callback: (runner: TypeOrmMemoryQueryRunner) => Promise<void>) {
    const memoryRunner = getTypeOrmMemoryQueryRunner(queryRunner);
    memoryRunner.enableSqlMemory();

    try {
        await callback(memoryRunner);
        return normalizeMemoryStatements(memoryRunner);
    } finally {
        memoryRunner.disableSqlMemory();
    }
}

async function getMySqlNativeDdl(client: RemoteDriverClient, tableName: string) {
    const objectRows = await client.queryRows<{ type: string | null }>({
        sql: `
            SELECT table_type AS type
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_name = ?
        `,
        params: [tableName],
    });
    const objectType = String(objectRows[0]?.type ?? '').toUpperCase();

    if (!objectType) {
        return undefined;
    }

    const rows = await client.queryRows<Record<string, unknown>>({
        sql: `${objectType === 'VIEW' ? 'SHOW CREATE VIEW' : 'SHOW CREATE TABLE'} ${quoteMySqlIdentifier(tableName)}`,
    });
    const row = rows[0];

    if (!row) {
        return undefined;
    }

    const createEntry = Object.entries(row).find(([key, value]) => /^create\s+/iu.test(key) && typeof value === 'string');
    const ddl = typeof createEntry?.[1] === 'string' ? createEntry[1].trim() : '';

    if (!ddl) {
        return undefined;
    }

    return ddl.endsWith(';') ? ddl : `${ddl};`;
}

async function getTableOrViewDdl(client: RemoteDriverClient, tableName: string) {
    const nativeDdl = await getMySqlNativeDdl(client, tableName);

    if (nativeDdl) {
        return nativeDdl;
    }

    const queryRunner = getMySqlQueryRunnerClient(client).queryRunner;
    const table = await loadTypeOrmTable(client, tableName);

    if (table) {
        const statements = await collectSqlMemoryStatements(queryRunner, async (memoryRunner) => {
            await memoryRunner.createTable(table, false, true, true);
        });

        return statements.join('\n');
    }

    const view = await getTypeOrmMemoryQueryRunner(queryRunner).getView(tableName);

    if (view) {
        const statements = await collectSqlMemoryStatements(queryRunner, async (memoryRunner) => {
            await memoryRunner.createView(view, false);
        });

        return statements.join('\n');
    }

    throw new Error(`Table '${tableName}' was not found.`);
}

async function getMySqlTableRows(client: RemoteDriverClient) {
    return client.queryRows<MySqlTableRow>({
        sql: `
            SELECT
                table_name AS name,
                table_type AS type,
                table_rows AS tableRows
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            ORDER BY table_type ASC, table_name ASC
        `,
    });
}

async function getMySqlColumnRows(client: RemoteDriverClient, tableName: string) {
    return client.queryRows<MySqlColumnRow>({
        sql: `
            SELECT
                ordinal_position AS ordinalPosition,
                column_name AS name,
                column_type AS columnType,
                is_nullable AS isNullable,
                column_default AS columnDefault,
                column_key AS columnKey,
                extra AS extra,
                column_comment AS comment,
                collation_name AS collation
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = ?
            ORDER BY ordinal_position ASC
        `,
        params: [tableName],
    });
}

async function getMySqlIndexRows(client: RemoteDriverClient, tableName: string) {
    return client.queryRows<MySqlIndexRow>({
        sql: `
            SELECT
                index_name AS name,
                column_name AS columnName,
                index_comment AS comment,
                index_type AS type,
                non_unique AS nonUnique,
                seq_in_index AS seqInIndex,
                collation AS columnOrder
            FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = ?
              AND index_name <> 'PRIMARY'
            ORDER BY index_name ASC, seq_in_index ASC
        `,
        params: [tableName],
    });
}

async function getMySqlForeignKeyRows(client: RemoteDriverClient, tableName: string) {
    return client.queryRows<MySqlForeignKeyRow>({
        sql: `
            SELECT
                kcu.constraint_name AS name,
                kcu.ordinal_position AS sequence,
                kcu.referenced_table_name AS tableName,
                kcu.column_name AS fromColumn,
                kcu.referenced_column_name AS toColumn,
                rc.update_rule AS onUpdate,
                rc.delete_rule AS onDelete,
                rc.match_option AS matchOption
            FROM information_schema.key_column_usage AS kcu
            INNER JOIN information_schema.referential_constraints AS rc
                ON rc.constraint_schema = kcu.constraint_schema
               AND rc.table_name = kcu.table_name
               AND rc.constraint_name = kcu.constraint_name
            WHERE kcu.table_schema = DATABASE()
              AND kcu.table_name = ?
              AND kcu.referenced_table_name IS NOT NULL
            ORDER BY kcu.constraint_name ASC, kcu.ordinal_position ASC
        `,
        params: [tableName],
    });
}

async function getMySqlTableInfoRow(client: RemoteDriverClient, tableName: string) {
    const rows = await client.queryRows<{
        comment: string | null;
        engine: string | null;
        collation: string | null;
        options: string | null;
    }>({
        sql: `
            SELECT
                table_comment AS comment,
                engine AS engine,
                table_collation AS collation,
                create_options AS options
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_name = ?
        `,
        params: [tableName],
    });

    return rows[0];
}

export function useMySqlSchemaHelper(deps: MySqlSchemaHelperDeps) {
    function mapMySqlColumns(rows: MySqlColumnRow[]) {
        let primaryKeyOrdinal = 0;

        return rows.map((row, index) => {
            const isPrimaryKey = String(row.columnKey ?? '').toUpperCase() === 'PRI';
            const extra = String(row.extra ?? '').toLowerCase();
            const onUpdateMatch = /on update\s+(.+)$/iu.exec(String(row.extra ?? ''));

            return {
                cid: Math.max(0, Number(row.ordinalPosition ?? index + 1) - 1),
                name: String(row.name ?? ''),
                type: String(row.columnType ?? ''),
                notNull: String(row.isNullable ?? '').toUpperCase() !== 'YES',
                defaultValue: formatMySqlDefaultValue(row.columnType, row.columnDefault),
                isPrimaryKey,
                primaryKeyOrdinal: isPrimaryKey ? ++primaryKeyOrdinal : null,
                isAutoIncrement: extra.includes('auto_increment'),
                comment: deps.normalizeOptionalText(row.comment),
                collation: deps.normalizeOptionalText(row.collation),
                onUpdate: deps.normalizeOptionalText(onUpdateMatch?.[1]),
            } satisfies TableColumnInfo;
        });
    }

    function mapMySqlIndexes(rows: MySqlIndexRow[]) {
        const groups = new Map<string, MySqlIndexRow[]>();

        rows.forEach((row) => {
            const name = String(row.name ?? '').trim();

            if (!name) {
                return;
            }

            const group = groups.get(name) ?? [];
            group.push(row);
            groups.set(name, group);
        });

        return [...groups.entries()].map(([name, group]) => {
            const sortedGroup = [...group].sort((left, right) => Number(left.seqInIndex ?? 0) - Number(right.seqInIndex ?? 0));

            return {
                name,
                columns: sortedGroup.map((row) => String(row.columnName ?? '')),
                orders: sortedGroup.map((row) => normalizeMySqlIndexOrder(row.columnOrder)),
                comment: deps.normalizeOptionalText(sortedGroup[0]?.comment),
                isUnique: Number(sortedGroup[0]?.nonUnique ?? 1) === 0,
                origin: deps.normalizeOptionalText(sortedGroup[0]?.type) ?? 'BTREE',
                isPartial: false,
                type: deps.normalizeOptionalText(sortedGroup[0]?.type),
            };
        });
    }

    function mapMySqlForeignKeys(rows: MySqlForeignKeyRow[]): TableForeignKeyInfo[] {
        const groups = new Map<string, number>();
        let nextId = 0;

        return rows.map((row) => {
            const name = String(row.name ?? '');

            if (!groups.has(name)) {
                groups.set(name, nextId++);
            }

            return {
                id: groups.get(name) ?? 0,
                name,
                sequence: Math.max(0, Number(row.sequence ?? 1) - 1),
                table: String(row.tableName ?? ''),
                from: String(row.fromColumn ?? ''),
                to: String(row.toColumn ?? ''),
                onUpdate: String(row.onUpdate ?? 'NO ACTION'),
                onDelete: String(row.onDelete ?? 'NO ACTION'),
                match: String(row.matchOption ?? 'NONE'),
            } satisfies TableForeignKeyInfo;
        });
    }

    async function getTableMetadata(client: RemoteDriverClient, tableName: string): Promise<Partial<ModifySchemaTable>> {
        const tableInfoRow = await getMySqlTableInfoRow(client, tableName);

        return {
            comment: deps.normalizeOptionalText(tableInfoRow?.comment),
            engine: deps.normalizeOptionalText(tableInfoRow?.engine),
            collation: deps.normalizeOptionalText(tableInfoRow?.collation),
            options: deps.normalizeOptionalText(tableInfoRow?.options),
        } satisfies Partial<ModifySchemaTable>;
    }

    async function queryRowCount(client: RemoteDriverClient, tableName: string) {
        const rows = await client.queryRows<{ count: number | bigint | string }>({
            sql: `SELECT COUNT(*) AS count FROM ${quoteMySqlIdentifier(tableName)}`,
        });

        return normalizeCountValue(rows[0]?.count);
    }

    /** `information_schema.tables.table_rows` is an InnoDB estimate, but it is
     *  instant — the only sane option for tables where COUNT(*) scans gigabytes. */
    async function estimateRowCount(client: RemoteDriverClient, tableName: string) {
        const rows = await client.queryRows<{ count: number | bigint | string | null }>({
            sql: `
                SELECT table_rows AS count
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                  AND table_name = ?
            `,
            params: [tableName],
        });

        return normalizeCountValue(rows[0]?.count);
    }

    async function getTableColumns(client: RemoteDriverClient, tableName: string): Promise<TableColumnInfo[]> {
        return mapMySqlColumns(await getMySqlColumnRows(client, tableName));
    }

    async function getIndexes(client: RemoteDriverClient, tableName: string) {
        return mapMySqlIndexes(await getMySqlIndexRows(client, tableName));
    }

    async function getForeignKeys(client: RemoteDriverClient, tableName: string): Promise<TableForeignKeyInfo[]> {
        return mapMySqlForeignKeys(await getMySqlForeignKeyRows(client, tableName));
    }

    async function getTableNames(client: RemoteDriverClient): Promise<TableSummary[]> {
        const rows = await getMySqlTableRows(client);
        const tableSummaries = rows
            .filter((row) => String(row.type ?? '').toUpperCase() === 'BASE TABLE')
            .map((row) => ({ name: String(row.name ?? '').trim(), estimate: normalizeCountValue(row.tableRows) }))
            .filter((table, index, values) => table.name.length > 0 && values.findIndex((candidate) => candidate.name === table.name) === index)
            .map((table) => {
                const count = resolveListedRowCount(table.estimate);

                return {
                    name: table.name,
                    type: 'table' as const,
                    rowCount: count.rowCount,
                    rowCountIsEstimated: count.rowCountIsEstimated,
                } satisfies TableSummary;
            });
        const seenNames = new Set(tableSummaries.map((table) => table.name.toLowerCase()));
        const viewSummaries = rows
            .filter((row) => String(row.type ?? '').toUpperCase() === 'VIEW')
            .map((row) => String(row.name ?? '').trim())
            .filter((name) => name.length > 0 && !seenNames.has(name.toLowerCase()))
            .map((viewName) => ({
                name: viewName,
                type: 'view' as const,
                rowCount: 0,
            }));

        return [...tableSummaries, ...viewSummaries].sort((left, right) => {
            if (left.type !== right.type) {
                return left.type.localeCompare(right.type);
            }

            return left.name.localeCompare(right.name);
        });
    }

    async function getServerSchemas(client: RemoteDriverClient): Promise<ServerSchemaRecord[]> {
        const rows = await client.queryRows<Record<string, unknown>>({ sql: 'SHOW DATABASES' });
        return rows
            .map((row) => {
                const name = Object.values(row).find((value): value is string => typeof value === 'string' && value.length > 0);
                return name ? { name } : undefined;
            })
            .filter((schema): schema is ServerSchemaRecord => schema !== undefined)
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    async function collectForeignKeyViolationMessages(client: RemoteDriverClient, tableName: string) {
        const foreignKeys = await getForeignKeys(client, tableName);
        const groups = new Map<number, TableForeignKeyInfo[]>();

        for (const foreignKey of foreignKeys) {
            const group = groups.get(foreignKey.id) ?? [];
            group.push(foreignKey);
            groups.set(foreignKey.id, group);
        }

        const messages: string[] = [];

        for (const group of groups.values()) {
            if (group.length === 0) {
                continue;
            }

            const sourceTable = deps.quoteRemoteIdentifier('mysql', tableName);
            const parentTable = deps.quoteRemoteIdentifier('mysql', group[0]!.table);
            const joinConditions = group
                .map((foreignKey) => `source.${deps.quoteRemoteIdentifier('mysql', foreignKey.from)} = parent.${deps.quoteRemoteIdentifier('mysql', foreignKey.to)}`)
                .join(' AND ');
            const nonNullConditions = group.map((foreignKey) => `source.${deps.quoteRemoteIdentifier('mysql', foreignKey.from)} IS NOT NULL`).join(' AND ');
            const missingParentCondition = group.map((foreignKey) => `parent.${deps.quoteRemoteIdentifier('mysql', foreignKey.to)} IS NULL`).join(' AND ');

            const sql = `
                SELECT COUNT(*) AS count
                FROM ${sourceTable} AS source
                LEFT JOIN ${parentTable} AS parent
                  ON ${joinConditions}
                WHERE ${nonNullConditions}
                  AND ${missingParentCondition}
            `;

            const rows = await client.queryRows<{ count: number | bigint | string }>({ sql });
            const count = normalizeCountValue(rows[0]?.count);

            if (count > 0) {
                const sourceColumns = group.map((foreignKey) => foreignKey.from).join(', ');
                const targetColumns = group.map((foreignKey) => foreignKey.to).join(', ');
                messages.push(`${tableName} has ${count} foreign key violation${count === 1 ? '' : 's'} for (${sourceColumns}) -> ${group[0]!.table}(${targetColumns}).`);
            }
        }

        return messages;
    }

    function getTableDdlDeps(): MySqlTableDdlDeps {
        return {
            escapeSqlString: deps.escapeSqlString,
            normalizeOptionalText: deps.normalizeOptionalText,
            quoteIdentifier: (identifier) => deps.quoteRemoteIdentifier('mysql', identifier),
        };
    }

    async function buildModifyTableStatements(client: RemoteDriverClient, tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
        const tableDdlDeps = getTableDdlDeps();
        const currentPrimaryKey = getCurrentPrimaryKey(currentInfo);
        const desiredPrimaryKey = getDesiredPrimaryKey(nextPlan);
        const currentForeignKeys = groupCurrentForeignKeys(currentInfo);
        const queryRunner = getMySqlQueryRunnerClient(client).queryRunner;
        const typeOrmTable = await loadTypeOrmTable(client, tableName);

        if (!typeOrmTable) {
            throw new Error(`Table ${tableName} does not exist.`);
        }

        const preManualStatements: string[] = [];
        const preStatements = await collectSqlMemoryStatements(queryRunner, async () => {
            for (const foreignKey of currentForeignKeys) {
                const desiredForeignKey = nextPlan.foreignKeys.find((entry) => entry.name.toLowerCase() === foreignKey.name.toLowerCase());

                if (!desiredForeignKey || foreignKeySignature(foreignKey) !== foreignKeySignature(desiredForeignKey)) {
                    const typeOrmForeignKey = typeOrmTable.foreignKeys.find((entry) => entry.name?.toLowerCase() === foreignKey.name.toLowerCase());

                    if (typeOrmForeignKey) {
                        await queryRunner.dropForeignKey(typeOrmTable, typeOrmForeignKey);
                    } else {
                        preManualStatements.push(buildDropForeignKeyStatement(tableDdlDeps, tableName, foreignKey.name));
                    }
                }
            }

            if (keySignature(currentPrimaryKey) !== keySignature(desiredPrimaryKey) && currentPrimaryKey) {
                await queryRunner.dropPrimaryKey(typeOrmTable);
            }
        });

        const manualStatements = buildAlterStatements(tableDdlDeps, tableName, currentInfo, nextPlan);
        const postStatements = await collectSqlMemoryStatements(queryRunner, async () => {
            if (desiredPrimaryKey && keySignature(currentPrimaryKey) !== keySignature(desiredPrimaryKey)) {
                await queryRunner.createPrimaryKey(
                    typeOrmTable,
                    desiredPrimaryKey.columns.map((column) => column.columnName)
                );
            }

            for (const foreignKey of nextPlan.foreignKeys) {
                const currentForeignKey = currentForeignKeys.find((entry) => entry.name.toLowerCase() === foreignKey.name.toLowerCase());

                if (!currentForeignKey || foreignKeySignature(currentForeignKey) !== foreignKeySignature(foreignKey)) {
                    await queryRunner.createForeignKey(typeOrmTable, createTypeOrmForeignKey(foreignKey));
                }
            }
        });
        const renameStatements =
            nextPlan.table.name !== tableName
                ? await collectSqlMemoryStatements(queryRunner, async () => {
                      await queryRunner.renameTable(typeOrmTable, nextPlan.table.name);
                  })
                : [];

        return [
            ...preManualStatements,
            ...preStatements,
            ...manualStatements,
            ...postStatements,
            ...buildTableOptionStatements(tableDdlDeps, tableName, currentInfo, nextPlan.table),
            ...renameStatements,
        ];
    }

    return {
        getTableMetadata: getTableMetadata,
        buildReadTableStatement(tableName: string, limit: number, offset: number, orderBy?: SortOrder): RemoteStatement {
            const orderClause = orderBy ? ` ORDER BY ${quoteMySqlIdentifier(orderBy.column)} ${orderBy.direction}` : '';

            return {
                sql:
                    limit < 0
                        ? `SELECT * FROM ${quoteMySqlIdentifier(tableName)}${orderClause}${offset > 0 ? ` LIMIT 18446744073709551615 OFFSET ${offset}` : ''}`
                        : `SELECT * FROM ${quoteMySqlIdentifier(tableName)}${orderClause} LIMIT ${limit} OFFSET ${offset}`,
            };
        },
        buildModifyTableStatements,
        buildWriteValueStatement(tableName: string, targetColumn: string, value: SqlValue, matchColumn: string, matchValue: SqlValue): RemoteStatement {
            return {
                sql: `UPDATE ${quoteMySqlIdentifier(tableName)} SET ${quoteMySqlIdentifier(targetColumn)} = ? WHERE ${quoteMySqlIdentifier(matchColumn)} = ?`,
                params: [value, matchValue],
            };
        },
        collectForeignKeyViolationMessages: collectForeignKeyViolationMessages,
        getForeignKeys: getForeignKeys,
        getIndexes: getIndexes,
        getServerSchemas: getServerSchemas,
        getTableColumns: getTableColumns,
        getTableNames: getTableNames,
        queryRowCount: queryRowCount,
        estimateRowCount: estimateRowCount,
        buildCreateDatabaseStatement(databaseName: string, collation?: string): string {
            const quotedName = quoteMySqlIdentifier(databaseName);
            const collationClause = collation ? ` COLLATE ${collation}` : '';
            return `CREATE DATABASE ${quotedName}${collationClause}`;
        },
    } satisfies RemoteDriverHelper & {
        collectForeignKeyViolationMessages: typeof collectForeignKeyViolationMessages;
    };
}

export function useMySqlDriverTools(deps: MySqlDriverToolsDeps): DriverTools {
    function createRemoteClient(dataSource: DataSource, queryRunner: QueryRunner): MySqlQueryRunnerClient {
        const remoteClient: RemoteDriverClient = {
            queryRows: async <TRow extends Record<string, unknown>>(statement: RemoteStatement) => {
                const rows = await queryRunner.query(statement.sql, statement.params ?? []);
                return Array.isArray(rows) ? (rows as TRow[]) : [];
            },
            queryRowsWithFields: async <TRow extends Record<string, unknown>>(statement: RemoteStatement) => {
                // mysql2 hands back the result fields alongside the rows, but the
                // TypeORM query runner drops them, so query the runner's own
                // connection directly (a second pool connection would deadlock:
                // connectionLimit is 1 and the runner holds that connection).
                const connection = await (queryRunner as unknown as { connect: () => Promise<MySqlNativeConnection> }).connect();
                const [rows, fields] = await connection.promise().query(statement.sql, statement.params ?? []);

                return { columns: (fields ?? []).map((field) => field.name), rows: Array.isArray(rows) ? (rows as TRow[]) : [] };
            },
            execute: async (statement: RemoteStatement) => {
                const result = await queryRunner.query(statement.sql, statement.params ?? []);
                return typeof result === 'object' && result !== null && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
            },
            withTransaction: async <T>(callback: (transactionClient: RemoteDriverClient) => Promise<T>) => {
                try {
                    await queryRunner.startTransaction();
                    const result = await callback(remoteClient);
                    await queryRunner.commitTransaction();
                    return result;
                } catch (error) {
                    try {
                        if (queryRunner.isTransactionActive) {
                            await queryRunner.rollbackTransaction();
                        }
                    } catch {
                        // Some DDL paths autocommit and make rollback unavailable.
                    }

                    throw error;
                }
            },
        };

        return Object.assign(remoteClient, {
            dataSource,
            queryRunner,
            tableCache: new Map<string, Promise<Table | undefined>>(),
        });
    }

    async function withMySqlClient<T>(connectionId: number, callback: (client: RemoteDriverClient) => Promise<T>): Promise<T> {
        return await remoteDataSourcePool.withDataSource(
            connectionPoolKey(connectionId),
            // The target and its secret are only resolved when a new pool entry is needed.
            async () => {
                const target = deps.getRemoteConnectionTarget(connectionId);
                const password = (await deps.readConnectionPassword(connectionId)) ?? '';

                return createMySqlDataSource({
                    host: target.hostname,
                    port: target.port,
                    database: target.database,
                    username: target.username,
                    password,
                });
            },
            (dataSource, queryRunner) => callback(createRemoteClient(dataSource, queryRunner))
        );
    }

    async function withMySqlServerClient<T>(serverId: number, callback: (client: RemoteDriverClient) => Promise<T>): Promise<T> {
        return await remoteDataSourcePool.withDataSource(
            serverPoolKey(serverId),
            // The target and its secret are only resolved when a new pool entry is needed.
            async () => {
                const target = deps.getRemoteServerTarget(serverId);
                const password = (await deps.readServerPassword(serverId)) ?? '';

                return createMySqlDataSource({
                    host: target.hostname,
                    port: target.port,
                    database: target.database,
                    username: target.username,
                    password,
                });
            },
            (dataSource, queryRunner) => callback(createRemoteClient(dataSource, queryRunner))
        );
    }

    async function testConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
        const hostname = params.host?.trim();

        if (!hostname) {
            throw new Error('Host is required to test a server connection.');
        }

        const dataSource = createMySqlDataSource({
            host: hostname,
            port: params.port,
            database: params.databaseName,
            username: params.username,
            password: params.password ?? '',
        });

        await dataSource.initialize();

        try {
            const databaseName = getConnectedDatabaseName(dataSource);

            return {
                ok: true,
                driver: 'mysql',
                message: databaseName ? `Connected to MySQL database ${databaseName}.` : 'Connected to MySQL server.',
            };
        } finally {
            await dataSource.destroy();
        }
    }

    const helper = useMySqlSchemaHelper({
        escapeSqlString: deps.escapeSqlString,
        normalizeOptionalText: deps.normalizeOptionalText,
        quoteRemoteIdentifier: (_, identifier) => quoteMySqlIdentifier(identifier),
    });

    const baseTools = useRemoteDriverTools({
        testConnection,
        withRemoteClient: withMySqlClient,
        withServerClient: withMySqlServerClient,
        resolveServerConnectionId: deps.resolveServerConnectionId,
        normalizeTableName: deps.normalizeTableName,
        normalizeColumnName: deps.normalizeColumnName,
        buildColumnStats: deps.buildColumnStats,
        remoteMutationId: deps.remoteMutationId,
        helper,
        foreignKeyController: {
            disable: async (client) => {
                await client.execute({ sql: 'SET FOREIGN_KEY_CHECKS = 0' });
            },
            enable: async (client) => {
                await client.execute({ sql: 'SET FOREIGN_KEY_CHECKS = 1' });
            },
            collectViolationMessages: (client, tableName) => helper.collectForeignKeyViolationMessages(client, tableName),
        },
        unsupportedForeignKeyDisableMessage: 'Disabling foreign key checks is currently supported only for SQLite and MySQL connections.',
    });

    return {
        ...baseTools,
        async getTableDdl(connectionId: number, tableName: string): Promise<string> {
            return withMySqlClient(connectionId, async (client) => getTableOrViewDdl(client, tableName));
        },
        async validateSql(connectionId: number, sql: string): Promise<void> {
            await withMySqlClient(connectionId, async (client) => {
                const statements = splitSqlStatements(sql);
                const queryRunner = getMySqlQueryRunnerClient(client).queryRunner;
                const variableName = '@danevan_validation_sql';
                const statementName = 'danevan_validate_stmt';

                for (const statement of statements) {
                    await queryRunner.query(`SET ${variableName} = ?`, [statement.replace(/;+$/u, '')]);

                    try {
                        await queryRunner.query(`PREPARE ${statementName} FROM ${variableName}`);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);

                        // PREPARE cannot handle every statement type (e.g. DROP/
                        // ALTER/CREATE TABLE) — don't treat "not supported" as a
                        // syntax error.
                        if (/not supported in the prepared statement protocol/i.test(message)) {
                            continue;
                        }

                        throw error;
                    } finally {
                        try {
                            await queryRunner.query(`DEALLOCATE PREPARE ${statementName}`);
                        } catch {
                            // Ignore cleanup errors when PREPARE itself fails.
                        }
                    }
                }
            });
        },
    } satisfies DriverTools;
}
