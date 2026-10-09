// @vitest-environment node
// app.ts keeps a module-level appDb singleton and db-app.configureDatabase() returns
// early once it is set, so every test resets the module registry and points the app at
// its own temp database. The real database under ~/Library/Application Support is never
// touched: configureDatabase() always receives tempDir and every test asserts that
// resolveAppDataDir() was not used (getUserDataDir() === tempDir) and that the file
// really landed inside the temp directory.
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiMethods } from '../../../shared/utils/apiMethods';
import type { CreateConnectionParams, CreateScriptParams, CreateServerParams, DbType, EditorSettings, MysqldumpExportOptions, MysqldumpExportParams } from '../../../shared/types';

const DATABASE_FILE_NAME = 'danevan.sqlite';

/**
 * `apiMethods` is generated from the shared client contract, and the shipped Electron
 * shell implements these four in the main process (src/electron/main.ts), not in app.ts.
 * They are listed here so the contract test can pin the split instead of pretending
 * app.ts owns them.
 */
const MAIN_PROCESS_ONLY_METHODS: readonly string[] = ['openFileInEditor', 'pickDatabaseFile', 'pickSavePath', 'revealPathInFileManager'];

/** app.ts talks to the macOS keychain through `security` subprocesses; mocking keeps
 *  the real entries (e.g. `danevan-server-password-1`) out of the test's reach. */
const authMocks = vi.hoisted(() => ({
    storeServerPassword: vi.fn(async () => undefined),
    deleteServerPassword: vi.fn(async () => undefined),
    readServerPassword: vi.fn(async () => null),
}));

vi.mock('../../../backend/auth.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../backend/auth.ts')>();

    return {
        ...actual,
        storeServerPassword: authMocks.storeServerPassword,
        deleteServerPassword: authMocks.deleteServerPassword,
        readServerPassword: authMocks.readServerPassword,
        storeConnectionPassword: vi.fn(async () => undefined),
        deleteConnectionPassword: vi.fn(async () => undefined),
        readConnectionPassword: vi.fn(async () => null),
    };
});

type AppApi = (typeof import('../../../backend/app.ts'))['app'];
type AppDb = ReturnType<(typeof import('../../../backend/db-app.ts'))['useAppDb']>;

let tempDir = '';
let app: AppApi;
let appDb: AppDb;

const mysqldumpOptions: MysqldumpExportOptions = {
    addDropTable: true,
    disableKeys: false,
    addLocks: false,
    addDropTrigger: false,
    exportSchemaOnly: false,
    completeInsert: false,
    includeTableOptions: true,
    includeRoutines: false,
    lockTables: false,
    insertDelayed: false,
};

function appDatabasePath() {
    return join(tempDir, DATABASE_FILE_NAME);
}

/** Asserts read through a separate connection, so module state alone cannot satisfy them. */
function openAppDatabase() {
    return new Database(appDatabasePath());
}

function queryRows<T>(sql: string, ...params: Array<string | number>) {
    const file = openAppDatabase();

    try {
        return file.prepare(sql).all(...params) as T[];
    } finally {
        file.close();
    }
}

function insertRow(sql: string, ...params: Array<string | number | null>) {
    const file = openAppDatabase();

    try {
        // Foreign keys are off on this connection only, so orphan fixtures can be seeded.
        file.pragma('foreign_keys = OFF');
        return Number(file.prepare(sql).run(...params).lastInsertRowid);
    } finally {
        file.close();
    }
}

async function loadConfiguredApp() {
    vi.resetModules();
    const { useAppDb } = await import('../../../backend/db-app.ts');
    appDb = useAppDb();
    appDb.configureDatabase(tempDir);
    const { app: loadedApp } = await import('../../../backend/app.ts');
    app = loadedApp;
}

function createSqliteFile(fileName: string, schema = 'CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT NOT NULL);') {
    const filePath = join(tempDir, fileName);
    const file = new Database(filePath);

    try {
        file.exec(schema);
    } finally {
        file.close();
    }

    return filePath;
}

function createServerParams(overrides: Partial<CreateServerParams> = {}): CreateServerParams {
    return {
        name: 'Server',
        kind: 'file',
        driver: 'sqlite',
        filePath: join(tempDir, 'server.sqlite'),
        host: undefined,
        port: undefined,
        username: undefined,
        password: undefined,
        ...overrides,
    };
}

function createConnectionParams(serverId: number, overrides: Partial<CreateConnectionParams> = {}): CreateConnectionParams {
    return {
        serverId,
        name: 'Connection',
        host: undefined,
        port: undefined,
        databaseName: undefined,
        readonly: false,
        ...overrides,
    };
}

