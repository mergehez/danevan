import type {
    ApplyTableChangesParams,
    ApplyTableChangesResult,
    ConnectionSchemaCache,
    DbType,
    ModifyTableColumnParams,
    ModifyTableForeignKeyParams,
    ModifyTableIndexParams,
    ModifyTableKeyParams,
    ModifyTableParams,
    ModifyTableTableParams,
    QueryExecutionResult,
    ServerSchemaRecord,
    SqlDiagnosticMarker,
    SqlValue,
    TableData,
    TableInfo,
    TableSummary,
    TestConnectionParams,
    TestConnectionResult,
    UpdateColumnParams,
} from '../shared/types';
import { normalizeSqlInputWhitespace } from '../shared/utils/sqlTextNormalization';
import { readServerPassword as readServerPasswordFromKeychain } from './auth.ts';
import { useAppDb } from './db-app.ts';
import { connectionPoolKey, remoteDataSourcePool, serverPoolKey } from './remoteDataSourcePool.ts';
import { statementWrites } from './useRemoteDriverTools.ts';
import { useMsAccessDriverTools } from './useMsAccessDriver.ts';
import { useMsAccessWindowsDriverTools } from './useMsAccessWindowsDriver.ts';
import { useMySqlDriverTools } from './useMySqlDriver.ts';
import { usePostgresDriverTools } from './usePostgresDriver.ts';
import type { ModifySchemaColumn, ModifySchemaForeignKey, ModifySchemaIndex, ModifySchemaKey, ModifySchemaPlan, ModifySchemaTable } from './useSqliteDriver.ts';
import { useSqliteDriverTools } from './useSqliteDriver.ts';
import { useSqlServerDriverTools } from './useSqlServerDriver.ts';

/** Maximum display length used when computing column stats. Prevents expensive
 *  string/JSON conversion on very large values (blobs, long text, etc.). */
const DATA_GRID_MAX_COLUMN_STAT_LENGTH = 500;

const appDb = useAppDb();

type ConnectionContext = {
    connection: ReturnType<typeof appDb.getConnection> extends infer T ? Exclude<T, undefined> : never;
    server: ReturnType<typeof appDb.getServer> extends infer T ? Exclude<T, undefined> : never;
};

export type RemoteConnectionTarget = {
    hostname: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string | (() => Promise<string>);
};

export type NormalizedApplyTableChanges = ReturnType<typeof normalizeApplyTableChanges>;

export type SortOrder = {
    column: string;
    direction: 'ASC' | 'DESC';
};

export type DriverTools = {
    testConnection: (params: TestConnectionParams) => Promise<TestConnectionResult> | TestConnectionResult;
    getTablesFresh: (connectionId: number) => Promise<TableSummary[]>;
    getTableInfoFresh: (connectionId: number, tableName: string) => Promise<TableInfo>;
    /** Every requested table's info (or every table when the list is omitted) from a bounded
     *  number of catalog queries. Drivers that cannot batch it leave this undefined and the
     *  caller falls back to one `getTableInfoFresh` per table. */
    getTableInfosFresh?: (connectionId: number, tableNames?: string[]) => Promise<TableInfo[]>;
    getTableDdl: (connectionId: number, tableName: string) => Promise<string>;
    listServerSchemas: (serverId: number, connectionId?: number) => Promise<ServerSchemaRecord[]>;
    createDatabase?: (serverId: number, databaseName: string, collation?: string) => Promise<void>;
    disconnectConnection?: (connectionId: number) => Promise<void>;
    getTableData: (connectionId: number, tableName: string, limit: number, offset: number, orderBy?: SortOrder, returnQuery?: boolean) => Promise<TableData>;
    runQuery: (connectionId: number, sql: string, params?: SqlValue[]) => Promise<QueryExecutionResult>;
    validateSql?: (connectionId: number, sql: string) => Promise<void>;
    modifyTable: (connectionId: number, tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan) => Promise<void>;
    updateColumn: (params: UpdateColumnParams) => Promise<TableData>;
    applyTableChanges: (params: NormalizedApplyTableChanges) => Promise<ApplyTableChangesResult>;
};

function quoteIdentifier(identifier: string) {
    return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteSqlIdentifier(identifier: string, driver: DbType) {
    return identifier
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            if (driver === 'mysql') {
                return `\`${part.replaceAll('`', '``')}\``;
            }

            if (driver === 'msaccess' || driver === 'sqlserver') {
                return `[${part.replaceAll(']', ']]')}]`;
            }

            return `"${part.replaceAll('"', '""')}"`;
        })
        .join('.');
}

