// @vitest-environment node
// db-app keeps a module-level SQLite singleton and configureDatabase() returns
// early once it is set, so every test resets the module registry and configures
// its own temp database instead of sharing one.
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { CreateConnectionParams, CreateScriptParams, CreateServerParams, DbType } from '../../../shared/types';

const DATABASE_FILE_NAME = 'danevan.sqlite';
const timestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

let tempDir = '';
let warnSpy: MockInstance;

async function loadAppDb() {
    vi.resetModules();
    const { useAppDb } = await import('../../../backend/db-app');
    return useAppDb();
}

async function configureAppDb(userDataDir: string = tempDir) {
    const appDb = await loadAppDb();
    appDb.configureDatabase(userDataDir);
    return appDb;
}

type AppDb = Awaited<ReturnType<typeof loadAppDb>>;

function databasePath() {
    return join(tempDir, DATABASE_FILE_NAME);
}

/** Reads through a separate connection, so assertions cannot be satisfied by module state alone. */
function openDatabaseFile() {
    return new Database(databasePath());
}

function queryRows<T>(sql: string, ...params: Array<string | number>) {
    const file = openDatabaseFile();
    try {
        return file.prepare(sql).all(...params) as T[];
    } finally {
        file.close();
    }
}

function runStatement(sql: string, ...params: Array<string | number | null>) {
    const file = openDatabaseFile();
    try {
        file.prepare(sql).run(...params);
    } finally {
        file.close();
    }
}

function sequencesOf(table: 'servers' | 'connections' | 'scripts', ids: number[]) {
    return ids.map((id) => queryRows<{ sequence: number }>(`SELECT sequence FROM ${table} WHERE id = ?`, id)[0]?.sequence);
}

function settingKeys() {
    return queryRows<{ key: string }>('SELECT key FROM settings ORDER BY key').map((row) => row.key);
}

function serverNames(appDb: AppDb) {
    return appDb.listServers().map((server) => server.name);
}

function connectionNames(appDb: AppDb, serverId?: number, options?: { includeHidden?: boolean }) {
    return appDb.listConnections(serverId, options).map((connection) => connection.name);
}

function scriptNames(appDb: AppDb, connectionId?: number) {
    return appDb.listScripts(connectionId).map((script) => script.name);
}

function createServer(appDb: AppDb, overrides: Partial<Omit<CreateServerParams, 'password'>> = {}) {
    return appDb.createServer({
        name: 'Server',
        kind: 'server',
        driver: 'mysql',
        filePath: undefined,
        host: undefined,
        port: undefined,
        username: undefined,
        ...overrides,
    });
}

function createConnection(appDb: AppDb, serverId: number, overrides: Partial<Omit<CreateConnectionParams, 'password'>> = {}) {
    return appDb.createConnection({
        serverId,
        name: 'Connection',
        host: undefined,
        port: undefined,
        databaseName: undefined,
        readonly: false,
        ...overrides,
    });
}

function createScript(appDb: AppDb, connectionId: number, overrides: Partial<Omit<CreateScriptParams, 'connectionId'>> = {}) {
    return appDb.createScript({ connectionId, name: 'Script', ...overrides });
}

beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'danevan-appdb-'));
    // createDbClient logs the path and setSetting logs the key; cleanupLegacySettings
    // warns about stale keys, which is asserted where it matters.
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    // Recursive removal also takes the WAL and shared-memory files.
    rmSync(tempDir, { recursive: true, force: true });
});

describe('configureDatabase', () => {
    it('creates the schema, the database file and records the data directory', async () => {
        const appDb = await configureAppDb();

        expect(appDb.getUserDataDir()).toBe(tempDir);
        expect(existsSync(databasePath())).toBe(true);
        expect(queryRows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((table) => table.name)).toEqual([
            'connections',
            'scripts',
            'servers',
            'settings',
        ]);
        expect(queryRows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").map((index) => index.name)).toEqual([
            'idx_connections_server_id',
            'idx_scripts_connection_id',
        ]);
        expect(queryRows<{ journal_mode: string }>('PRAGMA journal_mode')[0]?.journal_mode).toBe('wal');
    });

    it('keeps the first configuration when called again', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb, { name: 'Kept' });
        const ignoredDir = join(tempDir, 'ignored');

        appDb.configureDatabase(ignoredDir);

        expect(appDb.getUserDataDir()).toBe(tempDir);
        expect(appDb.serverExists(serverId)).toBe(true);
        expect(existsSync(join(ignoredDir, DATABASE_FILE_NAME))).toBe(false);
    });

    it('throws before the data directory is configured', async () => {
        const appDb = await loadAppDb();

        expect(() => appDb.getUserDataDir()).toThrow('Application data directory is not configured yet.');
    });
});

