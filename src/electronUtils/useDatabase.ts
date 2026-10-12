import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
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
    transaction: <T>(callback: () => T) => T;
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

    // Statements are recompiled on every prepare, and the same handful of queries run on every
    // request, so the wrappers are reused. Running arbitrary SQL clears the cache because the
    // schema may have changed underneath the compiled statements.
    const statementCache = new Map<string, DatabaseStatement>();

    const client: DatabaseClient = {
        exec: (sql: string) => {
            db.exec(sql);
            statementCache.clear();
        },
        prepare: (sql: string): DatabaseStatement => {
            const cached = statementCache.get(sql);
            if (cached) {
                return cached;
            }

            const statement = db.prepare(sql);

            const prepared: DatabaseStatement = {
                run: (...params: SQLInputValue[]) => {
                    const result = statement.run(...params);
                    return {
                        lastInsertRowid: result.lastInsertRowid,
                    } satisfies DatabaseRunResult;
                },
                get: <T = Record<string, SQLOutputValue>>(...params: SQLInputValue[]) => (statement.get(...params) ?? undefined) as T | undefined,
                all: <T = Record<string, SQLOutputValue>>(...params: SQLInputValue[]) => statement.all(...params) as T[],
            };

            statementCache.set(sql, prepared);
            return prepared;
        },
        transaction: <T>(callback: () => T) => db.transaction(callback)(),
        close: () => {
            statementCache.clear();
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
        transaction: <T>(callback: () => T) => db.transaction(callback),
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

        db.transaction(() => {
            rows.forEach((row, index) => {
                updateSequence.run(index + 1, row.id);
            });
        });
    }

    function applySequenceOrder(tableName: string, orderedIds: number[]) {
        const updateSequence = db.prepare(`UPDATE ${tableName} SET sequence = ? WHERE id = ?`);

        db.transaction(() => {
            orderedIds.forEach((entryId, index) => {
                updateSequence.run(index + 1, entryId);
            });
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
            // The schema belongs to the app (`backend/services/database.ts`), which creates it in
            // onDbCreated. Creating it here as well used to win the race with `CREATE TABLE IF NOT
            // EXISTS` and left every brand-new database without the newer columns.
            db.exec('PRAGMA journal_mode = WAL;');

            onDbCreated(db);
        },
        createRuntimeDatabaseClient: createRuntimeDatabaseClient,
        prepare: (sql: string) => db.prepare(sql),
        exec: (sql: string) => db.exec(sql),
        transaction: <T>(callback: () => T) => db.transaction(callback),
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

// The data dir is resolved in its own module: the keychain needs it too, and it must not pull the
// SQLite client in with it.
export { resolveAppDataDir, resolveDefaultAppDataDir } from './appDataDir.ts';