function normalizeTableName(tableName: string) {
    const normalizedTableName = tableName.trim();

    if (!normalizedTableName) {
        throw new Error('Table name is required.');
    }

    return normalizedTableName;
}

function getConnectionDriver(connectionId: number): DbType {
    const connection = appDb.getConnection(connectionId);

    if (!connection) {
        throw new Error('The selected connection could not be found.');
    }

    const server = appDb.getServer(connection.server_id);

    if (!server) {
        throw new Error('The server for the selected connection could not be found.');
    }

    return server.driver;
}

function normalizeColumnName(columnName: string, fieldName: string) {
    const normalizedColumnName = columnName.trim();

    if (!normalizedColumnName) {
        throw new Error(`${fieldName} is required.`);
    }

    return normalizedColumnName;
}

function normalizeOptionalText(value: string | null | undefined) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
}

function escapeSqlString(value: string) {
    return `'${value.replaceAll("'", "''")}'`;
}

function normalizeModifyColumns(columns: ModifyTableColumnParams[]) {
    const normalizedColumns: ModifySchemaColumn[] = columns.map((column) => ({
        originalName: normalizeOptionalText(column.originalName ?? null) ?? undefined,
        name: normalizeColumnName(column.name, 'Column name'),
        type: normalizeColumnName(column.type, `Column type for ${column.name}`),
        notNull: Boolean(column.notNull),
        defaultValue: normalizeOptionalText(column.defaultValue),
        isPrimaryKey: Boolean(column.isPrimaryKey),
        primaryKeyOrdinal: typeof column.primaryKeyOrdinal === 'number' && Number.isFinite(column.primaryKeyOrdinal) ? Math.trunc(column.primaryKeyOrdinal) : null,
        isAutoIncrement: Boolean(column.isAutoIncrement),
        comment: normalizeOptionalText(column.comment),
        collation: normalizeOptionalText(column.collation),
        onUpdate: normalizeOptionalText(column.onUpdate),
        hidden: Boolean(column.hidden),
        columnKind: normalizeOptionalText(column.columnKind ?? null),
    }));

    const seenColumnNames = new Set<string>();

    normalizedColumns.forEach((column) => {
        const lowerName = column.name.toLowerCase();

        if (seenColumnNames.has(lowerName)) {
            throw new Error(`Column ${column.name} is duplicated.`);
        }

        seenColumnNames.add(lowerName);
    });

    return normalizedColumns;
}

function normalizeModifyTableTable(tableName: string, table: ModifyTableTableParams | undefined): ModifySchemaTable {
    return {
        name: normalizeTableName(table?.name ?? tableName),
        comment: normalizeOptionalText(table?.comment),
        engine: normalizeOptionalText(table?.engine),
        collation: normalizeOptionalText(table?.collation),
        options: normalizeOptionalText(table?.options),
    };
}

function normalizeModifyKeys(keys: ModifyTableKeyParams[] | undefined): ModifySchemaKey[] {
    const seenNames = new Set<string>();

    return (keys ?? []).map((key) => {
        const normalizedName = normalizeColumnName(key.name, 'Key name');
        const lowerName = normalizedName.toLowerCase();

        if (seenNames.has(lowerName)) {
            throw new Error(`Key ${normalizedName} is duplicated.`);
        }

        seenNames.add(lowerName);

        const columns = key.columns
            .map((column) => ({
                columnName: normalizeColumnName(column.columnName, `Column name for key ${normalizedName}`),
            }))
            .filter((column, index, columnsList) => columnsList.findIndex((entry) => entry.columnName.toLowerCase() === column.columnName.toLowerCase()) === index);

        if (columns.length === 0) {
            throw new Error(`Key ${normalizedName} must include at least one column.`);
        }

        return {
            originalName: normalizeOptionalText(key.originalName ?? null) ?? undefined,
            name: normalizedName,
            isPrimary: Boolean(key.isPrimary),
            columns,
        } satisfies ModifySchemaKey;
    });
}

