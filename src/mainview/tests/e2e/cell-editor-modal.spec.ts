import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';

const API = 'http://127.0.0.1:3264/api';

/** Column 0 of a one-column table starts here for both the 42px row-number gutter and the compact 18px one. */
const FIRST_COLUMN_X = 78;
const FIRST_ROW_Y = 46;
const ROW_HEIGHT = 25;

async function post(request: APIRequestContext, method: string, data: unknown) {
    const resp = await request.post(`${API}/${method}`, { data });
    expect(resp.ok()).toBeTruthy();
    return resp.json();
}

async function createDocsSource(request: APIRequestContext) {
    const suffix = Date.now().toString();
    const dbPath = `/tmp/e2e-cell-editor-modal-${suffix}.sqlite`;
    const file = new Database(dbPath);

    file.exec('CREATE TABLE docs (payload TEXT)');
    file.exec(
        `INSERT INTO docs (payload) VALUES ('{"a":1,"b":[2,3]}'), ('hello'), ('{not json}')`
    );
    file.close();

    const serverName = `e2e-cell-editor-modal-${suffix}`;
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

async function openDocsTable(page: Page, connectionId: number, serverId: number) {
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

    const tableRow = page.locator(`[data-node-id="table:${connectionId}:docs"]`);
    await expect(tableRow).toBeVisible({ timeout: 15_000 });
    await dispatch(`[data-node-id="table:${connectionId}:docs"]`, 'dblclick');

    await expect(page.getByTestId('data-grid-viewport')).toBeVisible({ timeout: 15_000 });
}

/** Right-clicks the first cell of `rowIndex` and opens the modal editor from the cell menu. */
async function openModalEditor(page: Page, rowIndex = 0) {
    const viewport = page.getByTestId('data-grid-viewport');
    const box = await viewport.boundingBox();

    if (!box) {
        throw new Error('Grid viewport has no bounding box');
    }

    await page.mouse.click(box.x + FIRST_COLUMN_X, box.y + FIRST_ROW_Y + rowIndex * ROW_HEIGHT, { button: 'right' });

    const editInModal = page.getByRole('menuitem', { name: 'Edit in modal' });
    await expect(editInModal).toBeVisible();
    await editInModal.click();

    await expect(page.getByTestId('modal-edit-value')).toBeVisible();
}

test.describe('Edit cell value dialog', () => {
    test('remembers the text wrap preference across dialogs and reloads', async ({ page, request }) => {
        const source = await createDocsSource(request);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await page.waitForTimeout(3000);

            await openDocsTable(page, source.connectionId, source.serverId);
            await openModalEditor(page);

            await expect(page.getByTestId('modal-edit-value')).toHaveAttribute('wrap', 'off');

            await page.getByTestId('modal-edit-text-wrap').click();
            await expect(page.getByTestId('modal-edit-value')).toHaveAttribute('wrap', 'soft');

            // Closing and reopening the dialog must not reset the toggle.
            await page.getByRole('button', { name: 'Cancel' }).click();
            await expect(page.getByTestId('modal-edit-value')).toHaveCount(0);

            await openModalEditor(page);
            await expect(page.getByTestId('modal-edit-value')).toHaveAttribute('wrap', 'soft');

            // The preference survives an app restart too.
            await page.reload();
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await page.waitForTimeout(3000);

            await openDocsTable(page, source.connectionId, source.serverId);
            await openModalEditor(page);
            await expect(page.getByTestId('modal-edit-value')).toHaveAttribute('wrap', 'soft');
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
            rmSync(source.dbPath, { force: true });
        }
    });

    test('prettifies and compacts JSON objects only', async ({ page, request }) => {
        const source = await createDocsSource(request);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await page.waitForTimeout(3000);

            await openDocsTable(page, source.connectionId, source.serverId);
            await openModalEditor(page);

            const value = page.getByTestId('modal-edit-value');
            await expect(value).toHaveValue('{"a":1,"b":[2,3]}');
            await expect(page.getByTestId('modal-edit-prettify')).toBeVisible();
            await expect(page.getByTestId('modal-edit-compact')).toBeVisible();

            await page.getByTestId('modal-edit-prettify').click();
            await expect(value).toHaveValue(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));

            await page.getByTestId('modal-edit-compact').click();
            await expect(value).toHaveValue('{"a":1,"b":[2,3]}');

            // Saving the prettified draft still commits it.
            await page.getByTestId('modal-edit-prettify').click();
            await page.getByTestId('centered-modal-surface').getByRole('button', { name: 'Save' }).click();
            await expect(page.getByText('1 pending change')).toBeVisible();
            // Wait out the dialog's leave transition before touching the grid again.
            await expect(page.getByTestId('modal-edit-value')).toHaveCount(0);

            // Plain text and broken JSON get no JSON actions.
            for (const rowIndex of [1, 2]) {
                await openModalEditor(page, rowIndex);
                await expect(page.getByTestId('modal-edit-prettify')).toHaveCount(0);
                await expect(page.getByTestId('modal-edit-compact')).toHaveCount(0);
                await page.getByRole('button', { name: 'Cancel' }).click();
                await expect(page.getByTestId('modal-edit-value')).toHaveCount(0);
            }
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
            rmSync(source.dbPath, { force: true });
        }
    });
});
