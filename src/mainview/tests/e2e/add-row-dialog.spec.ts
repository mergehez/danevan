import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';

const API = 'http://127.0.0.1:3264/api';

async function post(request: APIRequestContext, method: string, data: unknown) {
    const resp = await request.post(`${API}/${method}`, { data });
    expect(resp.ok()).toBeTruthy();
    return resp.json();
}

async function createPeopleSource(request: APIRequestContext) {
    const suffix = Date.now().toString();
    const dbPath = `/tmp/e2e-add-row-${suffix}.sqlite`;
    const file = new Database(dbPath);

    file.exec('CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, nickname TEXT, age INTEGER DEFAULT NULL)');
    file.exec("INSERT INTO people (name, nickname) VALUES ('Ada', 'the first')");
    file.close();

    const serverName = `e2e-add-row-${suffix}`;
    const bootstrap = await post(request, 'createServer', { name: serverName, kind: 'file', driver: 'sqlite', filePath: dbPath });
    const serverId = bootstrap.servers.find((entry: { name: string }) => entry.name === serverName).id;
    const connectionName = `${serverName}-conn`;
    const withConnection = await post(request, 'createConnection', {
        serverId,
        name: connectionName,
        host: undefined,
        port: undefined,
        databaseName: undefined,
        readonly: false,
    });
    const connectionId = withConnection.connections.find((entry: { name: string }) => entry.name === connectionName).id;

    return { serverId, connectionId, dbPath };
}

async function openPeopleTable(page: Page, connectionId: number, serverId: number) {
    const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
    await expect(serverRow).toBeVisible({ timeout: 15_000 });

    // Sidebar rows are sticky and can be covered by the section header above them, so
    // navigation dispatches a bubbling event instead of relying on hit-testing. (What is
    // under test here is the dialog, not the sidebar.)
    const dispatch = (selector: string, type: 'click' | 'dblclick') =>
        page.locator(selector).evaluate((element, eventType) => element.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true })), type);

    // A file source has no connection row: its tables hang straight under the source row,
    // and they are fetched the moment that row is expanded. The collapse step makes the
    // fetch happen even if the source was already expanded when the app loaded.
    const toggle = `[data-sidebar-toggle-for="server:${serverId}"]`;
    if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'false') {
        await dispatch(toggle, 'click');
        await expect(serverRow).toHaveAttribute('data-sidebar-collapsed', 'true');
    }
    await dispatch(toggle, 'click');

    const tableRow = page.locator(`[data-node-id="table:${connectionId}:people"]`);
    await expect(tableRow).toBeVisible({ timeout: 15_000 });

    // A single click only toggles the row's details; the table opens on double click.
    await dispatch(`[data-node-id="table:${connectionId}:people"]`, 'dblclick');

    await expect(page.getByTestId('grid-add-row')).toBeVisible({ timeout: 15_000 });
}

test.describe('Add row dialog', () => {
    test('starts editable and only disables what the database fills for you', async ({ page, request }) => {
        const source = await createPeopleSource(request);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await page.waitForTimeout(3000);

            await openPeopleTable(page, source.connectionId, source.serverId);
            await page.getByTestId('grid-add-row').click();

            const form = page.getByTestId('add-row-form');
            await expect(form).toBeVisible();

            const nameInput = form.getByTestId('add-row-value-name');
            const nicknameInput = form.getByTestId('add-row-value-nickname');
            const ageInput = form.getByTestId('add-row-value-age');
            const idInput = form.getByTestId('add-row-value-id');

            // Regression: every field used to start disabled, because each column was
            // treated as NULL and a NOT NULL column has no checkbox to clear that.
            await expect(nameInput).toBeEnabled();
            await expect(nicknameInput).toBeEnabled();
            await expect(ageInput).toBeEnabled();

            await nameInput.fill('Grace');
            await expect(nameInput).toHaveValue('Grace');

            // The auto-increment key is disabled on purpose, and says why.
            await expect(idInput).toBeDisabled();
            await expect(idInput).toHaveAttribute('placeholder', 'auto');
            await expect(form.getByTestId('add-row-auto-id')).toHaveCount(1);
            await form.getByTestId('add-row-auto-id').hover();
            await expect(page.getByText('Auto increment - the database fills this column')).toBeVisible();

            // The NULL checkbox only affects its own field, and can be cleared again.
            await form.getByTestId('add-row-null-nickname').click();
            await expect(nicknameInput).toBeDisabled();
            await expect(nameInput).toBeEnabled();
            await expect(ageInput).toBeEnabled();

            await form.getByTestId('add-row-null-nickname').click();
            await expect(nicknameInput).toBeEnabled();
            await nicknameInput.fill('the second');

            await form.getByTestId('add-row-submit').click();
            await expect(form).toBeHidden();

            // The row is staged as a pending change, not written on submit.
            await expect(page.getByText('1 pending change')).toBeVisible();

            const beforeSave = await post(request, 'getTableData', { connectionId: source.connectionId, tableName: 'people', limit: 50, offset: 0 });
            expect(beforeSave.rows.map((row: { name: string }) => row.name)).toEqual(['Ada']);

            await page.getByTestId('save-bar-save').click();

            await expect
                .poll(async () => (await post(request, 'getTableData', { connectionId: source.connectionId, tableName: 'people', limit: 50, offset: 0 })).rows.length, {
                    timeout: 15_000,
                })
                .toBe(2);

            const afterSave = await post(request, 'getTableData', { connectionId: source.connectionId, tableName: 'people', limit: 50, offset: 0 });
            const inserted = afterSave.rows.find((row: { name: string }) => row.name === 'Grace');

            expect(inserted).toBeTruthy();
            expect(inserted.nickname).toBe('the second');
            expect(Number(inserted.id)).toBeGreaterThan(1);
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
            rmSync(source.dbPath, { force: true });
        }
    });

    test('writes NULL for a column whose checkbox is ticked', async ({ page, request }) => {
        const source = await createPeopleSource(request);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await page.waitForTimeout(3000);

            await openPeopleTable(page, source.connectionId, source.serverId);
            await page.getByTestId('grid-add-row').click();

            const form = page.getByTestId('add-row-form');
            await expect(form).toBeVisible();

            await form.getByTestId('add-row-value-name').fill('Null Nick');
            await form.getByTestId('add-row-null-nickname').click();
            await expect(form.getByTestId('add-row-value-nickname')).toBeDisabled();

            await form.getByTestId('add-row-submit').click();
            await expect(form).toBeHidden();

            await page.getByTestId('save-bar-save').click();

            await expect
                .poll(async () => (await post(request, 'getTableData', { connectionId: source.connectionId, tableName: 'people', limit: 50, offset: 0 })).rows.length, {
                    timeout: 15_000,
                })
                .toBe(2);

            const rows = (await post(request, 'getTableData', { connectionId: source.connectionId, tableName: 'people', limit: 50, offset: 0 })).rows;
            const inserted = rows.find((row: { name: string }) => row.name === 'Null Nick');

            expect(inserted).toBeTruthy();
            expect(inserted.nickname).toBeNull();
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
            rmSync(source.dbPath, { force: true });
        }
    });
});
