// A table tab is named by its table only, so a colored dot is what tells two databases apart. The
// color lives on the app DB: on the server row for a file source, on the connection row otherwise.
import { expect, test, type Page } from '@playwright/test';
import { API, MYSQL, createFileSource, createMySqlServerAndConnection, openSidebarRowMenu, openSidebarTable, post, reloadSidebarRow, requireMySqlDatabase } from './helpers';

const notesSchema = `CREATE TABLE notes (id integer primary key, body text); INSERT INTO notes (id, body) VALUES (1, 'note');`;

async function openApp(page: Page) {
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
}

function tableTab(page: Page, connectionId: number) {
    return page.locator(`#table-${connectionId}-notes`);
}

function tableTabDot(page: Page, connectionId: number) {
    return page.locator(`[data-testid="tab-color-table-${connectionId}-notes"]`);
}

async function pickColorFromRowMenu(page: Page, serverId: number, hex: string) {
    await openSidebarRowMenu(page.locator(`[data-node-id="server:${serverId}"]`));
    await page.getByRole('menuitem', { name: 'Appearance...' }).click();

    const dialog = page.getByTestId('db-appearance-dialog');
    const hexInput = dialog.locator('input[aria-label="Hex"]');
    await hexInput.fill(hex);
    await hexInput.press('Tab');
    await page.getByTestId('db-appearance-save').click();
    await expect(dialog).toBeHidden();
}

async function setShortCodeFromRowMenu(page: Page, serverId: number, shortCode: string) {
    await openSidebarRowMenu(page.locator(`[data-node-id="server:${serverId}"]`));
    await page.getByRole('menuitem', { name: 'Appearance...' }).click();

    const dialog = page.getByTestId('db-appearance-dialog');
    await dialog.getByTestId('db-appearance-short-code').fill(shortCode);
    await page.getByTestId('db-appearance-save').click();
    await expect(dialog).toBeHidden();
}

test.describe('Database colors on table tabs', () => {
    test('tags a file source from its row menu and shows the dot, with only the table name', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'db-color-menu', schema: notesSchema });

        try {
            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
            await openSidebarTable(page, source.connectionId, 'notes');

            // Without a color the dot is a neutral outline.
            await expect(tableTabDot(page, source.connectionId)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

            await pickColorFromRowMenu(page, source.serverId, '3b82f6');

            await expect(tableTabDot(page, source.connectionId)).toHaveCSS('background-color', 'rgb(59, 130, 246)');
            // The sidebar row carries the same dot, in place of its database icon.
            await expect(page.locator(`[data-testid="sidebar-color-server:${source.serverId}"]`)).toHaveCSS('background-color', 'rgb(59, 130, 246)');
            // The label is the table name only; the full path stays in the tooltip.
            await expect(tableTab(page, source.connectionId)).toContainText('notes');
            await expect(tableTab(page, source.connectionId)).not.toContainText(source.serverName);
            await expect(tableTab(page, source.connectionId).locator('i.icon-[mdi\\-\\-table-large]')).toHaveCount(0);

            // The 1-2 letter tag is shown before the dot and takes the database's color.
            await setShortCodeFromRowMenu(page, source.serverId, 'ti');
            const code = page.locator(`[data-testid="tab-code-table-${source.connectionId}-notes"]`);
            await expect(code).toHaveText('TI');
            await expect(code).toHaveCSS('color', 'rgb(59, 130, 246)');
            const codeBeforeDot = await page.locator(`#table-${source.connectionId}-notes`).evaluate((tab) => {
                const codeElement = tab.querySelector('[data-testid^="tab-code-"]');
                const dotElement = tab.querySelector('[data-testid^="tab-color-"]');
                return !!codeElement && !!dotElement && codeElement.compareDocumentPosition(dotElement) === Node.DOCUMENT_POSITION_FOLLOWING;
            });
            expect(codeBeforeDot).toBe(true);

            // The choice is stored in the app DB, not only in the tab.
            const bootstrap = await post(page.request, 'getBootstrap', undefined);
            expect(bootstrap.servers.find((server: { id: number }) => server.id === source.serverId)?.color).toBe('#3b82f6');
        } finally {
            await source.cleanup();
        }
    });

    test('edits the color in the file source update form', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'db-color-form', schema: notesSchema });

        try {
            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));

            await openSidebarRowMenu(page.locator(`[data-node-id="server:${source.serverId}"]`));
            await page.locator('.v-menu-item', { hasText: 'Update...' }).click();

            const surface = page.locator('[data-testid="centered-modal-surface"]');
            await expect(surface.getByTestId('db-appearance-current')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

            await surface.getByTestId('db-appearance-trigger').click();
            const picker = surface.getByTestId('db-appearance-picker');
            const hexInput = picker.locator('input[aria-label="Hex"]');
            await hexInput.fill('ec4899');
            await hexInput.press('Tab');
            await surface.getByRole('button', { name: 'Update' }).click();
            await expect(surface).toBeHidden();

            await openSidebarTable(page, source.connectionId, 'notes');
            await expect(tableTabDot(page, source.connectionId)).toHaveCSS('background-color', 'rgb(236, 72, 153)');
            await expect(page.locator(`[data-testid="sidebar-color-server:${source.serverId}"]`)).toHaveCSS('background-color', 'rgb(236, 72, 153)');

            // Reopening shows the stored color.
            await openSidebarRowMenu(page.locator(`[data-node-id="server:${source.serverId}"]`));
            await page.locator('.v-menu-item', { hasText: 'Update...' }).click();
            await expect(page.locator('[data-testid="centered-modal-surface"]').getByTestId('db-appearance-current')).toHaveCSS('background-color', 'rgb(236, 72, 153)');
            // The form's short-code field is part of the same appearance block.
            await expect(page.locator('[data-testid="centered-modal-surface"]').getByTestId('db-short-code')).toHaveValue('');
        } finally {
            await source.cleanup();
        }
    });

    test('shows a different dot for each database with a table of the same name', async ({ page, request }) => {
        const sourceA = await createFileSource(request, { label: 'db-color-a', schema: notesSchema });
        const sourceB = await createFileSource(request, { label: 'db-color-b', schema: notesSchema });

        try {
            await post(request, 'updateServer', {
                serverId: sourceA.serverId,
                server: {
                    name: sourceA.serverName,
                    kind: 'file',
                    driver: 'sqlite',
                    filePath: sourceA.databasePath,
                    host: undefined,
                    port: undefined,
                    username: undefined,
                    password: undefined,
                    color: '#22c55e',
                },
            });
            await post(request, 'updateServer', {
                serverId: sourceB.serverId,
                server: {
                    name: sourceB.serverName,
                    kind: 'file',
                    driver: 'sqlite',
                    filePath: sourceB.databasePath,
                    host: undefined,
                    port: undefined,
                    username: undefined,
                    password: undefined,
                    color: '#f97316',
                },
            });

            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${sourceA.serverId}"]`));
            await openSidebarTable(page, sourceA.connectionId, 'notes');
            await reloadSidebarRow(page.locator(`[data-node-id="server:${sourceB.serverId}"]`));
            await openSidebarTable(page, sourceB.connectionId, 'notes');

            // Both tabs say "notes"; the dots are what differs.
            await expect(tableTab(page, sourceA.connectionId)).toContainText('notes');
            await expect(tableTab(page, sourceB.connectionId)).toContainText('notes');
            await expect(tableTabDot(page, sourceA.connectionId)).toHaveCSS('background-color', 'rgb(34, 197, 94)');
            await expect(tableTabDot(page, sourceB.connectionId)).toHaveCSS('background-color', 'rgb(249, 115, 22)');
        } finally {
            await sourceA.cleanup();
            await sourceB.cleanup();
        }
    });
});

