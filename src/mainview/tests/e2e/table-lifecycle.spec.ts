import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API, MYSQL, createFileSource, createMySqlServerAndConnection, openSidebarRowMenu, post, reloadSidebarRow, requireFixtureData, requireMySqlDatabase } from './helpers';

/** A source that already has one table, so the connection it creates really works. */
const SEED_SCHEMA = `
    CREATE TABLE keep_me (id INTEGER PRIMARY KEY, note TEXT);
    INSERT INTO keep_me (id, note) VALUES (1, 'stays');
`;

async function tableNames(request: APIRequestContext, connectionId: number) {
    const tables = await post(request, 'getTables', { connectionId });
    return (tables as Array<{ name: string }>).map((table) => table.name).sort();
}

/** Picks an entry from a sidebar row's context menu. */
async function rowMenu(page: Page, nodeId: string, item: string) {
    await openSidebarRowMenu(page.locator(`[data-node-id="${nodeId}"]`));

    const menuItem = page.locator('.v-menu-item', { hasText: item });
    await expect(menuItem).toBeVisible();
    await menuItem.click();
}

test.describe('Table lifecycle', () => {
    test('creates a table from the server menu and deletes it after confirming', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'table-lifecycle', schema: SEED_SCHEMA });
        const tableName = `created_${Date.now()}`;

        try {
            await page.goto('/');
            await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));

            // Server menu entry 221 creates a table on the file source's only connection.
            await rowMenu(page, `server:${source.serverId}`, 'Create new table...');

            const modal = page.getByTestId('centered-modal-surface');
            await expect(modal).toContainText('Modify');
            await expect(page.locator('[data-testid="modify-apply"]')).toBeVisible();

            await page.getByTestId('modify-table-name').fill(tableName);

            // The draft starts with one `id int` column; give it a second one.
            await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="columns"]').click();
            await page.locator('[data-testid="modify-add"]').click();
            await page.locator('[data-testid="modify-column-name"]').fill('title');
            await page.locator('[data-testid="modify-column-type"] input').fill('text');
            await page.locator('[data-testid="modify-column-type"] input').press('Enter');

            await page.locator('[data-testid="modify-apply"]').click();
            await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

            // The new table shows up in the sidebar and in the database.
            const tableRow = page.locator(`[data-node-id="table:${source.connectionId}:${tableName}"]`);
            await expect(tableRow).toBeVisible();
            expect(await tableNames(request, source.connectionId)).toEqual(['keep_me', tableName].sort());

            // Deleting asks first, and cancelling keeps the table.
            await rowMenu(page, `table:${source.connectionId}:${tableName}`, 'Delete Table...');

            const confirmation = page.getByTestId('centered-modal-surface');
            await expect(confirmation).toContainText(`This will permanently delete ${tableName}.`);
            await confirmation.getByRole('button', { name: 'Cancel' }).click();

            await expect(tableRow).toBeVisible();
            expect(await tableNames(request, source.connectionId)).toEqual(['keep_me', tableName].sort());

            // Confirming removes it from both the sidebar and the database.
            await rowMenu(page, `table:${source.connectionId}:${tableName}`, 'Delete Table...');
            await page.getByRole('button', { name: 'Delete table' }).click();

            await expect(tableRow).toHaveCount(0);
            await expect.poll(() => tableNames(request, source.connectionId)).toEqual(['keep_me']);
        } finally {
            await source.cleanup();
        }
    });

    test('copies the table DDL to the clipboard', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'table-ddl', schema: SEED_SCHEMA });

        try {
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

            await page.goto('/');
            await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));

            await rowMenu(page, `table:${source.connectionId}:keep_me`, 'Copy as DDL');

            // The copy is async (fetch DDL, format, write): wait for the clipboard to fill.
            await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('keep_me');

            const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
            expect(clipboardText).toContain('keep_me');
            expect(clipboardText).toContain('id');
            expect(clipboardText).toContain('note');
        } finally {
            await source.cleanup();
        }
    });

    test('creates a database through the server menu', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'table-lifecycle.spec.ts');

        const suffix = Date.now();
        const databaseName = `e2e_lifecycle_${suffix}`;
        const source = await createMySqlServerAndConnection(request, MYSQL.database, 'lifecycle');

        try {
            await page.goto('/');

            await rowMenu(page, `server:${source.serverId}`, 'Create new database...');

            const modal = page.getByTestId('centered-modal-surface');
            await expect(modal).toContainText('Create database');

            await modal.getByPlaceholder('mydatabase').fill(databaseName);
            await modal.getByPlaceholder('utf8mb4_unicode_ci').fill('utf8mb4_unicode_ci');
            await modal.getByRole('button', { name: 'Create' }).click();

            await expect(page.getByTestId('centered-modal-surface')).toHaveCount(0);

            // The new database comes back as its own connection, named after it.
            const bootstrap = await post(request, 'getBootstrap', undefined);
            const connection = requireFixtureData(
                (bootstrap.connections as Array<{ id: number; server_id: number; database_name?: string }>).find(
                    (entry) => entry.server_id === source.serverId && entry.database_name === databaseName
                ),
                `POST /api/createDatabase did not create a connection for "${databaseName}".`
            );

            await expect(page.locator(`[data-node-id="connection:${connection.id}"]`)).toContainText(databaseName);
        } finally {
            await request.post(`${API}/runQuery`, { data: { connectionId: source.connectionId, sql: `DROP DATABASE IF EXISTS \`${databaseName}\`` } }).catch(() => {});
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
        }
    });
});
