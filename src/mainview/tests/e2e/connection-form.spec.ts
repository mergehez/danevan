import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API, MYSQL, post, reloadSidebarRow, requireFixtureData, requireMySqlDatabase } from './helpers';

const ADD_SOURCE_BUTTON = 'aside button:has(i[class*="database-plus-outline"])';

type Bootstrap = {
    servers: Array<{ id: number; name: string }>;
    connections: Array<{ id: number; server_id: number; name: string; readonly: number }>;
};

/** The form is the only way to create a source; the ids it produced come back from the bootstrap. */
async function createdIds(request: APIRequestContext, serverName: string, connectionName: string) {
    const bootstrap = (await post(request, 'getBootstrap', undefined)) as Bootstrap;
    const server = requireFixtureData(
        bootstrap.servers.find((entry) => entry.name === serverName),
        `The connection form did not create the server "${serverName}".`
    );
    const connection = requireFixtureData(
        bootstrap.connections.find((entry) => entry.server_id === server.id && entry.name === connectionName),
        `The connection form did not create the connection "${connectionName}" of server "${serverName}".`
    );

    return { serverId: server.id, connectionId: connection.id };
}

function serverRow(page: Page, serverId: number) {
    return page.locator(`[data-node-id="server:${serverId}"]`);
}

test.describe('Create a connection through the form', () => {
    test('adds a read-only SQLite file source and shows its tables', async ({ page, request }) => {
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const databasePath = join(tmpdir(), `e2e-connection-form-${suffix}.sqlite`);
        const file = new Database(databasePath);
        file.exec("CREATE TABLE people (id integer primary key, name text); INSERT INTO people (name) VALUES ('Ada'), ('Grace')");
        file.close();

        const sourceName = `e2e-form-source-${suffix}`;
        const connectionName = `e2e-form-conn-${suffix}`;
        let serverId = -1;

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            await page.locator(ADD_SOURCE_BUTTON).click();

            // SQLite is the first driver, so it is already selected.
            const dialog = page.getByRole('dialog');
            await expect(dialog).toContainText('Add SQLite connection');
            await expect(dialog.locator('#form-connectionName')).toHaveValue('local');

            await dialog.locator('#form-connectionName').fill(connectionName);
            await dialog.locator('#form-sourceName').fill(sourceName);
            await dialog.locator('#form-databaseFilePath').fill(databasePath);
            // The form is where a connection is marked read-only.
            await dialog.getByTestId('form-connection-readonly').check();
            await dialog.getByRole('button', { name: 'Add', exact: true }).click();

            await expect(page.getByRole('dialog')).toHaveCount(0);

            const ids = await createdIds(request, sourceName, connectionName);
            serverId = ids.serverId;

            // The flag the form set reached the app database.
            const bootstrap = (await post(request, 'getBootstrap', undefined)) as Bootstrap;
            expect(bootstrap.connections.find((connection) => connection.id === ids.connectionId)?.readonly).toBe(1);

            // The source row itself says so, then the tables its file path really opened.
            const row = serverRow(page, serverId);
            await expect(row).toContainText(sourceName);
            await expect(row.locator('[data-testid="readonly-lock"]')).toBeVisible();

            await reloadSidebarRow(row);
            await expect(page.locator(`[data-node-id="table:${ids.connectionId}:people"]`)).toContainText('people');
        } finally {
            if (serverId > 0) {
                await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
            }

            if (existsSync(databasePath)) {
                rmSync(databasePath, { force: true });
            }
        }
    });

    test('adds a MySQL connection with a password without echoing it back', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'connection-form.spec.ts');

        const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        // A new server takes its name from the form's connection name, so both are the same.
        const name = `e2e-form-mysql-${suffix}`;
        const secret = `e2e-secret-${suffix}`;
        let serverId = -1;

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            await page.locator(ADD_SOURCE_BUTTON).click();

            const dialog = page.getByRole('dialog');
            await dialog
                .locator('label')
                .filter({ hasText: /^MySQL$/ })
                .click();
            await expect(dialog).toContainText('Add MySQL connection');

            await dialog.locator('#form-connectionName').fill(name);
            await dialog.locator('#form-connectionHost').fill(MYSQL.host);
            await dialog.locator('#form-connectionPort').fill(String(MYSQL.port));
            await dialog.locator('#form-connectionUsername').fill(MYSQL.username);
            await dialog.locator('#form-connectionPassword').fill(secret);
            await dialog.locator('#form-databaseName').fill(MYSQL.database);
            await dialog.getByRole('button', { name: 'Add', exact: true }).click();

            await expect(page.getByRole('dialog')).toHaveCount(0);

            const ids = await createdIds(request, name, name);
            serverId = ids.serverId;

            // The server and the connection it created are in the sidebar...
            // The row is labelled with the database it points at.
            await expect(serverRow(page, serverId)).toContainText(name);
            await expect(page.locator(`[data-node-id="connection:${ids.connectionId}"]`)).toContainText(MYSQL.database);

            // ...and the password is nowhere in the screen, not even after reopening the forms.
            await expect(page.locator('body')).not.toContainText(secret);
            expect(JSON.stringify(await post(request, 'getBootstrap', undefined))).not.toContain(secret);

            await page.locator(ADD_SOURCE_BUTTON).click();
            const reopened = page.getByRole('dialog');
            await reopened
                .locator('label')
                .filter({ hasText: /^MySQL$/ })
                .click();
            // The stored secret is not pre-filled into the form that created it.
            await expect(reopened.locator('#form-connectionPassword')).toHaveValue('');
            await expect(reopened).not.toContainText(secret);
            await reopened.getByRole('button', { name: 'Cancel' }).click();
            await expect(page.getByRole('dialog')).toHaveCount(0);

            await serverRow(page, serverId).click({ button: 'right' });
            const updateItem = page.locator('.v-menu-item', { hasText: 'Update...' });
            await expect(updateItem).toBeVisible();
            await updateItem.click();

            const updateForm = page.getByTestId('centered-modal-surface');
            await expect(updateForm).toContainText('Update Server');
            await expect(updateForm.locator('input[type="password"]')).toHaveCount(0);
            await expect(updateForm).not.toContainText(secret);
        } finally {
            if (serverId > 0) {
                await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
            }
        }
    });
});
