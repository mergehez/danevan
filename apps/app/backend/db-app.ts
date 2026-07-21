import {
    ConnectionRow,
    CreateConnectionParams,
    CreateScriptParams,
    CreateServerParams,
    ScriptRow,
    ServerRow,
    UpdateConnectionParams,
    UpdateScriptParams,
    UpdateServerParams,
} from '@utils/appClient';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

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

type DatabaseClient = {
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
        create: options?.readOnly !== true,
        readwrite: options?.readOnly !== true,
        strict: true,
    });

    const client: DatabaseClient = {
        exec: (sql: string) => {
            db.exec(sql);
        },
        prepare: (sql: string): DatabaseStatement => {
            const statement = db.query(sql);

            return {
                run: (...params: SQLInputValue[]) => statement.run(...params),
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

export const DATABASE_FILE_NAME = 'danevan.sqlite';

function createDbClient(userDataDir: string) {
    mkdirSync(userDataDir, { recursive: true });

    console.log(`App built at: 2026-07-02T08:05:54.273Z`);
    console.log(`Using database path: ${join(userDataDir, DATABASE_FILE_NAME)}`);
    const runtimeDb = createRuntimeDatabaseClient(join(userDataDir, DATABASE_FILE_NAME));

    return {
        exec: (sql: string) => runtimeDb.exec(sql),
        prepare: (sql: string) => runtimeDb.prepare(sql),
        close: () => runtimeDb.close(),
    };
}

let db = undefined as unknown as ReturnType<typeof createDbClient>;
let configuredUserDataDir = '';

function toNumber(value: number | bigint | undefined) {
    if (typeof value === 'bigint') {
        return Number(value);
    }

    return value;
}

function normalizeOptionalText(value: string | undefined) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : undefined;
}

function normalizeRequiredText(value: string, fieldName: string) {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
        throw new Error(`${fieldName} is required.`);
    }

    return normalizedValue;
}

function normalizeOptionalPort(value: number | undefined) {
    if (value == null) {
        return undefined;
    }

    if (!Number.isFinite(value)) {
        throw new Error('Port must be a valid number.');
    }

    const port = Math.trunc(value);

    if (port < 1 || port > 65535) {
        throw new Error('Port must be between 1 and 65535.');
    }

    return port;
}

export function useAppDb() {
    function normalizeServerSequences() {
        const rows = db.prepare('SELECT id FROM servers ORDER BY sequence ASC, created_at ASC, id ASC').all<{ id: number }>();
        const updateSequence = db.prepare('UPDATE servers SET sequence = ? WHERE id = ?');

        rows.forEach((row, index) => {
            updateSequence.run(index + 1, row.id);
        });
    }

    function normalizeConnectionSequences(serverId?: number) {
        const updateSequence = db.prepare('UPDATE connections SET sequence = ? WHERE id = ?');

        if (typeof serverId === 'number') {
            const rows = db.prepare('SELECT id FROM connections WHERE server_id = ? ORDER BY sequence ASC, created_at ASC, id ASC').all<{ id: number }>(serverId);

            rows.forEach((row, index) => {
                updateSequence.run(index + 1, row.id);
            });

            return;
        }

        const rows = db.prepare('SELECT id, server_id FROM connections ORDER BY server_id ASC, sequence ASC, created_at ASC, id ASC').all<{ id: number; server_id: number }>();

        let activeServerId = -1;
        let sequence = 0;

        rows.forEach((row) => {
            if (row.server_id !== activeServerId) {
                activeServerId = row.server_id;
                sequence = 1;
            } else {
                sequence += 1;
            }

            updateSequence.run(sequence, row.id);
        });
    }

    function normalizeScriptSequences(connectionId?: number) {
        const updateSequence = db.prepare('UPDATE scripts SET sequence = ? WHERE id = ?');

        if (typeof connectionId === 'number') {
            const rows = db.prepare('SELECT id FROM scripts WHERE connection_id = ? ORDER BY sequence ASC, created_at ASC, id ASC').all<{ id: number }>(connectionId);

            rows.forEach((row, index) => {
                updateSequence.run(index + 1, row.id);
            });

            return;
        }

        const rows = db
            .prepare('SELECT id, connection_id FROM scripts ORDER BY connection_id ASC, sequence ASC, created_at ASC, id ASC')
            .all<{ id: number; connection_id: number }>();

        let activeConnectionId = -1;
        let sequence = 0;

        rows.forEach((row) => {
            if (row.connection_id !== activeConnectionId) {
                activeConnectionId = row.connection_id;
                sequence = 1;
            } else {
                sequence += 1;
            }

            updateSequence.run(sequence, row.id);
        });
    }

    function getNextServerSequence() {
        const row = db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM servers').get<{ sequence: number | bigint }>();
        return (toNumber(row?.sequence) ?? 0) + 1;
    }

    function getNextConnectionSequence(serverId: number) {
        const row = db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM connections WHERE server_id = ?').get<{ sequence: number | bigint }>(serverId);

        return (toNumber(row?.sequence) ?? 0) + 1;
    }

    function getNextScriptSequence(connectionId: number) {
        const row = db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM scripts WHERE connection_id = ?').get<{ sequence: number | bigint }>(connectionId);

        return (toNumber(row?.sequence) ?? 0) + 1;
    }

    function applyOrderedSequence(tableName: 'servers' | 'connections' | 'scripts', orderedIds: number[]) {
        const updateSequence = db.prepare(`UPDATE ${tableName} SET sequence = ? WHERE id = ?`);

        orderedIds.forEach((entryId, index) => {
            updateSequence.run(index + 1, entryId);
        });
    }

    function reorderServerSequence(id: number, toIndex: number) {
        const rows = db.prepare('SELECT id FROM servers ORDER BY sequence ASC, created_at ASC, id ASC').all<{ id: number }>();
        const currentIndex = rows.findIndex((row) => row.id === id);

        if (currentIndex === -1) {
            throw new Error('The selected server could not be found.');
        }

        const clampedIndex = Math.max(0, Math.min(toIndex, rows.length - 1));
        if (clampedIndex === currentIndex) {
            return;
        }

        const orderedIds = rows.map((row) => row.id);
        const [movedId] = orderedIds.splice(currentIndex, 1);
        orderedIds.splice(clampedIndex, 0, movedId!);

        applyOrderedSequence('servers', orderedIds);
    }

    function reorderConnectionSequence(id: number, serverId: number, toIndex: number) {
        const rows = db.prepare('SELECT id FROM connections WHERE server_id = ? ORDER BY sequence ASC, created_at ASC, id ASC').all<{ id: number }>(serverId);
        const currentIndex = rows.findIndex((row) => row.id === id);

        if (currentIndex === -1) {
            throw new Error('The selected connection could not be found.');
        }

        const clampedIndex = Math.max(0, Math.min(toIndex, rows.length - 1));
        if (clampedIndex === currentIndex) {
            return;
        }

        const orderedIds = rows.map((row) => row.id);
        const [movedId] = orderedIds.splice(currentIndex, 1);
        orderedIds.splice(clampedIndex, 0, movedId!);

        applyOrderedSequence('connections', orderedIds);
    }

    function reorderScriptSequence(id: number, connectionId: number, toIndex: number) {
        const rows = db.prepare('SELECT id FROM scripts WHERE connection_id = ? ORDER BY sequence ASC, created_at ASC, id ASC').all<{ id: number }>(connectionId);
        const currentIndex = rows.findIndex((row) => row.id === id);

        if (currentIndex === -1) {
            throw new Error('The selected script could not be found.');
        }

        const clampedIndex = Math.max(0, Math.min(toIndex, rows.length - 1));
        if (clampedIndex === currentIndex) {
            return;
        }

        const orderedIds = rows.map((row) => row.id);
        const [movedId] = orderedIds.splice(currentIndex, 1);
        orderedIds.splice(clampedIndex, 0, movedId!);

        applyOrderedSequence('scripts', orderedIds);
    }

    return {
        configureDatabase(userDataDir: string) {
            if (db) {
                return;
            }

            configuredUserDataDir = userDataDir;
            db = createDbClient(userDataDir);
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

            normalizeServerSequences();
            normalizeConnectionSequences();
            normalizeScriptSequences();
        },
        getStoredServerCount(userDataDir: string) {
            const databasePath = join(userDataDir, DATABASE_FILE_NAME);

            if (!existsSync(databasePath)) {
                return undefined;
            }

            let tempDatabase: DatabaseClient | undefined = undefined;

            try {
                tempDatabase = createRuntimeDatabaseClient(databasePath, { readOnly: true });

                const hasServersTable = tempDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'servers'").get() as { name: string } | undefined;

                if (!hasServersTable) {
                    return undefined;
                }

                const row = tempDatabase.prepare('SELECT COUNT(*) AS count FROM servers').get() as {
                    count: number;
                };
                return row.count;
            } catch {
                return undefined;
            } finally {
                tempDatabase?.close();
            }
        },
        listServers() {
            return db
                .prepare(
                    `
                        SELECT id, name, kind, driver, file_path, host, port, schema_count, sequence, username, created_at, updated_at
                        FROM servers
                        ORDER BY sequence ASC, created_at ASC, id ASC
                    `
                )
                .all<ServerRow>();
        },
        listConnections(serverId?: number) {
            return typeof serverId === 'number'
                ? db
                      .prepare(
                          `
                              SELECT id, server_id, name, host, port, database_name, readonly, sequence, created_at, updated_at, last_used_at
                              FROM connections
                              WHERE server_id = ?
                              ORDER BY sequence ASC, created_at ASC, id ASC
                          `
                      )
                      .all<ConnectionRow>(serverId)
                : db
                      .prepare(
                          `
                              SELECT id, server_id, name, host, port, database_name, readonly, sequence, created_at, updated_at, last_used_at
                              FROM connections
                              ORDER BY server_id ASC, sequence ASC, created_at ASC, id ASC
                          `
                      )
                      .all<ConnectionRow>();
        },
        listScripts(connectionId?: number) {
            return typeof connectionId === 'number'
                ? db
                      .prepare(
                          `
                              SELECT id, connection_id, name, group_name, sql_text, sequence, created_at, updated_at, last_run_at
                              FROM scripts
                              WHERE connection_id = ?
                              ORDER BY sequence ASC, created_at ASC, id ASC
                          `
                      )
                      .all<ScriptRow>(connectionId)
                : db
                      .prepare(
                          `
                              SELECT id, connection_id, name, group_name, sql_text, sequence, created_at, updated_at, last_run_at
                              FROM scripts
                              ORDER BY connection_id ASC, sequence ASC, created_at ASC, id ASC
                          `
                      )
                      .all<ScriptRow>();
        },
        getServer(id: number) {
            return db.prepare('SELECT * FROM servers WHERE id = ?').get<ServerRow>(id);
        },
        getConnection(id: number) {
            return db.prepare('SELECT * FROM connections WHERE id = ?').get<ConnectionRow>(id);
        },
        getScript(id: number) {
            return db.prepare('SELECT * FROM scripts WHERE id = ?').get<ScriptRow>(id);
        },
        serverExists(id: number) {
            return Boolean(db.prepare('SELECT id FROM servers WHERE id = ?').get<{ id: number }>(id));
        },
        connectionExists(id: number) {
            return Boolean(db.prepare('SELECT id FROM connections WHERE id = ?').get<{ id: number }>(id));
        },
        getUserDataDir() {
            if (!configuredUserDataDir) {
                throw new Error('Application data directory is not configured yet.');
            }

            return configuredUserDataDir;
        },
        scriptExists(id: number) {
            return Boolean(db.prepare('SELECT id FROM scripts WHERE id = ?').get<{ id: number }>(id));
        },
        createServer(params: Omit<CreateServerParams, 'password'>) {
            const result = db
                .prepare(
                    `
                        INSERT INTO servers(name, kind, driver, file_path, host, port, username, sequence)
                        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                    `
                )
                .run(
                    normalizeRequiredText(params.name, 'Server name'),
                    params.kind,
                    normalizeRequiredText(params.driver, 'Server driver'),
                    normalizeOptionalText(params.filePath) ?? null,
                    normalizeOptionalText(params.host) ?? null,
                    params.port ?? null,
                    normalizeOptionalText(params.username) ?? null,
                    getNextServerSequence()
                );

            return toNumber(result.lastInsertRowid)!;
        },
        updateServer(id: number, params: Omit<UpdateServerParams, 'password'>) {
            db.prepare(
                `
                    UPDATE servers
                    SET name = ?, kind = ?, driver = ?, file_path = ?, host = ?, port = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `
            ).run(
                normalizeRequiredText(params.name, 'Server name'),
                params.kind,
                normalizeRequiredText(params.driver, 'Server driver'),
                normalizeOptionalText(params.filePath) ?? null,
                normalizeOptionalText(params.host) ?? null,
                params.port ?? null,
                normalizeOptionalText(params.username) ?? null,
                id
            );
        },
        updateServerSchemaMetadata(id: number, params: { schemaCount: number }) {
            db.prepare(
                `
                    UPDATE servers
                    SET schema_count = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `
            ).run(params.schemaCount, id);
        },
        reorderServer(id: number, toIndex: number) {
            reorderServerSequence(id, toIndex);
        },
        deleteServer(id: number) {
            db.prepare('DELETE FROM servers WHERE id = ?').run(id);
            normalizeServerSequences();
        },
        createConnection(params: Omit<CreateConnectionParams, 'password'>) {
            const result = db
                .prepare(
                    `
                        INSERT INTO connections(server_id, name, host, port, database_name, readonly, sequence)
                        VALUES(?, ?, ?, ?, ?, ?, ?)
                    `
                )
                .run(
                    params.serverId,
                    normalizeRequiredText(params.name, 'Connection name'),
                    normalizeOptionalText(params.host) ?? null,
                    normalizeOptionalPort(params.port) ?? null,
                    normalizeOptionalText(params.databaseName) ?? null,
                    params.readonly ? 1 : 0,
                    getNextConnectionSequence(params.serverId)
                );

            return toNumber(result.lastInsertRowid)!;
        },
        updateConnection(id: number, params: Omit<UpdateConnectionParams, 'password'>) {
            const currentConnection = db.prepare('SELECT * FROM connections WHERE id = ?').get<ConnectionRow>(id);

            if (!currentConnection) {
                throw new Error('The selected connection could not be found.');
            }

            const targetServerId = params.serverId ?? currentConnection.server_id;
            const targetSequence = targetServerId === currentConnection.server_id ? toNumber(currentConnection.sequence)! : getNextConnectionSequence(targetServerId);

            db.prepare(
                `
                    UPDATE connections
                    SET server_id = ?, name = ?, host = ?, port = ?, database_name = ?, readonly = ?, sequence = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `
            ).run(
                targetServerId,
                normalizeRequiredText(params.name, 'Connection name'),
                normalizeOptionalText(params.host) ?? null,
                normalizeOptionalPort(params.port) ?? null,
                normalizeOptionalText(params.databaseName) ?? null,
                params.readonly ? 1 : 0,
                targetSequence,
                id
            );

            if (targetServerId !== currentConnection.server_id) {
                normalizeConnectionSequences(currentConnection.server_id);
                normalizeConnectionSequences(targetServerId);
            }
        },
        reorderConnection(id: number, serverId: number, toIndex: number) {
            reorderConnectionSequence(id, serverId, toIndex);
        },
        touchConnectionLastUsed(id: number) {
            db.prepare('UPDATE connections SET last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
        },
        deleteConnection(id: number) {
            const currentConnection = db.prepare('SELECT server_id FROM connections WHERE id = ?').get<{ server_id: number }>(id);
            db.prepare('DELETE FROM connections WHERE id = ?').run(id);

            if (currentConnection) {
                normalizeConnectionSequences(currentConnection.server_id);
            }
        },
        createScript(params: CreateScriptParams) {
            const result = db
                .prepare(
                    `
                        INSERT INTO scripts(connection_id, name, group_name, sql_text, sequence)
                        VALUES(?, ?, ?, ?, ?)
                    `
                )
                .run(
                    params.connectionId,
                    normalizeRequiredText(params.name, 'Script name'),
                    normalizeOptionalText(params.groupName) ?? null,
                    params.sqlText ?? '',
                    getNextScriptSequence(params.connectionId)
                );

            return toNumber(result.lastInsertRowid)!;
        },
        updateScript(id: number, params: UpdateScriptParams) {
            const currentScript = db.prepare('SELECT * FROM scripts WHERE id = ?').get<ScriptRow>(id);

            if (!currentScript) {
                throw new Error('The selected script could not be found.');
            }

            const targetConnectionId = params.connectionId ?? currentScript.connection_id;
            const targetSequence = targetConnectionId === currentScript.connection_id ? toNumber(currentScript.sequence)! : getNextScriptSequence(targetConnectionId);

            db.prepare(
                `
                    UPDATE scripts
                    SET connection_id = ?, name = ?, group_name = ?, sql_text = ?, sequence = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `
            ).run(targetConnectionId, normalizeRequiredText(params.name, 'Script name'), normalizeOptionalText(params.groupName) ?? null, params.sqlText, targetSequence, id);

            if (targetConnectionId !== currentScript.connection_id) {
                normalizeScriptSequences(currentScript.connection_id);
                normalizeScriptSequences(targetConnectionId);
            }
        },
        reorderScript(id: number, connectionId: number, toIndex: number) {
            reorderScriptSequence(id, connectionId, toIndex);
        },
        touchScriptLastRun(id: number) {
            db.prepare('UPDATE scripts SET last_run_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
        },
        deleteScript(id: number) {
            const currentScript = db.prepare('SELECT connection_id FROM scripts WHERE id = ?').get<{ connection_id: number }>(id);
            db.prepare('DELETE FROM scripts WHERE id = ?').run(id);

            if (currentScript) {
                normalizeScriptSequences(currentScript.connection_id);
            }
        },
        getSetting<T>(key: string, fallbackValue: T) {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>(key);

            if (!row) {
                return fallbackValue;
            }

            return JSON.parse(row.value) as T;
        },
        setSetting<T>(key: string, value: T) {
            console.log('setting', key);
            db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
        },
        setSettings(entries: Array<{ key: string; value: unknown }>) {
            if (entries.length === 0) {
                return;
            }

            const placeholders = entries.map(() => '(?, ?)').join(', ');
            const values = entries.flatMap(({ key, value }) => [key, JSON.stringify(value)]);

            db.prepare(
                `
                    INSERT INTO settings(key, value)
                    VALUES ${placeholders}
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                `
            ).run(...values);
        },
        deleteSetting(key: string) {
            db.prepare('DELETE FROM settings WHERE key = ?').run(key);
        },
        deleteSettings(keys: string[]) {
            if (keys.length === 0) {
                return;
            }

            const placeholders = keys.map(() => '?').join(', ');
            db.prepare(`DELETE FROM settings WHERE key IN (${placeholders})`).run(...keys);
        },
        deleteSettingsByPrefix(prefix: string) {
            db.prepare('DELETE FROM settings WHERE key LIKE ?').run(`${prefix}%`);
        },
        deleteSettingsByPrefixes(prefixes: string[]) {
            if (prefixes.length === 0) {
                return;
            }

            const clauses = prefixes.map(() => 'key LIKE ?').join(' OR ');
            db.prepare(`DELETE FROM settings WHERE ${clauses}`).run(...prefixes.map((prefix) => `${prefix}%`));
        },
    };
}
