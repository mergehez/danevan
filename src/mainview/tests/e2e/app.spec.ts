import { expect, test, type Page } from '@playwright/test';
import { API, MYSQL, createFileSource, createMySqlServerAndConnection, post, requireMySqlDatabase } from './helpers';

const ADD_SOURCE_BUTTON = 'aside button:has(i[class*="database-plus-outline"])';

function addSourceButton(page: Page) {
    return page.locator(ADD_SOURCE_BUTTON);
}

function serverRow(page: Page, serverId: number) {
    return page.locator(`[data-node-id="server:${serverId}"]`);
}

async function expandRow(row: ReturnType<Page['locator']>) {
    await expect(row).toBeVisible();

    if ((await row.getAttribute('data-sidebar-collapsed')) === 'true') {
        await row.click();
    }
}

test.describe('Danevan App', () => {
    test('renders the shell with its sidebar controls', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('#app')).toBeAttached();
        await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
        await expect(addSourceButton(page)).toBeVisible();
        await expect(page.locator('aside button:has(i[class*="mdi--history"])')).toBeVisible();
        await expect(page.getByTestId('sidebar-settings')).toBeVisible();
    });

    test('shows a stored file source with its tables after bootstrap', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'bootstrap', tableCount: 2 });

        try {
            await page.goto('/');

            const row = serverRow(page, source.serverId);
            await expandRow(row);
            await expect(row).toContainText(source.serverName);
            await expect(page.locator(`[data-node-id="table:${source.connectionId}:table_00"]`)).toBeAttached();
            await expect(page.locator(`[data-node-id="table:${source.connectionId}:table_01"]`)).toBeAttached();
        } finally {
            await source.cleanup();
        }
    });

    test('the add source form swaps its fields with the selected driver', async ({ page }) => {
        await page.goto('/');

        await addSourceButton(page).click();

        // "Add source" opens on the first driver, SQLite, which needs a file path instead of host/port.
        await expect(page.getByRole('dialog')).toContainText('Add SQLite connection');
        await expect(page.locator('#form-connectionName')).toHaveValue('local');
        await expect(page.locator('#form-sourceName')).toBeVisible();
        await expect(page.locator('#form-databaseFilePath')).toBeVisible();
        await expect(page.locator('#form-connectionHost')).toHaveCount(0);
        await expect(page.locator('#form-connectionPassword')).toHaveCount(0);

        await page.locator('label').filter({ hasText: /^MySQL$/ }).click();

        await expect(page.getByRole('dialog')).toContainText('Add MySQL connection');
        await expect(page.locator('#form-connectionHost')).toBeVisible();
        await expect(page.locator('#form-connectionPort')).toHaveValue('3306');
        await expect(page.locator('#form-connectionUsername')).toBeVisible();
        await expect(page.locator('#form-connectionPassword')).toHaveAttribute('type', 'password');
        await expect(page.locator('#form-databaseName')).toBeVisible();
        await expect(page.locator('#form-databaseFilePath')).toHaveCount(0);
        await expect(page.locator('#form-sourceName')).toHaveCount(0);
    });

    test('the schema selection button counts the databases the server exposes', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'the schema selection button spec');

        const source = await createMySqlServerAndConnection(request, MYSQL.database, 'schema-count');

        try {
            await page.goto('/');

            const row = serverRow(page, source.serverId);
            await expandRow(row);
            await expect(page.locator(`[data-node-id="connection:${source.connectionId}"]`)).toBeVisible();

            const schemas = await post(request, 'getServerSchemas', { serverId: source.serverId });

            // "<visible connections> of <databases on the server>" — '?' means the count never loaded.
            const schemaButton = row.locator('#server-schema-selection-button');
            await expect(schemaButton).toHaveText(`1 of ${schemas.length}`);
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => undefined);
        }
    });

    test('backend API answers the editor settings endpoint', async ({ request }) => {
        const response = await request.post(`${API}/getEditorSettings`, { headers: { 'Content-Type': 'application/json' } });
        expect(response.ok()).toBe(true);

        const body = await response.json();
        expect(body).toHaveProperty('activeView');
        expect(body).toHaveProperty('queryRowLimit');
    });

    test('sidebar settings button keeps its menu and tooltip modifiers', async ({ page }) => {
        // `v-menu.button` opens the menu on a plain click, `v-tooltip.xs.nowrap` styles the tooltip;
        // both modifiers used to be dropped by the vue-to-tsx conversion.
        await page.goto('/');

        const tooltip = page.locator('.tooltip', { hasText: 'Open settings' });
        await expect(tooltip).toHaveClass(/tooltip-xs/);
        await expect(tooltip).toHaveClass(/tooltip-nowrap/);

        await page.getByTestId('sidebar-settings').click();

        await expect(page.locator('.v-menu-item', { hasText: 'Clear metadata caches' })).toBeVisible();
    });
});