function normalizeModifyForeignKeys(foreignKeys: ModifyTableForeignKeyParams[] | undefined): ModifySchemaForeignKey[] {
    const seenNames = new Set<string>();

    return (foreignKeys ?? []).map((foreignKey) => {
        const normalizedName = normalizeColumnName(foreignKey.name, 'Foreign key name');
        const lowerName = normalizedName.toLowerCase();

        if (seenNames.has(lowerName)) {
            throw new Error(`Foreign key ${normalizedName} is duplicated.`);
        }

        seenNames.add(lowerName);

        const columns = foreignKey.columns.map((column) => ({
            columnName: normalizeColumnName(column.columnName, `Column name for foreign key ${normalizedName}`),
            targetName: normalizeColumnName(column.targetName, `Target column name for foreign key ${normalizedName}`),
        }));

        if (columns.length === 0) {
            throw new Error(`Foreign key ${normalizedName} must include at least one column mapping.`);
        }

        return {
            originalName: normalizeOptionalText(foreignKey.originalName ?? null) ?? undefined,
            name: normalizedName,
            targetTable: normalizeTableName(foreignKey.targetTable),
            columns,
            onUpdate: normalizeOptionalText(foreignKey.onUpdate),
            onDelete: normalizeOptionalText(foreignKey.onDelete),
            match: normalizeOptionalText(foreignKey.match),
        } satisfies ModifySchemaForeignKey;
    });
}

function normalizeModifyIndexes(indexes: ModifyTableIndexParams[] | undefined): ModifySchemaIndex[] {
    const seenNames = new Set<string>();

    return (indexes ?? []).map((index) => {
        const normalizedName = normalizeColumnName(index.name, 'Index name');
        const lowerName = normalizedName.toLowerCase();

        if (seenNames.has(lowerName)) {
            throw new Error(`Index ${normalizedName} is duplicated.`);
        }

        seenNames.add(lowerName);

        const columns = index.columns.map((column) => ({
            columnName: normalizeColumnName(column.columnName, `Column name for index ${normalizedName}`),
            order: normalizeOptionalText(column.order),
        }));

        if (columns.length === 0) {
            throw new Error(`Index ${normalizedName} must include at least one column.`);
        }

        return {
            originalName: normalizeOptionalText(index.originalName ?? null) ?? undefined,
            name: normalizedName,
            comment: normalizeOptionalText(index.comment),
            isUnique: Boolean(index.isUnique),
            type: normalizeOptionalText(index.type),
            columns,
        } satisfies ModifySchemaIndex;
    });
}

function normalizeModifyPlan(params: ModifyTableParams): ModifySchemaPlan {
    const columns = normalizeModifyColumns(params.columns);

    if (columns.length === 0) {
        throw new Error('At least one column is required.');
    }

    return {
        table: normalizeModifyTableTable(params.tableName, params.table),
        columns,
        keys: normalizeModifyKeys(params.keys),
        foreignKeys: normalizeModifyForeignKeys(params.foreignKeys),
        indexes: normalizeModifyIndexes(params.indexes),
        allowTableRebuild: Boolean(params.allowTableRebuild),
    } satisfies ModifySchemaPlan;
}

/**
 * A connection's own policy: a read-only connection is there to be looked at, so a statement that
 * writes is refused with the connection named instead of being sent.
 */
function assertConnectionWritable(connectionId: number) {
    const connection = appDb.getConnection(connectionId);

    if (!connection) {
        throw new Error('The selected connection could not be found.');
    }

    if (!connection.readonly) {
        return;
    }

    throw new Error(`The connection "${connection.name}" is read-only, so the write was refused. Allow writes from its sidebar menu to change that.`);
}

function getConnectionContext(connectionId: number): ConnectionContext {
    const connection = appDb.getConnection(connectionId);

    if (!connection) {
        throw new Error('The selected connection could not be found.');
    }

    const server = appDb.getServer(connection.server_id);

    if (!server) {
        throw new Error('The selected server could not be found.');
    }

    return {
        connection,
        server,
    } as ConnectionContext;
}

function getRemoteConnectionTarget(context: ConnectionContext) {
    const hostname = context.connection.host?.trim() || context.server.host?.trim();

    if (!hostname) {
        throw new Error('The selected connection is missing its host.');
    }

    return {
        hostname,
        port: context.connection.port ?? context.server.port,
        database: context.connection.database_name,
        username: context.server.username?.trim() || undefined,
    } satisfies RemoteConnectionTarget;
}

