import 'reflect-metadata';
import { DataSource, type QueryRunner, type Table, type View } from 'typeorm';
import type { ServerSchemaRecord, SqlValue, TableColumnInfo, TableForeignKeyInfo, TableInfo, TableSummary, TestConnectionParams, TestConnectionResult } from '../shared/types';
import type { DriverTools, RemoteConnectionTarget, SortOrder } from './db-tools.ts';
import { normalizeCountValue, normalizePostgresTableName, preparePostgresStatement, quotePostgresIdentifier } from './dialectSql.ts';
import { mapTypeOrmColumns, mapTypeOrmForeignKeys, mapTypeOrmIndexesWithoutMetadata } from './typeOrmMappers.ts';
import { buildPostgresModifyTableStatements } from './postgresTableDdl.ts';
import { resolveListedRowCount, useRemoteDriverTools, type RemoteDriverClient, type RemoteDriverHelper, type RemoteStatement } from './useRemoteDriverTools.ts';
import { connectionPoolKey, remoteDataSourcePool, serverPoolKey } from './remoteDataSourcePool.ts';
import type { ModifySchemaPlan, ModifySchemaTable } from './useSqliteDriver.ts';

type PostgresSchemaHelperDeps = {
    escapeSqlString: (value: string) => string;
    normalizeOptionalText: (value: string | null | undefined) => string | null;
    quoteIdentifier: (identifier: string) => string;
};

type PostgresDataSourceConfig = {
    host: string;
    port?: number;
    database?: string;
    username?: string;
    password: string;
};

