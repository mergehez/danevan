import type { ConnectionRecord, ConnectionSchemaCache, ServerRecord, TableData, TableInfo, TableSummary, TestConnectionResult } from '@utils/appClient';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createTableInfo(name: string, overrides: Partial<TableInfo> = {}): TableInfo {
    return {
        name,
        columns: [
            {
                cid: 0,
                name: 'id',
                type: 'int',
                notNull: true,
                defaultValue: null,
                isPrimaryKey: true,
                primaryKeyOrdinal: 1,
                isAutoIncrement: true,
                comment: null,
                collation: null,
                onUpdate: null,
            },
        ],
        indexes: [
            {
                name: `${name}_pk`,
                columns: ['id'],
                isUnique: true,
                origin: 'pk',
                isPartial: false,
            },
        ],
        foreignKeys: [],
        rowCount: 1,
        ...overrides,
    };
}

function createTableData(overrides: Partial<TableData> = {}): TableData {
    return {
        columns: ['id'],
        columnStats: { id: 1 },
        rows: [{ id: 1 }],
        rowCount: 1,
        limit: 100,
        offset: 0,
        ...overrides,
    };
}

const testHarness = vi.hoisted(() => {
    function createDriverToolsMock() {
        return {
            testConnection: vi.fn(async ({ driver }: { driver: any }) => ({ ok: true, driver, message: `${driver} ok` }) satisfies TestConnectionResult),
            getTablesFresh: vi.fn(async () => [] as TableSummary[]),
            getTableInfoFresh: vi.fn(async (_connectionId: number, tableName: string) => createTableInfo(tableName)),
            listServerSchemas: vi.fn(async () => [] as Array<{ name: string }>),
            disconnectConnection: vi.fn(async () => undefined),
            getTableData: vi.fn(async () => createTableData()),
            runQuery: vi.fn(async () => ({
                kind: 'rows',
                columns: ['id'],
                columnStats: { id: 1 },
                rows: [{ id: 1 }],
            })),
            modifyTable: vi.fn(async () => undefined),
            updateColumn: vi.fn(async () => createTableData()),
            applyTableChanges: vi.fn(async () => ({
                tableData: createTableData(),
                foreignKeyViolations: [],
            })),
        };
    }

    const driverToolsByType = {
        sqlite: createDriverToolsMock(),
        msaccess: createDriverToolsMock(),
        mysql: createDriverToolsMock(),
        postgresql: createDriverToolsMock(),
        sqlserver: createDriverToolsMock(),
    };

    const state = {
        servers: [] as ServerRecord[],
        connections: [] as ConnectionRecord[],
        settings: new Map<string, unknown>(),
        schemaMetadataUpdates: [] as Array<{
            serverId: number;
            schemaCount: number;
            schemaCachedAt?: string;
        }>,
        userDataDir: '/tmp/danevan-tests',
    };

    const appDb = {
        getConnection: (id: number) => state.connections.find((connection) => connection.id === id),
        getServer: (id: number) => state.servers.find((server) => server.id === id),
        listConnections: (serverId?: number) =>
            typeof serverId === 'number' ? state.connections.filter((connection) => connection.server_id === serverId) : [...state.connections],
        getSetting: <T>(key: string, fallbackValue: T) => (state.settings.has(key) ? (state.settings.get(key) as T) : fallbackValue),
        setSetting: (key: string, value: unknown) => {
            state.settings.set(key, value);
        },
        setSettings: (entries: Array<{ key: string; value: unknown }>) => {
            entries.forEach(({ key, value }) => {
                state.settings.set(key, value);
            });
        },
        deleteSettings: (keys: string[]) => {
            keys.forEach((key) => state.settings.delete(key));
        },
        deleteSettingsByPrefixes: (prefixes: string[]) => {
            for (const key of state.settings.keys()) {
                if (prefixes.some((prefix) => key.startsWith(prefix))) {
                    state.settings.delete(key);
                }
            }
        },
        updateServerSchemaMetadata: (serverId: number, params: { schemaCount: number; schemaCachedAt?: string }) => {
            state.schemaMetadataUpdates.push({ serverId, ...params });
        },
        getUserDataDir: () => state.userDataDir,
    };

    return {
        state,
        appDb,
        driverToolsByType,
        reset() {
            state.servers = [];
            state.connections = [];
            state.settings = new Map<string, unknown>();
            state.schemaMetadataUpdates = [];

            for (const driverTools of Object.values(driverToolsByType)) {
                driverTools.testConnection.mockReset();
                driverTools.testConnection.mockImplementation(async ({ driver }: { driver: string }) => ({
                    ok: true,
                    driver,
                    message: `${driver} ok`,
                }));
                driverTools.getTablesFresh.mockReset();
                driverTools.getTablesFresh.mockResolvedValue([]);
                driverTools.getTableInfoFresh.mockReset();
                driverTools.getTableInfoFresh.mockImplementation(async (_connectionId: number, tableName: string) => createTableInfo(tableName));
                driverTools.listServerSchemas.mockReset();
                driverTools.listServerSchemas.mockResolvedValue([]);
                driverTools.disconnectConnection.mockReset();
                driverTools.disconnectConnection.mockResolvedValue(undefined);
                driverTools.getTableData.mockReset();
                driverTools.getTableData.mockImplementation(async () => createTableData());
                driverTools.runQuery.mockReset();
                driverTools.runQuery.mockResolvedValue({
                    kind: 'rows',
                    columns: ['id'],
                    columnStats: { id: 1 },
                    rows: [{ id: 1 }],
                });
                driverTools.modifyTable.mockReset();
                driverTools.modifyTable.mockResolvedValue(undefined);
                driverTools.updateColumn.mockReset();
                driverTools.updateColumn.mockImplementation(async () => createTableData());
                driverTools.applyTableChanges.mockReset();
                driverTools.applyTableChanges.mockImplementation(async () => ({
                    tableData: createTableData(),
                    foreignKeyViolations: [],
                }));
            }
        },
    };
});

