import { test, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mysql from 'mysql2/promise';

export const API = `http://127.0.0.1:${process.env.E2E_API_PORT || '3264'}/api`;

export const MYSQL = {
    host: process.env.E2E_MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.E2E_MYSQL_PORT || 3306),
    username: process.env.E2E_MYSQL_USER || 'root',
    password: process.env.E2E_MYSQL_PASSWORD || '',
    database: process.env.E2E_MYSQL_DATABASE || 'tirsik3_test',
    /** Opened by the huge-table test: a schema whose tables are too big to count exactly. */
    largeDatabase: process.env.E2E_MYSQL_LARGE_DATABASE || 'wikiferheng',
};

export async function post(request: APIRequestContext, method: string, data: unknown) {
    const response = await request.post(`${API}/${method}`, { data });

    if (!response.ok()) {
        throw new Error(`POST /api/${method} failed with ${response.status()}: ${await response.text()}`);
    }

    return response.json();
}

/**
 * Environment preconditions fail the test by default: a missing database must never look like a
 * passing run. `E2E_SKIP_MISSING_DB=1` downgrades them to skips for machines that only run the
 * browser-only specs.
 */
function missingEnvironment(message: string): never {
    if (process.env.E2E_SKIP_MISSING_DB === '1') {
        test.skip(true, message);
    }

    throw new Error(`${message}\nFix the environment, or set E2E_SKIP_MISSING_DB=1 to skip these specs.`);
}

/** Fails unless the local MySQL holds `database`, so a green run proves the specs really executed. */
export async function requireMySqlDatabase(database: string, what = 'this spec') {
    let connection: mysql.Connection | undefined;

    try {
        connection = await mysql.createConnection({
            host: MYSQL.host,
            port: MYSQL.port,
            user: MYSQL.username,
            password: MYSQL.password,
            connectTimeout: 3000,
        });

        const [rows] = await connection.query<mysql.RowDataPacket[]>('SHOW DATABASES');

        if (!rows.map((row) => String(Object.values(row)[0])).includes(database)) {
            missingEnvironment(`The MySQL server at ${MYSQL.host}:${MYSQL.port} has no database "${database}" required by ${what}.`);
        }
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('The MySQL server')) {
            throw error;
        }

        missingEnvironment(
            `${what} needs a reachable MySQL at ${MYSQL.host}:${MYSQL.port} (database "${database}"). ` +
                `Set E2E_MYSQL_HOST/PORT/USER/PASSWORD/DATABASE or start MySQL. Cause: ${error instanceof Error ? error.message : String(error)}`
        );
    } finally {
        await connection?.end().catch(() => undefined);
    }
}

/**
 * Fails unless `findExecutable` reports a real path, so an export test cannot silently disappear.
 * The defaults endpoint resolves the binary for a connection, hence the connection id.
 */
export async function requireMySqlExecutable(request: APIRequestContext, executable: string, connectionId: number) {
    const defaults = await post(request, 'getMysqldumpExportDefaults', { connectionId });
    const resolved = executable === 'mysqldump' ? defaults.executable : undefined;

    if (!resolved) {
        missingEnvironment(`The "${executable}" executable was not found on this machine.`);
    }

    return resolved as string;
}

/** Fails unless the fixture data a spec shapes its assertions around is really there. */
export function requireFixtureData<T>(value: T, message: string): NonNullable<T> {
    if (!value) {
        missingEnvironment(message);
    }

    return value as NonNullable<T>;
}

/** The bootstrap response must echo the row that was just created, or the setup is broken. */
function findCreatedId<T extends { name: string; id: number }>(rows: T[] | undefined, name: string, call: string): number {
    return requireFixtureData(rows?.find((entry) => entry.name === name), `${call} did not come back with the row "${name}".`).id;
}

export async function createMySqlServerAndConnection(request: APIRequestContext, database: string, label: string) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const serverName = `e2e-${label}-server-${suffix}`;
    const connectionName = `e2e-${label}-conn-${suffix}`;

    const serverBootstrap = await post(request, 'createServer', {
        name: serverName,
        kind: 'server',
        driver: 'mysql',
        filePath: undefined,
        host: MYSQL.host,
        port: MYSQL.port,
        username: MYSQL.username,
        password: MYSQL.password,
    });
    const serverId = findCreatedId(serverBootstrap.servers, serverName, 'POST /api/createServer');

    const connectionBootstrap = await post(request, 'createConnection', {
        serverId,
        name: connectionName,
        host: MYSQL.host,
        port: MYSQL.port,
        databaseName: database,
        readonly: false,
    });
    const connectionId = findCreatedId(connectionBootstrap.connections, connectionName, 'POST /api/createConnection');

    return { serverId, connectionId, serverName, connectionName };
}

/** Creates a throwaway SQLite file plus a matching file source, and returns how to clean it up. */
export async function createFileSource(
    request: APIRequestContext,
    options: { label: string; tableCount?: number; tableNames?: string[]; schema?: string } = { label: 'file' }
) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const databasePath = join(tmpdir(), `e2e-${options.label}-${suffix}.sqlite`);
    const file = new Database(databasePath);
    const tableNames = options.tableNames ?? Array.from({ length: options.tableCount ?? 3 }, (_, index) => `table_${String(index).padStart(2, '0')}`);

    // `schema` seeds a table shape the spec asserts against; otherwise create empty tables.
    if (options.schema) {
        file.exec(options.schema);
    } else {
        for (const tableName of tableNames) {
            file.exec(`CREATE TABLE ${tableName} (id integer primary key, name text)`);
        }
    }

    file.close();

    const serverName = `e2e-${options.label}-source-${suffix}`;
    const bootstrap = await post(request, 'createServer', { name: serverName, kind: 'file', driver: 'sqlite', filePath: databasePath });
    const serverId = findCreatedId(bootstrap.servers, serverName, 'POST /api/createServer');

    const connectionName = `${serverName}-conn`;
    const withConnection = await post(request, 'createConnection', {
        serverId,
        name: connectionName,
        host: undefined,
        port: undefined,
        databaseName: undefined,
        readonly: false,
    });
    const connectionId = findCreatedId(withConnection.connections, connectionName, 'POST /api/createConnection');

    return {
        serverId,
        connectionId,
        databasePath,
        serverName,
        connectionName,
        tableNames,
        async cleanup() {
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => undefined);

            if (existsSync(databasePath)) {
                rmSync(databasePath, { force: true });
            }
        },
    };
}
