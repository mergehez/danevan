import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, MYSQL, createMySqlServerAndConnection, post } from './helpers';

// Port 1 refuses immediately, so failures are fast rather than waiting for the connect timeout.
async function createUnreachableServerAndConnection(request: APIRequestContext) {
    const suffix = Date.now().toString();
    const serverName = `e2e-unreachable-${suffix}`;
    const serverBootstrap = await post(request, 'createServer', {
        name: serverName,
        kind: 'server',
        driver: 'mysql',
        filePath: undefined,
        host: '127.0.0.1',
        port: 1,
        username: 'nobody',
        password: '',
    });
    const serverId = serverBootstrap.servers.find((entry: { name: string }) => entry.name === serverName).id;

    const connectionName = `e2e-unreachable-conn-${suffix}`;
    const databaseName = 'missing-db';
    const connectionBootstrap = await post(request, 'createConnection', {
        serverId,
        name: connectionName,
        host: '127.0.0.1',
        port: 1,
        databaseName,
        readonly: false,
    });
    const connectionId = connectionBootstrap.connections.find((entry: { name: string }) => entry.name === connectionName).id;

    return { serverId, connectionId, serverName, connectionName, databaseName };
}

test.describe('Server connections', () => {
    test('the server port input keeps a numeric model', async ({ page, request }) => {
        // `v-model.number` on a plain input is converted to `value` + `onInput` with `looseToNumber`.
        const failures: string[] = [];
        page.on('pageerror', (error) => failures.push(error.message));

        const { serverId } = await createMySqlServerAndConnection(request, MYSQL.database, 'hide');

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            await page.locator(`[data-node-id="server:${serverId}"]`).click({ button: 'right' });
            await page.locator('.v-menu-item', { hasText: 'Update...' }).click();

            const port = page.getByPlaceholder('Port');
            await expect(port).toHaveValue(String(MYSQL.port));

            // Typing must go through the coercion helper without throwing.
            await port.fill('3399');
            expect(failures).toEqual([]);

            // The form only submits `port` when it is a number, so this fails if the input stores a string.
            const updateRequest = page.waitForRequest((request) => request.url().endsWith('/api/updateServer'));
            await page.getByRole('button', { name: 'Update' }).click();

            const payload = JSON.parse((await updateRequest).postData() ?? '{}');
            expect(payload.server.port).toBe(3399);
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('lists connections alphabetically instead of by insertion order', async ({ page }) => {
        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request, MYSQL.database, 'hide');

        try {
            // Created second, but it sorts before the generated `e2e-hide-conn-…` name.
            const earlierName = `aa-sorted-${Date.now()}`;
            const bootstrap = await post(page.request, 'createConnection', {
                serverId,
                name: earlierName,
                host: MYSQL.host,
                port: MYSQL.port,
                databaseName: MYSQL.database,
                readonly: false,
            });
            const earlierConnectionId = bootstrap.connections.find((entry: { name: string }) => entry.name === earlierName).id;

            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
            await expect(serverRow).toBeVisible();

            if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await serverRow.click();
            }

            const connectionRows = page.locator(`[data-parent-id="server:${serverId}"]`);
            await expect(connectionRows).toHaveCount(2);

            const nodeIds = await connectionRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-node-id')));
            expect(nodeIds).toEqual([`connection:${earlierConnectionId}`, `connection:${connectionId}`]);
        } finally {
            await page.request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('keeps the saved scripts and can be undone from "Choose databases..."', async ({ request }) => {
        const { serverId, connectionId } = await createMySqlServerAndConnection(request, MYSQL.database, 'hide');

        try {
            const scriptBootstrap = await post(request, 'createScript', { connectionId, name: 'kept script', sqlText: 'SELECT 1' });
            const scriptId = scriptBootstrap.scripts.find((entry: { name: string }) => entry.name === 'kept script').id;
            expect(scriptId).toBeTruthy();

            const afterHide = await post(request, 'hideConnection', { connectionId });
            expect(afterHide.connections.some((entry: { id: number }) => entry.id === connectionId)).toBe(false);
            // The script must survive: hiding is not a delete.
            expect(afterHide.scripts.some((entry: { id: number }) => entry.id === scriptId)).toBe(true);

            const afterShow = await post(request, 'setVisibleServerSchemas', { serverId, schemaNames: [MYSQL.database] });
            expect(afterShow.connections.some((entry: { id: number }) => entry.id === connectionId)).toBe(true);
            expect(afterShow.scripts.some((entry: { id: number }) => entry.id === scriptId)).toBe(true);
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('the "Choose databases" popover applies a toggle immediately', async ({ page }) => {
        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request, MYSQL.database, 'hide');

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
            await expect(serverRow).toBeVisible();

            if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await serverRow.click();
            }

            const connectionRow = page.locator(`[data-node-id="connection:${connectionId}"]`);
            await expect(connectionRow).toBeVisible();

            await serverRow.locator('#server-schema-selection-button').click();

            // No Apply button: unchecking takes effect right away.
            await expect(page.locator('button', { hasText: 'Apply now' })).toHaveCount(0);

            const schemaCheckbox = page
                .locator('label')
                .filter({ hasText: new RegExp(`^\\s*${MYSQL.database}\\s*$`) })
                .locator('input[type="checkbox"]');
            await expect(schemaCheckbox).toBeChecked();

            await schemaCheckbox.uncheck();

            await expect(connectionRow).toHaveCount(0);
        } finally {
            await page.request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('names the connection when a connection request fails', async ({ page, request }) => {
        const { serverId, connectionId, connectionName, databaseName } = await createUnreachableServerAndConnection(request);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
            await expect(serverRow).toBeVisible();

            if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await serverRow.click();
            }

            // Expanding the connection loads its tables, which fails against the dead host.
            await page.locator(`[data-node-id="connection:${connectionId}"]`).click();

            const errorText = page.locator('p', { hasText: 'ECONNREFUSED' });
            await expect(errorText).toBeVisible();
            await expect(errorText).toContainText(`${connectionName} (127.0.0.1:1/${databaseName})`);
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('names the server when a server request fails', async ({ page, request }) => {
        const { serverId, serverName } = await createUnreachableServerAndConnection(request);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
            await expect(serverRow).toBeVisible();
            await serverRow.click({ button: 'right' });

            await page.locator('.v-menu-item', { hasText: 'Refresh databases' }).click();

            const errorText = page.locator('p', { hasText: 'ECONNREFUSED' });
            await expect(errorText).toBeVisible();
            await expect(errorText).toContainText(`${serverName} (127.0.0.1:1)`);
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('hides from the sidebar without asking for confirmation', async ({ page }) => {
        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request, MYSQL.database, 'hide');

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
            await expect(serverRow).toBeVisible();

            if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await serverRow.click();
            }

            const connectionRow = page.locator(`[data-node-id="connection:${connectionId}"]`);
            await expect(connectionRow).toBeVisible();
            await connectionRow.click({ button: 'right' });

            const menuItem = page.locator('.v-menu-item', { hasText: 'Hide database' });
            await expect(menuItem).toBeVisible();
            await menuItem.click();

            // No confirmation dialog: the row just goes away.
            await expect(page.locator('[data-testid="centered-modal-surface"]')).toHaveCount(0);
            await expect(connectionRow).toHaveCount(0);
        } finally {
            await page.request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });
});