type PostgresDriverToolsDeps = {
    escapeSqlString: (value: string) => string;
    normalizeOptionalText: (value: string | null | undefined) => string | null;
    quoteIdentifier: (identifier: string) => string;
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

type PostgresQueryRunnerClient = RemoteDriverClient & {
    dataSource: DataSource;
    queryRunner: QueryRunner;
    tableCache: Map<string, Promise<Table | undefined>>;
    currentSchema: Promise<string>;
};

type PostgresNativeConnection = {
    query: (sql: string, params?: SqlValue[]) => Promise<Array<Record<string, SqlValue>> | { rows?: Array<Record<string, SqlValue>>; fields?: Array<{ name: string }> }>;
};

type TypeOrmMemoryQueryRunner = QueryRunner & {
    enableSqlMemory(): void;
    disableSqlMemory(): void;
    getMemorySql(): { upQueries: Array<{ query: string }> };
    createTable(table: Table, ifNotExist?: boolean, createForeignKeys?: boolean, createIndices?: boolean): Promise<void>;
    createView(view: View, syncWithMetadata?: boolean): Promise<void>;
    getView(viewPath: string): Promise<View | undefined>;
};

function getPostgresQueryRunnerClient(client: RemoteDriverClient) {
    return client as PostgresQueryRunnerClient;
}

async function loadTypeOrmTable(client: RemoteDriverClient, tableName: string) {
    const queryRunnerClient = getPostgresQueryRunnerClient(client);
    const cacheKey = tableName.toLowerCase();
    const cachedTable = queryRunnerClient.tableCache.get(cacheKey);

    if (cachedTable) {
        return cachedTable;
    }

    const nextTable = queryRunnerClient.queryRunner.getTable(tableName);
    queryRunnerClient.tableCache.set(cacheKey, nextTable);
    return nextTable;
}

async function getCurrentSchema(client: RemoteDriverClient) {
    return getPostgresQueryRunnerClient(client).currentSchema;
}

function getTypeOrmMemoryQueryRunner(queryRunner: QueryRunner) {
    return queryRunner as TypeOrmMemoryQueryRunner;
}

function normalizeMemoryStatements(queryRunner: TypeOrmMemoryQueryRunner) {
    return queryRunner.getMemorySql().upQueries.map(({ query }) => {
        const trimmed = query.trim();
        return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
    });
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

async function getPostgresNativeViewDdl(client: RemoteDriverClient, tableName: string) {
    const currentSchema = await getCurrentSchema(client);
    const qualifiedName = tableName.includes('.') ? tableName : `${currentSchema}.${tableName}`;
    const rows = await client.queryRows<{ definition: string | null }>({
        sql: 'SELECT pg_get_viewdef(?::regclass, true) AS definition',
        params: [qualifiedName],
    });
    const definition = rows[0]?.definition?.trim();

    if (!definition) {
        return undefined;
    }

    return `CREATE VIEW ${quotePostgresIdentifier(tableName)} AS\n${definition}${definition.endsWith(';') ? '' : ';'}`;
}

async function getTableOrViewDdl(client: RemoteDriverClient, tableName: string) {
    const queryRunner = getPostgresQueryRunnerClient(client).queryRunner;
    const table = await loadTypeOrmTable(client, tableName);

    if (table) {
        const statements = await collectSqlMemoryStatements(queryRunner, async (memoryRunner) => {
            await memoryRunner.createTable(table, false, true, true);
        });

        return statements.join('\n');
    }

    const view = await getTypeOrmMemoryQueryRunner(queryRunner).getView(tableName);

    if (view) {
        const nativeViewDdl = await getPostgresNativeViewDdl(client, tableName);

        if (nativeViewDdl) {
            return nativeViewDdl;
        }

        const statements = await collectSqlMemoryStatements(queryRunner, async (memoryRunner) => {
            await memoryRunner.createView(view, false);
        });

        return statements.join('\n');
    }

    throw new Error(`Table '${tableName}' was not found.`);
}

function createPostgresDataSource(config: PostgresDataSourceConfig) {
    return new DataSource({
        type: 'postgres',
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
            max: 1,
            idleTimeoutMillis: 5_000,
            connectionTimeoutMillis: 10_000,
        },
    });
}

function getConnectedDatabaseName(dataSource: DataSource) {
    const driver = dataSource.driver as { database?: string | null };
    const databaseName = driver.database?.trim();

    return databaseName && databaseName.length > 0 ? databaseName : null;
}

export function usePostgresSchemaHelper(deps: PostgresSchemaHelperDeps) {
    async function getTableMetadata(client: RemoteDriverClient, tableName: string): Promise<Partial<ModifySchemaTable>> {
        const table = await loadTypeOrmTable(client, tableName);

        return {
            comment: deps.normalizeOptionalText(table?.comment),
            engine: null,
            collation: null,
            options: null,
        } satisfies Partial<ModifySchemaTable>;
    }

    async function getTableColumns(client: RemoteDriverClient, tableName: string): Promise<TableColumnInfo[]> {
        const table = await loadTypeOrmTable(client, tableName);

        return table ? mapTypeOrmColumns(table, deps.normalizeOptionalText) : [];
    }

    async function getIndexes(client: RemoteDriverClient, tableName: string): Promise<TableInfo['indexes']> {
        const table = await loadTypeOrmTable(client, tableName);

        return table ? mapTypeOrmIndexesWithoutMetadata(table.indices, table.uniques, deps.normalizeOptionalText) : [];
    }

    async function getForeignKeys(client: RemoteDriverClient, tableName: string): Promise<TableForeignKeyInfo[]> {
        const table = await loadTypeOrmTable(client, tableName);

        return table ? mapTypeOrmForeignKeys(table.foreignKeys) : [];
    }

    async function queryRowCount(client: RemoteDriverClient, tableName: string) {
        const rows = await client.queryRows<{ count: number | bigint | string }>({
            sql: `SELECT COUNT(*) AS count FROM ${deps.quoteIdentifier(tableName)}`,
        });

        return normalizeCountValue(rows[0]?.count);
    }

    /** `pg_class.reltuples` is the planner's estimate: instantly available, and the
     *  only affordable source for tables where COUNT(*) scans the whole relation. */
    async function estimateRowCount(client: RemoteDriverClient, tableName: string) {
        const rows = await client.queryRows<{ count: number | bigint | string | null }>({
            sql: `
                SELECT GREATEST(COALESCE(c.reltuples, 0), 0)::bigint AS count
                FROM pg_class AS c
                INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
                WHERE n.nspname = current_schema()
                  AND c.relname = ?
            `,
            params: [tableName],
        });

        return normalizeCountValue(rows[0]?.count);
    }

    async function getTableNames(client: RemoteDriverClient): Promise<TableSummary[]> {
        const queryRunner = getPostgresQueryRunnerClient(client).queryRunner;
        const currentSchema = await getCurrentSchema(client);
        const [tables, views, estimates] = await Promise.all([
            queryRunner.getTables(),
            queryRunner.getViews(),
            client.queryRows<{ name: string | null; count: number | bigint | string | null }>({
                sql: `
                    SELECT c.relname AS name, GREATEST(COALESCE(c.reltuples, 0), 0)::bigint AS count
                    FROM pg_class AS c
                    INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
                    WHERE n.nspname = current_schema()
                      AND c.relkind IN ('r', 'p')
                `,
            }),
        ]);
        const schemaTables = tables.filter((table) => table.schema === currentSchema);
        const schemaViews = views.filter((view) => view.schema === currentSchema);
        const estimateByName = new Map(estimates.map((row) => [String(row.name ?? ''), normalizeCountValue(row.count)]));
        const tableRows = schemaTables.map((table) => {
            const name = normalizePostgresTableName(table);
            const count = resolveListedRowCount(estimateByName.get(name));

            return {
                name,
                type: 'table' as const,
                rowCount: count.rowCount,
                rowCountIsEstimated: count.rowCountIsEstimated,
            } satisfies TableSummary;
        });
        const viewRows = schemaViews.map((view) => ({
            name: normalizePostgresTableName(view),
            type: 'view' as const,
            rowCount: 0,
        }));

        return [...tableRows, ...viewRows].sort((left, right) => {
            if (left.type !== right.type) {
                return left.type.localeCompare(right.type);
            }

            return left.name.localeCompare(right.name);
        });
    }

    async function getServerSchemas(client: RemoteDriverClient): Promise<ServerSchemaRecord[]> {
        const schemas = await getPostgresQueryRunnerClient(client).queryRunner.getDatabases();

        return schemas.map((name) => ({ name })).sort((left, right) => left.name.localeCompare(right.name));
    }

    function buildModifyTableStatements(_client: RemoteDriverClient, tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
        return buildPostgresModifyTableStatements(deps, tableName, currentInfo, nextPlan);
    }

    return {
        buildReadTableStatement(tableName: string, limit: number, offset: number, orderBy?: SortOrder): RemoteStatement {
            const orderClause = orderBy ? ` ORDER BY ${deps.quoteIdentifier(orderBy.column)} ${orderBy.direction}` : '';

            return {
                sql:
                    limit < 0
                        ? `SELECT * FROM ${deps.quoteIdentifier(tableName)}${orderClause}${offset > 0 ? ` OFFSET ${offset}` : ''}`
                        : `SELECT * FROM ${deps.quoteIdentifier(tableName)}${orderClause} LIMIT ${limit} OFFSET ${offset}`,
            };
        },
        getTableMetadata,
        buildModifyTableStatements,
        buildWriteValueStatement(tableName: string, targetColumn: string, value: SqlValue, matchColumn: string, matchValue: SqlValue): RemoteStatement {
            return {
                sql: `UPDATE ${deps.quoteIdentifier(tableName)} SET ${deps.quoteIdentifier(targetColumn)} = ? WHERE ${deps.quoteIdentifier(matchColumn)} = ?`,
                params: [value, matchValue],
            };
        },
        getForeignKeys,
        getIndexes,
        getServerSchemas,
        getTableColumns,
        getTableNames,
        queryRowCount: queryRowCount,
        estimateRowCount: estimateRowCount,
        buildCreateDatabaseStatement(databaseName: string, _collation?: string): string {
            return `CREATE DATABASE ${deps.quoteIdentifier(databaseName)}`;
        },
    } satisfies RemoteDriverHelper;
}

export function usePostgresDriverTools(deps: PostgresDriverToolsDeps): DriverTools {
    function createRemoteClient(dataSource: DataSource, queryRunner: QueryRunner): PostgresQueryRunnerClient {
        const remoteClient: RemoteDriverClient = {
            queryRows: async <TRow extends Record<string, unknown>>(statement: RemoteStatement) => {
                const prepared = preparePostgresStatement(statement);
                const rows = await queryRunner.query(prepared.sql, prepared.params);
                return Array.isArray(rows) ? (rows as TRow[]) : [];
            },
            queryRowsWithFields: async <TRow extends Record<string, unknown>>(statement: RemoteStatement) => {
                // pg reports the result fields, but the TypeORM query runner keeps
                // only the rows; the runner's own client has both (the pool is
                // limited to a single connection, so it must not be borrowed twice).
                const prepared = preparePostgresStatement(statement);
                const connection = await (queryRunner as unknown as { connect: () => Promise<PostgresNativeConnection> }).connect();
                const result = await connection.query(prepared.sql, prepared.params);

                if (Array.isArray(result)) {
                    return { columns: [], rows: result as TRow[] };
                }

                return { columns: (result.fields ?? []).map((field) => field.name), rows: (result.rows ?? []) as TRow[] };
            },
            execute: async (statement: RemoteStatement) => {
                const prepared = preparePostgresStatement(statement);
                const result = await queryRunner.query(prepared.sql, prepared.params);
                return Array.isArray(result) ? {} : result;
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
            currentSchema: queryRunner.getCurrentSchema().then((schema) => schema ?? 'public'),
        });
    }

    async function withPostgresClient<T>(connectionId: number, callback: (client: RemoteDriverClient) => Promise<T>): Promise<T> {
        return await remoteDataSourcePool.withDataSource(
            connectionPoolKey(connectionId),
            // The target and its secret are only resolved when a new pool entry is needed.
            async () => {
                const target = deps.getRemoteConnectionTarget(connectionId);
                const password = (await deps.readConnectionPassword(connectionId)) ?? '';

                return createPostgresDataSource({
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

    async function withPostgresServerClient<T>(serverId: number, callback: (client: RemoteDriverClient) => Promise<T>): Promise<T> {
        return await remoteDataSourcePool.withDataSource(
            serverPoolKey(serverId),
            // The target and its secret are only resolved when a new pool entry is needed.
            async () => {
                const target = deps.getRemoteServerTarget(serverId);
                const password = (await deps.readServerPassword(serverId)) ?? '';

                return createPostgresDataSource({
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

        const dataSource = createPostgresDataSource({
            host: hostname,
            port: params.port,
            database: params.databaseName,
            username: params.username,
            password: params.password ?? '',
        });

        await dataSource.initialize();

        try {
            return {
                ok: true,
                driver: 'postgresql',
                message: getConnectedDatabaseName(dataSource) ? `Connected to PostgreSQL database ${getConnectedDatabaseName(dataSource)}.` : 'Connected to PostgreSQL server.',
            };
        } finally {
            await dataSource.destroy();
        }
    }

    const baseTools = useRemoteDriverTools({
        testConnection: testConnection,
        withRemoteClient: withPostgresClient,
        withServerClient: withPostgresServerClient,
        resolveServerConnectionId: deps.resolveServerConnectionId,
        normalizeTableName: deps.normalizeTableName,
        normalizeColumnName: deps.normalizeColumnName,
        buildColumnStats: deps.buildColumnStats,
        remoteMutationId: deps.remoteMutationId,
        helper: usePostgresSchemaHelper({
            escapeSqlString: deps.escapeSqlString,
            normalizeOptionalText: deps.normalizeOptionalText,
            quoteIdentifier: deps.quoteIdentifier,
        }),
        unsupportedForeignKeyDisableMessage: 'Disabling foreign key checks is currently supported only for SQLite and MySQL connections.',
    });

    return {
        ...baseTools,
        async getTableDdl(connectionId: number, tableName: string): Promise<string> {
            return withPostgresClient(connectionId, async (client) => getTableOrViewDdl(client, tableName));
        },
        async validateSql(connectionId: number, sql: string): Promise<void> {
            await withPostgresClient(connectionId, async (client) => {
                const queryRunner = getPostgresQueryRunnerClient(client).queryRunner;
                const prepared = preparePostgresStatement({ sql });

                await queryRunner.startTransaction();

                try {
                    await queryRunner.query(prepared.sql, prepared.params);
                } finally {
                    if (queryRunner.isTransactionActive) {
                        await queryRunner.rollbackTransaction();
                    }
                }
            });
        },
    } satisfies DriverTools;
}