describe('legacy database migration', () => {
    it('adds the hidden column to a database written before hide-database', async () => {
        // The pre-hide-database schema: everything the current build writes except `hidden`.
        const file = openDatabaseFile();
        file.exec(`
            CREATE TABLE servers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL, kind TEXT NOT NULL, driver TEXT NOT NULL,
                file_path TEXT, host TEXT, port INTEGER, schema_count INTEGER, username TEXT,
                sequence INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_id INTEGER NOT NULL, name TEXT NOT NULL,
                host TEXT, port INTEGER, database_name TEXT,
                readonly INTEGER NOT NULL DEFAULT 0,
                sequence INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_used_at TEXT
            );
            INSERT INTO servers(id, name, kind, driver, sequence) VALUES (1, 'Legacy server', 'server', 'mysql', 1);
            INSERT INTO connections(id, server_id, name, sequence) VALUES (7, 1, 'Legacy connection', 1);
        `);
        file.close();

        const appDb = await configureAppDb();

        expect(queryRows<{ name: string }>('PRAGMA table_info(connections)').map((column) => column.name)).toContain('hidden');
        expect(appDb.getConnection(7)?.name).toBe('Legacy connection');
        expect(appDb.getConnection(7)?.hidden).toBe(0);
        expect(appDb.listConnections(1)).toHaveLength(1);
    });

    it('drops legacy settings caches and reports keys this build does not know', async () => {
        const file = openDatabaseFile();
        file.exec(`
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO settings(key, value) VALUES ('tableInfo:1:people', '{}'), ('someFutureCache', '{}'), ('editorSettings', '{}');
        `);
        file.close();

        await configureAppDb();

        expect(settingKeys()).toEqual(['editorSettings', 'someFutureCache']);
        expect(warnSpy).toHaveBeenCalledWith('[appDb] settings keys not read by this build: someFutureCache');
    });
});

