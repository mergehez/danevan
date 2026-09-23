import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:3264/api';
const MYSQL = {
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    password: '',
    database: 'tirsik3_test',
};

function tableDdl(tableName: string) {
    return `CREATE TABLE \`${tableName}\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`name\` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  \`path\` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  \`description\` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`foo_user_id\` bigint unsigned DEFAULT NULL,
  \`height\` int unsigned NOT NULL DEFAULT 0,
  \`width\` int unsigned NOT NULL DEFAULT 0,
  \`size\` int unsigned NOT NULL DEFAULT 0,
  \`last_synced_at\` bigint unsigned DEFAULT NULL,
  \`created_at\` bigint unsigned NOT NULL DEFAULT 0,
  \`created_by\` bigint unsigned NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`caps_path_unique\` (\`path\`),
  KEY \`caps_created_by_foreign\` (\`created_by\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

async function post(request: APIRequestContext, method: string, data: unknown) {
    const resp = await request.post(`${API}/${method}`, { data });
    expect(resp.ok()).toBeTruthy();
    return resp.json();
}

async function expand(page: Page, locator: ReturnType<Page['locator']>) {
    await expect(locator).toBeVisible();
    if ((await locator.getAttribute('data-sidebar-collapsed')) === 'true') {
        await locator.click();
        await page.waitForTimeout(300);
    }
}

async function openTableModifyPopup(page: Page, connectionId: number, tableName: string, serverId: number) {
    await expand(page, page.locator(`[data-node-id="server:${serverId}"]`));
    await expand(page, page.locator(`[data-node-id="connection:${connectionId}"]`));

    // In grouped mode tables sit behind a "tables" collection; in flat mode they are direct children.
    const tablesCollection = page.locator(`[data-testid="modify-collection"][data-collection-kind="tables"]`);
    if ((await tablesCollection.count()) > 0) {
        await expand(page, tablesCollection);
    }

    const tableRow = page.locator(`[data-node-id="table:${connectionId}:${tableName}"]`);
    await expect(tableRow).toBeVisible({ timeout: 10_000 });
    await tableRow.click({ button: 'right' });
    await page.waitForTimeout(300);

    const menuItem = page.locator('.v-menu-item', { hasText: 'Modify Table...' });
    await expect(menuItem).toBeVisible();
    await menuItem.click();
    await page.waitForTimeout(300);

    // Wait for the modal to finish loading the table metadata (columns become visible).
    await expect(page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="modify-apply"]')).toBeVisible();
}

async function setColumnType(page: Page, value: string) {
    await columnTypeInput(page).fill(value);
    await columnTypeInput(page).press('Enter');
}
function columnsGroup(page: Page) {
    return page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="columns"]');
}

function columnItem(page: Page, name: string) {
    return page.locator(`[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="${name}"]`);
}

function columnTypeInput(page: Page) {
    return page.locator('[data-testid="modify-column-type"] input');
}
test.describe('Modify table popup (e2e)', () => {
    let serverId = -1;
    let connectionId = -1;
    let tableName = '';

    test.beforeAll(async ({ request }) => {
        const suffix = Date.now().toString();
        const serverName = `e2e-mod-${suffix}`;
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
        const server = serverBootstrap.servers.find((entry: { name: string }) => entry.name === serverName);
        serverId = server.id;

        const connectionBootstrap = await post(request, 'createConnection', {
            serverId,
            name: `e2e-mod-conn-${suffix}`,
            host: MYSQL.host,
            port: MYSQL.port,
            databaseName: MYSQL.database,
            readonly: false,
        });
        const connection = connectionBootstrap.connections.find((entry: { server_id: number }) => entry.server_id === serverId);
        connectionId = connection.id;
    });

    test.beforeEach(async ({ request }) => {
        tableName = `caps_e2e_${Date.now()}`;
        await post(request, 'runQuery', { connectionId, sql: tableDdl(tableName) });
    });

    test.afterEach(async ({ request }) => {
        if (tableName) {
            await request.post(`${API}/runQuery`, { data: { connectionId, sql: `DROP TABLE IF EXISTS \`${tableName}\`` } }).catch(() => {});
        }
    });

    test.afterAll(async ({ request }) => {
        if (serverId > 0) {
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('opens the Modify Table popup and shows the columns', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
        await page.waitForTimeout(3000);

        await openTableModifyPopup(page, connectionId, tableName, serverId);

        await expect(columnItem(page, 'id')).toBeVisible();
        await expect(columnItem(page, 'name')).toBeVisible();
        await expect(columnItem(page, 'path')).toBeVisible();
    });

    test('adds a column through the popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
        await page.waitForTimeout(3000);

        await openTableModifyPopup(page, connectionId, tableName, serverId);

        // Select the "columns" group, then add a new column.
        await columnsGroup(page).click();
        await page.locator('[data-testid="modify-add"]').click();

        await page.locator('[data-testid="modify-column-name"]').fill('test_column');
        await setColumnType(page, 'int');
        await page.locator('[data-testid="modify-apply"]').click();

        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.columns.some((c: any) => c.name === 'test_column')).toBe(true);
    });

    test('changes a column type through the popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
        await page.waitForTimeout(3000);

        await openTableModifyPopup(page, connectionId, tableName, serverId);

        await columnsGroup(page).click();
        await columnItem(page, 'name').click();
        await setColumnType(page, 'varchar(500)');
        await page.locator('[data-testid="modify-apply"]').click();

        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        const name = info.columns.find((c: any) => c.name === 'name');
        expect(name.type.toLowerCase()).toContain('varchar(500)');
    });

    test('moves a column down once through the popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
        await page.waitForTimeout(3000);

        await openTableModifyPopup(page, connectionId, tableName, serverId);

        // Select the "columns" group, then the "name" column and move it down once.
        await columnsGroup(page).click();
        await columnItem(page, 'name').click();
        await page.locator('[data-testid="modify-move-down"]').click();
        await page.locator('[data-testid="modify-apply"]').click();

        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        const order = info.columns.map((c: any) => c.name);
        expect(order.indexOf('name')).toBe(order.indexOf('path') + 1);
    });

    test('deletes a column through the popup', async ({ page }) => {
        // Seed the table with a column to delete.
        await post(page.request, 'runQuery', {
            connectionId,
            sql: `ALTER TABLE \`${tableName}\` ADD COLUMN \`test_column\` int NULL`,
        });

        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
        await page.waitForTimeout(3000);

        await openTableModifyPopup(page, connectionId, tableName, serverId);

        await columnsGroup(page).click();
        await columnItem(page, 'test_column').click();
        await page.locator('[data-testid="modify-delete"]').click();

        // Deleting a column asks for confirmation.
        await page.locator('[data-testid="centered-modal-surface"]').getByRole('button', { name: 'Delete' }).click();
        await page.locator('[data-testid="modify-apply"]').click();

        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.columns.some((c: any) => c.name === 'test_column')).toBe(false);
    });
});
