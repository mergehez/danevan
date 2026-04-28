import { deleteConnectionPassword, readConnectionPassword, storeConnectionPassword } from '@backend/auth.ts';
import {
    useAppDb,
    type ConnectionRow,
    type CreateScriptParams,
    type CreateServerParams,
    type ScriptRow,
    type ServerRow,
    type UpdateScriptParams,
    type UpdateServerParams,
} from '@backend/db-app.ts';
import { dbTools } from '@backend/db-tools.ts';
import { formatSql as formatSqlResult, getSqlDiagnostics as getSqlDiagnosticsResult } from '@backend/sqlDiagnostics.ts';
import { inspectMsAccessRuntime } from '@backend/useMsAccessDriver.ts';
import type {
    ApplyTableChangesParams as AppApplyTableChangesParams,
    CreateConnectionParams as AppCreateConnectionParams,
    ApplyTableChangesResult,
    TestConnectionParams as AppTestConnectionParams,
    UpdateConnectionParams as AppUpdateConnectionParams,
    CollectionFilterState,
    ConnectionSchemaCache,
    DbType,
    EditorSettings,
    FormatSqlParams,
    GetSqlDiagnosticsParams,
    GridCustomFormatter,
    GridFormatterState,
    ModifyTableParams,
    MsAccessRuntimeStatus,
    NavigationView,
    PeekFkUsageRelation,
    PeekFkUsageRowsParams,
    PeekFkUsagesParams,
    PeekFkUsagesResult,
    PeekFkUsageSummary,
    QueryExecutionResult,
    ServerSchemaRecord,
    SqlDiagnosticsResult,
    SqlValue,
    TableData,
    TableInfo,
    TableSummary,
    TestConnectionResult,
    UpdateColumnParams,
} from '@utils/appClient';
import { existsSync } from 'fs';

export type AppBootstrapApi = {
    servers: ServerRow[];
    connections: ConnectionRow[];
    scripts: ScriptRow[];
    selectedServerId: number | undefined;
    selectedConnectionId: number | undefined;
    selectedScriptId: number | undefined;
};

const appDb = useAppDb();

function normalizeConnectionPort(port: number | undefined) {
    if (port == null) {
        return undefined;
    }

    if (!Number.isFinite(port)) {
        throw new Error('Port must be a valid number.');
    }

    return Math.trunc(port);
}