describe('servers', () => {
    it('persists every field and trims surrounding whitespace', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb, {
            name: '  Test MySQL Server  ',
            driver: 'mysql',
            host: '  db.example.com  ',
            port: 3306,
            username: '  admin  ',
        });

        const server = appDb.getServer(serverId)!;

        expect(serverId).toBeGreaterThan(0);
        expect(server.name).toBe('Test MySQL Server');
        expect(server.kind).toBe('server');
        expect(server.driver).toBe('mysql');
        expect(server.host).toBe('db.example.com');
        expect(server.port).toBe(3306);
        expect(server.username).toBe('admin');
        expect(server.file_path).toBeUndefined();
        expect(server.schema_count).toBeUndefined();
        expect(server.sequence).toBe(1);
        expect(server.created_at).toMatch(timestampPattern);
        expect(server.updated_at).toMatch(timestampPattern);
    });

    it('stores blank optional text as NULL', async () => {
        const appDb = await configureAppDb();
        // Blank optionals are stored as SQL NULL; the app DB client normalises the
        // columns back to `undefined` so they match the `string | undefined` row types.
        const serverId = createServer(appDb, { filePath: '   ', host: '\t', username: '\n ' });

        const server = appDb.getServer(serverId)!;

        expect(server.file_path).toBeUndefined();
        expect(server.host).toBeUndefined();
        expect(server.username).toBeUndefined();
        // The raw column really is NULL on disk.
        expect(queryRows<{ file_path: null }>('SELECT file_path FROM servers WHERE id = ?', serverId)[0]?.file_path).toBeNull();
    });

    it('assigns an incrementing sequence per server', async () => {
        const appDb = await configureAppDb();
        const first = createServer(appDb, { name: 'First' });
        const second = createServer(appDb, { name: 'Second' });
        const third = createServer(appDb, { name: 'Third' });

        expect(sequencesOf('servers', [first, second, third])).toEqual([1, 2, 3]);
    });

    it('lists servers ordered by sequence', async () => {
        const appDb = await configureAppDb();
        const first = createServer(appDb, { name: 'First' });
        const second = createServer(appDb, { name: 'Second' });
        const third = createServer(appDb, { name: 'Third' });

        appDb.reorderServer(second, 0);

        expect(appDb.listServers().map((server) => server.id)).toEqual([second, first, third]);
    });

    it('rejects a blank name and a blank driver', async () => {
        const appDb = await configureAppDb();

        expect(() => createServer(appDb, { name: '   ' })).toThrow('Server name is required.');
        expect(() => createServer(appDb, { name: '' })).toThrow('Server name is required.');
        expect(() => createServer(appDb, { driver: '   ' as DbType })).toThrow('Server driver is required.');
        expect(() => createServer(appDb, { driver: '' as DbType })).toThrow('Server driver is required.');
        expect(appDb.listServers()).toEqual([]);
    });

    it('updates every field, trims text and blanks optional text', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb, { name: 'Original', host: 'old.example.com', port: 3306, username: 'user1' });

        appDb.updateServer(serverId, {
            name: '  Updated  ',
            kind: 'server',
            driver: 'postgresql',
            filePath: '  /tmp/app.sqlite  ',
            host: '  new.example.com  ',
            port: 5433,
            username: '   ',
        });

        const server = appDb.getServer(serverId)!;

        expect(server.name).toBe('Updated');
        expect(server.driver).toBe('postgresql');
        expect(server.file_path).toBe('/tmp/app.sqlite');
        expect(server.host).toBe('new.example.com');
        expect(server.port).toBe(5433);
        expect(server.username).toBeUndefined();
    });

    it('sets the schema count', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);

        appDb.updateServerSchemaMetadata(serverId, { schemaCount: 42 });

        expect(appDb.getServer(serverId)!.schema_count).toBe(42);
    });

    it('reorders a server and renormalises the sequences', async () => {
        const appDb = await configureAppDb();
        const first = createServer(appDb, { name: 'First' });
        const second = createServer(appDb, { name: 'Second' });
        const third = createServer(appDb, { name: 'Third' });

        appDb.reorderServer(third, 0);

        expect(serverNames(appDb)).toEqual(['Third', 'First', 'Second']);
        expect(sequencesOf('servers', [third, first, second])).toEqual([1, 2, 3]);
    });

    it('clamps an out-of-range reorder index instead of corrupting the order', async () => {
        const appDb = await configureAppDb();
        const first = createServer(appDb, { name: 'First' });
        const second = createServer(appDb, { name: 'Second' });
        const third = createServer(appDb, { name: 'Third' });

        appDb.reorderServer(first, 99);
        expect(serverNames(appDb)).toEqual(['Second', 'Third', 'First']);

        appDb.reorderServer(first, -5);
        expect(serverNames(appDb)).toEqual(['First', 'Second', 'Third']);
        expect(sequencesOf('servers', [first, second, third])).toEqual([1, 2, 3]);
    });

    it('ignores a reorder to the current position', async () => {
        const appDb = await configureAppDb();
        const first = createServer(appDb, { name: 'First' });
        const second = createServer(appDb, { name: 'Second' });

        appDb.reorderServer(first, 0);

        expect(serverNames(appDb)).toEqual(['First', 'Second']);
        expect(sequencesOf('servers', [first, second])).toEqual([1, 2]);
    });

    it('throws when reordering an unknown server', async () => {
        const appDb = await configureAppDb();
        createServer(appDb, { name: 'First' });

        expect(() => appDb.reorderServer(999, 0)).toThrow('The selected server could not be found.');
    });

    it('deletes a server, renormalises the sequences and cascades to its rows', async () => {
        const appDb = await configureAppDb();
        const first = createServer(appDb, { name: 'First' });
        const second = createServer(appDb, { name: 'Second' });
        const third = createServer(appDb, { name: 'Third' });
        const connectionId = createConnection(appDb, second, { name: 'Doomed connection' });
        const scriptId = createScript(appDb, connectionId, { name: 'Doomed script' });

        appDb.deleteServer(second);

        expect(serverNames(appDb)).toEqual(['First', 'Third']);
        expect(sequencesOf('servers', [first, third])).toEqual([1, 2]);
        expect(appDb.serverExists(second)).toBe(false);
        // PRAGMA foreign_keys = ON plus ON DELETE CASCADE removes the children.
        expect(appDb.connectionExists(connectionId)).toBe(false);
        expect(appDb.getConnection(connectionId)).toBeUndefined();
        expect(appDb.scriptExists(scriptId)).toBe(false);
        expect(appDb.getScript(scriptId)).toBeUndefined();
        expect(appDb.listConnections(second, { includeHidden: true })).toEqual([]);
    });
});

