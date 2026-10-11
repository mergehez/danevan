import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { DATA_GRID_ROW_HEIGHT } from '../../../datagrid/dataGrid';

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
    const response = await postWhenApiIsUp(request, method, data);

    if (!response.ok()) {
        throw new Error(`POST /api/${method} failed with ${response.status()}: ${await response.text()}`);
    }

    return response.json();
}

/**
 * Playwright calls the dev server ready as soon as the renderer port answers, and the vite plugin
 * mounts the API on its own port right after that (`vite-plugin.ts` imports `devServer.ts` in the
 * `listening` handler). A spec whose first action is an API call — before it loads the page — could
 * therefore arrive a moment too early. Only a refused connection is retried, and only for a few
 * seconds, so a backend that never came up still fails the spec.
 */
async function postWhenApiIsUp(request: APIRequestContext, method: string, data: unknown) {
    const deadline = Date.now() + 5000;

    for (;;) {
        try {
            return await request.post(`${API}/${method}`, { data });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (!message.includes('ECONNREFUSED') || Date.now() > deadline) {
                throw error;
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
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

/** The data dir the suite boots with; `playwright.config.ts` owns the same value. */
function e2eAppDataDir() {
    return process.env.APP_DATA_DIR || join(process.cwd(), '.e2e-data');
}

/**
 * Fails unless SQLFluff really runs, the way the MySQL specs require their database. On a fresh
 * data dir the first diagnostics or format request provisions a venv and runs `pip install`:
 * far longer than a spec may wait, and the marker counts of the run before it are wrong.
 */
export function requireSqlFluffRuntime(what = 'this spec') {
    const runtimeDir = join(e2eAppDataDir(), 'sqlfluff-runtime');
    const managedPython = process.platform === 'win32' ? join(runtimeDir, 'Scripts', 'python.exe') : join(runtimeDir, 'bin', 'python');
    const python = process.platform === 'win32' ? 'py' : 'python3';
    const pythonArgs = process.platform === 'win32' ? ['-3'] : [];

    // The backend resolves the runtime in this order; a system install is as good as the managed one.
    const candidates: Array<[string, string[]]> = [
        ['sqlfluff', ['--version']],
        [python, [...pythonArgs, '-m', 'sqlfluff', '--version']],
        ['python', ['-m', 'sqlfluff', '--version']],
        [managedPython, ['-m', 'sqlfluff', '--version']],
    ];

    const answered = candidates.some(([command, args]) => {
        try {
            execFileSync(command, args, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    });

    if (!answered) {
        missingEnvironment(
            `${what} needs a runnable SQLFluff runtime; none of ${candidates.map(([command]) => command).join(', ')} answered \`--version\`. ` +
                `The managed runtime at ${runtimeDir} is provisioned once and kept across runs: ` +
                `\`python3 -m venv "${runtimeDir}" && "${managedPython}" -m pip install sqlfluff\`.`
        );
    }
}

/** The bootstrap response must echo the row that was just created, or the setup is broken. */
function findCreatedId<T extends { name: string; id: number }>(rows: T[] | undefined, name: string, call: string): number {
    return requireFixtureData(
        rows?.find((entry) => entry.name === name),
        `${call} did not come back with the row "${name}".`
    ).id;
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
export async function createFileSource(request: APIRequestContext, options: { label: string; tableCount?: number; tableNames?: string[]; schema?: string } = { label: 'file' }) {
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

/**
 * Removes every source the app already holds. The specs share one app DB for a whole run, so a spec
 * that measures the sidebar list (pinned rows, row order) has to start from a list it owns instead of
 * whatever earlier specs left behind.
 */
export async function deleteAllServers(request: APIRequestContext) {
    const bootstrap = (await post(request, 'getBootstrap', undefined)) as { servers?: Array<{ id: number }> };

    for (const server of bootstrap.servers ?? []) {
        await request.post(`${API}/deleteServer`, { data: { serverId: server.id } }).catch(() => undefined);
    }
}

/**
 * Sidebar rows are sticky: once the source list is long enough, a row's chevron ends up
 * pinned outside the scroll panel, covered by the section headers above it. Navigation
 * therefore dispatches a bubbling click instead of relying on hit-testing.
 * `sidebar-sticky.spec.ts` is the spec that guards the pinned-row hit-testing behaviour.
 */
export async function toggleSidebarRow(row: Locator) {
    await expect(row).toBeVisible();
    await row.locator('[data-sidebar-toggle-for]').dispatchEvent('click');
}

/** Expands a collapsed sidebar row, leaving an already expanded one alone. */
export async function expandSidebarRow(row: Locator) {
    await expect(row).toBeVisible();

    if ((await row.getAttribute('data-sidebar-collapsed')) === 'true') {
        await toggleSidebarRow(row);
        await expect(row).toHaveAttribute('data-sidebar-collapsed', 'false');
    }
}

/** Collapses then expands a row, which is what makes it (re)load its children. */
export async function reloadSidebarRow(row: Locator) {
    await expect(row).toBeVisible();

    if ((await row.getAttribute('data-sidebar-collapsed')) === 'false') {
        await toggleSidebarRow(row);
        await expect(row).toHaveAttribute('data-sidebar-collapsed', 'true');
    }

    await toggleSidebarRow(row);
    await expect(row).toHaveAttribute('data-sidebar-collapsed', 'false');
}

/** Opens a sidebar row's context menu from a dispatched event, anchored on screen. */
export async function openSidebarRowMenu(row: Locator) {
    await expect(row).toBeVisible();
    await row.dispatchEvent('contextmenu', { clientX: 48, clientY: 48 });
}

/** Opens a table by double-clicking its sidebar row and waits for the grid. */
export async function openSidebarTable(page: Page, connectionId: number, tableName: string) {
    const tableRow = page.locator(`[data-node-id="table:${connectionId}:${tableName}"]`);
    await expect(tableRow).toBeVisible();
    await tableRow.dispatchEvent('dblclick');

    await expect(page.getByTestId('data-grid-viewport').first()).toBeVisible();
}

/** Boots the app and opens one table of a file source. */
export async function openFileTable(page: Page, source: { serverId: number; connectionId: number }, tableName: string) {
    await page.goto('/');
    await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
    await openSidebarTable(page, source.connectionId, tableName);
}

/**
 * The screen position of a grid cell and of the viewport's top edge. The grid draws to a canvas, so
 * the cell's own top-left comes from the in-cell editor the grid positions over it (the editor may
 * be wider and taller than its cell, so the offsets stay inside the one row and its first pixels).
 */
export async function gridCellPoint(page: Page, columnIndex: number, rowIndex = 0) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    await viewport.focus();

    for (let index = 0; index < columnIndex; index += 1) {
        await page.keyboard.press('ArrowRight');
    }

    for (let index = 0; index < rowIndex; index += 1) {
        await page.keyboard.press('ArrowDown');
    }

    await page.keyboard.press('Enter');

    const editor = page.locator(`textarea[data-editor-key="${rowIndex}:${columnIndex}"]`);
    await expect(editor).toBeVisible();
    const box = (await editor.boundingBox())!;
    await editor.press('Escape');

    return { x: box.x + 4, y: box.y + DATA_GRID_ROW_HEIGHT / 2, viewportTop: (await viewport.boundingBox())!.y };
}

/** One entry of the context menu that is open. */
export function menuItem(page: Page, label: string | RegExp) {
    return page.locator('.v-menu-panel .v-menu-item', { hasText: label }).first();
}

export async function readClipboard(page: Page) {
    return page.evaluate(() => navigator.clipboard.readText());
}

/** An empty clipboard makes a copy that silently does nothing fail instead of reading stale text. */
export async function clearClipboard(page: Page) {
    await page.evaluate(() => navigator.clipboard.writeText(''));
}

export async function expectClipboardText(page: Page, expected: string) {
    await expect.poll(() => readClipboard(page)).toBe(expected);
}

/** Expands a MySQL server down to one of its tables and opens it. */
export async function openMySqlTable(page: Page, source: { serverId: number; connectionId: number }, tableName: string) {
    await expandSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
    await expandSidebarRow(page.locator(`[data-node-id="connection:${source.connectionId}"]`));

    // Tables can sit behind a "tables" group; the collection filter can flatten them.
    const tablesCollection = page.locator(`[data-collection-kind="tables"][data-parent-id="connection:${source.connectionId}"]`);
    const tableRow = page.locator(`[data-node-id="table:${source.connectionId}:${tableName}"]`);

    // The table list arrives asynchronously once the connection expands.
    await expect(tablesCollection.or(tableRow).first()).toBeVisible({ timeout: 15_000 });

    if ((await tablesCollection.count()) > 0) {
        await expandSidebarRow(tablesCollection.first());
    }

    await openSidebarTable(page, source.connectionId, tableName);
}
