import type { DriverTools, RemoteConnectionTarget } from '@backend/db-tools.ts';
import { getTypeOrmObjectBaseName, mapTypeOrmColumns, mapTypeOrmForeignKeys, mapTypeOrmIndexesWithoutMetadata } from '@backend/typeOrmMappers.ts';
import { prepareTypeOrmParameterizedStatement } from '@backend/typeOrmStatementParameters.ts';
import { useRemoteDriverTools, type RemoteDriverClient, type RemoteDriverHelper, type RemoteStatement } from '@backend/useRemoteDriverTools.ts';
import type { ModifySchemaPlan } from '@backend/useSqliteDriver.ts';
import type { ServerSchemaRecord, SqlValue, TableColumnInfo, TableForeignKeyInfo, TableInfo, TableSummary, TestConnectionParams, TestConnectionResult } from '@utils/appClient';
import 'reflect-metadata';
import { DataSource, type QueryRunner, type Table, type View } from 'typeorm';

type SqlServerDataSourceConfig = {
    host: string;
    port?: number;
    database?: string;
    username?: string;
    password: string;
};

type SqlServerDriverToolsDeps = {
    normalizeOptionalText: (value: string | null | undefined) => string | null;
    getRemoteConnectionTarget: (connectionId: number) => RemoteConnectionTarget;
    resolveServerConnectionId: (serverId: number, connectionId?: number) => number;
    readConnectionPassword: (connectionId: number) => Promise<string | null>;
    normalizeTableName: (tableName: string) => string;
    normalizeColumnName: (columnName: string, fieldName: string) => string;
    buildColumnStats: (columns: string[], rows: Array<Record<string, SqlValue>>) => Record<string, number>;
    remoteMutationId: (result: Record<string, unknown>) => number | bigint;
};

type SqlServerQueryRunnerClient = RemoteDriverClient & {
    dataSource: DataSource;
    queryRunner: QueryRunner;
    tableCache: Map<string, Promise<Table | undefined>>;
};

type TypeOrmMemoryQueryRunner = QueryRunner & {
    enableSqlMemory(): void;
    disableSqlMemory(): void;
    getMemorySql(): { upQueries: Array<{ query: string }> };
    createTable(table: Table, ifNotExist?: boolean, createForeignKeys?: boolean, createIndices?: boolean): Promise<void>;
    createView(view: View, syncWithMetadata?: boolean): Promise<void>;
    getView(viewPath: string): Promise<View | undefined>;
};

function getSqlServerQueryRunnerClient(client: RemoteDriverClient) {
    return client as SqlServerQueryRunnerClient;
}

async function loadTypeOrmTable(client: RemoteDriverClient, tableName: string) {
    const queryRunnerClient = getSqlServerQueryRunnerClient(client);
    const cacheKey = tableName.toLowerCase();
    const cachedTable = queryRunnerClient.tableCache.get(cacheKey);

    if (cachedTable) {
        return cachedTable;
    }

    const nextTable = queryRunnerClient.queryRunner.getTable(tableName);
    queryRunnerClient.tableCache.set(cacheKey, nextTable);
    return nextTable;
}

function normalizeSqlServerObjectName(entry: Table | View) {
    const baseName = getTypeOrmObjectBaseName(entry);
    return entry.schema ? `${entry.schema}.${baseName}` : baseName;
}