/** A real SQLite file plus its file source and one connection. Nothing remote is involved. */
async function createFileSource(name = 'Local SQLite') {
    const filePath = createSqliteFile(`${name.replaceAll(/[^a-zA-Z0-9]+/g, '-')}.sqlite`);
    const created = await app.createServer(createServerParams({ name, filePath }));
    const serverId = created.servers.find((server) => server.name === name)?.id;

    if (serverId === undefined) {
        throw new Error(`fixture: server ${name} was not created`);
    }

    const withConnection = await app.createConnection(createConnectionParams(serverId, { name: `${name} connection` }));
    const connectionId = withConnection.connections.find((connection) => connection.server_id === serverId)?.id;

    if (connectionId === undefined) {
        throw new Error(`fixture: connection for ${name} was not created`);
    }

    return { serverId, connectionId, filePath };
}

/** A server-based entry for guards that run before any driver is touched. */
async function createRemoteServer(name = 'Remote MySQL') {
    const bootstrap = await app.createServer(createServerParams({ name, kind: 'server', driver: 'mysql', filePath: undefined, host: '127.0.0.1', port: 3306 }));

    return bootstrap.servers.find((server) => server.name === name)!.id;
}

async function createScript(connectionId: number, name: string, overrides: Partial<CreateScriptParams> = {}) {
    const bootstrap = await app.createScript({ connectionId, name, ...overrides });
    const script = bootstrap.scripts.find((candidate) => candidate.name === name);

    if (!script) {
        throw new Error(`fixture: script ${name} was not created`);
    }

    return script.id;
}

/** A connection whose server row does not exist; reachable only by seeding it directly. */
function seedOrphanConnection() {
    return insertRow('INSERT INTO connections(server_id, name, sequence) VALUES(?, ?, ?)', 987_654, 'Orphan connection', 1);
}

function seedRemoteConnection(options: { host: string | null; databaseName: string | null }) {
    const serverId = insertRow("INSERT INTO servers(name, kind, driver, host, port, sequence) VALUES('Seed MySQL', 'server', 'mysql', ?, 3306, 1)", options.host);
    const connectionId = insertRow(
        'INSERT INTO connections(server_id, name, host, port, database_name, readonly, sequence) VALUES(?, ?, ?, 3306, ?, 0, 1)',
        serverId,
        'Seed MySQL connection',
        options.host,
        options.databaseName
    );

    return { serverId, connectionId };
}

/** `exportWithMysqldump` only checks that the executable exists before validating the rest. */
function mysqldumpStub() {
    const stubPath = join(tempDir, 'mysqldump-stub');
    writeFileSync(stubPath, '#!/bin/sh\n');

    return stubPath;
}

function scriptFile(name = 'run.sql', sql = 'SELECT 1;\n') {
    const filePath = join(tempDir, name);
    writeFileSync(filePath, sql);

    return filePath;
}

beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'danevan-app-api-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    authMocks.storeServerPassword.mockClear();
    authMocks.deleteServerPassword.mockClear();
    authMocks.readServerPassword.mockClear();

    await loadConfiguredApp();

    // Safety: the app database lives in the temp directory, not in Application Support.
    expect(appDb.getUserDataDir()).toBe(tempDir);
    expect(existsSync(appDatabasePath())).toBe(true);
});

afterEach(() => {
    vi.restoreAllMocks();
    // Recursive removal also takes the WAL and shared-memory files.
    rmSync(tempDir, { recursive: true, force: true });
});

describe('app API contract', () => {
    it('exposes exactly the backend handlers declared by apiMethods', () => {
        const backendMethods = apiMethods.filter((method) => !MAIN_PROCESS_ONLY_METHODS.includes(method));

        expect(apiMethods).toHaveLength(58);
        expect(backendMethods).toHaveLength(54);
        expect(Object.keys(app).sort()).toEqual([...backendMethods].sort());

        for (const method of backendMethods) {
            expect(typeof app[method as keyof AppApi]).toBe('function');
        }
    });

    it('leaves the four Electron main-process handlers to the shipped shell', () => {
        const mainProcessSource = readFileSync(new URL('../../../electron/main.ts', import.meta.url), 'utf8');

        expect([...MAIN_PROCESS_ONLY_METHODS]).toEqual(['openFileInEditor', 'pickDatabaseFile', 'pickSavePath', 'revealPathInFileManager']);

        for (const method of MAIN_PROCESS_ONLY_METHODS) {
            expect(apiMethods).toContain(method);
            expect(Object.hasOwn(app, method)).toBe(false);
            expect(mainProcessSource).toContain(`${method}: async`);
        }
    });
});