describe('connections', () => {
    it('starts the per-server sequence at 1', async () => {
        const appDb = await configureAppDb();
        const serverA = createServer(appDb, { name: 'A' });
        const serverB = createServer(appDb, { name: 'B' });

        const firstA = createConnection(appDb, serverA, { name: 'A1' });
        const secondA = createConnection(appDb, serverA, { name: 'A2' });
        const firstB = createConnection(appDb, serverB, { name: 'B1' });

        expect(sequencesOf('connections', [firstA, secondA, firstB])).toEqual([1, 2, 1]);
    });

    it('round-trips the readonly flag and trims the database name', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);

        const writable = createConnection(appDb, serverId, { name: 'Writable', readonly: false, databaseName: '  mydb  ' });
        const readonly = createConnection(appDb, serverId, { name: 'Readonly', readonly: true, databaseName: 'other' });

        expect(appDb.getConnection(writable)!.readonly).toBe(0);
        expect(appDb.getConnection(readonly)!.readonly).toBe(1);
        expect(appDb.getConnection(writable)!.database_name).toBe('mydb');

        appDb.updateConnection(writable, { name: 'Writable', readonly: true });

        expect(appDb.getConnection(writable)!.readonly).toBe(1);
    });

    it('stores blank host and database name as NULL', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);

        const connectionId = createConnection(appDb, serverId, { host: '   ', databaseName: '\t' });

        const connection = appDb.getConnection(connectionId)!;

        expect(connection.host).toBeUndefined();
        expect(connection.database_name).toBeUndefined();
        expect(connection.last_used_at).toBeUndefined();
    });

    it('rejects a blank connection name', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);

        expect(() => createConnection(appDb, serverId, { name: '  ' })).toThrow('Connection name is required.');
        expect(appDb.listConnections(serverId)).toEqual([]);
    });

    it('filters by server and orders by sequence', async () => {
        const appDb = await configureAppDb();
        const serverA = createServer(appDb, { name: 'A' });
        const serverB = createServer(appDb, { name: 'B' });
        createConnection(appDb, serverA, { name: 'A1' });
        const a2 = createConnection(appDb, serverA, { name: 'A2' });
        createConnection(appDb, serverB, { name: 'B1' });

        appDb.reorderConnection(a2, serverA, 0);

        expect(connectionNames(appDb, serverA)).toEqual(['A2', 'A1']);
        expect(connectionNames(appDb, serverB)).toEqual(['B1']);
    });

    it('hides hidden connections by default and re-shows them', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const first = createConnection(appDb, serverId, { name: 'First' });
        const second = createConnection(appDb, serverId, { name: 'Second' });

        appDb.setConnectionHidden(first, true);
        appDb.setConnectionHidden(second, true);

        expect(connectionNames(appDb, serverId)).toEqual([]);
        // Hidden rows survive, so their scripts stay reachable when re-shown.
        expect(connectionNames(appDb, serverId, { includeHidden: true })).toEqual(['First', 'Second']);
        expect(appDb.connectionExists(first)).toBe(true);

        appDb.setConnectionHidden(first, false);

        expect(connectionNames(appDb, serverId)).toEqual(['First']);
    });

    it('returns every server connections ordered by server then sequence', async () => {
        const appDb = await configureAppDb();
        const serverA = createServer(appDb, { name: 'A' });
        const serverB = createServer(appDb, { name: 'B' });
        createConnection(appDb, serverB, { name: 'B1' });
        createConnection(appDb, serverA, { name: 'A1' });
        createConnection(appDb, serverB, { name: 'B2' });
        const a2 = createConnection(appDb, serverA, { name: 'A2' });
        appDb.setConnectionHidden(a2, true);

        expect(connectionNames(appDb)).toEqual(['A1', 'B1', 'B2']);
        expect(connectionNames(appDb, undefined, { includeHidden: true })).toEqual(['A1', 'A2', 'B1', 'B2']);
    });

    it('updates a connection and throws for an unknown one', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionId = createConnection(appDb, serverId, { name: 'Original' });

        appDb.updateConnection(connectionId, {
            name: '  Updated  ',
            host: '  new.example.com  ',
            port: 1434,
            databaseName: '  updated_db  ',
            readonly: true,
        });

        const connection = appDb.getConnection(connectionId)!;

        expect(connection.name).toBe('Updated');
        expect(connection.host).toBe('new.example.com');
        expect(connection.port).toBe(1434);
        expect(connection.database_name).toBe('updated_db');
        expect(connection.readonly).toBe(1);
        expect(connection.server_id).toBe(serverId);
        expect(connection.last_used_at).toBeUndefined();

        expect(() => appDb.updateConnection(999, { name: 'Nope' })).toThrow('The selected connection could not be found.');
    });

    it('moves a connection to another server and renormalises both servers', async () => {
        const appDb = await configureAppDb();
        const serverA = createServer(appDb, { name: 'A' });
        const serverB = createServer(appDb, { name: 'B' });
        const firstA = createConnection(appDb, serverA, { name: 'A1' });
        const moved = createConnection(appDb, serverA, { name: 'A2' });
        const thirdA = createConnection(appDb, serverA, { name: 'A3' });
        const firstB = createConnection(appDb, serverB, { name: 'B1' });

        appDb.updateConnection(moved, { serverId: serverB, name: 'A2' });

        expect(connectionNames(appDb, serverA)).toEqual(['A1', 'A3']);
        expect(connectionNames(appDb, serverB)).toEqual(['B1', 'A2']);
        expect(sequencesOf('connections', [firstA, thirdA])).toEqual([1, 2]);
        expect(sequencesOf('connections', [firstB, moved])).toEqual([1, 2]);
        expect(appDb.getConnection(moved)!.server_id).toBe(serverB);
    });

    it('reorders a connection within its server and renormalises', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const first = createConnection(appDb, serverId, { name: 'First' });
        const second = createConnection(appDb, serverId, { name: 'Second' });
        const third = createConnection(appDb, serverId, { name: 'Third' });

        appDb.reorderConnection(third, serverId, 0);

        expect(connectionNames(appDb, serverId)).toEqual(['Third', 'First', 'Second']);
        expect(sequencesOf('connections', [third, first, second])).toEqual([1, 2, 3]);
    });

    it('clamps connection reorder indexes', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const first = createConnection(appDb, serverId, { name: 'First' });
        const second = createConnection(appDb, serverId, { name: 'Second' });
        const third = createConnection(appDb, serverId, { name: 'Third' });

        appDb.reorderConnection(first, serverId, 99);
        expect(connectionNames(appDb, serverId)).toEqual(['Second', 'Third', 'First']);

        appDb.reorderConnection(first, serverId, -3);
        expect(connectionNames(appDb, serverId)).toEqual(['First', 'Second', 'Third']);
        expect(sequencesOf('connections', [first, second, third])).toEqual([1, 2, 3]);
    });

    it('throws when reordering an unknown connection', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        createConnection(appDb, serverId, { name: 'Only' });

        expect(() => appDb.reorderConnection(999, serverId, 0)).toThrow('The selected connection could not be found.');
    });

    it('records the last used timestamp', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionId = createConnection(appDb, serverId);
        runStatement("UPDATE connections SET updated_at = '2000-01-01 00:00:00', last_used_at = NULL WHERE id = ?", connectionId);

        appDb.touchConnectionLastUsed(connectionId);

        const connection = appDb.getConnection(connectionId)!;

        expect(connection.last_used_at).toMatch(timestampPattern);
        expect(connection.updated_at).toMatch(timestampPattern);
        expect(connection.updated_at).not.toBe('2000-01-01 00:00:00');
    });

    describe('port normalisation', () => {
        it('rejects a port that is not a finite number', async () => {
            const appDb = await configureAppDb();
            const serverId = createServer(appDb);
            const connectionId = createConnection(appDb, serverId);

            for (const port of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
                expect(() => createConnection(appDb, serverId, { port })).toThrow('Port must be a valid number.');
                expect(() => appDb.updateConnection(connectionId, { name: 'Connection', port })).toThrow('Port must be a valid number.');
            }
        });

        it('rejects a port outside 1..65535', async () => {
            const appDb = await configureAppDb();
            const serverId = createServer(appDb);
            const connectionId = createConnection(appDb, serverId);

            for (const port of [0, -1, 70000]) {
                expect(() => createConnection(appDb, serverId, { port })).toThrow('Port must be between 1 and 65535.');
                expect(() => appDb.updateConnection(connectionId, { name: 'Connection', port })).toThrow('Port must be between 1 and 65535.');
            }
        });

        it('truncates a fractional port and stores an omitted port as NULL', async () => {
            const appDb = await configureAppDb();
            const serverId = createServer(appDb);

            const connectionId = createConnection(appDb, serverId, { port: 3306.9 });
            expect(appDb.getConnection(connectionId)!.port).toBe(3306);

            appDb.updateConnection(connectionId, { name: 'Connection', port: 5432.7 });
            expect(appDb.getConnection(connectionId)!.port).toBe(5432);

            appDb.updateConnection(connectionId, { name: 'Connection', port: undefined });
            expect(appDb.getConnection(connectionId)!.port).toBeUndefined();

            expect(appDb.getConnection(createConnection(appDb, serverId))!.port).toBeUndefined();
        });
    });
});

