import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { API, post } from './helpers';

/** A SQLite table whose cells cover the value kinds that used to round-trip lossily. */
async function createNotesSource(request: APIRequestContext) {
    const suffix = Date.now().toString();
    const dbPath = `/tmp/e2e-cell-editor-${suffix}.sqlite`;
    const file = new Database(dbPath);

    file.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT, board BLOB)');

    const insert = file.prepare('INSERT INTO notes (title, board) VALUES (?, ?)');
    insert.run('Ada Lovelace', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    insert.run('Grace Hopper', Buffer.from([0x01, 0x02, 0x03]));
    file.close();

    const serverName = `e2e-cell-editor-${suffix}`;
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

/** Expands the sidebar down to a table of a file source and opens it. */
async function openNotesTable(page: Page, connectionId: number, serverId: number) {
    const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
    await expect(serverRow).toBeVisible({ timeout: 15_000 });

    // Sidebar rows are sticky and can be covered by the section header above them, so
    // navigation dispatches a bubbling event instead of relying on hit-testing.
    const dispatch = (selector: string, type: 'click' | 'dblclick') =>
        page.locator(selector).evaluate((element, eventType) => element.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true })), type);

    const toggle = `[data-sidebar-toggle-for="server:${serverId}"]`;
    if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'false') {
        await dispatch(toggle, 'click');
        await expect(serverRow).toHaveAttribute('data-sidebar-collapsed', 'true');
    }
    await dispatch(toggle, 'click');

    const tableRow = page.locator(`[data-node-id="table:${connectionId}:notes"]`);
    await expect(tableRow).toBeVisible({ timeout: 15_000 });
    await dispatch(`[data-node-id="table:${connectionId}:notes"]`, 'dblclick');

    await expect(page.getByTestId('data-grid-viewport')).toBeVisible({ timeout: 15_000 });
}

async function openCellEditor(page: Page, columnIndex: number, rowIndex = 0) {
    const viewport = page.getByTestId('data-grid-viewport');
    await viewport.focus();

    for (let index = 0; index < columnIndex; index += 1) {
        await page.keyboard.press('ArrowRight');
    }

    for (let index = 0; index < rowIndex; index += 1) {
        await page.keyboard.press('ArrowDown');
    }

    await page.keyboard.press('Enter');

    const editor = page.locator(`textarea[data-editor-key="${rowIndex}:${columnIndex}"]`);
    await expect(editor).toBeVisible();
    return editor;
}

test.describe('In-cell editor keyboard', () => {
    test('moves the caret with the arrow keys and commits on Enter', async ({ page, request }) => {
        const source = await createNotesSource(request);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            await openNotesTable(page, source.connectionId, source.serverId);

            // Column 1 is `title`; open its editor through the keyboard.
            const editor = await openCellEditor(page, 1);
            await expect(editor).toHaveValue('Ada Lovelace');

            // Regression: the grid used to steal the arrows and cancel the caret move.
            await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0));
            await editor.press('ArrowRight');
            await expect.poll(() => editor.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(1);

            await editor.press('ArrowLeft');
            await expect.poll(() => editor.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(0);

            // The key stayed in the editor: it is still the open cell.
            await expect(page.locator('textarea[data-editor-key="0:1"]')).toBeVisible();

            // Enter commits the edit and moves the active cell one row down.
            await editor.press('X');
            await editor.press('Enter');

            await expect(editor).toHaveCount(0);
            await expect(page.getByTestId('save-bar-save')).toBeVisible();
            await expect(page.getByText('1 pending change')).toBeVisible();

            // The active cell followed the commit: Enter reopens the row below.
            await page.keyboard.press('Enter');
            await expect(page.locator('textarea[data-editor-key="1:1"]')).toBeVisible();
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
            rmSync(source.dbPath, { force: true });
        }
    });

    test('closing the editor without typing does not stage a change', async ({ page, request }) => {
        const source = await createNotesSource(request);

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            await openNotesTable(page, source.connectionId, source.serverId);

            // Column 2 is the BLOB: its value does not survive a format/parse round-trip,
            // so a mere blur used to look like an edit.
            const editor = await openCellEditor(page, 2);
            await expect(page.getByTestId('save-bar-save')).toHaveCount(0);

            // Click another cell to close the editor without typing anything.
            await page.getByTestId('data-grid-viewport').click({ position: { x: 78, y: 46 } });

            await expect(editor).toHaveCount(0);
            await expect(page.getByTestId('save-bar-save')).toHaveCount(0);
            await expect(page.getByText(/pending change/)).toHaveCount(0);
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
            rmSync(source.dbPath, { force: true });
        }
    });
});