describe('app API input guards', () => {
    it('rejects server-scoped handlers for an unknown server id', async () => {
        const serverId = 999_999;
        const message = 'The selected server could not be found.';

        await expect(app.updateServer({ serverId, server: createServerParams({ name: 'Renamed' }) })).rejects.toThrow(message);
        await expect(app.deleteServer({ serverId })).rejects.toThrow(message);
        await expect(app.reorderServer({ serverId, toIndex: 0 })).rejects.toThrow(message);
        await expect(app.selectServer({ serverId })).rejects.toThrow(message);
        await expect(app.createConnection(createConnectionParams(serverId))).rejects.toThrow(message);
        await expect(app.createConnectionFromServerSchema({ serverId, schemaName: 'main' })).rejects.toThrow(message);
        await expect(app.createDatabase({ serverId, databaseName: 'main' })).rejects.toThrow(message);
        await expect(app.setVisibleServerSchemas({ serverId, schemaNames: [] })).rejects.toThrow(message);
        await expect(app.getServerSchemas({ serverId })).rejects.toThrow(message);
        await expect(app.refreshServerSchemas({ serverId })).rejects.toThrow(message);
        // resolveDatabaseFilePath is synchronous, so it throws before a promise exists.
        expect(() => app.resolveDatabaseFilePath({ serverId })).toThrow(message);
    });

    it('rejects connection-scoped handlers for an unknown connection id', async () => {
        const connectionId = 999_999;
        const message = 'The selected connection could not be found.';

        await expect(app.updateConnection({ connectionId, connection: { name: 'Renamed' } })).rejects.toThrow(message);
        await expect(app.hideConnection({ connectionId })).rejects.toThrow(message);
        await expect(app.reorderConnection({ connectionId, serverId: 1, toIndex: 0 })).rejects.toThrow(message);
        await expect(app.selectConnection({ connectionId })).rejects.toThrow(message);
        await expect(app.disconnectConnection({ connectionId })).rejects.toThrow(message);
        await expect(app.getTables({ connectionId })).rejects.toThrow(message);
        await expect(app.getTableInfo({ connectionId, tableName: 'widgets' })).rejects.toThrow(message);
        await expect(app.getTableDdl({ connectionId, tableName: 'widgets' })).rejects.toThrow(message);
        await expect(app.refreshConnectionSchema({ connectionId })).rejects.toThrow(message);
        await expect(app.refreshTableInfo({ connectionId, tableName: 'widgets' })).rejects.toThrow(message);
        await expect(app.dropTable({ connectionId, tableName: 'widgets' })).rejects.toThrow(message);
        await expect(app.getTableData({ connectionId, tableName: 'widgets' })).rejects.toThrow(message);
        await expect(app.peekFkUsages({ connectionId, tableName: 'widgets', columnName: 'id', rowValues: {} })).rejects.toThrow(message);
        await expect(
            app.peekFkUsageRows({
                connectionId,
                relation: { sourceTable: 'widgets', targetTable: 'widgets', columns: [{ sourceColumn: 'id', targetColumn: 'id' }] },
                rowValues: {},
                limit: 10,
            })
        ).rejects.toThrow(message);
        await expect(app.runQuery({ connectionId, sql: 'SELECT 1' })).rejects.toThrow(message);
        await expect(app.updateColumn({ connectionId, tableName: 'widgets', targetColumn: 'label', value: 'x', matchColumn: 'id', matchValue: 1 })).rejects.toThrow(message);
        await expect(app.applyTableChanges({ connectionId, tableName: 'widgets', changes: [] })).rejects.toThrow(message);
        await expect(app.modifyTable({ connectionId, tableName: 'widgets', columns: [] })).rejects.toThrow(message);
        await expect(app.createScript({ connectionId, name: 'Script' })).rejects.toThrow(message);
        await expect(app.getSqlDiagnostics({ sql: 'SELECT 1', connectionId })).rejects.toThrow(message);
        await expect(app.getMysqldumpExportDefaults({ connectionId })).rejects.toThrow(message);
    });

    it('rejects script-scoped handlers for an unknown script id', async () => {
        const scriptId = 999_999;
        const message = 'The selected script could not be found.';
        const { connectionId } = await createFileSource();

        await expect(app.updateScript({ scriptId, script: { name: 'Renamed', sqlText: '' } })).rejects.toThrow(message);
        await expect(app.deleteScript({ scriptId })).rejects.toThrow(message);
        await expect(app.reorderScript({ scriptId, connectionId, toIndex: 0 })).rejects.toThrow(message);
        await expect(app.selectScript({ scriptId })).rejects.toThrow(message);
        await expect(app.runQuery({ connectionId, sql: 'SELECT 1', scriptId })).rejects.toThrow(message);
        await expect(app.getRunSqlScriptStatus({ runId: 'missing-run' })).rejects.toThrow('The SQL script run could not be found. It may have been cancelled or expired.');
    });

    it('createServer validates the name, the driver, the file path and the host', async () => {
        await expect(app.createServer(createServerParams({ name: '   ' }))).rejects.toThrow('Server name is required.');
        await expect(app.createServer(createServerParams({ driver: '   ' as DbType }))).rejects.toThrow('Driver is required.');
        await expect(app.createServer(createServerParams({ filePath: '   ' }))).rejects.toThrow('A file path is required for file-based servers.');
        await expect(app.createServer(createServerParams({ kind: 'server', filePath: undefined, host: undefined }))).rejects.toThrow(
            'A host is required for server-based entries.'
        );
    });

    it('updateServer requires a non-empty name', async () => {
        const { serverId, filePath } = await createFileSource();

        await expect(app.updateServer({ serverId, server: createServerParams({ name: '   ', filePath }) })).rejects.toThrow('Server name is required.');
    });

    it('createConnection and testConnection validate the name and the port', async () => {
        const { serverId } = await createFileSource();

        await expect(app.createConnection(createConnectionParams(serverId, { name: '   ' }))).rejects.toThrow('Connection name is required.');
        await expect(app.createConnection(createConnectionParams(serverId, { port: Number.NaN }))).rejects.toThrow('Port must be a valid number.');
        await expect(app.createConnection(createConnectionParams(serverId, { port: 70_000 }))).rejects.toThrow('Port must be between 1 and 65535.');
        await expect(app.testConnection({ kind: 'file', driver: 'sqlite', port: Number.NaN })).rejects.toThrow('Port must be a valid number.');
    });

    it('createConnectionFromServerSchema requires a server entry and a schema name', async () => {
        const { serverId: fileServerId } = await createFileSource();

        await expect(app.createConnectionFromServerSchema({ serverId: fileServerId, schemaName: 'main' })).rejects.toThrow(
            'Schema-based connections are only supported for server-based entries.'
        );

        const remoteServerId = await createRemoteServer();
        await expect(app.createConnectionFromServerSchema({ serverId: remoteServerId, schemaName: '   ' })).rejects.toThrow('Schema name is required.');
    });

    it('createDatabase requires a server-based entry and a database name', async () => {
        const { serverId: fileServerId } = await createFileSource();

        await expect(app.createDatabase({ serverId: fileServerId, databaseName: 'app' })).rejects.toThrow('Creating databases is only supported for server-based entries.');

        const remoteServerId = await createRemoteServer();
        await expect(app.createDatabase({ serverId: remoteServerId, databaseName: '   ' })).rejects.toThrow('Database name is required.');
    });

    it('resolveDatabaseFilePath requires a file-backed server', async () => {
        const remoteServerId = await createRemoteServer();

        expect(() => app.resolveDatabaseFilePath({ serverId: remoteServerId })).toThrow('The selected server does not point to a local database file.');
    });

    it('createScript and updateScript require a script name', async () => {
        const { connectionId } = await createFileSource();

        await expect(app.createScript({ connectionId, name: '   ' })).rejects.toThrow('Script name is required.');

        const scriptId = await createScript(connectionId, 'First');

        await expect(app.updateScript({ scriptId, script: { name: '   ', sqlText: '' } })).rejects.toThrow('Script name is required.');
    });

    it('getRunSqlScriptDefaults and startRunSqlScript validate the script file', async () => {
        const { connectionId } = await createFileSource();
        const missingPath = join(tempDir, 'missing.sql');

        await expect(app.getRunSqlScriptDefaults({ connectionId, filePath: '   ' })).rejects.toThrow('A SQL script file is required.');
        await expect(app.startRunSqlScript({ connectionId, filePath: '   ' })).rejects.toThrow('A SQL script file is required.');
        await expect(app.getRunSqlScriptDefaults({ connectionId, filePath: missingPath })).rejects.toThrow(`The SQL script file was not found at: ${missingPath}`);
        await expect(app.startRunSqlScript({ connectionId, filePath: missingPath })).rejects.toThrow(`The SQL script file was not found at: ${missingPath}`);
        await expect(app.getRunSqlScriptDefaults({ connectionId, filePath: tempDir })).rejects.toThrow('The selected SQL script path is not a file.');
    });

    it('exportWithMysqldump validates the driver, the executable, the host and the database', async () => {
        const { connectionId: sqliteConnectionId } = await createFileSource();
        const params = (connectionId: number, overrides: Partial<MysqldumpExportParams> = {}): MysqldumpExportParams => ({
            connectionId,
            executable: mysqldumpStub(),
            outputPath: join(tempDir, 'dump.sql'),
            databases: 'app',
            options: mysqldumpOptions,
            ...overrides,
        });

        await expect(app.exportWithMysqldump(params(sqliteConnectionId))).rejects.toThrow('Export with mysqldump is only supported for MySQL connections.');

        const { connectionId } = seedRemoteConnection({ host: '127.0.0.1', databaseName: null });
        const missingExecutable = join(tempDir, 'missing-mysqldump');

        await expect(app.exportWithMysqldump(params(connectionId, { executable: '   ' }))).rejects.toThrow('The mysqldump executable path is required.');
        await expect(app.exportWithMysqldump(params(connectionId, { executable: missingExecutable }))).rejects.toThrow(
            `The mysqldump executable was not found at: ${missingExecutable}`
        );
        await expect(app.exportWithMysqldump(params(connectionId, { databases: '   ' }))).rejects.toThrow('A database name is required to run the export.');

        const { connectionId: hostlessConnectionId } = seedRemoteConnection({ host: null, databaseName: null });
        await expect(app.exportWithMysqldump(params(hostlessConnectionId))).rejects.toThrow('The selected connection is missing its host.');
    });

    it('reports a connection whose server row is missing', async () => {
        const connectionId = seedOrphanConnection();
        const message = 'The server for the selected connection could not be found.';
        const filePath = scriptFile();

        await expect(app.getMysqldumpExportDefaults({ connectionId })).rejects.toThrow(message);
        await expect(app.getRunSqlScriptDefaults({ connectionId, filePath })).rejects.toThrow(message);
        await expect(app.startRunSqlScript({ connectionId, filePath })).rejects.toThrow(message);
        await expect(
            app.exportWithMysqldump({ connectionId, executable: mysqldumpStub(), outputPath: join(tempDir, 'dump.sql'), databases: 'app', options: mysqldumpOptions })
        ).rejects.toThrow(message);
        await expect(app.peekFkUsages({ connectionId, tableName: 'widgets', columnName: 'id', rowValues: {} })).rejects.toThrow(message);
        await expect(
            app.peekFkUsageRows({
                connectionId,
                relation: { sourceTable: 'widgets', targetTable: 'widgets', columns: [{ sourceColumn: 'id', targetColumn: 'id' }] },
                rowValues: {},
                limit: 10,
            })
        ).rejects.toThrow(message);
    });

    it('table and query handlers validate their input', async () => {
        const { connectionId } = await createFileSource();

        await expect(app.runQuery({ connectionId, sql: '   ' })).rejects.toThrow('SQL is required.');
        await expect(app.getTableInfo({ connectionId, tableName: '  ' })).rejects.toThrow('Table name is required.');
        await expect(app.getTableDdl({ connectionId, tableName: '  ' })).rejects.toThrow('Table name is required.');
        await expect(app.getTableData({ connectionId, tableName: '  ' })).rejects.toThrow('Table name is required.');
        await expect(app.dropTable({ connectionId, tableName: '  ' })).rejects.toThrow('Table name is required.');
    });

    it('grid formatter handlers validate their input', () => {
        // These handlers are synchronous: they throw before a promise exists.
        expect(() => app.saveGridCustomFormatter({ formatter: { name: '   ', template: 'return value;' } })).toThrow('Formatter name is required.');
        expect(() => app.saveGridCustomFormatter({ formatter: { name: 'Upper case', template: '   ' } })).toThrow('Formatter template is required.');
        expect(() => app.deleteGridCustomFormatter({ formatterId: '   ' })).toThrow('Formatter id is required.');
        expect(() => app.setGridColumnFormatter({ connectionId: 1, tableName: '  ', columnName: 'label' })).toThrow('Table and column are required.');
        expect(() => app.setGridColumnFormatter({ connectionId: 1, tableName: 'widgets', columnName: 'label', formatterId: 'missing-formatter' })).toThrow(
            'The selected formatter no longer exists.'
        );
    });
});