describe('scripts', () => {
    it('creates a script with a per-connection sequence', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionA = createConnection(appDb, serverId, { name: 'A' });
        const connectionB = createConnection(appDb, serverId, { name: 'B' });

        const firstA = createScript(appDb, connectionA, { name: 'A1' });
        const secondA = createScript(appDb, connectionA, { name: 'A2' });
        const firstB = createScript(appDb, connectionB, { name: 'B1' });

        expect(firstA).toBeGreaterThan(0);
        expect(sequencesOf('scripts', [firstA, secondA, firstB])).toEqual([1, 2, 1]);
        expect(appDb.getScript(firstA)!.connection_id).toBe(connectionA);
    });

    it('stores a blank group name as NULL and defaults the SQL text to empty', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionId = createConnection(appDb, serverId);

        const scriptId = createScript(appDb, connectionId, { groupName: '   ' });

        const script = appDb.getScript(scriptId)!;

        expect(script.group_name).toBeUndefined();
        expect(script.sql_text).toBe('');
        expect(script.sequence).toBe(1);
        expect(script.last_run_at).toBeUndefined();
    });

    it('rejects a blank script name', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionId = createConnection(appDb, serverId);

        expect(() => createScript(appDb, connectionId, { name: '  ' })).toThrow('Script name is required.');
        expect(appDb.listScripts(connectionId)).toEqual([]);
    });

    it('lists scripts per connection and across all connections', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionA = createConnection(appDb, serverId, { name: 'A' });
        const connectionB = createConnection(appDb, serverId, { name: 'B' });
        createScript(appDb, connectionA, { name: 'A1' });
        createScript(appDb, connectionA, { name: 'A2' });
        createScript(appDb, connectionB, { name: 'B1' });

        expect(scriptNames(appDb, connectionA)).toEqual(['A1', 'A2']);
        expect(scriptNames(appDb, connectionB)).toEqual(['B1']);
        expect(scriptNames(appDb)).toEqual(['A1', 'A2', 'B1']);
    });

    it('updates a script and throws for an unknown one', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionId = createConnection(appDb, serverId);
        const scriptId = createScript(appDb, connectionId, { name: 'Original' });

        appDb.updateScript(scriptId, { name: '  Updated  ', groupName: '  Group  ', sqlText: 'SELECT 1' });

        const script = appDb.getScript(scriptId)!;

        expect(script.name).toBe('Updated');
        expect(script.group_name).toBe('Group');
        expect(script.sql_text).toBe('SELECT 1');
        expect(script.connection_id).toBe(connectionId);

        expect(() => appDb.updateScript(999, { name: 'Nope', sqlText: '' })).toThrow('The selected script could not be found.');
    });

    it('moves a script to another connection and renormalises both connections', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionA = createConnection(appDb, serverId, { name: 'A' });
        const connectionB = createConnection(appDb, serverId, { name: 'B' });
        const firstA = createScript(appDb, connectionA, { name: 'A1' });
        const moved = createScript(appDb, connectionA, { name: 'A2' });
        const thirdA = createScript(appDb, connectionA, { name: 'A3' });
        const firstB = createScript(appDb, connectionB, { name: 'B1' });

        appDb.updateScript(moved, { connectionId: connectionB, name: 'A2', sqlText: 'SELECT 1' });

        expect(scriptNames(appDb, connectionA)).toEqual(['A1', 'A3']);
        expect(scriptNames(appDb, connectionB)).toEqual(['B1', 'A2']);
        expect(sequencesOf('scripts', [firstA, thirdA])).toEqual([1, 2]);
        expect(sequencesOf('scripts', [firstB, moved])).toEqual([1, 2]);
        expect(appDb.getScript(moved)!.connection_id).toBe(connectionB);
    });

    it('reorders scripts, renormalises and clamps', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionId = createConnection(appDb, serverId);
        const first = createScript(appDb, connectionId, { name: 'First' });
        const second = createScript(appDb, connectionId, { name: 'Second' });
        const third = createScript(appDb, connectionId, { name: 'Third' });

        appDb.reorderScript(third, connectionId, 0);
        expect(scriptNames(appDb, connectionId)).toEqual(['Third', 'First', 'Second']);

        appDb.reorderScript(third, connectionId, 99);
        expect(scriptNames(appDb, connectionId)).toEqual(['First', 'Second', 'Third']);
        expect(sequencesOf('scripts', [first, second, third])).toEqual([1, 2, 3]);
    });

    it('throws when reordering an unknown script', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionId = createConnection(appDb, serverId);
        createScript(appDb, connectionId, { name: 'Only' });

        expect(() => appDb.reorderScript(999, connectionId, 0)).toThrow('The selected script could not be found.');
    });

    it('deletes a script and renormalises the remaining sequences', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionId = createConnection(appDb, serverId);
        const first = createScript(appDb, connectionId, { name: 'First' });
        const second = createScript(appDb, connectionId, { name: 'Second' });
        const third = createScript(appDb, connectionId, { name: 'Third' });

        appDb.deleteScript(second);

        expect(appDb.scriptExists(second)).toBe(false);
        expect(appDb.getScript(second)).toBeUndefined();
        expect(scriptNames(appDb, connectionId)).toEqual(['First', 'Third']);
        expect(sequencesOf('scripts', [first, third])).toEqual([1, 2]);
    });

    it('records the last run timestamp', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionId = createConnection(appDb, serverId);
        const scriptId = createScript(appDb, connectionId);
        runStatement("UPDATE scripts SET updated_at = '2000-01-01 00:00:00', last_run_at = NULL WHERE id = ?", scriptId);

        appDb.touchScriptLastRun(scriptId);

        const script = appDb.getScript(scriptId)!;

        expect(script.last_run_at).toMatch(timestampPattern);
        expect(script.updated_at).toMatch(timestampPattern);
        expect(script.updated_at).not.toBe('2000-01-01 00:00:00');
    });
});

