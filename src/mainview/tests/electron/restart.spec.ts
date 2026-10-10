// A relaunch, not a `page.reload()`: the shell is killed and started again against the same app DB,
// so what a user typed in the last session has to be there when the app comes back — including the
// writes that were still in the write-ahead log when the process died. The app DB also records the
// schema version it was upgraded to, and an older or half-upgraded file must still boot.
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { APP_DB_SCHEMA_VERSION } from '../../../backend/appDbSchema.ts';
import { closeShell, createAppDataDir, launchShell, openAppWindow, post, readAppDbVersion, requireShellBuild } from './helpers';

type Bootstrap = {
    servers: Array<{ id: number; name: string }>;
    connections: Array<{ id: number; name: string }>;
    scripts: Array<{ id: number; name: string }>;
    selectedServerId: number | undefined;
    selectedConnectionId: number | undefined;
    selectedScriptId: number | undefined;
};

function appDatabasePath(appDataDir: string) {
    return join(appDataDir, 'danevan.sqlite');
}

function withAppDatabase<T>(appDataDir: string, callback: (database: Database.Database) => T): T {
    const database = new Database(appDatabasePath(appDataDir));

    try {
        return callback(database);
    } finally {
        database.close();
    }
}

/** A SQLite file the shell can add as a source; the source list is what a relaunch has to keep. */
function createSourceFile(appDataDir: string) {
    const sourcePath = join(appDataDir, 'source.sqlite');
    const file = new Database(sourcePath);
    file.exec('CREATE TABLE people (id integer primary key, name text)');
    file.close();

    return sourcePath;
}

/** The app DB the build before the schema record wrote: no `hidden` column and `user_version` 0. */
function createLegacyAppDatabase(appDataDir: string, options: { withHiddenColumn?: boolean } = {}) {
    const database = new Database(appDatabasePath(appDataDir));
    database.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            driver TEXT NOT NULL,
            file_path TEXT,
            host TEXT,
            port INTEGER,
            schema_count INTEGER,
            username TEXT,
            sequence INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            host TEXT,
            port INTEGER,
            database_name TEXT,
            readonly INTEGER NOT NULL DEFAULT 0,
            sequence INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_used_at TEXT,
            FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
        );
        CREATE TABLE scripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            group_name TEXT,
            sql_text TEXT NOT NULL DEFAULT '',
            sequence INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_run_at TEXT,
            FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
        );
        INSERT INTO servers (name, kind, driver, sequence) VALUES ('legacy source', 'file', 'sqlite', 1);
        INSERT INTO connections (server_id, name, sequence) VALUES (1, 'legacy connection', 1);
        INSERT INTO scripts (connection_id, name, sql_text, sequence) VALUES (1, 'legacy script', 'select 1;', 1);
        INSERT INTO settings (key, value) VALUES ('selectedServerId', '1'), ('selectedConnectionId', '1');
    `);

    if (options.withHiddenColumn) {
        database.exec('ALTER TABLE connections ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;');
    }

    database.close();
}

test.beforeAll(() => {
    requireShellBuild();
});

test('keeps the sources and scripts a previous launch stored', async () => {
    const appDataDir = createAppDataDir('danevan-relaunch-');
    const sourcePath = createSourceFile(appDataDir);
    let connectionId: number | undefined;
    let scriptId: number | undefined;

    const first = await launchShell(appDataDir);

    try {
        await openAppWindow(first);

        const serverBootstrap = (await post('createServer', { name: 'relaunch source', kind: 'file', driver: 'sqlite', filePath: sourcePath })) as Bootstrap;
        const serverId = serverBootstrap.servers.find((server) => server.name === 'relaunch source')?.id;
        const connectionBootstrap = (await post('createConnection', { serverId, name: 'relaunch connection' })) as Bootstrap;
        connectionId = connectionBootstrap.connections.find((connection) => connection.name === 'relaunch connection')?.id;
        const scriptBootstrap = (await post('createScript', { connectionId, name: 'relaunch script', sqlText: 'select 42 as kept;' })) as Bootstrap;
        scriptId = scriptBootstrap.scripts.find((script) => script.name === 'relaunch script')?.id;
    } finally {
        // Killed, not quit: the writes of this session are still in the WAL when the next launch opens.
        await first.close();
    }

    const second = await launchShell(appDataDir);

    try {
        await openAppWindow(second);

        const bootstrap = (await post('getBootstrap')) as Bootstrap;

        expect(bootstrap.servers.map((server) => server.name)).toContain('relaunch source');
        expect(bootstrap.connections.map((connection) => connection.name)).toContain('relaunch connection');
        expect(bootstrap.scripts.map((script) => script.name)).toContain('relaunch script');
        // The selection the last session left behind comes back with the rows.
        expect(bootstrap.selectedConnectionId).toBe(connectionId);
        expect(bootstrap.selectedScriptId).toBe(scriptId);

        expect(readAppDbVersion(appDataDir)).toBe(APP_DB_SCHEMA_VERSION);
    } finally {
        await closeShell(second, appDataDir);
    }
});

test('upgrades the app database the previous build wrote and keeps its rows', async () => {
    const appDataDir = createAppDataDir('danevan-legacy-');
    createLegacyAppDatabase(appDataDir);

    const app = await launchShell(appDataDir);

    try {
        await openAppWindow(app);

        const bootstrap = (await post('getBootstrap')) as Bootstrap;
        expect(bootstrap.servers.map((server) => server.name)).toEqual(['legacy source']);
        expect(bootstrap.scripts.map((script) => script.name)).toEqual(['legacy script']);

        withAppDatabase(appDataDir, (database) => {
            expect(database.prepare('PRAGMA table_info(connections)').all()).toContainEqual(expect.objectContaining({ name: 'hidden' }));
        });
        expect(readAppDbVersion(appDataDir)).toBe(APP_DB_SCHEMA_VERSION);
    } finally {
        await closeShell(app, appDataDir);
    }
});

test('boots an app database whose upgrade was left half finished', async () => {
    // The old build added `hidden` by hand without recording a version, so the shape is current
    // while `user_version` still says 0.
    const appDataDir = createAppDataDir('danevan-half-upgraded-');
    createLegacyAppDatabase(appDataDir, { withHiddenColumn: true });

    const app = await launchShell(appDataDir);

    try {
        await openAppWindow(app);

        expect(((await post('getBootstrap')) as Bootstrap).servers.map((server) => server.name)).toEqual(['legacy source']);
        expect(readAppDbVersion(appDataDir)).toBe(APP_DB_SCHEMA_VERSION);
    } finally {
        await closeShell(app, appDataDir);
    }
});