vi.mock('@backend/auth', () => ({
    readConnectionPassword: vi.fn(async () => 'secret'),
}));

vi.mock('@backend/db-app', () => ({
    useAppDb: () => testHarness.appDb,
}));

vi.mock('@backend/useSqliteDriver', () => ({
    useSqliteDriverTools: vi.fn(() => testHarness.driverToolsByType.sqlite),
}));

vi.mock('@backend/useMsAccessDriver', () => ({
    useMsAccessDriverTools: vi.fn(() => testHarness.driverToolsByType.msaccess),
}));

vi.mock('@backend/useMySqlDriver', () => ({
    useMySqlDriverTools: vi.fn(() => testHarness.driverToolsByType.mysql),
}));

vi.mock('@backend/usePostgresDriver', () => ({
    usePostgresDriverTools: vi.fn(() => testHarness.driverToolsByType.postgresql),
}));

vi.mock('@backend/useSqlServerDriver', () => ({
    useSqlServerDriverTools: vi.fn(() => testHarness.driverToolsByType.sqlserver),
}));

const { dbTools } = await import('@backend/db-tools');

function seedServer(overrides: Partial<ServerRecord> = {}): ServerRecord {
    const server: ServerRecord = {
        id: overrides.id ?? 1,
        name: overrides.name ?? 'SQL Server',
        kind: overrides.kind ?? 'server',
        driver: overrides.driver ?? 'sqlserver',
        file_path: overrides.file_path,
        host: overrides.host,
        port: overrides.port,
        schema_count: overrides.schema_count,
        sequence: overrides.sequence ?? 1,
        created_at: overrides.created_at ?? '2026-04-17T00:00:00.000Z',
        updated_at: overrides.updated_at ?? '2026-04-17T00:00:00.000Z',
    };

    testHarness.state.servers.push(server);
    return server;
}