async function readConnectionOrServerPassword(connectionId: number) {
    const connection = appDb.getConnection(connectionId);

    if (!connection) {
        return null;
    }

    return readServerPasswordFromKeychain(connection.server_id);
}

async function readServerPassword(serverId: number) {
    return readServerPasswordFromKeychain(serverId);
}

function getConnectionRemoteTarget(connectionId: number) {
    return getRemoteConnectionTarget(getConnectionContext(connectionId));
}

function getServerRemoteTarget(serverId: number) {
    const server = appDb.getServer(serverId);

    if (!server) {
        throw new Error('The selected server could not be found.');
    }

    if (server.kind !== 'server') {
        throw new Error('The selected server does not support remote schema discovery.');
    }

    const hostname = server.host?.trim();

    if (!hostname) {
        throw new Error('The selected server is missing its host.');
    }

    return {
        hostname,
        port: server.port,
        username: server.username?.trim() || undefined,
    } satisfies RemoteConnectionTarget;
}

function getValueDisplayLength(value: SqlValue | undefined): number {
    if (value == null) {
        return 4; // 'NULL'
    }

    if (typeof value === 'string') {
        return Math.min(value.length, DATA_GRID_MAX_COLUMN_STAT_LENGTH);
    }

    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        return String(value).length;
    }

    if (value instanceof Uint8Array) {
        // Hex representation: "0x" prefix + 2 hex chars per byte
        return Math.min(2 + value.length * 2, DATA_GRID_MAX_COLUMN_STAT_LENGTH);
    }

    // Objects: use a capped JSON representation to avoid expensive
    // stringify on large structured data or nested objects.
    try {
        const text = JSON.stringify(value, (_key, val) => {
            if (typeof val === 'string' && val.length > DATA_GRID_MAX_COLUMN_STAT_LENGTH) {
                return val.slice(0, DATA_GRID_MAX_COLUMN_STAT_LENGTH) + '…';
            }
            return val;
        });
        return Math.min(text?.length ?? 0, DATA_GRID_MAX_COLUMN_STAT_LENGTH);
    } catch {
        return DATA_GRID_MAX_COLUMN_STAT_LENGTH;
    }
}

function buildColumnStats(columns: string[], rows: Array<Record<string, SqlValue>>): Record<string, number> {
    const columnStats = Object.fromEntries(columns.map((columnName) => [columnName, 0])) as Record<string, number>;

    for (const row of rows) {
        for (const columnName of columns) {
            const length = getValueDisplayLength(row?.[columnName]);

            if (length > columnStats[columnName]) {
                columnStats[columnName] = length;
            }
        }
    }

    return columnStats;
}

function getNormalizedPaging(params: { limit?: number; offset?: number }) {
    return {
        limit: typeof params.limit === 'number' && Number.isFinite(params.limit) && params.limit < 0 ? -1 : Math.max(1, Math.min(params.limit ?? 100, 1000)),
        offset: Math.max(0, params.offset ?? 0),
    };
}

function normalizeApplyTableChanges(params: ApplyTableChangesParams) {
    const normalizedTableName = normalizeTableName(params.tableName);
    const changes = params.changes.map((change) => ({
        targetColumn: normalizeColumnName(change.targetColumn, 'Target column'),
        value: change.value,
        matchColumn: normalizeColumnName(change.matchColumn, 'Match column'),
        matchValue: change.matchValue,
    }));

    if (changes.length === 0) {
        throw new Error('At least one change is required.');
    }

    return {
        connectionId: params.connectionId,
        tableName: normalizedTableName,
        changes,
        disableForeignKeyChecks: params.disableForeignKeyChecks === true,
        ...getNormalizedPaging(params),
    };
}

/**
 * Session metadata cache: one entry per connection and table name. A schema sweep (comparison,
 * autocomplete, a foreign-key peek) reads every table at once, and a table's info costs several
 * catalog queries to build, so the sweep pays them once per table per session instead of once per
 * panel open. Nothing survives a schema change: every write path — modify, drop, a writing
 * `runQuery` (which is how a `CREATE TABLE` arrives), apply, refresh, disconnect — invalidates the
 * connection or the table it touched.
 */
const tableInfoCacheByConnection = new Map<number, Map<string, TableInfo>>();

function getTableInfoCache(connectionId: number) {
    let cache = tableInfoCacheByConnection.get(connectionId);

    if (!cache) {
        cache = new Map();
        tableInfoCacheByConnection.set(connectionId, cache);
    }

    return cache;
}