describe('existence helpers', () => {
    it('reports whether a row exists', async () => {
        const appDb = await configureAppDb();
        const serverId = createServer(appDb);
        const connectionId = createConnection(appDb, serverId);
        const scriptId = createScript(appDb, connectionId);

        expect(appDb.serverExists(serverId)).toBe(true);
        expect(appDb.connectionExists(connectionId)).toBe(true);
        expect(appDb.scriptExists(scriptId)).toBe(true);

        expect(appDb.serverExists(999)).toBe(false);
        expect(appDb.connectionExists(999)).toBe(false);
        expect(appDb.scriptExists(999)).toBe(false);
    });
});

describe('settings', () => {
    it('round-trips JSON values', async () => {
        const appDb = await configureAppDb();
        const object = { nested: { count: 2 }, list: [1, 2] };
        const array = [1, 'two', false];

        appDb.setSetting('object', object);
        appDb.setSetting('array', array);
        appDb.setSetting('number', 42);
        appDb.setSetting('string', 'hello');

        expect(appDb.getSetting('object', null)).toEqual(object);
        expect(appDb.getSetting('array', null)).toEqual(array);
        expect(appDb.getSetting('number', null)).toBe(42);
        expect(appDb.getSetting('string', null)).toBe('hello');
    });

    it('returns the fallback for a missing key', async () => {
        const appDb = await configureAppDb();

        expect(appDb.getSetting('missing', 'fallback')).toBe('fallback');
        expect(appDb.getSetting('missing', { mode: 'dark' })).toEqual({ mode: 'dark' });
    });

    it('overwrites an existing key instead of duplicating it', async () => {
        const appDb = await configureAppDb();
        appDb.setSetting('theme', 'light');
        appDb.setSetting('theme', 'dark');

        expect(appDb.getSetting('theme', 'fallback')).toBe('dark');
        expect(queryRows<{ count: number }>('SELECT COUNT(*) AS count FROM settings WHERE key = ?', 'theme')).toEqual([{ count: 1 }]);
    });

    it('upserts a batch and ignores an empty batch', async () => {
        const appDb = await configureAppDb();
        appDb.setSetting('kept', 'original');

        appDb.setSettings([]);
        expect(settingKeys()).toEqual(['kept']);

        appDb.setSettings([
            { key: 'kept', value: 'updated' },
            { key: 'added', value: [1, 2, 3] },
        ]);

        expect(appDb.getSetting('kept', '')).toBe('updated');
        expect(appDb.getSetting('added', [])).toEqual([1, 2, 3]);
        expect(settingKeys()).toEqual(['added', 'kept']);
    });

    it('deletes one setting', async () => {
        const appDb = await configureAppDb();
        appDb.setSetting('first', 1);
        appDb.setSetting('second', 2);

        appDb.deleteSetting('first');

        expect(appDb.getSetting('first', 'gone')).toBe('gone');
        expect(appDb.getSetting('second', 0)).toBe(2);
    });

    it('deletes several settings and ignores an empty key list', async () => {
        const appDb = await configureAppDb();
        appDb.setSetting('first', 1);
        appDb.setSetting('second', 2);
        appDb.setSetting('third', 3);

        appDb.deleteSettings([]);
        expect(settingKeys()).toEqual(['first', 'second', 'third']);

        appDb.deleteSettings(['first', 'third']);
        expect(settingKeys()).toEqual(['second']);
    });

    it('deletes settings by prefix', async () => {
        const appDb = await configureAppDb();
        appDb.setSetting('gridColumnFormatters:1:a', 1);
        appDb.setSetting('gridColumnFormatters:1:b', 2);
        appDb.setSetting('editorSettings', '{}');

        appDb.deleteSettingsByPrefix('gridColumnFormatters:');

        expect(settingKeys()).toEqual(['editorSettings']);
    });

    it('deletes settings by several prefixes and ignores an empty list', async () => {
        const appDb = await configureAppDb();
        appDb.setSetting('serverSchemas:1', []);
        appDb.setSetting('gridColumnFormatters:1:a', 1);
        appDb.setSetting('editorSettings', '{}');

        appDb.deleteSettingsByPrefixes([]);
        expect(settingKeys()).toEqual(['editorSettings', 'gridColumnFormatters:1:a', 'serverSchemas:1']);

        appDb.deleteSettingsByPrefixes(['serverSchemas:', 'gridColumnFormatters:']);
        expect(settingKeys()).toEqual(['editorSettings']);
    });
});

describe('getStoredServerCount', () => {
    it('returns undefined when the database file does not exist', async () => {
        const appDb = await loadAppDb();

        expect(appDb.getStoredServerCount(tempDir)).toBeUndefined();
    });

    it('returns undefined when the file has no servers table', async () => {
        const file = openDatabaseFile();
        file.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
        file.close();

        const appDb = await loadAppDb();

        expect(appDb.getStoredServerCount(tempDir)).toBeUndefined();
    });

    it('counts the stored servers', async () => {
        const appDb = await configureAppDb();
        createServer(appDb, { name: 'First' });
        createServer(appDb, { name: 'Second' });

        expect(appDb.getStoredServerCount(tempDir)).toBe(2);
    });
});