function seedConnection(overrides: Partial<ConnectionRecord> = {}): ConnectionRecord {
    const connection: ConnectionRecord = {
        id: overrides.id ?? 10,
        server_id: overrides.server_id ?? 1,
        name: overrides.name ?? 'main',
        host: overrides.host,
        port: overrides.port,
        database_name: overrides.database_name ?? 'app',
        username: overrides.username ?? 'sa',
        readonly: overrides.readonly ?? 0,
        sequence: overrides.sequence ?? 1,
        created_at: overrides.created_at ?? '2026-04-17T00:00:00.000Z',
        updated_at: overrides.updated_at ?? '2026-04-17T00:00:00.000Z',
        last_used_at: overrides.last_used_at,
    };

    testHarness.state.connections.push(connection);
    return connection;
}

describe('dbTools', () => {
    beforeEach(() => {
        testHarness.reset();
        seedServer();
        seedConnection();
    });

    it('delegates testConnection to the matching driver tools', async () => {
        testHarness.driverToolsByType.sqlserver.testConnection.mockResolvedValue({
            ok: true,
            driver: 'sqlserver',
            message: 'Connected to SQL Server.',
        });

        await expect(
            dbTools.testConnection({
                kind: 'server',
                driver: 'sqlserver',
                host: 'db.internal',
                port: 1433,
                databaseName: 'app',
                username: 'sa',
                password: 'secret',
            })
        ).resolves.toEqual({
            ok: true,
            driver: 'sqlserver',
            message: 'Connected to SQL Server.',
        });

        expect(testHarness.driverToolsByType.sqlserver.testConnection).toHaveBeenCalledOnce();
    });

    it('returns cached tables before falling back to getTablesFresh', async () => {
        testHarness.state.settings.set('connectionSchema:10', {
            cachedAt: '2026-04-17T00:00:00.000Z',
            tables: [{ name: 'dbo.Users', type: 'table', rowCount: 5 }],
            tableInfoByName: {},
        } satisfies ConnectionSchemaCache);

        await expect(dbTools.getTables(10)).resolves.toEqual([{ name: 'dbo.Users', type: 'table', rowCount: 5 }]);
        expect(testHarness.driverToolsByType.sqlserver.getTablesFresh).not.toHaveBeenCalled();

        testHarness.state.settings.clear();
        testHarness.driverToolsByType.sqlserver.getTablesFresh.mockResolvedValue([{ name: 'dbo.Fresh', type: 'table', rowCount: 1 }]);

        await expect(dbTools.getTables(10)).resolves.toEqual([{ name: 'dbo.Fresh', type: 'table', rowCount: 1 }]);
        expect(testHarness.driverToolsByType.sqlserver.getTablesFresh).toHaveBeenCalledWith(10);
    });

    it('returns cached table info when present and refreshes it when requested', async () => {
        const cachedInfo = createTableInfo('dbo.Users', { rowCount: 3 });
        testHarness.state.settings.set('connectionSchema:10', {
            cachedAt: '2026-04-17T00:00:00.000Z',
            tables: [],
            tableInfoByName: { 'dbo.Users': cachedInfo },
        } satisfies ConnectionSchemaCache);

        await expect(dbTools.getTableInfo(10, ' dbo.Users ')).resolves.toEqual(cachedInfo);
        expect(testHarness.driverToolsByType.sqlserver.getTableInfoFresh).not.toHaveBeenCalled();

        const freshInfo = createTableInfo('dbo.Users', { rowCount: 9 });
        testHarness.driverToolsByType.sqlserver.getTableInfoFresh.mockResolvedValue(freshInfo);

        await expect(dbTools.getTableInfoFresh(10, 'dbo.Users')).resolves.toEqual(freshInfo);
        expect(testHarness.state.settings.get('connectionSchema:10')).toEqual({
            cachedAt: expect.any(String),
            tables: [],
            tableInfoByName: { 'dbo.Users': freshInfo },
        });
    });

    it('returns cached server schemas and refreshes them through the driver', async () => {
        testHarness.state.settings.set('serverSchemas:1', {
            cachedAt: '2026-04-17T00:00:00.000Z',
            schemas: [{ name: 'master' }],
        });

        await expect(dbTools.getServerSchemas(1)).resolves.toEqual([{ name: 'master' }]);

        seedConnection({ id: 11, server_id: 1, name: 'reporting' });
        testHarness.driverToolsByType.sqlserver.listServerSchemas.mockResolvedValue([{ name: 'master' }, { name: 'reporting' }]);
        testHarness.driverToolsByType.sqlserver.getTablesFresh.mockResolvedValue([]);

        await expect(dbTools.refreshServerSchemas(1)).resolves.toEqual([{ name: 'master' }, { name: 'reporting' }]);
        expect(testHarness.driverToolsByType.sqlserver.listServerSchemas).toHaveBeenCalledWith(1, undefined);
        expect(testHarness.driverToolsByType.sqlserver.getTablesFresh).toHaveBeenCalledWith(10);
        expect(testHarness.driverToolsByType.sqlserver.getTablesFresh).toHaveBeenCalledWith(11);
        expect(testHarness.state.schemaMetadataUpdates).toEqual([
            {
                serverId: 1,
                schemaCount: 2,
                schemaCachedAt: expect.any(String),
            },
        ]);
    });

    it('refreshes connection schema, clears stale cache entries, and exposes refreshTableInfo', async () => {
        testHarness.state.settings.set('connectionSchema:10', {
            cachedAt: '2026-04-17T00:00:00.000Z',
            tables: [{ name: 'dbo.Stale', type: 'table', rowCount: 1 }],
            tableInfoByName: {},
        } satisfies ConnectionSchemaCache);
        testHarness.state.settings.set('tableInfo:10:dbo.Stale', {
            cachedAt: '2026-04-17T00:00:00.000Z',
            info: createTableInfo('dbo.Stale'),
        });
        testHarness.driverToolsByType.sqlserver.getTablesFresh.mockResolvedValue([{ name: 'dbo.Users', type: 'table', rowCount: 2 }]);

        await expect(dbTools.refreshConnectionSchema(10)).resolves.toEqual({
            cachedAt: expect.any(String),
            tables: [{ name: 'dbo.Users', type: 'table', rowCount: 2 }],
            tableInfoByName: {},
        });
        expect(testHarness.state.settings.has('tableInfo:10:dbo.Stale')).toBe(false);

        const refreshedInfo = createTableInfo('dbo.Users', { rowCount: 2 });
        testHarness.driverToolsByType.sqlserver.getTableInfoFresh.mockResolvedValue(refreshedInfo);
        await expect(dbTools.refreshTableInfo(10, 'dbo.Users')).resolves.toEqual(refreshedInfo);
    });

    it('delegates disconnectConnection when the driver supports it', async () => {
        await expect(dbTools.disconnectConnection(10)).resolves.toBeUndefined();
        expect(testHarness.driverToolsByType.sqlserver.disconnectConnection).toHaveBeenCalledWith(10);
    });

    it('normalizes paging and table names for getTableData', async () => {
        const tableData = createTableData({ limit: 1000, offset: 0 });
        testHarness.driverToolsByType.sqlserver.getTableData.mockResolvedValue(tableData);

        await expect(dbTools.getTableData(10, { tableName: ' dbo.Users ', limit: 5000, offset: -10 })).resolves.toEqual(tableData);
        expect(testHarness.driverToolsByType.sqlserver.getTableData).toHaveBeenCalledWith(10, 'dbo.Users', 1000, 0);
    });

    it('trims SQL before runQuery and rejects empty statements', async () => {
        await expect(dbTools.runQuery(10, '   ')).rejects.toThrow('SQL is required.');

        await dbTools.runQuery(10, '  SELECT 1  ', [1]);
        expect(testHarness.driverToolsByType.sqlserver.runQuery).toHaveBeenCalledWith(10, 'SELECT 1', [1]);
    });

    it('normalizes columns during modifyTable and refreshes metadata after the driver runs', async () => {
        const currentInfo = createTableInfo('dbo.Users', { rowCount: 2 });
        const nextInfo = createTableInfo('dbo.Users', {
            rowCount: 2,
            columns: [
                ...currentInfo.columns,
                {
                    cid: 1,
                    name: 'display_name',
                    type: 'nvarchar(255)',
                    notNull: false,
                    defaultValue: null,
                    isPrimaryKey: false,
                    primaryKeyOrdinal: null,
                    isAutoIncrement: false,
                    comment: 'Display name',
                    collation: null,
                    onUpdate: null,
                },
            ],
        });
        testHarness.driverToolsByType.sqlserver.getTableInfoFresh.mockResolvedValueOnce(currentInfo).mockResolvedValueOnce(nextInfo);

        await expect(
            dbTools.modifyTable({
                connectionId: 10,
                tableName: ' dbo.Users ',
                columns: [
                    {
                        originalName: ' id ',
                        name: 'id',
                        type: ' int ',
                        notNull: true,
                        defaultValue: null,
                        isPrimaryKey: true,
                        primaryKeyOrdinal: 1,
                        isAutoIncrement: true,
                        comment: null,
                        collation: null,
                        onUpdate: null,
                    },
                    {
                        name: ' display_name ',
                        type: ' nvarchar(255) ',
                        notNull: false,
                        defaultValue: null,
                        isPrimaryKey: false,
                        primaryKeyOrdinal: null,
                        isAutoIncrement: false,
                        comment: ' Display name ',
                        collation: null,
                        onUpdate: null,
                    },
                ],
            })
        ).resolves.toEqual(nextInfo);

        expect(testHarness.driverToolsByType.sqlserver.modifyTable).toHaveBeenCalledWith(
            10,
            'dbo.Users',
            currentInfo,
            expect.arrayContaining([
                expect.objectContaining({ originalName: 'id', name: 'id', type: 'int' }),
                expect.objectContaining({
                    name: 'display_name',
                    type: 'nvarchar(255)',
                    comment: 'Display name',
                }),
            ])
        );
    });

    it('normalizes table names for updateColumn and applyTableChanges', async () => {
        const updatedTableData = createTableData({
            rows: [{ id: 1, value: 'updated' }],
            columns: ['id', 'value'],
            columnStats: { id: 1, value: 7 },
        });
        testHarness.driverToolsByType.sqlserver.updateColumn.mockResolvedValue(updatedTableData);

        await expect(
            dbTools.updateColumn({
                connectionId: 10,
                tableName: ' dbo.Users ',
                targetColumn: 'value',
                value: 'updated',
                matchColumn: 'id',
                matchValue: 1,
            })
        ).resolves.toEqual(updatedTableData);
        expect(testHarness.driverToolsByType.sqlserver.updateColumn).toHaveBeenCalledWith({
            connectionId: 10,
            tableName: 'dbo.Users',
            targetColumn: 'value',
            value: 'updated',
            matchColumn: 'id',
            matchValue: 1,
        });

        await dbTools.applyTableChanges({
            connectionId: 10,
            tableName: ' dbo.Users ',
            changes: [
                {
                    targetColumn: ' value ',
                    value: 'updated',
                    matchColumn: ' id ',
                    matchValue: 1,
                },
            ],
            disableForeignKeyChecks: true,
            limit: 5,
            offset: 2,
        });

        expect(testHarness.driverToolsByType.sqlserver.applyTableChanges).toHaveBeenCalledWith({
            connectionId: 10,
            tableName: 'dbo.Users',
            changes: [
                {
                    targetColumn: 'value',
                    value: 'updated',
                    matchColumn: 'id',
                    matchValue: 1,
                },
            ],
            disableForeignKeyChecks: true,
            limit: 5,
            offset: 2,
        });
    });
});