function cacheTableInfo(connectionId: number, info: TableInfo) {
    getTableInfoCache(connectionId).set(normalizeTableName(info.name), info);
}

function invalidateConnectionMetadataCache(connectionId: number) {
    tableInfoCacheByConnection.delete(connectionId);
}

function invalidateTableMetadataCache(connectionId: number, tableName: string) {
    tableInfoCacheByConnection.get(connectionId)?.delete(normalizeTableName(tableName));
}

function invalidateAllMetadataCaches() {
    tableInfoCacheByConnection.clear();
}

/** Fallback for drivers without a batched read: one fresh info per table, in the requested order. */
async function fetchTableInfosOneByOne(tools: DriverTools, connectionId: number, tableNames?: string[]): Promise<TableInfo[]> {
    const names = tableNames ?? (await tools.getTablesFresh(connectionId)).map((table) => table.name);
    const infos: TableInfo[] = [];

    for (const name of names) {
        infos.push(await tools.getTableInfoFresh(connectionId, name));
    }

    return infos;
}

function remoteMutationId(result: Record<string, unknown>) {
    const lastInsertRowid = result.lastInsertRowid;

    if (typeof lastInsertRowid === 'number' || typeof lastInsertRowid === 'bigint') {
        return lastInsertRowid;
    }

    const affectedRows = result.affectedRows;

    if (typeof affectedRows === 'number' || typeof affectedRows === 'bigint') {
        return affectedRows;
    }

    return 0;
}

function resolveServerConnectionId(serverId: number, connectionId?: number): number | undefined {
    const connection = typeof connectionId === 'number' ? appDb.getConnection(connectionId) : appDb.listConnections(serverId)[0];

    return connection?.id;
}

const driverRegistry: Record<DbType, DriverTools> = {
    sqlite: useSqliteDriverTools({
        assertWritable: assertConnectionWritable,
        getConnection: (connectionId) => appDb.getConnection(connectionId),
        getServer: (serverId) => appDb.getServer(serverId),
        listConnections: (serverId) => appDb.listConnections(serverId),
        escapeSqlString,
        quoteIdentifier,
        normalizeTableName,
        normalizeColumnName,
        buildColumnStats,
    }),
    msaccess:
        process.platform === 'win32'
            ? useMsAccessWindowsDriverTools({
                  getConnection: (connectionId) => appDb.getConnection(connectionId),
                  getServer: (serverId) => appDb.getServer(serverId),
                  listConnections: (serverId) => appDb.listConnections(serverId),
                  getUserDataDir: () => appDb.getUserDataDir(),
                  normalizeTableName,
                  normalizeColumnName,
                  buildColumnStats,
              })
            : useMsAccessDriverTools({
                  getConnection: (connectionId) => appDb.getConnection(connectionId),
                  getServer: (serverId) => appDb.getServer(serverId),
                  listConnections: (serverId) => appDb.listConnections(serverId),
                  getUserDataDir: () => appDb.getUserDataDir(),
                  normalizeTableName,
                  normalizeColumnName,
                  buildColumnStats,
              }),
    mysql: useMySqlDriverTools({
        assertWritable: assertConnectionWritable,
        escapeSqlString,
        normalizeOptionalText,
        getRemoteConnectionTarget: getConnectionRemoteTarget,
        getRemoteServerTarget: getServerRemoteTarget,
        resolveServerConnectionId,
        readConnectionPassword: readConnectionOrServerPassword,
        readServerPassword,
        normalizeTableName,
        normalizeColumnName,
        buildColumnStats,
        remoteMutationId,
    }),
    postgresql: usePostgresDriverTools({
        assertWritable: assertConnectionWritable,
        escapeSqlString,
        normalizeOptionalText,
        quoteIdentifier,
        getRemoteConnectionTarget: getConnectionRemoteTarget,
        getRemoteServerTarget: getServerRemoteTarget,
        resolveServerConnectionId,
        readConnectionPassword: readConnectionOrServerPassword,
        readServerPassword,
        normalizeTableName,
        normalizeColumnName,
        buildColumnStats,
        remoteMutationId,
    }),
    sqlserver: useSqlServerDriverTools({
        assertWritable: assertConnectionWritable,
        normalizeOptionalText,
        getRemoteConnectionTarget: getConnectionRemoteTarget,
        getRemoteServerTarget: getServerRemoteTarget,
        resolveServerConnectionId,
        readConnectionPassword: readConnectionOrServerPassword,
        readServerPassword,
        normalizeTableName,
        normalizeColumnName,
        buildColumnStats,
        remoteMutationId,
    }),
};

