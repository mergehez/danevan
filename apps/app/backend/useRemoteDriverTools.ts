import type { DriverTools, NormalizedApplyTableChanges, SortOrder } from '@backend/db-tools.ts';
import type { ModifySchemaPlan, ModifySchemaTable } from '@backend/useSqliteDriver.ts';
import type {
    ApplyTableChangesResult,
    QueryExecutionResult,
    ServerSchemaRecord,
    SqlValue,
    TableColumnInfo,
    TableData,
    TableForeignKeyInfo,
    TableIndexInfo,
    TableInfo,
    TableSummary,
    TestConnectionParams,
    TestConnectionResult,
    UpdateColumnParams,
} from '@utils/appClient';

export type RemoteStatement = {
    sql: string;
    params?: SqlValue[];
};

export type RemoteDriverClient = {
    queryRows: <TRow extends Record<string, unknown>>(statement: RemoteStatement) => Promise<TRow[]>;
    execute: (statement: RemoteStatement) => Promise<Record<string, unknown>>;
    withTransaction: <T>(callback: (client: RemoteDriverClient) => Promise<T>) => Promise<T>;
};

export type RemoteDriverHelper = {
    queryRowCount: (client: RemoteDriverClient, tableName: string) => Promise<number>;
    getTableColumns: (client: RemoteDriverClient, tableName: string) => Promise<TableColumnInfo[]>;
    getIndexes: (client: RemoteDriverClient, tableName: string) => Promise<TableIndexInfo[]>;
    getForeignKeys: (client: RemoteDriverClient, tableName: string) => Promise<TableForeignKeyInfo[]>;
    getTableMetadata?: (client: RemoteDriverClient, tableName: string) => Promise<Partial<ModifySchemaTable>>;
    getTableDdl?: (client: RemoteDriverClient, tableName: string) => Promise<string>;
    getTableNames: (client: RemoteDriverClient) => Promise<TableSummary[]>;
    getServerSchemas: (client: RemoteDriverClient) => Promise<ServerSchemaRecord[]>;
    buildReadTableStatement: (tableName: string, limit: number, offset: number, orderBy?: SortOrder) => RemoteStatement;
    buildWriteValueStatement: (tableName: string, targetColumn: string, value: SqlValue, matchColumn: string, matchValue: SqlValue) => RemoteStatement;
    buildModifyTableStatements: (client: RemoteDriverClient, tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan) => string[] | Promise<string[]>;
};

type RemoteForeignKeyController = {
    disable: (client: RemoteDriverClient) => Promise<void>;
    enable: (client: RemoteDriverClient) => Promise<void>;
    collectViolationMessages: (client: RemoteDriverClient, tableName: string) => Promise<string[]>;
};

type RemoteDriverToolsDeps = {
    testConnection: (params: TestConnectionParams) => Promise<TestConnectionResult>;
    withRemoteClient: <T>(connectionId: number, callback: (client: RemoteDriverClient) => Promise<T>) => Promise<T>;
    withServerClient?: <T>(serverId: number, callback: (client: RemoteDriverClient) => Promise<T>) => Promise<T>;
    resolveServerConnectionId: (serverId: number, connectionId?: number) => number | undefined;
    normalizeTableName: (tableName: string) => string;
    normalizeColumnName: (columnName: string, fieldName: string) => string;
    buildColumnStats: (columns: string[], rows: Array<Record<string, SqlValue>>) => Record<string, number>;
    remoteMutationId: (result: Record<string, unknown>) => number | bigint;
    helper: RemoteDriverHelper;
    foreignKeyController?: RemoteForeignKeyController;
    unsupportedForeignKeyDisableMessage?: string;
};