describe('server round trips', () => {
    it('createServer stores a file source in the temp database and returns it', async () => {
        const filePath = createSqliteFile('local.sqlite');

        const bootstrap = await app.createServer(createServerParams({ name: 'Local DB', filePath }));
        const [persisted] = queryRows<{ id: number }>('SELECT id FROM servers');

        expect(bootstrap.selectedServerId).toBe(persisted!.id);
        expect(
            bootstrap.servers.map((server) => ({
                id: server.id,
                name: server.name,
                kind: server.kind,
                driver: server.driver,
                file_path: server.file_path,
                sequence: server.sequence,
            }))
        ).toEqual([{ id: persisted!.id, name: 'Local DB', kind: 'file', driver: 'sqlite', file_path: filePath, sequence: 1 }]);
        expect(bootstrap.connections).toEqual([]);
        expect(
            queryRows<{ name: string; kind: string; driver: string; file_path: string; host: string | null; port: number | null }>(
                'SELECT name, kind, driver, file_path, host, port FROM servers'
            )
        ).toEqual([{ name: 'Local DB', kind: 'file', driver: 'sqlite', file_path: filePath, host: null, port: null }]);
    });

    it('getBootstrap returns the stored server, connection and selection', async () => {
        const { serverId, connectionId } = await createFileSource('Local SQLite');

        const bootstrap = await app.getBootstrap();

        expect(bootstrap.servers.map((server) => [server.id, server.name, server.driver])).toEqual([[serverId, 'Local SQLite', 'sqlite']]);
        expect(bootstrap.connections.map((connection) => [connection.id, connection.name, connection.server_id])).toEqual([[connectionId, 'Local SQLite connection', serverId]]);
        expect(queryRows<{ hidden: number }>('SELECT hidden FROM connections WHERE id = ?', connectionId)).toEqual([{ hidden: 0 }]);
        expect(bootstrap.selectedServerId).toBe(serverId);
        expect(bootstrap.selectedConnectionId).toBe(connectionId);
        expect(bootstrap.selectedScriptId).toBeUndefined();
        expect(bootstrap.scripts).toEqual([]);
    });

    it('updateServer renames the stored server', async () => {
        const { serverId, filePath } = await createFileSource('Before');

        const bootstrap = await app.updateServer({ serverId, server: createServerParams({ name: 'After', filePath }) });

        expect(bootstrap.servers.map((server) => server.name)).toEqual(['After']);
        expect(queryRows<{ name: string; file_path: string }>('SELECT name, file_path FROM servers WHERE id = ?', serverId)).toEqual([{ name: 'After', file_path: filePath }]);
    });

    it('deleteServer removes the server, its connections and its stored password', async () => {
        const { serverId } = await createFileSource();

        const bootstrap = await app.deleteServer({ serverId });

        expect(bootstrap.servers).toEqual([]);
        expect(bootstrap.connections).toEqual([]);
        expect(bootstrap.selectedServerId).toBeUndefined();
        expect(queryRows('SELECT id FROM servers')).toEqual([]);
        expect(queryRows('SELECT id FROM connections')).toEqual([]);
        expect(queryRows<{ key: string }>('SELECT key FROM settings WHERE key = ?', `serverSchemas:${serverId}`)).toEqual([]);
        expect(authMocks.deleteServerPassword).toHaveBeenCalledWith(serverId);
        // A file source must never write a keychain secret.
        expect(authMocks.storeServerPassword).not.toHaveBeenCalled();
    });

    it('reorderServer moves a server to the requested index', async () => {
        const first = await createFileSource('First');
        const second = await createFileSource('Second');
        expect((await app.getBootstrap()).servers.map((server) => server.name)).toEqual(['First', 'Second']);

        const bootstrap = await app.reorderServer({ serverId: first.serverId, toIndex: 1 });

        expect(bootstrap.servers.map((server) => [server.id, server.name])).toEqual([
            [second.serverId, 'Second'],
            [first.serverId, 'First'],
        ]);
        expect(queryRows<{ name: string }>('SELECT name FROM servers ORDER BY sequence ASC')).toEqual([{ name: 'Second' }, { name: 'First' }]);
    });

    it('selectServer persists the selection and falls back to the first server when cleared', async () => {
        const first = await createFileSource('First');
        const second = await createFileSource('Second');

        const selected = await app.selectServer({ serverId: second.serverId });
        expect(selected.selectedServerId).toBe(second.serverId);
        expect(queryRows<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'selectedServerId')).toEqual([{ value: String(second.serverId) }]);

        // Clearing the setting does not empty the selection: buildBootstrap re-selects servers[0].
        const cleared = await app.selectServer({ serverId: undefined });
        expect(cleared.selectedServerId).toBe(first.serverId);
    });

    it('resolveDatabaseFilePath returns the local file path of a file source', async () => {
        const { serverId, filePath } = await createFileSource();

        expect(app.resolveDatabaseFilePath({ serverId })).toBe(filePath);
    });
});

