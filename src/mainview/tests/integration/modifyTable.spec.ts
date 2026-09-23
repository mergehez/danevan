import { expect, test, type APIRequestContext } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'fs';

const API = 'http://127.0.0.1:3264/api';

// A real local MySQL database used to verify the actual dump output.
const MYSQL = {
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    password: '',
    database: 'tirsik3_test',
};

const EXPORT_OPTIONS = {
    addDropTable: true,
    disableKeys: true,
    addLocks: false,
    addDropTrigger: false,
    exportSchemaOnly: false,
    completeInsert: true,
    includeTableOptions: true,
    includeRoutines: false,
    lockTables: false,
    insertDelayed: false,
};

async function createMySqlServerAndConnection(request: APIRequestContext, database = MYSQL.database) {
    const suffix = Date.now().toString();
    const serverName = `e2e-mysql-server-${suffix}`;
    const connectionName = `e2e-mysql-conn-${suffix}`;

    const serverResp = await request.post(`${API}/createServer`, {
        data: {
            name: serverName,
            kind: 'server',
            driver: 'mysql',
            filePath: undefined,
            host: MYSQL.host,
            port: MYSQL.port,
            username: MYSQL.username,
            password: MYSQL.password,
        },
    });
    expect(serverResp.ok()).toBe(true);

    const serverBootstrap = await serverResp.json();
    const server = serverBootstrap.servers.find((entry: { name: string }) => entry.name === serverName);
    expect(server).toBeTruthy();

    const connectionResp = await request.post(`${API}/createConnection`, {
        data: {
            serverId: server.id,
            name: connectionName,
            host: MYSQL.host,
            port: MYSQL.port,
            databaseName: database,
            readonly: false,
        },
    });
    expect(connectionResp.ok()).toBe(true);

    const connectionBootstrap = await connectionResp.json();
    const connection = connectionBootstrap.connections.find((entry: { server_id: number }) => entry.server_id === server.id);
    expect(connection).toBeTruthy();

    return { serverId: server.id, connectionId: connection.id, connectionName };
}