function quotePeekSqlIdentifier(identifier: string, driver: DbType) {
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

function bytesToHex(value: Uint8Array) {
    return Array.from(value)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function escapePeekSqlString(value: string) {
    return value.replaceAll("'", "''");
}

function formatPeekSqlValue(value: SqlValue) {
    if (value == null) {
        return 'NULL';
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
    }

    if (value instanceof Uint8Array) {
        return `X'${bytesToHex(value)}'`;
    }

    return `'${escapePeekSqlString(String(value))}'`;
}

function buildPeekMatchPredicate(columnName: string, value: SqlValue, driver: DbType) {
    const identifier = quotePeekSqlIdentifier(columnName, driver);
    return value == null ? `${identifier} IS NULL` : `${identifier} = ${formatPeekSqlValue(value)}`;
}

function buildPeekUsageRelationPredicate(relation: PeekFkUsageRelation, rowValues: Record<string, SqlValue>, driver: DbType) {
    return relation.columns.map(({ sourceColumn, targetColumn }) => buildPeekMatchPredicate(sourceColumn, rowValues[targetColumn] ?? null, driver)).join(' AND ');
}

function groupForeignKeysById(foreignKeys: TableInfo['foreignKeys']) {
    const foreignKeysById = new Map<number, TableInfo['foreignKeys']>();

    for (const foreignKey of foreignKeys) {
        const currentGroup = foreignKeysById.get(foreignKey.id) ?? [];
        currentGroup.push(foreignKey);
        foreignKeysById.set(foreignKey.id, currentGroup);
    }

    return foreignKeysById;
}

async function getPeekUsageRelations(connectionId: number, targetTable: string, targetColumn: string) {
    const tables = await dbTools.getTables(connectionId);
    const tableInfos = await Promise.all(
        tables.map(async (table) => ({
            name: table.name,
            info: await dbTools.getTableInfo(connectionId, table.name),
        }))
    );
    const usages: PeekFkUsageRelation[] = [];

    for (const tableInfo of tableInfos) {
        for (const group of groupForeignKeysById(tableInfo.info.foreignKeys).values()) {
            if (!group.length) {
                continue;
            }

            const sortedGroup = [...group].sort((left, right) => left.sequence - right.sequence);

            if (sortedGroup.some((foreignKey) => foreignKey.table !== targetTable) || !sortedGroup.some((foreignKey) => foreignKey.to === targetColumn)) {
                continue;
            }

            usages.push({
                sourceTable: tableInfo.name,
                targetTable,
                columns: sortedGroup.map((foreignKey) => ({
                    sourceColumn: foreignKey.from,
                    targetColumn: foreignKey.to,
                })),
            });
        }
    }

    return usages.sort(
        (left, right) =>
            left.sourceTable.localeCompare(right.sourceTable) ||
            left.columns
                .map((column) => column.sourceColumn)
                .join(',')
                .localeCompare(right.columns.map((column) => column.sourceColumn).join(','))
    );
}

async function runPeekUsageCountQuery(connectionId: number, driver: DbType, relation: PeekFkUsageRelation, rowValues: Record<string, SqlValue>) {
    return dbTools.runQuery(
        connectionId,
        [
            'SELECT COUNT(*) AS row_count',
            `FROM ${quotePeekSqlIdentifier(relation.sourceTable, driver)}`,
            `WHERE ${buildPeekUsageRelationPredicate(relation, rowValues, driver)}`,
        ].join(' ')
    );
}

async function runPeekUsageRowsQuery(connectionId: number, driver: DbType, params: PeekFkUsageRowsParams) {
    return dbTools.runQuery(
        connectionId,
        [
            'SELECT *',
            `FROM ${quotePeekSqlIdentifier(params.relation.sourceTable, driver)}`,
            `WHERE ${buildPeekUsageRelationPredicate(params.relation, params.rowValues, driver)}`,
            `LIMIT ${params.limit}`,
        ].join(' ')
    );
}

function readPeekUsageRowCount(result: QueryExecutionResult) {
    if (result.kind !== 'rows') {
        return 0;
    }

    const rawValue = result.rows[0]?.row_count;

    if (typeof rawValue === 'number') {
        return Number.isFinite(rawValue) ? rawValue : 0;
    }

    if (typeof rawValue === 'bigint') {
        return rawValue > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(rawValue);
    }

    if (typeof rawValue === 'string') {
        const nextValue = Number(rawValue);
        return Number.isFinite(nextValue) ? nextValue : 0;
    }

    return 0;
}

function getConnectionDriverOrThrow(connectionId: number) {
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

function normalizeTestConnectionPayload(params: AppTestConnectionParams) {
    return {
        kind: params.kind,
        driver: params.driver,
        filePath: params.filePath?.trim(),
        host: params.host?.trim(),
        port: normalizeConnectionPort(params.port),
        databaseName: params.databaseName?.trim(),
        username: params.username?.trim(),
        password: params.password,
    } satisfies AppTestConnectionParams;
}

const defaultEditorSettings: EditorSettings = {
    editors: [],
    defaultEditorPath: undefined,
    queryRowLimit: 100,
    activeView: 'servers',
    collectionFilter: {
        connections: {
            tables: true,
            views: true,
        },
        tables: {
            columns: true,
            keys: true,
            indexes: true,
        },
    },
};

function gridFormatterCollectionKey() {
    return 'gridCustomFormatters';
}

function gridFormatterAssignmentsKey(connectionId: number, tableName: string) {
    return `gridColumnFormatters:${connectionId}:${tableName}`;
}

function normalizeGridCustomFormatters(value: unknown): GridCustomFormatter[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter(
            (formatter): formatter is GridCustomFormatter =>
                !!formatter &&
                typeof formatter === 'object' &&
                typeof (formatter as GridCustomFormatter).id === 'string' &&
                typeof (formatter as GridCustomFormatter).name === 'string' &&
                typeof (formatter as GridCustomFormatter).template === 'string' &&
                typeof (formatter as GridCustomFormatter).createdAt === 'string' &&
                typeof (formatter as GridCustomFormatter).updatedAt === 'string'
        )
        .map((formatter) => ({
            id: formatter.id.trim(),
            name: formatter.name.trim(),
            template: formatter.template,
            // templateType: formatter.templateType,
            createdAt: formatter.createdAt,
            updatedAt: formatter.updatedAt,
        }))
        .filter((formatter) => formatter.id && formatter.name)
        .filter((formatter, index, collection) => collection.findIndex((candidate) => candidate.id === formatter.id) === index)
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
}

function normalizeGridColumnFormatterAssignments(value: unknown, validFormatterIds: string[]) {
    if (!value || typeof value !== 'object') {
        return {} as Record<string, string | undefined>;
    }

    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string' && validFormatterIds.includes(entry[1]))
    );
}

function getGridCustomFormatters() {
    const formatters = normalizeGridCustomFormatters(appDb.getSetting<unknown>(gridFormatterCollectionKey(), []));
    appDb.setSetting(gridFormatterCollectionKey(), formatters);
    return formatters;
}

function getGridFormatterState(connectionId: number, tableName: string): GridFormatterState {
    const formatters = getGridCustomFormatters();
    const columnFormatterIds = normalizeGridColumnFormatterAssignments(
        appDb.getSetting<unknown>(gridFormatterAssignmentsKey(connectionId, tableName), {}),
        formatters.map((formatter) => formatter.id)
    );
    appDb.setSetting(gridFormatterAssignmentsKey(connectionId, tableName), columnFormatterIds);
    return { formatters, columnFormatterIds };
}

function normalizeEditorSettings(value: unknown): EditorSettings {
    if (!value || typeof value !== 'object') {
        return defaultEditorSettings;
    }

    const raw = value as {
        editors?: Array<{ path?: string; label?: string }>;
        defaultEditorPath?: string | undefined;
        queryRowLimit?: number;
        activeView?: NavigationView;
        collectionFilter?: CollectionFilterState;
    };

    const editors = (raw.editors ?? [])
        .filter((editor): editor is { path: string; label?: string } => typeof editor?.path === 'string' && editor.path.trim().length > 0)
        .map((editor) => ({
            path: editor.path,
            label: editor.label?.trim() || editor.path.split('/').pop() || editor.path,
        }))
        .filter((editor, index, collection) => collection.findIndex((candidate) => candidate.path === editor.path) === index);

    const defaultEditorPath = typeof raw.defaultEditorPath === 'string' && editors.some((editor) => editor.path === raw.defaultEditorPath) ? raw.defaultEditorPath : undefined;

    return {
        editors,
        defaultEditorPath,
        queryRowLimit:
            typeof raw.queryRowLimit === 'number' && Number.isFinite(raw.queryRowLimit) ? (raw.queryRowLimit < 0 ? -1 : Math.min(1000, Math.round(raw.queryRowLimit))) : 100,
        activeView: raw.activeView === 'query' || raw.activeView === 'scripts' ? raw.activeView : 'servers',
        collectionFilter: {
            connections: {
                tables: raw.collectionFilter?.connections?.tables ?? true,
                views: raw.collectionFilter?.connections?.views ?? true,
            },
            tables: {
                columns: raw.collectionFilter?.tables?.columns ?? true,
                keys: raw.collectionFilter?.tables?.keys ?? true,
                indexes: raw.collectionFilter?.tables?.indexes ?? true,
            },
        },
    };
}

function normalizeSelectedId(settingKey: string, existingIds: number[]) {
    const selectedId = appDb.getSetting<number | undefined>(settingKey, undefined);

    if (selectedId === undefined) {
        return undefined;
    }

    return existingIds.includes(selectedId) ? selectedId : undefined;
}

async function withTimedAppOperation<T>(label: string, details: Record<string, unknown>, callback: () => Promise<T> | T) {
    const startedAt = performance.now();

    try {
        return await callback();
    } finally {
        const durationMs = Math.round(performance.now() - startedAt);
        console.log(`[perf][app] ${label} ${durationMs}ms ${JSON.stringify(details)}`);
    }
}

async function buildBootstrap(): Promise<AppBootstrapApi> {
    const servers = appDb.listServers();
    const connections = appDb.listConnections();
    const scripts = appDb.listScripts();

    const selectedServerId = normalizeSelectedId(
        'selectedServerId',
        servers.map((server) => server.id)
    );
    const selectedConnectionId = normalizeSelectedId(
        'selectedConnectionId',
        connections.map((connection) => connection.id)
    );
    const selectedScriptId = normalizeSelectedId(
        'selectedScriptId',
        scripts.map((script) => script.id)
    );

    if (selectedServerId === undefined) {
        appDb.setSetting('selectedServerId', servers[0]?.id);
    }

    if (selectedConnectionId === undefined) {
        appDb.setSetting('selectedConnectionId', connections[0]?.id);
    }

    if (selectedScriptId === undefined) {
        appDb.setSetting('selectedScriptId', scripts[0]?.id);
    }

    return {
        servers,
        connections,
        scripts,
        selectedServerId: selectedServerId ?? servers[0]?.id,
        selectedConnectionId: selectedConnectionId ?? connections[0]?.id,
        selectedScriptId: selectedScriptId ?? scripts[0]?.id,
    };
}

function normalizeDriver(driver: string) {
    const normalizedDriver = driver.trim().toLowerCase();

    if (!normalizedDriver) {
        throw new Error('Driver is required.');
    }

    return normalizedDriver as DbType;
}

function normalizeServerPayload(params: CreateServerParams | UpdateServerParams) {
    const name = params.name.trim();

    if (!name) {
        throw new Error('Server name is required.');
    }

    const driver = normalizeDriver(params.driver);

    if (params.kind === 'file') {
        const filePath = params.filePath?.trim();

        if (!filePath) {
            throw new Error('A file path is required for file-based servers.');
        }

        return {
            name,
            kind: params.kind,
            driver,
            filePath,
            host: undefined,
            port: undefined,
        } satisfies CreateServerParams;
    }

    const host = params.host?.trim();

    if (!host) {
        throw new Error('A host is required for server-based entries.');
    }

    return {
        name,
        kind: params.kind,
        driver,
        host,
        port: params.port,
        filePath: undefined,
    } satisfies CreateServerParams;
}

function ensureServerExists(serverId: number) {
    if (!appDb.serverExists(serverId)) {
        throw new Error('The selected server could not be found.');
    }
}

function ensureConnectionExists(connectionId: number) {
    if (!appDb.connectionExists(connectionId)) {
        throw new Error('The selected connection could not be found.');
    }
}

function ensureScriptExists(scriptId: number) {
    if (!appDb.scriptExists(scriptId)) {
        throw new Error('The selected script could not be found.');
    }
}

async function refreshServerSchemasForConnection(serverId: number, connectionId: number) {
    try {
        await dbTools.refreshServerSchemas(serverId, connectionId);
    } catch (error) {
        console.warn('Unable to refresh server schemas after connection update:', error);
    }
}

function normalizeSchemaNames(schemaNames: string[]) {
    const uniqueSchemaNames = new Set<string>();

    for (const schemaName of schemaNames) {
        const normalizedSchemaName = schemaName.trim();

        if (!normalizedSchemaName) {
            continue;
        }

        uniqueSchemaNames.add(normalizedSchemaName);
    }

    return [...uniqueSchemaNames];
}

export const app = {
    getBootstrap: async (): Promise<AppBootstrapApi> => {
        return buildBootstrap();
    },
    getEditorSettings: (): EditorSettings => {
        const nextSettings = normalizeEditorSettings(appDb.getSetting<unknown>('editorSettings', defaultEditorSettings));
        appDb.setSetting('editorSettings', nextSettings);
        return nextSettings;
    },
    updateEditorSettings: (ps: { settings: EditorSettings }): EditorSettings => {
        const nextSettings = normalizeEditorSettings(ps.settings);
        appDb.setSetting('editorSettings', nextSettings);
        return nextSettings;
    },
    getGridCustomFormatters: (): GridCustomFormatter[] => {
        return getGridCustomFormatters();
    },
    getGridFormatterState: (ps: { connectionId: number; tableName: string }): GridFormatterState => {
        return getGridFormatterState(ps.connectionId, ps.tableName.trim());
    },
    saveGridCustomFormatter: (ps: { formatter: Partial<GridCustomFormatter> & { name: string; template: string } }): GridCustomFormatter[] => {
        const name = ps.formatter.name.trim();
        const template = ps.formatter.template;

        if (!name) {
            throw new Error('Formatter name is required.');
        }

        if (!template.trim()) {
            throw new Error('Formatter template is required.');
        }

        const now = new Date().toISOString();
        const current = getGridCustomFormatters();
        const formatterId = ps.formatter.id?.trim() || crypto.randomUUID();
        const existing = current.find((formatter) => formatter.id === formatterId);
        const nextFormatters = normalizeGridCustomFormatters(
            existing
                ? current.map((formatter) => (formatter.id === formatterId ? { ...formatter, name, template, updatedAt: now } : formatter))
                : [...current, { id: formatterId, name, template, createdAt: now, updatedAt: now }]
        );
        appDb.setSetting(gridFormatterCollectionKey(), nextFormatters);
        return nextFormatters;
    },
    deleteGridCustomFormatter: (ps: { formatterId: string }): GridCustomFormatter[] => {
        const formatterId = ps.formatterId.trim();

        if (!formatterId) {
            throw new Error('Formatter id is required.');
        }

        const nextFormatters = getGridCustomFormatters().filter((formatter) => formatter.id !== formatterId);
        appDb.setSetting(gridFormatterCollectionKey(), nextFormatters);
        appDb.deleteSettingsByPrefix('gridColumnFormatters:');
        return nextFormatters;
    },
    setGridColumnFormatter: (ps: { connectionId: number; tableName: string; columnName: string; formatterId?: string }): GridFormatterState => {
        const tableName = ps.tableName.trim();
        const columnName = ps.columnName.trim();

        if (!tableName || !columnName) {
            throw new Error('Table and column are required.');
        }

        const state = getGridFormatterState(ps.connectionId, tableName);
        const formatterId = ps.formatterId?.trim();

        if (formatterId && !state.formatters.some((formatter) => formatter.id === formatterId)) {
            throw new Error('The selected formatter no longer exists.');
        }

        const nextAssignments = { ...state.columnFormatterIds };

        if (formatterId) {
            nextAssignments[columnName] = formatterId;
        } else {
            delete nextAssignments[columnName];
        }

        appDb.setSetting(gridFormatterAssignmentsKey(ps.connectionId, tableName), nextAssignments);
        return { formatters: state.formatters, columnFormatterIds: nextAssignments };
    },
    createServer: async (ps: CreateServerParams) => {
        const nextServer = normalizeServerPayload(ps);
        const serverId = appDb.createServer(nextServer);
        appDb.setSetting('selectedServerId', serverId);
        return buildBootstrap();
    },
    updateServer: async (ps: { serverId: number; server: UpdateServerParams }) => {
        ensureServerExists(ps.serverId);
        appDb.updateServer(ps.serverId, normalizeServerPayload(ps.server));
        return buildBootstrap();
    },
    deleteServer: async (ps: { serverId: number }) => {
        ensureServerExists(ps.serverId);
        for (const connection of appDb.listConnections(ps.serverId)) {
            await dbTools.disconnectConnection(connection.id);
        }
        appDb.deleteSetting(`serverSchemas:${ps.serverId}`);
        appDb.deleteServer(ps.serverId);
        return buildBootstrap();
    },
    reorderServer: async (ps: { serverId: number; toIndex: number }) => {
        ensureServerExists(ps.serverId);
        appDb.reorderServer(ps.serverId, ps.toIndex);
        return buildBootstrap();
    },
    selectServer: async (ps: { serverId: number | undefined }) => {
        if (ps.serverId !== undefined) {
            ensureServerExists(ps.serverId);
        }

        appDb.setSetting('selectedServerId', ps.serverId);
        return buildBootstrap();
    },
    createConnection: async (ps: AppCreateConnectionParams) => {
        ensureServerExists(ps.serverId);
        const connectionId = appDb.createConnection({
            ...ps,
            name: ps.name.trim(),
            host: ps.host?.trim(),
            port: normalizeConnectionPort(ps.port),
            databaseName: ps.databaseName?.trim(),
            username: ps.username?.trim(),
        });

        const password = ps.password?.trim();

        if (password) {
            await storeConnectionPassword(connectionId, `${ps.name.trim()} password`, password);
        }

        await refreshServerSchemasForConnection(ps.serverId, connectionId);

        appDb.setSetting('selectedConnectionId', connectionId);
        return buildBootstrap();
    },
    createConnectionFromServerSchema: async (ps: { serverId: number; schemaName: string }) => {
        ensureServerExists(ps.serverId);

        const schemaName = ps.schemaName.trim();

        if (!schemaName) {
            throw new Error('Schema name is required.');
        }

        const templateConnection = appDb.listConnections(ps.serverId)[0];

        if (!templateConnection) {
            throw new Error('Create at least one connection for this server before showing more databases.');
        }

        const connectionId = appDb.createConnection({
            serverId: ps.serverId,
            name: schemaName,
            host: templateConnection.host,
            port: templateConnection.port,
            databaseName: schemaName,
            username: templateConnection.username,
            readonly: templateConnection.readonly === 1,
        });

        const templatePassword = await readConnectionPassword(templateConnection.id);

        if (templatePassword) {
            await storeConnectionPassword(connectionId, `${schemaName} password`, templatePassword);
        }

        await refreshServerSchemasForConnection(ps.serverId, connectionId);

        appDb.setSetting('selectedConnectionId', connectionId);
        return buildBootstrap();
    },
    setVisibleServerSchemas: async (ps: { serverId: number; schemaNames: string[] }) => {
        ensureServerExists(ps.serverId);

        const schemaNames = normalizeSchemaNames(ps.schemaNames);
        const existingConnections = appDb.listConnections(ps.serverId);
        const existingConnectionsBySchema = new Map(existingConnections.map((connection) => [connection.database_name || connection.name, connection]));
        const templateConnection = existingConnections[0];

        if (!templateConnection && schemaNames.length > 0) {
            throw new Error('Create at least one connection for this server before showing more databases.');
        }

        for (const connection of existingConnections) {
            const schemaName = connection.database_name || connection.name;

            if (schemaNames.includes(schemaName)) {
                continue;
            }

            await deleteConnectionPassword(connection.id);
            appDb.deleteSetting(`connectionSchema:${connection.id}`);
            appDb.deleteConnection(connection.id);
        }

        if (templateConnection) {
            const templatePassword = await readConnectionPassword(templateConnection.id);

            for (const schemaName of schemaNames) {
                if (existingConnectionsBySchema.has(schemaName)) {
                    continue;
                }

                const connectionId = appDb.createConnection({
                    serverId: ps.serverId,
                    name: schemaName,
                    host: templateConnection.host,
                    port: templateConnection.port,
                    databaseName: schemaName,
                    username: templateConnection.username,
                    readonly: templateConnection.readonly === 1,
                });

                if (templatePassword) {
                    await storeConnectionPassword(connectionId, `${schemaName} password`, templatePassword);
                }
            }
        }

        const nextConnections = appDb.listConnections(ps.serverId);
        const connectionToRefresh = nextConnections[0];

        if (connectionToRefresh) {
            await refreshServerSchemasForConnection(ps.serverId, connectionToRefresh.id);
            appDb.setSetting('selectedConnectionId', connectionToRefresh.id);
        }

        return buildBootstrap();
    },
    updateConnection: async (ps: { connectionId: number; connection: AppUpdateConnectionParams }) => {
        ensureConnectionExists(ps.connectionId);

        if (typeof ps.connection.serverId === 'number') {
            ensureServerExists(ps.connection.serverId);
        }

        appDb.updateConnection(ps.connectionId, {
            ...ps.connection,
            name: ps.connection.name.trim(),
            host: ps.connection.host?.trim(),
            port: normalizeConnectionPort(ps.connection.port),
            databaseName: ps.connection.databaseName?.trim(),
            username: ps.connection.username?.trim(),
        });

        if (Object.hasOwn(ps.connection, 'password')) {
            const password = ps.connection.password?.trim();

            if (password) {
                await storeConnectionPassword(ps.connectionId, `${ps.connection.name.trim()} password`, password);
            } else {
                await deleteConnectionPassword(ps.connectionId);
            }
        }

        const updatedConnection = appDb.getConnection(ps.connectionId);

        if (updatedConnection) {
            await refreshServerSchemasForConnection(updatedConnection.server_id, ps.connectionId);
        }

        return buildBootstrap();
    },
    deleteConnection: async (ps: { connectionId: number }) => {
        ensureConnectionExists(ps.connectionId);
        await dbTools.disconnectConnection(ps.connectionId);
        const connection = appDb.getConnection(ps.connectionId);
        await deleteConnectionPassword(ps.connectionId);
        appDb.deleteSetting(`connectionSchema:${ps.connectionId}`);
        appDb.deleteConnection(ps.connectionId);

        if (connection) {
            const siblingConnection = appDb.listConnections(connection.server_id)[0];

            if (siblingConnection) {
                await refreshServerSchemasForConnection(connection.server_id, siblingConnection.id);
            }
        }

        return buildBootstrap();
    },
    reorderConnection: async (ps: { connectionId: number; serverId: number; toIndex: number }) => {
        ensureConnectionExists(ps.connectionId);
        ensureServerExists(ps.serverId);
        appDb.reorderConnection(ps.connectionId, ps.serverId, ps.toIndex);
        return buildBootstrap();
    },
    selectConnection: async (ps: { connectionId: number | undefined }) => {
        if (ps.connectionId !== undefined) {
            ensureConnectionExists(ps.connectionId);
            const connection = appDb.getConnection(ps.connectionId)!;
            appDb.setSetting('selectedServerId', connection.server_id);
        }

        appDb.setSetting('selectedConnectionId', ps.connectionId);
        return buildBootstrap();
    },
    disconnectConnection: async (ps: { connectionId: number }): Promise<void> => {
        ensureConnectionExists(ps.connectionId);
        await dbTools.disconnectConnection(ps.connectionId);
    },
    testConnection: async (ps: AppTestConnectionParams): Promise<TestConnectionResult> => {
        return withTimedAppOperation('testConnection', { driver: ps.driver, kind: ps.kind }, () => dbTools.testConnection(normalizeTestConnectionPayload(ps)));
    },
    getMsAccessRuntimeStatus: async (): Promise<MsAccessRuntimeStatus> => {
        return inspectMsAccessRuntime(appDb.getUserDataDir());
    },
    createScript: async (ps: CreateScriptParams) => {
        ensureConnectionExists(ps.connectionId);
        const scriptId = appDb.createScript({
            ...ps,
            name: ps.name.trim(),
            groupName: ps.groupName?.trim(),
            sqlText: ps.sqlText,
        });
        appDb.setSetting('selectedConnectionId', ps.connectionId);
        appDb.setSetting('selectedScriptId', scriptId);
        return buildBootstrap();
    },
    updateScript: async (ps: { scriptId: number; script: UpdateScriptParams }) => {
        ensureScriptExists(ps.scriptId);

        if (typeof ps.script.connectionId === 'number') {
            ensureConnectionExists(ps.script.connectionId);
        }

        appDb.updateScript(ps.scriptId, {
            ...ps.script,
            name: ps.script.name.trim(),
            groupName: ps.script.groupName?.trim(),
        });
        return buildBootstrap();
    },
    deleteScript: async (ps: { scriptId: number }) => {
        ensureScriptExists(ps.scriptId);
        appDb.deleteScript(ps.scriptId);
        return buildBootstrap();
    },
    reorderScript: async (ps: { scriptId: number; connectionId: number; toIndex: number }) => {
        ensureScriptExists(ps.scriptId);
        ensureConnectionExists(ps.connectionId);
        appDb.reorderScript(ps.scriptId, ps.connectionId, ps.toIndex);
        return buildBootstrap();
    },
    selectScript: async (ps: { scriptId: number | undefined }) => {
        if (ps.scriptId !== undefined) {
            ensureScriptExists(ps.scriptId);
            const script = appDb.getScript(ps.scriptId)!;
            appDb.setSetting('selectedConnectionId', script.connection_id);
        }

        appDb.setSetting('selectedScriptId', ps.scriptId);
        return buildBootstrap();
    },
    getTables: async (ps: { connectionId: number }): Promise<TableSummary[]> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);
        return withTimedAppOperation('getTables', { connectionId: ps.connectionId }, () => dbTools.getTables(ps.connectionId));
    },
    getTableInfo: async (ps: { connectionId: number; tableName: string }): Promise<TableInfo> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);
        return withTimedAppOperation('getTableInfo', { connectionId: ps.connectionId, tableName: ps.tableName }, () => dbTools.getTableInfo(ps.connectionId, ps.tableName));
    },
    getTableDdl: async (ps: { connectionId: number; tableName: string }): Promise<string> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);
        return withTimedAppOperation('getTableDdl', { connectionId: ps.connectionId, tableName: ps.tableName }, () => dbTools.getTableDdl(ps.connectionId, ps.tableName));
    },
    getServerSchemas: async (ps: { serverId: number }): Promise<ServerSchemaRecord[]> => {
        ensureServerExists(ps.serverId);
        return dbTools.getServerSchemas(ps.serverId);
    },
    refreshServerSchemas: async (ps: { serverId: number }) => {
        ensureServerExists(ps.serverId);
        await dbTools.refreshServerSchemas(ps.serverId);
        return buildBootstrap();
    },
    refreshConnectionSchema: async (ps: { connectionId: number }): Promise<ConnectionSchemaCache> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);
        return dbTools.refreshConnectionSchema(ps.connectionId);
    },
    invalidateAllMetadataCaches: async (): Promise<void> => {
        dbTools.invalidateAllMetadataCaches();
    },
    refreshTableInfo: async (ps: { connectionId: number; tableName: string }): Promise<TableInfo> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);
        return dbTools.refreshTableInfo(ps.connectionId, ps.tableName);
    },
    dropTable: async (ps: { connectionId: number; tableName: string }): Promise<ConnectionSchemaCache> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);
        return withTimedAppOperation('dropTable', { connectionId: ps.connectionId, tableName: ps.tableName }, () => dbTools.dropTable(ps.connectionId, ps.tableName));
    },
    getTableData: async (ps: { connectionId: number; tableName: string; limit?: number; offset?: number }): Promise<TableData> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);
        return withTimedAppOperation(
            'getTableData',
            {
                connectionId: ps.connectionId,
                tableName: ps.tableName,
                limit: ps.limit,
                offset: ps.offset,
            },
            () => dbTools.getTableData(ps.connectionId, ps)
        );
    },
    peekFkUsages: async (ps: PeekFkUsagesParams): Promise<PeekFkUsagesResult> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);

        return withTimedAppOperation('peekFkUsages', { connectionId: ps.connectionId, tableName: ps.tableName, columnName: ps.columnName }, async () => {
            const driver = getConnectionDriverOrThrow(ps.connectionId);
            const relations = await getPeekUsageRelations(ps.connectionId, ps.tableName, ps.columnName);
            const usages = await Promise.all(
                relations.map(async (relation) => {
                    try {
                        const result = await runPeekUsageCountQuery(ps.connectionId, driver, relation, ps.rowValues);
                        return {
                            relation,
                            rowCount: readPeekUsageRowCount(result),
                            errorMessage: undefined,
                        } satisfies PeekFkUsageSummary;
                    } catch (error) {
                        return {
                            relation,
                            rowCount: 0,
                            errorMessage: error instanceof Error ? error.message : String(error),
                        } satisfies PeekFkUsageSummary;
                    }
                })
            );

            return {
                usages: usages.sort(
                    (left, right) =>
                        right.rowCount - left.rowCount ||
                        left.relation.sourceTable.localeCompare(right.relation.sourceTable) ||
                        left.relation.columns
                            .map((column) => column.sourceColumn)
                            .join(',')
                            .localeCompare(right.relation.columns.map((column) => column.sourceColumn).join(','))
                ),
            } satisfies PeekFkUsagesResult;
        });
    },
    peekFkUsageRows: async (ps: PeekFkUsageRowsParams): Promise<QueryExecutionResult> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);

        return withTimedAppOperation('peekFkUsageRows', { connectionId: ps.connectionId, sourceTable: ps.relation.sourceTable }, async () => {
            const driver = getConnectionDriverOrThrow(ps.connectionId);
            return runPeekUsageRowsQuery(ps.connectionId, driver, ps);
        });
    },
    runQuery: async (ps: {
        connectionId: number;
        sql: string;
        params?: Array<string | number | bigint | Uint8Array | Buffer | null>;
        scriptId?: number;
    }): Promise<QueryExecutionResult> => {
        ensureConnectionExists(ps.connectionId);

        if (ps.scriptId !== undefined) {
            ensureScriptExists(ps.scriptId);
            appDb.touchScriptLastRun(ps.scriptId);
        }

        appDb.touchConnectionLastUsed(ps.connectionId);
        return withTimedAppOperation('runQuery', { connectionId: ps.connectionId }, () => dbTools.runQuery(ps.connectionId, ps.sql, ps.params));
    },
    getSqlDiagnostics: async (ps: GetSqlDiagnosticsParams): Promise<SqlDiagnosticsResult> => {
        if (typeof ps.connectionId === 'number') {
            ensureConnectionExists(ps.connectionId);
        }

        return getSqlDiagnosticsResult({
            sql: ps.sql,
            dialect: ps.dialect,
            connectionId: ps.connectionId,
            userDataDir: appDb.getUserDataDir(),
        });
    },
    formatSql: async (ps: FormatSqlParams): Promise<string> => {
        return formatSqlResult({
            sql: ps.sql,
            dialect: ps.dialect,
            userDataDir: appDb.getUserDataDir(),
        });
    },
    updateColumn: async (ps: UpdateColumnParams): Promise<TableData> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);
        return dbTools.updateColumn(ps);
    },
    applyTableChanges: async (ps: AppApplyTableChangesParams): Promise<ApplyTableChangesResult> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);
        return dbTools.applyTableChanges(ps);
    },
    modifyTable: async (ps: ModifyTableParams): Promise<TableInfo> => {
        ensureConnectionExists(ps.connectionId);
        appDb.touchConnectionLastUsed(ps.connectionId);
        return dbTools.modifyTable(ps);
    },
    resolveDatabaseFilePath: (ps: { serverId: number }) => {
        const server = appDb.getServer(ps.serverId);

        if (!server) {
            throw new Error('The selected server could not be found.');
        }

        if (server.kind !== 'file' || !server.file_path) {
            throw new Error('The selected server does not point to a local database file.');
        }

        return server.file_path;
    },
    openResolvedPathInEditor: (ps: { path: string; editorPath?: string }) => {
        if (!existsSync(ps.path)) {
            throw new Error('The selected path no longer exists on disk.');
        }

        if (ps.editorPath && !existsSync(ps.editorPath)) {
            throw new Error('The selected editor no longer exists on disk.');
        }

        return {
            path: ps.path,
            editorPath: ps.editorPath,
        };
    },
};