describe('connection round trips', () => {
    it('createConnection stores the connection and selects it', async () => {
        const filePath = createSqliteFile('local.sqlite');
        const created = await app.createServer(createServerParams({ name: 'Local DB', filePath }));
        const serverId = created.selectedServerId!;

        const bootstrap = await app.createConnection(createConnectionParams(serverId, { name: 'Read only', readonly: true }));

        expect(bootstrap.selectedConnectionId).toBe(bootstrap.connections[0]?.id);
        expect(
            bootstrap.connections.map((connection) => ({
                id: connection.id,
                server_id: connection.server_id,
                name: connection.name,
                database_name: connection.database_name,
                readonly: connection.readonly,
            }))
        ).toEqual([{ id: bootstrap.selectedConnectionId, server_id: serverId, name: 'Read only', database_name: undefined, readonly: 1 }]);
        expect(queryRows<{ name: string; readonly: number; hidden: number }>('SELECT name, readonly, hidden FROM connections WHERE server_id = ?', serverId)).toEqual([
            { name: 'Read only', readonly: 1, hidden: 0 },
        ]);
    });

    it('updateConnection rewrites the stored row', async () => {
        const { connectionId } = await createFileSource('Local DB');

        const bootstrap = await app.updateConnection({
            connectionId,
            connection: { name: 'Reporting', host: 'db.example', port: 3307, databaseName: 'reporting', readonly: true },
        });

        expect(
            bootstrap.connections.map((connection) => ({
                id: connection.id,
                name: connection.name,
                host: connection.host,
                port: connection.port,
                database_name: connection.database_name,
                readonly: connection.readonly,
            }))
        ).toEqual([{ id: connectionId, name: 'Reporting', host: 'db.example', port: 3307, database_name: 'reporting', readonly: 1 }]);
        expect(queryRows('SELECT name, host, port, database_name, readonly FROM connections WHERE id = ?', connectionId)).toEqual([
            { name: 'Reporting', host: 'db.example', port: 3307, database_name: 'reporting', readonly: 1 },
        ]);
    });

    it('hideConnection hides the row but keeps the connection data', async () => {
        const { serverId, connectionId } = await createFileSource('Local DB');

        const bootstrap = await app.hideConnection({ connectionId });

        expect(bootstrap.connections).toEqual([]);
        expect(bootstrap.selectedConnectionId).toBeUndefined();
        expect(bootstrap.servers.map((server) => server.id)).toEqual([serverId]);
        expect(queryRows<{ name: string; hidden: number }>('SELECT name, hidden FROM connections WHERE id = ?', connectionId)).toEqual([
            { name: 'Local DB connection', hidden: 1 },
        ]);
        expect(queryRows<{ name: string }>('SELECT name FROM connections')).toEqual([{ name: 'Local DB connection' }]);
    });

    it('setVisibleServerSchemas creates, hides and revives schema connections', async () => {
        const filePath = createSqliteFile('schemas.sqlite');
        const created = await app.createServer(createServerParams({ name: 'Schema DB', filePath }));
        const serverId = created.selectedServerId!;

        // Blank and duplicate names are dropped before any row is written.
        const withBoth = await app.setVisibleServerSchemas({ serverId, schemaNames: [' main ', 'reporting', 'main', '  '] });
        expect(withBoth.connections.map((connection) => [connection.name, connection.database_name])).toEqual([
            ['main', 'main'],
            ['reporting', 'reporting'],
        ]);
        const mainId = withBoth.connections[0]!.id;
        const reportingId = withBoth.connections[1]!.id;

        const onlyMain = await app.setVisibleServerSchemas({ serverId, schemaNames: ['main'] });
        expect(onlyMain.connections.map((connection) => [connection.id, connection.name])).toEqual([[mainId, 'main']]);
        expect(queryRows<{ id: number; hidden: number }>('SELECT id, hidden FROM connections WHERE server_id = ? ORDER BY sequence ASC', serverId)).toEqual([
            { id: mainId, hidden: 0 },
            { id: reportingId, hidden: 1 },
        ]);

        const revived = await app.setVisibleServerSchemas({ serverId, schemaNames: ['main', 'reporting'] });
        expect(revived.connections.map((connection) => [connection.id, connection.name])).toEqual([
            [mainId, 'main'],
            [reportingId, 'reporting'],
        ]);
    });

    it('reorderConnection moves a connection within its server', async () => {
        const { serverId } = await createFileSource('Local DB');
        const before = await app.createConnection(createConnectionParams(serverId, { name: 'Second' }));
        const secondId = before.connections.find((connection) => connection.name === 'Second')!.id;

        const bootstrap = await app.reorderConnection({ connectionId: secondId, serverId, toIndex: 0 });

        expect(bootstrap.connections.map((connection) => connection.name)).toEqual(['Second', 'Local DB connection']);
        expect(queryRows<{ name: string }>('SELECT name FROM connections WHERE server_id = ? ORDER BY sequence ASC', serverId)).toEqual([
            { name: 'Second' },
            { name: 'Local DB connection' },
        ]);
    });
});