export function useRemoteDriverTools(deps: RemoteDriverToolsDeps): DriverTools {
    async function readTableData(client: RemoteDriverClient, tableName: string, limit: number, offset: number, orderBy?: SortOrder): Promise<TableData> {
        const [columns, rows, rowCount] = await Promise.all([
            deps.helper.getTableColumns(client, tableName),
            client.queryRows<Record<string, SqlValue>>(deps.helper.buildReadTableStatement(tableName, limit, offset, orderBy)),
            deps.helper.queryRowCount(client, tableName),
        ]);
        const columnNames = columns.map((column) => column.name);

        return {
            columns: columnNames,
            columnStats: deps.buildColumnStats(columnNames, rows),
            rows,
            rowCount,
            limit,
            offset,
        } satisfies TableData;
    }

    async function getTableData(connectionId: number, tableName: string, limit: number, offset: number, orderBy?: SortOrder): Promise<TableData> {
        return deps.withRemoteClient(connectionId, async (client) => readTableData(client, tableName, limit, offset, orderBy));
    }

    return {
        testConnection: deps.testConnection,
        async getTablesFresh(connectionId: number): Promise<TableSummary[]> {
            return deps.withRemoteClient(connectionId, async (client) => deps.helper.getTableNames(client));
        },
        async getTableInfoFresh(connectionId: number, tableName: string): Promise<TableInfo> {
            return deps.withRemoteClient(connectionId, async (client) => {
                const [columns, indexes, foreignKeys, rowCount, tableMetadata] = await Promise.all([
                    deps.helper.getTableColumns(client, tableName),
                    deps.helper.getIndexes(client, tableName),
                    deps.helper.getForeignKeys(client, tableName),
                    deps.helper.queryRowCount(client, tableName),
                    deps.helper.getTableMetadata?.(client, tableName) ?? Promise.resolve({}),
                ]);

                return {
                    name: tableName,
                    columns,
                    indexes,
                    foreignKeys,
                    rowCount,
                    ...tableMetadata,
                } satisfies TableInfo;
            });
        },
        async getTableDdl(connectionId: number, tableName: string): Promise<string> {
            if (!deps.helper.getTableDdl) {
                throw new Error('DDL export is not supported for this driver.');
            }

            return deps.withRemoteClient(connectionId, async (client) => deps.helper.getTableDdl!(client, tableName));
        },
        async listServerSchemas(serverId: number, connectionId?: number): Promise<ServerSchemaRecord[]> {
            const resolvedConnectionId = deps.resolveServerConnectionId(serverId, connectionId);

            if (typeof resolvedConnectionId === 'number') {
                return deps.withRemoteClient(resolvedConnectionId, async (client) => deps.helper.getServerSchemas(client));
            }

            if (deps.withServerClient) {
                return deps.withServerClient(serverId, async (client) => deps.helper.getServerSchemas(client));
            }

            throw new Error('Create at least one connection for this server before refreshing databases.');
        },
        getTableData: getTableData,
        async runQuery(connectionId: number, sql: string, params?: SqlValue[]): Promise<QueryExecutionResult> {
            return deps.withRemoteClient(connectionId, async (client) => {
                const bindings = params ?? [];
                const isRowReturningQuery = /^(select|show|describe|pragma|with|explain)\b/i.test(sql);
                const statement = { sql, params: bindings } satisfies RemoteStatement;

                if (isRowReturningQuery) {
                    const rowArray = await client.queryRows<Record<string, SqlValue>>(statement);
                    const columns = rowArray.length > 0 ? Object.keys(rowArray[0] ?? {}) : [];

                    return {
                        kind: 'rows',
                        columns,
                        columnStats: deps.buildColumnStats(columns, rowArray),
                        rows: rowArray,
                    } satisfies QueryExecutionResult;
                }

                const result = await client.execute(statement);

                return {
                    kind: 'mutation',
                    lastInsertRowid: deps.remoteMutationId(result),
                } satisfies QueryExecutionResult;
            });
        },
        async modifyTable(connectionId: number, tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan): Promise<void> {
            await deps.withRemoteClient(connectionId, async (client) => {
                const statements = await deps.helper.buildModifyTableStatements(client, tableName, currentInfo, nextPlan);

                if (statements.length === 0) {
                    return;
                }

                await client.withTransaction(async (transactionClient) => {
                    for (const statement of statements) {
                        await transactionClient.execute({ sql: statement });
                    }
                });
            });
        },
        async updateColumn(params: UpdateColumnParams): Promise<TableData> {
            const normalizedTableName = deps.normalizeTableName(params.tableName);
            const normalizedTargetColumn = deps.normalizeColumnName(params.targetColumn, 'Target column');
            const normalizedMatchColumn = deps.normalizeColumnName(params.matchColumn, 'Match column');

            return deps.withRemoteClient(params.connectionId, async (client) => {
                await client.execute(deps.helper.buildWriteValueStatement(normalizedTableName, normalizedTargetColumn, params.value, normalizedMatchColumn, params.matchValue));

                return readTableData(client, normalizedTableName, 100, 0);
            });
        },
        async applyTableChanges(params: NormalizedApplyTableChanges): Promise<ApplyTableChangesResult> {
            return deps.withRemoteClient(params.connectionId, async (client) => {
                if (params.disableForeignKeyChecks && !deps.foreignKeyController) {
                    throw new Error(deps.unsupportedForeignKeyDisableMessage ?? 'Disabling foreign key checks is not supported for this driver.');
                }

                if (params.disableForeignKeyChecks) {
                    await deps.foreignKeyController!.disable(client);
                }

                try {
                    await client.withTransaction(async (transactionClient) => {
                        for (const change of params.changes) {
                            await transactionClient.execute(
                                deps.helper.buildWriteValueStatement(params.tableName, change.targetColumn, change.value, change.matchColumn, change.matchValue)
                            );
                        }
                    });

                    return {
                        tableData: await readTableData(client, params.tableName, params.limit, params.offset),
                        foreignKeyViolations: params.disableForeignKeyChecks ? await deps.foreignKeyController!.collectViolationMessages(client, params.tableName) : [],
                    } satisfies ApplyTableChangesResult;
                } finally {
                    if (params.disableForeignKeyChecks) {
                        await deps.foreignKeyController!.enable(client);
                    }
                }
            });
        },
    } satisfies DriverTools;
}
