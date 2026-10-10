// Failures have to be visible where the user is looking. A save against a connection that broke
// after the change was staged must keep the change and say why; a server that rejects the
// credentials must name the connection it rejected.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, MYSQL, createMySqlServerAndConnection, expandSidebarRow, openMySqlTable, openSidebarRowMenu, post, requireFixtureData, requireMySqlDatabase } from './helpers';

async function runSql(request: APIRequestContext, connectionId: number, sql: string) {
    await post(request, 'runQuery', { connectionId, sql });
}

test.describe('Failure modes', () => {
    test('shows why a save failed and keeps the pending change', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'failure-modes.spec.ts');

        const tableName = `e2e_save_failure_${Date.now()}`;
        const source = await createMySqlServerAndConnection(request, MYSQL.database, 'save-failure');

        try {
            await runSql(request, source.connectionId, `CREATE TABLE \`${tableName}\` (id int NOT NULL, name varchar(50), PRIMARY KEY (id))`);

            await page.goto('/');
            await openMySqlTable(page, source, tableName);

            // Stage an insert through the toolbar dialog, so nothing depends on canvas hit-testing.
            await page.getByTestId('grid-add-row').click();
            const form = page.getByTestId('add-row-form');
            await form.getByTestId('add-row-value-id').fill('1');
            await form.getByTestId('add-row-value-name').fill('Staged');
            await form.getByTestId('add-row-submit').click();
            await expect(page.getByText('1 pending change')).toBeVisible();

            // The server moves behind the app's back: same connection, a port nothing listens on.
            await post(request, 'updateConnection', {
                connectionId: source.connectionId,
                connection: {
                    serverId: source.serverId,
                    name: source.connectionName,
                    host: MYSQL.host,
                    port: 1,
                    databaseName: MYSQL.database,
                    readonly: false,
                },
            });

            await page.getByTestId('save-bar-save').click();

            const error = page.getByTestId('save-bar-error');
            await expect(error).toBeVisible();
            await expect(error).toContainText(source.connectionName);
            await expect(error).toContainText('ECONNREFUSED');
            // The failure's own message, not the JSON envelope that carried it.
            await expect(error).not.toContainText('Backend error');

            // The staged change survives the failure, so the user can fix the connection and retry.
            await expect(page.getByText('1 pending change')).toBeVisible();
            await expect(page.getByTestId('save-bar-save')).toBeEnabled();
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
        }
    });

    test('names the connection whose credentials the server rejected', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'failure-modes.spec.ts');

        const suffix = Date.now();
        const serverName = `e2e-bad-credentials-server-${suffix}`;
        const connectionName = `e2e-bad-credentials-conn-${suffix}`;

        const serverBootstrap = await post(request, 'createServer', {
            name: serverName,
            kind: 'server',
            driver: 'mysql',
            filePath: undefined,
            host: MYSQL.host,
            port: MYSQL.port,
            username: MYSQL.username,
            password: 'definitely-not-the-password',
        });
        const serverId = requireFixtureData(
            (serverBootstrap.servers as Array<{ id: number; name: string }>).find((server) => server.name === serverName),
            'POST /api/createServer did not return the new server.'
        ).id;

        const connectionBootstrap = await post(request, 'createConnection', {
            serverId,
            name: connectionName,
            host: MYSQL.host,
            port: MYSQL.port,
            databaseName: MYSQL.database,
            readonly: false,
        });
        const connectionId = requireFixtureData(
            (connectionBootstrap.connections as Array<{ id: number; name: string }>).find((connection) => connection.name === connectionName),
            'POST /api/createConnection did not return the new connection.'
        ).id;

        try {
            await page.goto('/');

            const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
            await expect(serverRow).toBeVisible();
            await serverRow.click();

            // Loading the tables is what the rejected credentials break.
            await page.locator(`[data-node-id="connection:${connectionId}"]`).click();

            const errorText = page.locator('p', { hasText: 'Access denied' });
            await expect(errorText).toBeVisible();
            await expect(errorText).toContainText(connectionName);
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('says the backend never answered instead of leaving an empty shell', async ({ page }) => {
        // Nothing listens on the API port: the renderer boots, but no request can succeed.
        await page.route('**/api/**', (route) => route.abort());

        await page.goto('/');

        const failure = page.getByTestId('request-error');
        await expect(failure).toBeVisible();
        await expect(failure).toContainText('Request failed');

        // The same build boots normally as soon as the backend answers again.
        await page.unroute('**/api/**');
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
        await expect(failure).toHaveCount(0);
    });

    test('shows a mysqldump executable that is gone, in the export modal', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'failure-modes.spec.ts');

        const { serverId, connectionId } = await createMySqlServerAndConnection(request, MYSQL.database, 'export-failure');

        try {
            await page.goto('/');
            await expandSidebarRow(page.locator(`[data-node-id="server:${serverId}"]`));
            await openSidebarRowMenu(page.locator(`[data-node-id="connection:${connectionId}"]`));
            await page.locator('.v-menu-item', { hasText: 'Export using mysqldump...' }).click();

            const modal = page.getByTestId('centered-modal-surface');
            await expect(modal).toContainText('Export with mysqldump...');

            const missingExecutable = '/tmp/e2e-mysqldump-that-is-gone';
            await modal.getByPlaceholder('/path/to/mysqldump').fill(missingExecutable);
            await modal.getByPlaceholder('/path/to/dump.sql').fill('/tmp/e2e-export-failure.sql');
            await modal.getByRole('button', { name: 'Run', exact: true }).click();

            await expect(modal).toContainText(`The mysqldump executable was not found at: ${missingExecutable}`);
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });
});