test.describe('Database colors on a server-based connection', () => {
    test('tags a connection from its row menu and shows the dot on its table tab', async ({ page, request }) => {
        requireMySqlDatabase(MYSQL.database);

        const connection = await createMySqlServerAndConnection(request, MYSQL.database, 'db-color-mysql');
        const tableName = `color_tab_${Date.now()}`;

        try {
            await post(request, 'runQuery', { connectionId: connection.connectionId, sql: `CREATE TABLE \`${tableName}\` (id int primary key)` });

            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${connection.serverId}"]`));
            await reloadSidebarRow(page.locator(`[data-node-id="connection:${connection.connectionId}"]`));
            await openSidebarTable(page, connection.connectionId, tableName);

            await openSidebarRowMenu(page.locator(`[data-node-id="connection:${connection.connectionId}"]`));
            await page.getByRole('menuitem', { name: 'Appearance...' }).click();

            const dialog = page.getByTestId('db-appearance-dialog');
            const hexInput = dialog.locator('input[aria-label="Hex"]');
            await hexInput.fill('8b5cf6');
            await hexInput.press('Tab');
            await page.getByTestId('db-appearance-save').click();
            await expect(dialog).toBeHidden();

            await expect(page.locator(`[data-testid="tab-color-table-${connection.connectionId}-${tableName}"]`)).toHaveCSS('background-color', 'rgb(139, 92, 246)');
            await expect(page.locator(`[data-testid="sidebar-color-connection:${connection.connectionId}"]`)).toHaveCSS('background-color', 'rgb(139, 92, 246)');

            const bootstrap = await post(page.request, 'getBootstrap', undefined);
            expect(bootstrap.connections.find((entry: { id: number }) => entry.id === connection.connectionId)?.color).toBe('#8b5cf6');
        } finally {
            await request.post(`${API}/runQuery`, { data: { connectionId: connection.connectionId, sql: `DROP TABLE IF EXISTS \`${tableName}\`` } }).catch(() => {});
            await request.post(`${API}/deleteServer`, { data: { serverId: connection.serverId } }).catch(() => {});
        }
    });
});
