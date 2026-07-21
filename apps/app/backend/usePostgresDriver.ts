import type { DriverTools, RemoteConnectionTarget, SortOrder } from '@backend/db-tools.ts';
import { getTypeOrmObjectBaseName, mapTypeOrmColumns, mapTypeOrmForeignKeys, mapTypeOrmIndexesWithoutMetadata } from '@backend/typeOrmMappers.ts';
import { prepareTypeOrmParameterizedStatement } from '@backend/typeOrmStatementParameters.ts';
import { useMySqlSchemaHelper } from '@backend/useMySqlDriver.ts';
import { useRemoteDriverTools, type RemoteDriverClient, type RemoteDriverHelper, type RemoteStatement } from '@backend/useRemoteDriverTools.ts';
import type { ModifySchemaForeignKey, ModifySchemaIndex, ModifySchemaKey, ModifySchemaPlan, ModifySchemaTable } from '@backend/useSqliteDriver.ts';
import type { ServerSchemaRecord, SqlValue, TableColumnInfo, TableForeignKeyInfo, TableInfo, TableSummary, TestConnectionParams, TestConnectionResult } from '@utils/appClient';
import 'reflect-metadata';
import { DataSource, type QueryRunner, type Table, type View } from 'typeorm';

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

function normalizePostgresTableName(table: Table | View) {
    return getTypeOrmObjectBaseName(table);
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

function quotePostgresIdentifier(identifier: string) {
    return identifier
        .split('.')
        .map((part) => `"${part.replaceAll('"', '""')}"`)
        .join('.');
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

function preparePostgresStatement(statement: RemoteStatement) {
    const params = statement.params ?? [];
    const prepared = prepareTypeOrmParameterizedStatement(statement.sql, (index) => `$${index + 1}`);

    if (prepared.paramCount !== params.length) {
        throw new Error(`PostgreSQL expected ${prepared.paramCount} parameter(s) but received ${params.length}.`);
    }

    return {
        sql: prepared.sql,
        params,
    };
}

export function usePostgresSchemaHelper(deps: PostgresSchemaHelperDeps) {
    const mysqlSchemaHelper = useMySqlSchemaHelper({
        escapeSqlString: deps.escapeSqlString,
        normalizeOptionalText: deps.normalizeOptionalText,
        quoteRemoteIdentifier: (_, identifier) => deps.quoteIdentifier(identifier),
    });

    function serializeColumns(columns: string[]) {
        return columns.map((columnName) => columnName.toLowerCase()).join('|');
    }

    function serializeIndexColumns(columns: Array<{ columnName: string; order?: string | null }>) {
        return columns.map((column) => `${column.columnName.toLowerCase()}:${(column.order ?? '').toUpperCase()}`).join('|');
    }

    function getDesiredPrimaryKey(plan: ModifySchemaPlan) {
        const explicitPrimary = plan.keys.find((key) => key.isPrimary);

        if (explicitPrimary) {
            return explicitPrimary;
        }

        const primaryColumns = [...plan.columns]
            .filter((column) => column.isPrimaryKey)
            .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
            .map((column) => ({ columnName: column.name }));

        return primaryColumns.length ? ({ name: 'PRIMARY', isPrimary: true, columns: primaryColumns } satisfies ModifySchemaKey) : undefined;
    }

    function getCurrentPrimaryKey(currentInfo: TableInfo) {
        const primaryColumns = [...currentInfo.columns]
            .filter((column) => column.isPrimaryKey)
            .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
            .map((column) => ({ columnName: column.name }));

        return primaryColumns.length ? ({ name: 'PRIMARY', isPrimary: true, columns: primaryColumns } satisfies ModifySchemaKey) : undefined;
    }

    function keySignature(key: Pick<ModifySchemaKey, 'columns'> | undefined) {
        return key ? serializeColumns(key.columns.map((column) => column.columnName)) : '';
    }

    function foreignKeySignature(foreignKey: ModifySchemaForeignKey) {
        return [
            foreignKey.targetTable.toLowerCase(),
            foreignKey.columns.map((column) => `${column.columnName.toLowerCase()}=>${column.targetName.toLowerCase()}`).join('|'),
            (foreignKey.onDelete ?? '').toLowerCase(),
            (foreignKey.onUpdate ?? '').toLowerCase(),
            (foreignKey.match ?? '').toLowerCase(),
        ].join('::');
    }

    function indexSignature(index: ModifySchemaIndex) {
        return [serializeIndexColumns(index.columns), index.isUnique ? '1' : '0', (index.type ?? '').toLowerCase()].join('::');
    }

    function buildIndexColumns(index: ModifySchemaIndex) {
        return index.columns.map((column) => `${deps.quoteIdentifier(column.columnName)}${column.order && column.order !== 'NONE' ? ` ${column.order}` : ''}`).join(', ');
    }

    function groupCurrentForeignKeys(currentInfo: TableInfo) {
        const groups = new Map<string, TableForeignKeyInfo[]>();

        currentInfo.foreignKeys.forEach((foreignKey) => {
            const key = foreignKey.name ?? `${foreignKey.id}`;
            const nextGroup = groups.get(key) ?? [];
            nextGroup.push(foreignKey);
            groups.set(key, nextGroup);
        });

        return [...groups.entries()].map(([name, group]) => ({
            name,
            targetTable: group[0]?.table ?? '',
            columns: [...group].sort((left, right) => left.sequence - right.sequence).map((foreignKey) => ({ columnName: foreignKey.from, targetName: foreignKey.to })),
            onDelete: group[0]?.onDelete ?? null,
            onUpdate: group[0]?.onUpdate ?? null,
            match: group[0]?.match ?? null,
        })) satisfies ModifySchemaForeignKey[];
    }

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

    async function getTableNames(client: RemoteDriverClient): Promise<TableSummary[]> {
        const queryRunner = getPostgresQueryRunnerClient(client).queryRunner;
        const currentSchema = await getCurrentSchema(client);
        const [tables, views] = await Promise.all([queryRunner.getTables(), queryRunner.getViews()]);
        const schemaTables = tables.filter((table) => table.schema === currentSchema);
        const schemaViews = views.filter((view) => view.schema === currentSchema);
        const tableRows = await Promise.all(
            schemaTables.map(async (table) => ({
                name: normalizePostgresTableName(table),
                type: 'table' as const,
                rowCount: await mysqlSchemaHelper.queryRowCount(client, normalizePostgresTableName(table)),
            }))
        );
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
        const nextColumns = nextPlan.columns;
        const quotedTableName = deps.quoteIdentifier(tableName);
        const currentColumnsByName = new Map(currentInfo.columns.map((column) => [column.name, column]));
        const statements: string[] = [];
        const currentPrimaryKey = getCurrentPrimaryKey(currentInfo);
        const desiredPrimaryKey = getDesiredPrimaryKey(nextPlan);
        const currentUniqueKeys = currentInfo.indexes
            .filter((index) => index.isUnique && serializeColumns(index.columns) !== keySignature(currentPrimaryKey))
            .map((index) => ({ name: index.name, isPrimary: false, columns: index.columns.map((columnName) => ({ columnName })) })) satisfies ModifySchemaKey[];
        const currentForeignKeys = groupCurrentForeignKeys(currentInfo);
        const desiredUniqueKeys = nextPlan.keys.filter((key) => !key.isPrimary);
        const desiredStandaloneIndexes = nextPlan.indexes.filter((index) => !nextPlan.keys.some((key) => key.name.toLowerCase() === index.name.toLowerCase()));
        const currentStandaloneIndexes = currentInfo.indexes
            .filter((index) => !index.isUnique)
            .map((index) => ({
                name: index.name,
                comment: null,
                isUnique: index.isUnique,
                type: index.type ?? null,
                columns: index.columns.map((columnName, indexPosition) => ({ columnName, order: index.orders?.[indexPosition] ?? null })),
            })) satisfies ModifySchemaIndex[];

        currentForeignKeys.forEach((foreignKey) => {
            const desiredForeignKey = nextPlan.foreignKeys.find((entry) => entry.name.toLowerCase() === foreignKey.name.toLowerCase());

            if (!desiredForeignKey || foreignKeySignature(foreignKey) !== foreignKeySignature(desiredForeignKey)) {
                statements.push(`ALTER TABLE ${quotedTableName} DROP CONSTRAINT ${deps.quoteIdentifier(foreignKey.name)};`);
            }
        });

        currentUniqueKeys.forEach((key) => {
            const desiredKey = desiredUniqueKeys.find((entry) => entry.name.toLowerCase() === key.name.toLowerCase());

            if (!desiredKey || keySignature(key) !== keySignature(desiredKey)) {
                statements.push(`ALTER TABLE ${quotedTableName} DROP CONSTRAINT ${deps.quoteIdentifier(key.name)};`);
            }
        });

        currentStandaloneIndexes.forEach((index) => {
            const desiredIndex = desiredStandaloneIndexes.find((entry) => entry.name.toLowerCase() === index.name.toLowerCase());

            if (!desiredIndex || indexSignature(index) !== indexSignature(desiredIndex)) {
                statements.push(`DROP INDEX ${deps.quoteIdentifier(index.name)};`);
            }
        });

        if (keySignature(currentPrimaryKey) !== keySignature(desiredPrimaryKey) && currentPrimaryKey) {
            statements.push(`ALTER TABLE ${quotedTableName} DROP CONSTRAINT ${deps.quoteIdentifier(`${tableName}_pkey`)};`);
        }

        statements.push(...mysqlSchemaHelper.buildDropColumnStatements(tableName, currentInfo, nextColumns).map((statement) => statement.replaceAll('`', '"')));

        nextColumns.forEach((column) => {
            const currentColumn = column.originalName ? currentColumnsByName.get(column.originalName) : undefined;
            const quotedCurrentName = currentColumn ? deps.quoteIdentifier(currentColumn.name) : undefined;
            const quotedNextName = deps.quoteIdentifier(column.name);

            if (!currentColumn) {
                const definitionParts = [quotedNextName, column.type];

                if (column.collation) {
                    definitionParts.push(`COLLATE ${deps.quoteIdentifier(column.collation)}`);
                }

                if (column.isAutoIncrement) {
                    definitionParts.push('GENERATED BY DEFAULT AS IDENTITY');
                }

                if (column.defaultValue) {
                    definitionParts.push(`DEFAULT ${column.defaultValue}`);
                }

                if (column.notNull) {
                    definitionParts.push('NOT NULL');
                }

                statements.push(`ALTER TABLE ${quotedTableName} ADD COLUMN ${definitionParts.join(' ')};`);

                if (column.comment) {
                    statements.push(`COMMENT ON COLUMN ${quotedTableName}.${quotedNextName} IS ${deps.escapeSqlString(column.comment)};`);
                }

                return;
            }

            if (column.collation !== deps.normalizeOptionalText(currentColumn.collation)) {
                throw new Error(`PostgreSQL does not support changing collation for existing column ${currentColumn.name} here.`);
            }

            if (column.isAutoIncrement !== currentColumn.isAutoIncrement) {
                throw new Error(`PostgreSQL identity changes for column ${currentColumn.name} are not supported in Modify Table yet.`);
            }

            if (column.name !== currentColumn.name) {
                statements.push(`ALTER TABLE ${quotedTableName} RENAME COLUMN ${quotedCurrentName} TO ${quotedNextName};`);
            }

            if (column.type !== currentColumn.type) {
                statements.push(`ALTER TABLE ${quotedTableName} ALTER COLUMN ${quotedNextName} TYPE ${column.type};`);
            }

            if (column.defaultValue !== deps.normalizeOptionalText(currentColumn.defaultValue)) {
                statements.push(
                    column.defaultValue
                        ? `ALTER TABLE ${quotedTableName} ALTER COLUMN ${quotedNextName} SET DEFAULT ${column.defaultValue};`
                        : `ALTER TABLE ${quotedTableName} ALTER COLUMN ${quotedNextName} DROP DEFAULT;`
                );
            }

            if (column.notNull !== currentColumn.notNull) {
                statements.push(
                    column.notNull
                        ? `ALTER TABLE ${quotedTableName} ALTER COLUMN ${quotedNextName} SET NOT NULL;`
                        : `ALTER TABLE ${quotedTableName} ALTER COLUMN ${quotedNextName} DROP NOT NULL;`
                );
            }

            if (column.comment !== deps.normalizeOptionalText(currentColumn.comment)) {
                statements.push(`COMMENT ON COLUMN ${quotedTableName}.${quotedNextName} IS ${column.comment ? deps.escapeSqlString(column.comment) : 'NULL'};`);
            }
        });

        if (desiredPrimaryKey && keySignature(currentPrimaryKey) !== keySignature(desiredPrimaryKey)) {
            statements.push(`ALTER TABLE ${quotedTableName} ADD PRIMARY KEY (${desiredPrimaryKey.columns.map((column) => deps.quoteIdentifier(column.columnName)).join(', ')});`);
        }

        desiredUniqueKeys.forEach((key) => {
            const currentKey = currentUniqueKeys.find((entry) => entry.name.toLowerCase() === key.name.toLowerCase());

            if (!currentKey || keySignature(currentKey) !== keySignature(key)) {
                statements.push(
                    `ALTER TABLE ${quotedTableName} ADD CONSTRAINT ${deps.quoteIdentifier(key.name)} UNIQUE (${key.columns.map((column) => deps.quoteIdentifier(column.columnName)).join(', ')});`
                );
            }
        });

        desiredStandaloneIndexes.forEach((index) => {
            const currentIndex = currentStandaloneIndexes.find((entry) => entry.name.toLowerCase() === index.name.toLowerCase());

            if (!currentIndex || indexSignature(currentIndex) !== indexSignature(index)) {
                statements.push(
                    `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${deps.quoteIdentifier(index.name)}${index.type ? ` USING ${index.type}` : ''} ON ${quotedTableName} (${buildIndexColumns(index)});`
                );
            }
        });

        nextPlan.foreignKeys.forEach((foreignKey) => {
            const currentForeignKey = currentForeignKeys.find((entry) => entry.name.toLowerCase() === foreignKey.name.toLowerCase());

            if (!currentForeignKey || foreignKeySignature(currentForeignKey) !== foreignKeySignature(foreignKey)) {
                const clauses = [
                    `ALTER TABLE ${quotedTableName} ADD CONSTRAINT ${deps.quoteIdentifier(foreignKey.name)}`,
                    `FOREIGN KEY (${foreignKey.columns.map((column) => deps.quoteIdentifier(column.columnName)).join(', ')})`,
                    `REFERENCES ${deps.quoteIdentifier(foreignKey.targetTable)} (${foreignKey.columns.map((column) => deps.quoteIdentifier(column.targetName)).join(', ')})`,
                ];

                if (foreignKey.match && foreignKey.match !== 'none') {
                    clauses.push(`MATCH ${foreignKey.match.toUpperCase()}`);
                }

                if (foreignKey.onDelete) {
                    clauses.push(`ON DELETE ${foreignKey.onDelete.replaceAll('_', ' ').toUpperCase()}`);
                }

                if (foreignKey.onUpdate) {
                    clauses.push(`ON UPDATE ${foreignKey.onUpdate.replaceAll('_', ' ').toUpperCase()}`);
                }

                statements.push(`${clauses.join(' ')};`);
            }
        });

        if ((nextPlan.table.comment ?? '') !== (currentInfo.comment ?? '')) {
            statements.push(`COMMENT ON TABLE ${quotedTableName} IS ${nextPlan.table.comment ? deps.escapeSqlString(nextPlan.table.comment) : 'NULL'};`);
        }

        if (nextPlan.table.name !== tableName) {
            statements.push(`ALTER TABLE ${quotedTableName} RENAME TO ${deps.quoteIdentifier(nextPlan.table.name)};`);
        }

        return statements;
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
        queryRowCount: mysqlSchemaHelper.queryRowCount,
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
        const target = deps.getRemoteConnectionTarget(connectionId);
        const dataSource = createPostgresDataSource({
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

    async function withPostgresServerClient<T>(serverId: number, callback: (client: RemoteDriverClient) => Promise<T>): Promise<T> {
        const target = deps.getRemoteServerTarget(serverId);
        const dataSource = createPostgresDataSource({
            host: target.hostname,
            port: target.port,
            database: target.database,
            username: target.username,
            password: (await deps.readServerPassword(serverId)) ?? '',
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