function getDriverTools(driver: string, kind?: string) {
    function resolveDriverToolKey(driver: string, kind?: string) {
        if (driver === 'sqlite') {
            return 'sqlite';
        }

        if (driver === 'msaccess') {
            return 'msaccess';
        }

        if (kind === 'file') {
            throw new Error(`The '${driver}' file driver is not implemented yet.`);
        }

        const remoteDriverAliases = {
            mysql: 'mysql',
            postgres: 'postgresql',
            postgresql: 'postgresql',
            mssql: 'sqlserver',
            sqlserver: 'sqlserver',
        } as const;
        const normalizedDriver = remoteDriverAliases[driver as keyof typeof remoteDriverAliases];

        if (!normalizedDriver) {
            throw new Error(`The '${driver}' driver is not implemented yet.`);
        }

        return normalizedDriver;
    }

    const toolKey = resolveDriverToolKey(driver, kind);
    const driverTools = driverRegistry[toolKey];

    if (!driverTools) {
        throw new Error(`The '${driver}' driver is not implemented yet.`);
    }

    return driverTools;
}

function getConnectionDriverTools(connectionId: number) {
    const context = getConnectionContext(connectionId);
    return getDriverTools(context.server.driver, context.server.kind);
}

function getMarkerRangeFromOffset(sql: string, startOffset: number, endOffset: number) {
    const safeStart = Math.max(0, Math.min(startOffset, sql.length));
    const safeEnd = Math.max(safeStart + 1, Math.min(Math.max(endOffset, safeStart + 1), sql.length || safeStart + 1));
    let lineNumber = 1;
    let column = 1;
    let startLineNumber = 1;
    let startColumn = 1;
    let endLineNumber = 1;
    let endColumn = 1;

    for (let index = 0; index <= sql.length; index += 1) {
        if (index === safeStart) {
            startLineNumber = lineNumber;
            startColumn = column;
        }

        if (index === safeEnd) {
            endLineNumber = lineNumber;
            endColumn = column;
            break;
        }

        const char = sql[index];

        if (char === '\n') {
            lineNumber += 1;
            column = 1;
        } else {
            column += 1;
        }
    }

    return {
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn,
    };
}

function findTokenOffset(sql: string, token: string) {
    const normalizedToken = token.trim().replace(/^['"`[]+|['"`\]]+$/g, '');

    if (!normalizedToken) {
        return undefined;
    }

    const escapedToken = normalizedToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordMatch = new RegExp(`(?<![A-Za-z0-9_$])${escapedToken}(?![A-Za-z0-9_$])`, 'iu').exec(sql);

    if (wordMatch?.index !== undefined) {
        return {
            startOffset: wordMatch.index,
            endOffset: wordMatch.index + wordMatch[0].length,
        };
    }

    const looseIndex = sql.toLowerCase().indexOf(normalizedToken.toLowerCase());

    if (looseIndex >= 0) {
        return {
            startOffset: looseIndex,
            endOffset: looseIndex + normalizedToken.length,
        };
    }

    return undefined;
}

function inferDatabaseMarkerRange(sql: string, message: string) {
    const tokenPatterns = [
        /no such column:\s*([^\s,;]+)/iu,
        /unknown column\s+'([^']+)'/iu,
        /column\s+"([^"]+)"\s+does not exist/iu,
        /invalid column name\s+'([^']+)'/iu,
        /near\s+"([^"]+)"/iu,
    ];

    for (const pattern of tokenPatterns) {
        const match = pattern.exec(message);
        const token = match?.[1];

        if (!token) {
            continue;
        }

        const offset = findTokenOffset(sql, token);

        if (offset) {
            return getMarkerRangeFromOffset(sql, offset.startOffset, offset.endOffset);
        }
    }

    return {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
    };
}