function quoteSqlServerIdentifier(identifier: string) {
    return identifier
        .split('.')
        .map((part) => `[${part.replaceAll(']', ']]')}]`)
        .join('.');
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

function createSqlServerDataSource(config: SqlServerDataSourceConfig) {
    return new DataSource({
        type: 'mssql',
        host: config.host,
        port: config.port ?? 1433,
        username: config.username,
        password: config.password,
        database: config.database,
        entities: [],
        subscribers: [],
        migrations: [],
        synchronize: false,
        logging: false,
        pool: {
            max: 1,
            min: 0,
            idleTimeoutMillis: 5_000,
        },
        options: {
            trustServerCertificate: true,
            enableArithAbort: true,
        },
        connectionTimeout: 10_000,
        requestTimeout: 30_000,
    });
}

function getConnectedDatabaseName(dataSource: DataSource) {
    const driver = dataSource.driver as { database?: string | null };
    const databaseName = driver.database?.trim();

    return databaseName && databaseName.length > 0 ? databaseName : null;
}

function prepareSqlServerStatement(statement: RemoteStatement) {
    const params = statement.params ?? [];
    const prepared = prepareTypeOrmParameterizedStatement(statement.sql, (index) => `@${index}`);

    if (prepared.paramCount !== params.length) {
        throw new Error(`SQL Server expected ${prepared.paramCount} parameter(s) but received ${params.length}.`);
    }

    return {
        sql: prepared.sql,
        params,
    };
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

async function getSqlServerNativeViewDdl(client: RemoteDriverClient, tableName: string) {
    const rows = await client.queryRows<{ definition: string | null }>({
        sql: 'SELECT OBJECT_DEFINITION(OBJECT_ID(?)) AS definition',
        params: [tableName],
    });
    const definition = rows[0]?.definition?.trim();

    if (!definition) {
        return undefined;
    }

    return definition.endsWith(';') ? definition : `${definition};`;
}

async function getTableOrViewDdl(client: RemoteDriverClient, tableName: string) {
    const queryRunner = getSqlServerQueryRunnerClient(client).queryRunner;
    const table = await loadTypeOrmTable(client, tableName);

    if (table) {
        const statements = await collectSqlMemoryStatements(queryRunner, async (memoryRunner) => {
            await memoryRunner.createTable(table, false, true, true);
        });

        return statements.join('\n');
    }

    const view = await getTypeOrmMemoryQueryRunner(queryRunner).getView(tableName);

    if (view) {
        const nativeViewDdl = await getSqlServerNativeViewDdl(client, tableName);

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

export function useSqlServerSchemaHelper(deps: { normalizeOptionalText: SqlServerDriverToolsDeps['normalizeOptionalText'] }) {
    async function queryRowCount(client: RemoteDriverClient, tableName: string) {
        const rows = await client.queryRows<{ count: number | bigint | string }>({
            sql: `SELECT COUNT(*) AS count FROM ${quoteSqlServerIdentifier(tableName)}`,
        });

        return normalizeCountValue(rows[0]?.count);
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

    async function getTableNames(client: RemoteDriverClient): Promise<TableSummary[]> {
        const queryRunner = getSqlServerQueryRunnerClient(client).queryRunner;
        const [tables, views] = await Promise.all([queryRunner.getTables(), queryRunner.getViews()]);
        const tableRows = await Promise.all(
            tables.map(async (table) => ({
                name: normalizeSqlServerObjectName(table),
                type: 'table' as const,
                rowCount: await queryRowCount(client, normalizeSqlServerObjectName(table)),
            }))
        );
        const viewRows = views.map((view) => ({
            name: normalizeSqlServerObjectName(view),
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
        const schemas = await getSqlServerQueryRunnerClient(client).queryRunner.getDatabases();

        return schemas.map((name) => ({ name })).sort((left, right) => left.name.localeCompare(right.name));
    }

    return {
        buildReadTableStatement(tableName: string, limit: number, offset: number): RemoteStatement {
            return {
                sql:
                    limit < 0
                        ? `SELECT * FROM ${quoteSqlServerIdentifier(tableName)} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS`
                        : `SELECT * FROM ${quoteSqlServerIdentifier(tableName)} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
            };
        },
        buildWriteValueStatement(tableName: string, targetColumn: string, value: SqlValue, matchColumn: string, matchValue: SqlValue): RemoteStatement {
            return {
                sql: `UPDATE ${quoteSqlServerIdentifier(tableName)} SET ${quoteSqlServerIdentifier(targetColumn)} = ? WHERE ${quoteSqlServerIdentifier(matchColumn)} = ?`,
                params: [value, matchValue],
            };
        },
        getForeignKeys,
        getIndexes,
        getServerSchemas,
        getTableColumns,
        getTableNames,
        queryRowCount,
        buildModifyTableStatements(_client: RemoteDriverClient, _tableName: string, _currentInfo: TableInfo, _nextPlan: ModifySchemaPlan): string[] {
            throw new Error('Function not implemented.');
        },
    } satisfies RemoteDriverHelper;
}

export function useSqlServerDriverTools(deps: SqlServerDriverToolsDeps): DriverTools {
    function createRemoteClient(dataSource: DataSource, queryRunner: QueryRunner): SqlServerQueryRunnerClient {
        const remoteClient: RemoteDriverClient = {
            queryRows: async <TRow extends Record<string, unknown>>(statement: RemoteStatement) => {
                const prepared = prepareSqlServerStatement(statement);
                const rows = await queryRunner.query(prepared.sql, prepared.params);
                return Array.isArray(rows) ? (rows as TRow[]) : [];
            },
            execute: async (statement: RemoteStatement) => {
                const prepared = prepareSqlServerStatement(statement);
                const result = await queryRunner.query(prepared.sql, prepared.params);
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
                        // ignore rollback errors
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

    async function withSqlServerClient<T>(connectionId: number, callback: (client: RemoteDriverClient) => Promise<T>) {
        const target = deps.getRemoteConnectionTarget(connectionId);
        const dataSource = createSqlServerDataSource({
            host: target.hostname,
            port: target.port,
            database: target.database,
            username: target.username,
            password: (await deps.readConnectionPassword(connectionId)) ?? '',
        });

        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();

        try {
            return await callback(createRemoteClient(dataSource, queryRunner));
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    }

    async function testConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
        const hostname = params.host?.trim();

        if (!hostname) {
            throw new Error('Host is required to test a server connection.');
        }

        const dataSource = createSqlServerDataSource({
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
                driver: 'sqlserver',
                message: getConnectedDatabaseName(dataSource) ? `Connected to SQL Server database ${getConnectedDatabaseName(dataSource)}.` : 'Connected to SQL Server.',
            } satisfies TestConnectionResult;
        } finally {
            await dataSource.destroy();
        }
    }

    const helper = useSqlServerSchemaHelper({
        normalizeOptionalText: deps.normalizeOptionalText,
    });
    const baseTools = useRemoteDriverTools({
        testConnection,
        withRemoteClient: withSqlServerClient,
        resolveServerConnectionId: deps.resolveServerConnectionId,
        normalizeTableName: deps.normalizeTableName,
        normalizeColumnName: deps.normalizeColumnName,
        buildColumnStats: deps.buildColumnStats,
        remoteMutationId: deps.remoteMutationId,
        helper,
        unsupportedForeignKeyDisableMessage: 'Disabling foreign key checks is currently supported only for SQLite and MySQL connections.',
    });

    return {
        ...baseTools,
        async getTableDdl(connectionId: number, tableName: string): Promise<string> {
            return withSqlServerClient(connectionId, async (client) => getTableOrViewDdl(client, tableName));
        },
        async validateSql(connectionId: number, sql: string): Promise<void> {
            await withSqlServerClient(connectionId, async (client) => {
                const queryRunner = getSqlServerQueryRunnerClient(client).queryRunner;
                const prepared = prepareSqlServerStatement({ sql });

                await queryRunner.query('SET NOEXEC ON');

                try {
                    await queryRunner.query(prepared.sql, prepared.params);
                } finally {
                    await queryRunner.query('SET NOEXEC OFF');
                }
            });
        },
        async modifyTable(_connectionId: number, _tableName: string, _currentInfo: TableInfo, _nextPlan: ModifySchemaPlan): Promise<void> {
            throw new Error('Modify Table is not supported for SQL Server yet.');
        },
    } satisfies DriverTools;
}
