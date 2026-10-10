import type { DatabaseClient } from '../electronUtils/useDatabase.ts';

type AppDbSchemaStore = Pick<DatabaseClient, 'exec' | 'prepare'>;

/**
 * One step of the app DB's upgrade path. `version` is the `PRAGMA user_version` the step leaves
 * behind, and a step must be safe to run against a database that already has part of its change:
 * an app DB written before the version was recorded has `user_version = 0` whatever its shape.
 */
export type AppDbMigration = {
    version: number;
    name: string;
    migrate: (db: AppDbSchemaStore) => void;
};

function hasColumn(db: AppDbSchemaStore, tableName: string, columnName: string) {
    return db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all<{ name: string }>()
        .some((column) => column.name === columnName);
}

/**
 * The upgrade path, in order. A fresh app DB is created with the current shape and only stamps the
 * version; an older one runs the steps it is missing. Add a step for every schema change — the
 * bootstrap `CREATE TABLE IF NOT EXISTS` cannot add a column to a table that already exists.
 */
export const APP_DB_MIGRATIONS: AppDbMigration[] = [
    {
        version: 1,
        name: 'connection-hide-flag',
        migrate: (db) => {
            if (!hasColumn(db, 'connections', 'hidden')) {
                db.exec('ALTER TABLE connections ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;');
            }
        },
    },
];

export const APP_DB_SCHEMA_VERSION = APP_DB_MIGRATIONS.reduce((latest, migration) => Math.max(latest, migration.version), 0);

/** The version recorded in the app DB header; 0 means "before the record existed". */
export function readAppDbSchemaVersion(db: AppDbSchemaStore) {
    return Number(db.prepare('PRAGMA user_version').get<{ user_version: number }>()?.user_version ?? 0);
}

/** The tables and indexes a fresh app DB starts with, at the current shape. */
export function createAppDbTables(db: AppDbSchemaStore) {
    db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS servers (
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
        CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            host TEXT,
            port INTEGER,
            database_name TEXT,
            readonly INTEGER NOT NULL DEFAULT 0,
            hidden INTEGER NOT NULL DEFAULT 0,
            sequence INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_used_at TEXT,
            FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS scripts (
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
        CREATE INDEX IF NOT EXISTS idx_connections_server_id ON connections(server_id);
        CREATE INDEX IF NOT EXISTS idx_scripts_connection_id ON scripts(connection_id);
    `);
}

/**
 * Brings an app DB up to `APP_DB_SCHEMA_VERSION` and returns the version it now records. Each step
 * runs in its own transaction, so a step that fails leaves the version it started from — the app
 * reports the failure instead of pretending an upgrade it did not finish.
 */
export function runAppDbMigrations(db: AppDbSchemaStore, migrations: AppDbMigration[] = APP_DB_MIGRATIONS) {
    const currentVersion = readAppDbSchemaVersion(db);
    const targetVersion = migrations.reduce((latest, migration) => Math.max(latest, migration.version), 0);

    if (currentVersion > targetVersion) {
        throw new Error(
            `The app database was written by a newer Danevan (schema ${currentVersion}, this build understands ${targetVersion}). Update Danevan instead of running an older build against it.`
        );
    }

    for (const migration of [...migrations].sort((left, right) => left.version - right.version)) {
        if (migration.version <= currentVersion) {
            continue;
        }

        db.exec('BEGIN IMMEDIATE;');

        try {
            migration.migrate(db);
            db.exec(`PRAGMA user_version = ${migration.version};`);
            db.exec('COMMIT;');
        } catch (error) {
            db.exec('ROLLBACK;');
            throw new Error(`App database migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
    }

    return readAppDbSchemaVersion(db);
}

/** Creates the tables of a fresh app DB and upgrades an existing one, stamping the version it reached. */
export function configureAppDbSchema(db: AppDbSchemaStore) {
    createAppDbTables(db);

    return runAppDbMigrations(db);
}