describe('script round trips', () => {
    it('createScript appends the script and selects it', async () => {
        const { connectionId } = await createFileSource();

        const bootstrap = await app.createScript({ connectionId, name: 'First', groupName: 'Setup', sqlText: 'SELECT 1;' });

        expect(bootstrap.selectedConnectionId).toBe(connectionId);
        expect(
            bootstrap.scripts.map((script) => ({
                id: script.id,
                connection_id: script.connection_id,
                name: script.name,
                group_name: script.group_name,
                sql_text: script.sql_text,
                sequence: script.sequence,
            }))
        ).toEqual([{ id: bootstrap.selectedScriptId, connection_id: connectionId, name: 'First', group_name: 'Setup', sql_text: 'SELECT 1;', sequence: 1 }]);
        expect(queryRows('SELECT connection_id, name, group_name, sql_text, sequence FROM scripts')).toEqual([
            { connection_id: connectionId, name: 'First', group_name: 'Setup', sql_text: 'SELECT 1;', sequence: 1 },
        ]);
    });

    it('updateScript rewrites the stored script', async () => {
        const { connectionId } = await createFileSource();
        const scriptId = await createScript(connectionId, 'First', { sqlText: 'SELECT 1;' });

        const bootstrap = await app.updateScript({ scriptId, script: { name: 'Renamed', groupName: 'Ops', sqlText: 'SELECT 2;' } });

        expect(bootstrap.scripts.map((script) => ({ id: script.id, name: script.name, group_name: script.group_name, sql_text: script.sql_text }))).toEqual([
            { id: scriptId, name: 'Renamed', group_name: 'Ops', sql_text: 'SELECT 2;' },
        ]);
        expect(queryRows('SELECT name, group_name, sql_text FROM scripts WHERE id = ?', scriptId)).toEqual([{ name: 'Renamed', group_name: 'Ops', sql_text: 'SELECT 2;' }]);
    });

    it('reorderScript moves a script within its connection', async () => {
        const { connectionId } = await createFileSource();
        const firstId = await createScript(connectionId, 'First');
        const secondId = await createScript(connectionId, 'Second');

        const bootstrap = await app.reorderScript({ scriptId: firstId, connectionId, toIndex: 1 });

        expect(bootstrap.scripts.map((script) => [script.id, script.name])).toEqual([
            [secondId, 'Second'],
            [firstId, 'First'],
        ]);
        expect(queryRows<{ name: string }>('SELECT name FROM scripts WHERE connection_id = ? ORDER BY sequence ASC', connectionId)).toEqual([
            { name: 'Second' },
            { name: 'First' },
        ]);
    });

    it('deleteScript removes the script and renumbers the rest', async () => {
        const { connectionId } = await createFileSource();
        const firstId = await createScript(connectionId, 'First');
        const secondId = await createScript(connectionId, 'Second');

        const bootstrap = await app.deleteScript({ scriptId: firstId });

        expect(bootstrap.scripts.map((script) => [script.id, script.name, script.sequence])).toEqual([[secondId, 'Second', 1]]);
        expect(queryRows<{ id: number; sequence: number }>('SELECT id, sequence FROM scripts')).toEqual([{ id: secondId, sequence: 1 }]);
    });

    it('selectScript persists the selected script and its connection', async () => {
        const { serverId } = await createFileSource();
        const other = await app.createConnection(createConnectionParams(serverId, { name: 'Other' }));
        const otherConnectionId = other.connections.find((connection) => connection.name === 'Other')!.id;
        const scriptId = await createScript(otherConnectionId, 'Other script');

        const bootstrap = await app.selectScript({ scriptId });

        expect(bootstrap.selectedScriptId).toBe(scriptId);
        expect(bootstrap.selectedConnectionId).toBe(otherConnectionId);
        expect(queryRows<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'selectedScriptId')).toEqual([{ value: String(scriptId) }]);
    });

    it('getRunSqlScriptDefaults describes the script file for a driver-backed run', async () => {
        const { connectionId } = await createFileSource('Local DB');
        const filePath = scriptFile('run.sql');

        const defaults = await app.getRunSqlScriptDefaults({ connectionId, filePath });

        expect(defaults).toEqual({
            connectionId,
            driver: 'sqlite',
            database: 'Local DB connection',
            dataSource: 'Local DB connection',
            runner: 'driver',
            executable: undefined,
            scriptName: 'run.sql',
            scriptPath: filePath,
            scriptSize: 10,
        });
    });
});

