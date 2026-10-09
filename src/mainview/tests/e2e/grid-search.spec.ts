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
    const dbPath = `/tmp/e2e-grid-search-${suffix}.sqlite`;
    const file = new Database(dbPath);

    file.exec('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT)');
    file.exec("INSERT INTO people (name) VALUES ('Alpha'), ('Alphabet'), ('Zulu')");
    file.close();

    const serverName = `e2e-grid-search-${suffix}`;
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

    const dispatch = (selector: string, type: 'click' | 'dblclick') =>
        page.locator(selector).evaluate((element, eventType) => element.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true })), type);

    const toggle = `[data-sidebar-toggle-for="server:${serverId}"]`;
    if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'false') {
        await dispatch(toggle, 'click');
        await expect(serverRow).toHaveAttribute('data-sidebar-collapsed', 'true');
    }
    await dispatch(toggle, 'click');

    const tableRow = page.locator(`[data-node-id="table:${connectionId}:people"]`);
    await expect(tableRow).toBeVisible({ timeout: 15_000 });
    await dispatch(`[data-node-id="table:${connectionId}:people"]`, 'dblclick');

    await expect(page.getByTestId('data-grid-viewport')).toBeVisible({ timeout: 15_000 });
}

test.describe('Grid search', () => {
    test('filters the result set after typing pauses and clears instantly', async ({ page, request }) => {
        const source = await createPeopleSource(request);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await page.waitForTimeout(3000);

            await openPeopleTable(page, source.connectionId, source.serverId);

            const search = page.getByPlaceholder('Search grid');
            const counter = search.locator('xpath=following-sibling::span[1]');

            await expect(counter).toHaveText('0/0');

            await search.fill('alp');
            // The input echoes immediately; the debounced commit then reports the matches.
            await expect(search).toHaveValue('alp');
            await expect(counter).toHaveText('1/2');

            await search.fill('zzz');
            await expect(counter).toHaveText('0/0');
            await expect(page.getByText('No matching rows.')).toBeVisible();

            // Clearing shows every row again, without waiting for the debounce.
            await search.fill('');
            await expect(counter).toHaveText('0/0');
            await expect(page.getByText('No matching rows.')).toHaveCount(0);
            await expect(page.getByRole('button', { name: /^1-3 of 3$/ })).toBeVisible();
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
            rmSync(source.dbPath, { force: true });
        }
    });
});