test.describe('Export using mysqldump', () => {
    test('exportWithMysqldump writes a real SQL dump', async ({ page }) => {
        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request);
        let outputPath = '';

        try {
            const defaultsResp = await page.request.post(`${API}/getMysqldumpExportDefaults`, { data: { connectionId } });
            expect(defaultsResp.ok()).toBe(true);
            const defaults = await defaultsResp.json();
            test.skip(!defaults.executable, 'The mysqldump executable could not be found.');

            const tablesResp = await page.request.post(`${API}/getTables`, { data: { connectionId } });
            test.skip(!tablesResp.ok(), `Could not reach the local MySQL database (${MYSQL.database}).`);
            const tables = await tablesResp.json();
            const table = tables[0]?.name;
            test.skip(!table, 'The local MySQL database has no tables to dump.');

            outputPath = `/tmp/e2e-mysqldump-${Date.now()}.sql`;
            const exportResp = await page.request.post(`${API}/exportWithMysqldump`, {
                data: {
                    connectionId,
                    executable: defaults.executable,
                    outputPath,
                    databases: MYSQL.database,
                    tables: table,
                    options: EXPORT_OPTIONS,
                },
            });

            expect(exportResp.ok()).toBe(true);
            const result = await exportResp.json();
            expect(result.outputPath).toBe(outputPath);
            expect(existsSync(outputPath)).toBe(true);

            // The dump must contain real mysqldump output for the exported table.
            const content = readFileSync(outputPath, 'utf8');
            expect(content.length).toBeGreaterThan(0);
            expect(content).toContain('-- MySQL dump');
            expect(content).toMatch(/CREATE TABLE/);
            expect(content).toContain(table);
        } finally {
            if (outputPath) {
                rmSync(outputPath, { force: true });
            }
            await page.request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('getMysqldumpExportDefaults returns the expected defaults', async ({ page }) => {
        const { serverId, connectionId, connectionName } = await createMySqlServerAndConnection(page.request);

        try {
            const resp = await page.request.post(`${API}/getMysqldumpExportDefaults`, { data: { connectionId } });
            expect(resp.ok()).toBe(true);

            const defaults = await resp.json();
            expect(defaults).toHaveProperty('executable');
            expect(defaults.database).toBe(MYSQL.database);
            expect(defaults.dataSource).toBe(connectionName);
            expect(defaults.defaultOutputPath).toContain('{timestamp}');
            expect(defaults.defaultOutputPath).toContain('{database}');
            expect(defaults.defaultOutputPath).toContain('{data_source}');
        } finally {
            await page.request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('mysql connection shows the Export using mysqldump menu and opens the modal', async ({ page }) => {
        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await page.waitForTimeout(3000);

            const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
            await expect(serverRow).toBeVisible();

            // Expand the server if it starts collapsed.
            if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await serverRow.click();
                await page.waitForTimeout(500);
            }

            const connectionRow = page.locator(`[data-node-id="connection:${connectionId}"]`);
            await expect(connectionRow).toBeVisible();

            // Right-click to open the context menu.
            await connectionRow.click({ button: 'right' });

            const menuItem = page.locator('.v-menu-item', { hasText: 'Export using mysqldump...' });
            await expect(menuItem).toBeVisible();
            await menuItem.click();

            // The centered modal should appear with the export dialog title.
            const modal = page.locator('[data-testid="centered-modal-surface"]');
            await expect(modal).toBeVisible();
            await expect(modal).toContainText('Export with mysqldump...');

            // Key fields are present.
            const executableInput = modal.getByPlaceholder('/path/to/mysqldump');
            await expect(executableInput).toBeVisible();
            await expect(modal.getByPlaceholder('/path/to/dump.sql')).toBeVisible();
            await expect(modal.getByPlaceholder('database_name')).toHaveValue(MYSQL.database);
            await expect(modal.getByPlaceholder('table1 table2')).toBeVisible();

            // The output path template should carry the allowed substitution patterns.
            const outputValue = await modal.getByPlaceholder('/path/to/dump.sql').inputValue();
            expect(outputValue).toContain('{timestamp}');
            expect(outputValue).toContain('{database}');
            expect(outputValue).toContain('{data_source}');

            // The executable path is auto-detected when mysqldump is available, otherwise left empty.
            const executableValue = await executableInput.inputValue();
            if (executableValue) {
                expect(existsSync(executableValue)).toBe(true);
            }

            // Option checkboxes are rendered.
            await expect(modal.getByText('Add DROP TABLE before CREATE...')).toBeVisible();
            await expect(modal.getByText('Include column names in each INSERT...')).toBeVisible();

            await page.screenshot({ path: 'test-results/mysqldump-export-modal.png', fullPage: true });
        } finally {
            await page.request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('Export using mysqldump menu item is not shown for non-MySQL connections', async ({ page }) => {
        const suffix = Date.now().toString();
        const pgServerResp = await page.request.post(`${API}/createServer`, {
            data: {
                name: `e2e-pg-server-${suffix}`,
                kind: 'server',
                driver: 'postgresql',
                filePath: undefined,
                host: '127.0.0.1',
                port: 5432,
                username: 'postgres',
                password: '',
            },
        });
        expect(pgServerResp.ok()).toBe(true);

        const pgBootstrap = await pgServerResp.json();
        const pgServer = pgBootstrap.servers.find((entry: { name: string }) => entry.name === `e2e-pg-server-${suffix}`);
        expect(pgServer).toBeTruthy();

        const pgConnectionResp = await page.request.post(`${API}/createConnection`, {
            data: {
                serverId: pgServer.id,
                name: `e2e-pg-conn-${suffix}`,
                host: '127.0.0.1',
                port: 5432,
                databaseName: 'e2e_test_db',
                readonly: false,
            },
        });
        expect(pgConnectionResp.ok()).toBe(true);

        const pgConnectionBootstrap = await pgConnectionResp.json();
        const pgConnection = pgConnectionBootstrap.connections.find((entry: { server_id: number }) => entry.server_id === pgServer.id);
        expect(pgConnection).toBeTruthy();

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await page.waitForTimeout(3000);

            const serverRow = page.locator(`[data-node-id="server:${pgServer.id}"]`);
            await expect(serverRow).toBeVisible();

            if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await serverRow.click();
                await page.waitForTimeout(500);
            }

            const connectionRow = page.locator(`[data-node-id="connection:${pgConnection.id}"]`);
            await expect(connectionRow).toBeVisible();

            await connectionRow.click({ button: 'right' });

            // The context menu should be open (it has the shared connection entries).
            await expect(page.locator('.v-menu-item', { hasText: 'Select connection' })).toBeVisible();

            // The mysqldump export entry must not be present for a non-MySQL connection.
            await expect(page.locator('.v-menu-item', { hasText: 'Export using mysqldump...' })).toHaveCount(0);
        } finally {
            await page.request.post(`${API}/deleteServer`, { data: { serverId: pgServer.id } }).catch(() => {});
        }
    });
});