export const dbTools = {
    async testConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
        return getDriverTools(params.driver, params.kind).testConnection(params);
    },
    async getTables(connectionId: number): Promise<TableSummary[]> {
        return this.getTablesFresh(connectionId);
    },
    async getTablesFresh(connectionId: number): Promise<TableSummary[]> {
        return getConnectionDriverTools(connectionId).getTablesFresh(connectionId);
    },
    async getTableInfo(connectionId: number, tableName: string): Promise<TableInfo> {
        const normalizedTableName = normalizeTableName(tableName);

        return this.getTableInfoFresh(connectionId, normalizedTableName);
    },
    async getTableInfoFresh(connectionId: number, tableName: string): Promise<TableInfo> {
        const normalizedTableName = normalizeTableName(tableName);
        const info = await getConnectionDriverTools(connectionId).getTableInfoFresh(connectionId, normalizedTableName);
        cacheTableInfo(connectionId, info);
        return info;
    },
    /** One call for every table a sweep needs. Answers from the session cache and reads only the
     *  tables it does not hold yet, in one driver call. `refresh` drops what the caller asked for
     *  first, for a sweep that must see the live schema. */
    async getTableInfos(connectionId: number, tableNames?: string[], refresh = false): Promise<TableInfo[]> {
        const tools = getConnectionDriverTools(connectionId);
        const read = (names?: string[]) => (tools.getTableInfosFresh ? tools.getTableInfosFresh(connectionId, names) : fetchTableInfosOneByOne(tools, connectionId, names));

        if (refresh) {
            if (tableNames) {
                for (const name of tableNames) {
                    invalidateTableMetadataCache(connectionId, name);
                }
            } else {
                invalidateConnectionMetadataCache(connectionId);
            }
        }

        if (!tableNames) {
            const infos = await read();

            for (const info of infos) {
                cacheTableInfo(connectionId, info);
            }

            return infos;
        }

        const names = tableNames.map(normalizeTableName);
        const cache = getTableInfoCache(connectionId);
        const missing = names.filter((name) => !cache.has(name));

        if (missing.length) {
            for (const info of await read(missing)) {
                cacheTableInfo(connectionId, info);
            }
        }

        return names.map((name) => {
            const info = cache.get(name);

            if (!info) {
                throw new Error(`Table '${name}' was not found.`);
            }

            return info;
        });
    },
    async getTableDdl(connectionId: number, tableName: string): Promise<string> {
        const normalizedTableName = normalizeTableName(tableName);
        return getConnectionDriverTools(connectionId).getTableDdl(connectionId, normalizedTableName);
    },
    async getServerSchemas(serverId: number): Promise<ServerSchemaRecord[]> {
        const server = appDb.getServer(serverId);

        if (!server) {
            throw new Error('The selected server could not be found.');
        }

        const schemas = await getDriverTools(server.driver, server.kind).listServerSchemas(serverId);
        appDb.updateServerSchemaMetadata(serverId, { schemaCount: schemas.length });
        return schemas;
    },
    async refreshServerSchemas(serverId: number, connectionId?: number): Promise<ServerSchemaRecord[]> {
        const server = appDb.getServer(serverId);

        if (!server) {
            throw new Error('The selected server could not be found.');
        }

        const schemas = await getDriverTools(server.driver, server.kind).listServerSchemas(serverId, connectionId);
        appDb.updateServerSchemaMetadata(serverId, { schemaCount: schemas.length });
        return schemas;
    },
    async createDatabase(serverId: number, databaseName: string, collation?: string): Promise<void> {
        const server = appDb.getServer(serverId);

        if (!server) {
            throw new Error('The selected server could not be found.');
        }

        if (server.kind !== 'server') {
            throw new Error('Creating databases is only supported for server-based entries.');
        }

        const driverTools = getDriverTools(server.driver, server.kind);

        if (!driverTools.createDatabase) {
            throw new Error(`Creating databases is not supported for ${server.driver} servers.`);
        }

        await driverTools.createDatabase(serverId, databaseName, collation);
    },
    async refreshConnectionSchema(connectionId: number): Promise<ConnectionSchemaCache> {
        invalidateConnectionMetadataCache(connectionId);
        const tables = await this.getTablesFresh(connectionId);
        return {
            cachedAt: new Date().toISOString(),
            tables,
            tableInfoByName: {},
        };
    },
    async refreshTableInfo(connectionId: number, tableName: string): Promise<TableInfo> {
        invalidateTableMetadataCache(connectionId, tableName);
        return this.getTableInfoFresh(connectionId, tableName);
    },
    async dropTable(connectionId: number, tableName: string): Promise<ConnectionSchemaCache> {
        const normalizedTableName = normalizeTableName(tableName);
        const driver = getConnectionDriver(connectionId);

        await this.runQuery(connectionId, `DROP TABLE ${quoteSqlIdentifier(normalizedTableName, driver)};`);

        return this.refreshConnectionSchema(connectionId);
    },
    invalidateAllMetadataCaches(): void {
        invalidateAllMetadataCaches();
    },
    async disconnectConnection(connectionId: number): Promise<void> {
        invalidateConnectionMetadataCache(connectionId);
        // Drop the pooled connection first: the driver's own cleanup (SQLite, MS Access)
        // must not run against a data source that is about to be destroyed.
        await remoteDataSourcePool.dispose(connectionPoolKey(connectionId));
        await getConnectionDriverTools(connectionId).disconnectConnection?.(connectionId);
    },
    async disconnectServer(serverId: number): Promise<void> {
        await remoteDataSourcePool.dispose(serverPoolKey(serverId));

        for (const connection of appDb.listConnections(serverId, { includeHidden: true })) {
            invalidateConnectionMetadataCache(connection.id);
            await remoteDataSourcePool.dispose(connectionPoolKey(connection.id));
        }
    },
    async getTableData(connectionId: number, params: { tableName: string; limit?: number; offset?: number; orderBy?: SortOrder; returnQuery?: boolean }): Promise<TableData> {
        const normalizedTableName = normalizeTableName(params.tableName);
        const { limit, offset } = getNormalizedPaging(params);
        return getConnectionDriverTools(connectionId).getTableData(connectionId, normalizedTableName, limit, offset, params.orderBy, params.returnQuery);
    },
    async runQuery(connectionId: number, sql: string, params?: SqlValue[]): Promise<QueryExecutionResult> {
        const normalizedSql = normalizeSqlInputWhitespace(sql).trim();

        if (!normalizedSql) {
            throw new Error('SQL is required.');
        }

        return getConnectionDriverTools(connectionId)
            .runQuery(connectionId, normalizedSql, params)
            .then((result) => {
                // DDL arrives through the editor as a raw statement, so a writing query is the only
                // signal that this connection's cached metadata (a `CREATE`/`ALTER`/`DROP`) is stale.
                if (statementWrites(normalizedSql)) {
                    invalidateConnectionMetadataCache(connectionId);
                }

                return result;
            });
    },
    async validateSql(connectionId: number, sql: string): Promise<SqlDiagnosticMarker[]> {
        const normalizedSql = normalizeSqlInputWhitespace(sql).trim();

        if (!normalizedSql) {
            return [];
        }

        try {
            await getConnectionDriverTools(connectionId).validateSql?.(connectionId, normalizedSql);
            return [];
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const markerRange = inferDatabaseMarkerRange(normalizedSql, message);

            return [
                {
                    message,
                    severity: 'error',
                    ...markerRange,
                    source: 'database',
                },
            ];
        }
    },
    async modifyTable(params: ModifyTableParams): Promise<TableInfo> {
        const normalizedTableName = normalizeTableName(params.tableName);
        const nextPlan = normalizeModifyPlan(params);

        const currentInfo = await this.getTableInfoFresh(params.connectionId, normalizedTableName);

        await getConnectionDriverTools(params.connectionId).modifyTable(params.connectionId, normalizedTableName, currentInfo, nextPlan);

        // A modify can rename a table or change what other tables reference, so the whole
        // connection's metadata is dropped rather than only the table that was edited.
        invalidateConnectionMetadataCache(params.connectionId);
        return this.getTableInfoFresh(params.connectionId, nextPlan.table.name);
    },
    async updateColumn(params: UpdateColumnParams): Promise<TableData> {
        const normalizedTableName = normalizeTableName(params.tableName);
        return getConnectionDriverTools(params.connectionId).updateColumn({
            ...params,
            tableName: normalizedTableName,
        });
    },
    async applyTableChanges(params: ApplyTableChangesParams): Promise<ApplyTableChangesResult> {
        const normalized = normalizeApplyTableChanges(params);
        const result = await getConnectionDriverTools(normalized.connectionId).applyTableChanges(normalized);

        // The schema is unchanged, but the cached row count no longer matches the table.
        invalidateTableMetadataCache(normalized.connectionId, normalized.tableName);
        return result;
    },
};