describe('settings round trips', () => {
    it('getEditorSettings returns the documented defaults on a fresh database', async () => {
        const settings = app.getEditorSettings();

        expect(settings).toEqual({
            queryRowLimit: 100,
            activeView: 'servers',
            collectionFilter: { connections: { tables: true, views: true }, tables: { columns: true, keys: true, indexes: true } },
        });
        expect(JSON.parse(queryRows<{ value: string }>("SELECT value FROM settings WHERE key = 'editorSettings'")[0]!.value)).toEqual(settings);
    });

    it('updateEditorSettings round-trips the stored settings object', async () => {
        const settings: EditorSettings = {
            queryRowLimit: 250,
            activeView: 'query',
            collectionFilter: { connections: { tables: false, views: true }, tables: { columns: true, keys: false, indexes: true } },
        };

        expect(app.updateEditorSettings({ settings })).toEqual(settings);
        expect(app.getEditorSettings()).toEqual(settings);
        expect(JSON.parse(queryRows<{ value: string }>("SELECT value FROM settings WHERE key = 'editorSettings'")[0]!.value)).toEqual(settings);
    });

    it('updateEditorSettings clamps and normalizes out-of-range values', async () => {
        const defaults = app.getEditorSettings();

        const clamped = app.updateEditorSettings({ settings: { ...defaults, queryRowLimit: 5_000, activeView: 'nope' as EditorSettings['activeView'] } });
        expect(clamped.queryRowLimit).toBe(1000);
        expect(clamped.activeView).toBe('servers');

        expect(app.updateEditorSettings({ settings: { ...clamped, queryRowLimit: -5 } }).queryRowLimit).toBe(-1);
    });

    it('saveGridCustomFormatter round-trips a formatter and its column assignment', async () => {
        const saved = app.saveGridCustomFormatter({ formatter: { name: 'Upper case', template: 'return String(value).toUpperCase();' } });

        expect(saved).toHaveLength(1);
        expect(saved[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(saved[0]).toMatchObject({ name: 'Upper case', template: 'return String(value).toUpperCase();' });
        expect(app.getGridCustomFormatters().map((formatter) => formatter.name)).toEqual(['Upper case']);

        const formatterId = saved[0]!.id;
        const assigned = app.setGridColumnFormatter({ connectionId: 7, tableName: 'widgets', columnName: 'label', formatterId });

        expect(assigned.columnFormatterIds).toEqual({ label: formatterId });
        expect(app.getGridFormatterState({ connectionId: 7, tableName: 'widgets' })).toEqual({ formatters: saved, columnFormatterIds: { label: formatterId } });

        expect(app.deleteGridCustomFormatter({ formatterId })).toEqual([]);
        expect(app.getGridCustomFormatters()).toEqual([]);
        expect(queryRows<{ key: string }>("SELECT key FROM settings WHERE key LIKE 'gridColumnFormatters:%'")).toEqual([]);
    });
});
