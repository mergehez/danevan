import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'fs';
import {
    API,
    MYSQL,
    createMySqlServerAndConnection,
    expandSidebarRow,
    openSidebarRowMenu,
    post,
    requireFixtureData,
    requireMySqlDatabase,
    requireMySqlExecutable,
} from './helpers';

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

test.describe('Export using mysqldump', () => {
    test('exportWithMysqldump writes a real SQL dump', async ({ page }) => {
        await requireMySqlDatabase(MYSQL.database, 'mysqldump-export.spec.ts');

        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request, MYSQL.database, 'mysqldump');
        let outputPath = '';

        try {
            const executable = await requireMySqlExecutable(page.request, 'mysqldump', connectionId);

            const tables = await post(page.request, 'getTables', { connectionId });
            const table = requireFixtureData(
                tables[0]?.name,
                `The MySQL database "${MYSQL.database}" has no tables to dump; create one (e.g. CREATE TABLE e2e_dump (id INT)) before running this spec.`
            );

            outputPath = `/tmp/e2e-mysqldump-${Date.now()}.sql`;
            const result = await post(page.request, 'exportWithMysqldump', {
                connectionId,
                executable,
                outputPath,
                databases: MYSQL.database,
                tables: table,
                options: EXPORT_OPTIONS,
            });

            expect(result.outputPath).toBe(outputPath);
            expect(existsSync(outputPath)).toBe(true);

            // The dump must contain real mysqldump output for the exported table.
            const content = readFileSync(outputPath, 'utf8');
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

    test('exports from the modal with the chosen options', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'mysqldump-export.spec.ts');

        const { serverId, connectionId } = await createMySqlServerAndConnection(request, MYSQL.database, 'mysqldump-submit');
        const schemaPath = `/tmp/e2e-mysqldump-schema-${Date.now()}.sql`;
        const dataPath = `/tmp/e2e-mysqldump-data-${Date.now()}.sql`;

        try {
            const executable = await requireMySqlExecutable(request, 'mysqldump', connectionId);
            const tables = await post(request, 'getTables', { connectionId });
            const table = requireFixtureData(
                tables.find((entry: { type: string; rowCount: number }) => entry.type === 'table' && Number(entry.rowCount) > 0)?.name,
                `The MySQL database "${MYSQL.database}" has no table with rows to dump; insert rows into a table before running this spec.`
            );

            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            await expandSidebarRow(page.locator(`[data-node-id="server:${serverId}"]`));
            await openSidebarRowMenu(page.locator(`[data-node-id="connection:${connectionId}"]`));
            await page.locator('.v-menu-item', { hasText: 'Export using mysqldump...' }).click();

            const modal = page.getByTestId('centered-modal-surface');
            await expect(modal).toContainText('Export with mysqldump...');
            // The executable was resolved for this connection, so Run is usable straight away.
            await expect(modal.getByPlaceholder('/path/to/mysqldump')).toHaveValue(executable);
            await expect(modal.getByPlaceholder('database_name')).toHaveValue(MYSQL.database);

            await modal.getByPlaceholder('/path/to/dump.sql').fill(schemaPath);
            await modal.getByPlaceholder('table1 table2').fill(table);

            // Hold the request open so the progress state is observable.
            await page.route('**/api/exportWithMysqldump', async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 500));
                await route.continue();
            });

            // Schema only: no data in the dump.
            await modal.getByRole('checkbox', { name: 'Export schema without data' }).check();
            await modal.getByRole('button', { name: 'Run', exact: true }).click();

            await expect(modal.getByRole('button', { name: 'Running...', exact: true })).toBeVisible();
            await expect(modal).toContainText(`Export written to ${schemaPath}`, { timeout: 15_000 });

            expect(existsSync(schemaPath)).toBe(true);
            const schemaDump = readFileSync(schemaPath, 'utf8');
            expect(schemaDump).toContain(`CREATE TABLE \`${table}\``);
            expect(schemaDump).not.toContain('INSERT INTO');

            await page.unroute('**/api/exportWithMysqldump');

            // Now the data, with the column names option on.
            await modal.getByPlaceholder('/path/to/dump.sql').fill(dataPath);
            await modal.getByRole('checkbox', { name: 'Export schema without data' }).uncheck();
            await modal.getByRole('checkbox', { name: /Include column names in each INSERT/ }).check();
            await modal.getByRole('button', { name: 'Run', exact: true }).click();

            await expect(modal).toContainText(`Export written to ${dataPath}`, { timeout: 15_000 });

            expect(existsSync(dataPath)).toBe(true);
            const dataDump = readFileSync(dataPath, 'utf8');
            expect(dataDump).toContain(`INSERT INTO \`${table}\` (\``);
        } finally {
            rmSync(schemaPath, { force: true });
            rmSync(dataPath, { force: true });
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('getMysqldumpExportDefaults returns the expected defaults', async ({ page }) => {
        const { serverId, connectionId, connectionName } = await createMySqlServerAndConnection(page.request, MYSQL.database, 'mysqldump');

        try {
            const defaults = await post(page.request, 'getMysqldumpExportDefaults', { connectionId });

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
        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request, MYSQL.database, 'mysqldump');

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
            await expect(serverRow).toBeVisible();

            // Expand the server if it starts collapsed.
            if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await serverRow.click();
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
        const pgServer = await post(page.request, 'createServer', {
            name: `e2e-pg-server-${suffix}`,
            kind: 'server',
            driver: 'postgresql',
            filePath: undefined,
            host: '127.0.0.1',
            port: 5432,
            username: 'postgres',
            password: '',
        });

        const pgServerId = pgServer.servers.find((entry: { name: string }) => entry.name === `e2e-pg-server-${suffix}`).id;
        const pgConnectionBootstrap = await post(page.request, 'createConnection', {
            serverId: pgServerId,
            name: `e2e-pg-conn-${suffix}`,
            host: '127.0.0.1',
            port: 5432,
            databaseName: 'e2e_test_db',
            readonly: false,
        });

        const pgConnection = pgConnectionBootstrap.connections.find((entry: { server_id: number }) => entry.server_id === pgServerId);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            const serverRow = page.locator(`[data-node-id="server:${pgServerId}"]`);
            await expect(serverRow).toBeVisible();

            if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await serverRow.click();
            }

            const connectionRow = page.locator(`[data-node-id="connection:${pgConnection.id}"]`);
            await expect(connectionRow).toBeVisible();

            await connectionRow.click({ button: 'right' });

            // The context menu should be open (it has the shared connection entries).
            await expect(page.locator('.v-menu-item', { hasText: 'Refresh metadata' })).toBeVisible();

            // The mysqldump export entry must not be present for a non-MySQL connection.
            await expect(page.locator('.v-menu-item', { hasText: 'Export using mysqldump...' })).toHaveCount(0);
        } finally {
            await page.request.post(`${API}/deleteServer`, { data: { serverId: pgServerId } }).catch(() => {});
        }
    });
});
