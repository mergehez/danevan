// @vitest-environment node
// The app DB's upgrade path is a record, not a pile of `CREATE TABLE IF NOT EXISTS`: a table that
// already exists never gains a column, so an older DB needs a step to run — and a half-finished
// upgrade (the column is there, the version was never stamped) must not fail the boot.
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../electronUtils/useDatabase.ts';
import { APP_DB_SCHEMA_VERSION, configureAppDbSchema, readAppDbSchemaVersion, runAppDbMigrations, type AppDbMigration } from '../../../backend/appDbSchema.ts';

let databasePath = '';

/** The same client shape the app uses, over a real file, so a transaction really rolls back. */
function createClient(path = databasePath): DatabaseClient {
    const file = new Database(path);

    return {
        exec: (sql: string) => {
            file.exec(sql);
        },
        prepare: (sql: string) => {
            const statement = file.prepare(sql);

            return {
                run: (...params: Parameters<typeof statement.run>) => statement.run(...params),
                get: <T>(...params: Parameters<typeof statement.get>) => statement.get(...params) as T | undefined,
                all: <T>(...params: Parameters<typeof statement.all>) => statement.all(...params) as T[],
            };
        },
        close: () => {
            file.close();
        },
    };
}

function columnNames(client: DatabaseClient, tableName: string) {
    return client
        .prepare(`PRAGMA table_info(${tableName})`)
        .all<{ name: string }>()
        .map((column) => column.name);
}

function serverNames(client: DatabaseClient) {
    return client
        .prepare('SELECT name FROM servers ORDER BY id')
        .all<{ name: string }>()
        .map((row) => row.name);
}

/** A database the build before the version record wrote: no `hidden` column, version 0. */
function createLegacyClient(options: { withHiddenColumn?: boolean } = {}) {
    const file = new Database(databasePath);
    file.exec(`
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            driver TEXT NOT NULL,
            sequence INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            readonly INTEGER NOT NULL DEFAULT 0,
            sequence INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE scripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            sql_text TEXT NOT NULL DEFAULT '',
            sequence INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO servers (name, kind, driver) VALUES ('legacy source', 'file', 'sqlite');
        INSERT INTO connections (server_id, name) VALUES (1, 'legacy connection');
        INSERT INTO settings (key, value) VALUES ('selectedServerId', '1');
    `);

    if (options.withHiddenColumn) {
        file.exec('ALTER TABLE connections ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;');
    }

    file.close();

    return createClient();
}

beforeEach(() => {
    databasePath = join(mkdtempSync(join(tmpdir(), 'danevan-app-db-')), 'danevan.sqlite');
});

afterEach(() => {
    rmSync(dirname(databasePath), { recursive: true, force: true });
});

describe('a fresh app database', () => {
    it('is created at the current schema version', () => {
        const client = createClient();

        try {
            expect(readAppDbSchemaVersion(client)).toBe(0);
            expect(configureAppDbSchema(client)).toBe(APP_DB_SCHEMA_VERSION);

            expect(readAppDbSchemaVersion(client)).toBe(APP_DB_SCHEMA_VERSION);
            expect(columnNames(client, 'connections')).toContain('hidden');
            expect(columnNames(client, 'servers')).toContain('sequence');
            expect(columnNames(client, 'scripts')).toContain('group_name');
        } finally {
            client.close();
        }
    });

    it('can be configured again without changing anything', () => {
        const client = createClient();

        try {
            configureAppDbSchema(client);
            const before = client.prepare('SELECT type, name FROM sqlite_master ORDER BY name').all();

            expect(runAppDbMigrations(client)).toBe(APP_DB_SCHEMA_VERSION);
            expect(client.prepare('SELECT type, name FROM sqlite_master ORDER BY name').all()).toEqual(before);
        } finally {
            client.close();
        }
    });
});

describe('an app database from an older build', () => {
    it('gains the columns it is missing and keeps its rows', () => {
        const client = createLegacyClient();

        try {
            expect(configureAppDbSchema(client)).toBe(APP_DB_SCHEMA_VERSION);

            expect(columnNames(client, 'connections')).toContain('hidden');
            expect(serverNames(client)).toEqual(['legacy source']);
            expect(client.prepare("SELECT value FROM settings WHERE key = 'selectedServerId'").get()).toEqual({ value: '1' });
        } finally {
            client.close();
        }
    });

    it('boots a half-finished upgrade whose column is already there', () => {
        // What the old build left behind when it added `hidden` by hand: the shape is current,
        // the version record is not.
        const client = createLegacyClient({ withHiddenColumn: true });

        try {
            expect(configureAppDbSchema(client)).toBe(APP_DB_SCHEMA_VERSION);
            expect(columnNames(client, 'connections')).toContain('hidden');
            expect(serverNames(client)).toEqual(['legacy source']);
        } finally {
            client.close();
        }
    });

    it('refuses a database a newer build wrote instead of downgrading it', () => {
        const client = createClient();

        try {
            client.exec(`PRAGMA user_version = ${APP_DB_SCHEMA_VERSION + 1};`);

            expect(() => configureAppDbSchema(client)).toThrow(
                `The app database was written by a newer Danevan (schema ${APP_DB_SCHEMA_VERSION + 1}, this build understands ${APP_DB_SCHEMA_VERSION}).`
            );
            // The version it started from survives, so the newer build still recognises it.
            expect(readAppDbSchemaVersion(client)).toBe(APP_DB_SCHEMA_VERSION + 1);
        } finally {
            client.close();
        }
    });
});

describe('a migration that fails', () => {
    const failingMigration: AppDbMigration = {
        version: 1,
        name: 'break-halfway',
        migrate: (db) => {
            db.exec('CREATE TABLE half_written (id INTEGER PRIMARY KEY);');
            throw new Error('disk went away');
        },
    };

    it('reports the step and leaves the version and the schema it started from', () => {
        const client = createClient();

        try {
            expect(() => runAppDbMigrations(client, [failingMigration])).toThrow('App database migration 1 (break-halfway) failed: disk went away');
            expect(readAppDbSchemaVersion(client)).toBe(0);
            expect(client.prepare("SELECT name FROM sqlite_master WHERE name = 'half_written'").all()).toEqual([]);
        } finally {
            client.close();
        }
    });
});
