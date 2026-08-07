import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { appConfig } from './helpers';

type SQLInputValue = string | number | bigint | Uint8Array | Buffer | null;
type SQLOutputValue = string | number | bigint | Uint8Array | Buffer | null;

type DatabaseRunResult = {
    lastInsertRowid: number | bigint;
};

type DatabaseStatement = {
    run: (...params: SQLInputValue[]) => DatabaseRunResult;
    get: <T = Record<string, SQLOutputValue>>(...params: SQLInputValue[]) => T | undefined;
    all: <T = Record<string, SQLOutputValue>>(...params: SQLInputValue[]) => T[];
};

export type DatabaseClient = {
    exec: (sql: string) => void;
    prepare: (sql: string) => DatabaseStatement;
    close: () => void;
};

function applyConnectionPragmas(db: Pick<DatabaseClient, 'exec'>) {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
}

function createRuntimeDatabaseClient(databasePath: string, options?: { readOnly?: boolean }): DatabaseClient {
    const db = new Database(databasePath, {
        readonly: options?.readOnly === true,
        fileMustExist: options?.readOnly === true,
        timeout: 5000,
    });

    const client: DatabaseClient = {
        exec: (sql: string) => {
            db.exec(sql);
        },
        prepare: (sql: string): DatabaseStatement => {
            const statement = db.prepare(sql);

            return {
                run: (...params: SQLInputValue[]) => {
                    const result = statement.run(...params);
                    return {
                        lastInsertRowid: result.lastInsertRowid,
                    } satisfies DatabaseRunResult;
                },
                get: <T = Record<string, SQLOutputValue>>(...params: SQLInputValue[]) => (statement.get(...params) ?? undefined) as T | undefined,
                all: <T = Record<string, SQLOutputValue>>(...params: SQLInputValue[]) => statement.all(...params) as T[],
            };
        },
        close: () => {
            db.close();
        },
    };

    applyConnectionPragmas(client);

    return client;
}

function createDbClient(userDataDir: string): DatabaseClient {
    mkdirSync(userDataDir, { recursive: true });

    console.log(`Using database path: ${join(userDataDir, appConfig.dbFileName)}`);
    const db = createRuntimeDatabaseClient(join(userDataDir, appConfig.dbFileName));

    return {
        exec: (sql: string) => db.exec(sql),
        prepare: (sql: string) => db.prepare(sql),
        close: () => db.close(),
    };
}

let db = undefined as unknown as ReturnType<typeof createDbClient>;

export function useDatabase() {
    function toNumber(value: number | bigint) {
        return typeof value === 'bigint' ? Number(value) : value;
    }
    function ensureColumn(tableName: string, columnName: string, definition: string) {
        const columns = db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();

        if (columns.some((column) => column.name === columnName)) {
            return;
        }

        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }

    function normalizeSequence(tableName: string, additionalOrderBy: string = '') {
        const rows = db.prepare(`SELECT id FROM ${tableName} ORDER BY sequence ASC, ${additionalOrderBy} created_at ASC, id ASC`).all<{ id: number }>();
        const updateSequence = db.prepare(`UPDATE ${tableName} SET sequence = ? WHERE id = ?`);
        rows.forEach((row, index) => {
            updateSequence.run(index + 1, row.id);
        });
    }

    function applySequenceOrder(tableName: string, orderedIds: number[]) {
        const updateSequence = db.prepare(`UPDATE ${tableName} SET sequence = ? WHERE id = ?`);

        orderedIds.forEach((entryId, index) => {
            updateSequence.run(index + 1, entryId);
        });
    }

    function getNextSequence(tableName: string) {
        const row = db.prepare(`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM ${tableName}`).get<{ sequence: number }>();
        return toNumber(row!.sequence) + 1;
    }

    function moveSequence(what: string, tableName: string, id: number, direction: 'up' | 'down') {
        const rows = db.prepare(`SELECT id FROM ${tableName} ORDER BY sequence ASC, created_at ASC, id ASC`).all<{ id: number }>();
        const currentIndex = rows.findIndex((row) => row.id === id);

        if (currentIndex === -1) {
            throw new Error(`The selected ${what} could not be found.`);
        }

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= rows.length) {
            return;
        }

        const orderedIds = rows.map((row) => row.id);
        const [movedId] = orderedIds.splice(currentIndex, 1);
        orderedIds.splice(targetIndex, 0, movedId!);

        applySequenceOrder(tableName, orderedIds);
    }

    function reorderSequence(what: string, tableName: string, id: number, toIndex: number) {
        const rows = db.prepare(`SELECT id FROM ${tableName} ORDER BY sequence ASC, created_at ASC, id ASC`).all<{ id: number }>();
        const currentIndex = rows.findIndex((row) => row.id === id);

        if (currentIndex === -1) {
            throw new Error(`The selected ${what} could not be found.`);
        }

        const clampedIndex = Math.max(0, Math.min(toIndex, rows.length - 1));
        if (currentIndex === clampedIndex) {
            return;
        }

        const orderedIds = rows.map((row) => row.id);
        const [movedId] = orderedIds.splice(currentIndex, 1);
        orderedIds.splice(clampedIndex, 0, movedId!);

        applySequenceOrder(tableName, orderedIds);
    }

    return {
        configureDatabase(userDataDir: string, onDbCreated: (db: DatabaseClient) => void) {
            if (db) {
                return;
            }

            db = createDbClient(userDataDir);
            db.exec(`
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    label TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    auth_kind TEXT NOT NULL,
                    username TEXT,
                    host TEXT,
                    sequence INTEGER NOT NULL DEFAULT 0,
                    is_default INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    sequence INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS repositories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    sequence INTEGER NOT NULL DEFAULT 0,
                    account_id INTEGER,
                    terminal_path TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_opened_at TEXT,
                    FOREIGN KEY (account_id) REFERENCES accounts(id)
                );
            `);

            onDbCreated(db);
        },
        createRuntimeDatabaseClient: createRuntimeDatabaseClient,
        prepare: (sql: string) => db.prepare(sql),
        exec: (sql: string) => db.exec(sql),
        close: () => db.close(),
        toNumber: toNumber,
        getSetting<T>(key: string, fallbackValue: T) {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>(key);

            if (!row) {
                return fallbackValue;
            }

            return JSON.parse(row.value) as T;
        },
        setSetting<T>(key: string, value: T) {
            db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
        },
        ensureColumn: ensureColumn,
        normalizeSequence: normalizeSequence,
        applySequenceOrder: applySequenceOrder,
        getNextSequence: getNextSequence,
        moveSequence: moveSequence,
        reorderSequence: reorderSequence,
    };
}

export function resolveAppDataDir(): string {
    const envDir = process.env.APP_DATA_DIR;
    if (envDir) return envDir;

    if (platform() === 'win32') {
        const appData = process.env.APPDATA;
        if (appData) return join(appData, appConfig.projectName);
    }

    if (platform() === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', appConfig.projectName);
    }

    return join(homedir(), '.local', 'share', appConfig.projectName);
}
