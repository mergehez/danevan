import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createFileSource, openSidebarTable, post, reloadSidebarRow } from './helpers';

/**
 * Two tables with the same shape: a `select * from people` result carries `id` and `name`, and so
 * does `accounts`. Anything that picks the result's table by column shape or by what is open in the
 * sidebar can pick the wrong one; only the statement says where the rows came from.
 */
const SHARED_SHAPE_SCHEMA = `
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO accounts (id, name) VALUES (1, 'Account One');
    INSERT INTO people (id, name) VALUES (1, 'Ada');
`;

type Source = Awaited<ReturnType<typeof createFileSource>>;

async function openApp(page: Page) {
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
}

/** Opens a table and waits for it to be loaded, not just for the panel. */
async function openTable(page: Page, source: Source, tableName: string) {
    // The metadata read may be answered from the sidebar's schema sweep instead of its own request,
    // so the rows request and the panel's loading overlay are what say the table is really loaded.
    const dataLoaded = page.waitForResponse(
        (response) => response.url().endsWith('/api/getTableData') && (response.request().postData() ?? '').includes(`"${tableName}"`)
    );

    await openSidebarTable(page, source.connectionId, tableName);
    await dataLoaded;
    await expect(page.getByText('Loading table data...')).toHaveCount(0);
}

/** Runs the active script and waits for the run to come back, so the grid below is its result. */
async function runScript(page: Page) {
    const queryRan = page.waitForResponse((response) => response.url().endsWith('/api/runQuery'));

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await queryRan;
    await expect(page.getByTestId('data-grid-viewport')).toBeVisible({ timeout: 15_000 });
}

/** Replaces the active script editor's text the way a user types it. */
async function writeScript(page: Page, sql: string) {
    const lines = page.locator('.monaco-editor .view-lines');
    await lines.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(sql);
}

/** Opens the in-cell editor on a result cell. The grid draws to a canvas, so the editor is the
 *  only place a test can read the value the grid is showing. */
async function openResultCellEditor(page: Page, columnIndex: number) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    await viewport.focus();

    // Meta+arrow jumps to the row's first cell / the column's first row, so the cell below is
    // reached from a known place even after an earlier edit moved the active cell.
    await page.keyboard.press('Meta+ArrowLeft');
    await page.keyboard.press('Meta+ArrowUp');

    for (let index = 0; index < columnIndex; index += 1) {
        await page.keyboard.press('ArrowRight');
    }

    await page.keyboard.press('Enter');

    const editor = page.locator(`textarea[data-editor-key="0:${columnIndex}"]`);
    await expect(editor).toBeVisible();

    return editor;
}

async function commitResultCell(editor: Locator, value: string) {
    await editor.fill(value);
    await editor.press('Enter');
    await expect(editor).toHaveCount(0);
}

/** The pending-updates preview must name the table the update is written to. */
async function expectUpdateTarget(page: Page, tableIdentifier: string) {
    await page.getByRole('button', { name: 'Preview', exact: true }).click();

    const preview = page.getByRole('dialog').filter({ hasText: 'Pending updates' });
    await expect(preview).toBeVisible();
    await expect(preview.locator('pre')).toContainText(`UPDATE ${tableIdentifier}`);

    await preview.getByRole('button', { name: 'Close' }).click();
    await expect(preview).toBeHidden();
}

async function storedNames(request: APIRequestContext, connectionId: number, tableName: string) {
    const data = await post(request, 'getTableData', { connectionId, tableName, limit: 50, offset: 0 });

    return (data.rows as Array<{ name: string }>).map((row) => row.name);
}

async function expectOnlyPeopleChanged(request: APIRequestContext, connectionId: number) {
    await expect.poll(() => storedNames(request, connectionId, 'people')).toEqual(['Ada Lovelace']);
    expect(await storedNames(request, connectionId, 'accounts')).toEqual(['Account One']);
}

test.describe('Saving an edited result', () => {
    test('writes a script result to the table the script reads', async ({ page, request }) => {
        const source: Source = await createFileSource(request, { label: 'script-save-target', schema: SHARED_SHAPE_SCHEMA });

        try {
            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));

            // `people` is the table the script reads; `accounts` is the one the sidebar is left on and
            // the one whose metadata the old column-shape guess picked.
            await openTable(page, source, 'people');
            await openTable(page, source, 'accounts');

            await page.getByTestId('new-scratch-tab').click();
            await writeScript(page, 'select * from people;');
            await runScript(page);

            // Column 1 is `name`.
            await commitResultCell(await openResultCellEditor(page, 1), 'Ada Lovelace');
            await expect(page.getByText('1 pending change')).toBeVisible();

            await expectUpdateTarget(page, '"people"');
            await page.getByTestId('save-bar-save').click();

            await expectOnlyPeopleChanged(request, source.connectionId);
        } finally {
            await source.cleanup();
        }
    });

    test('writes a custom query result to the table the query reads', async ({ page, request }) => {
        const source: Source = await createFileSource(request, { label: 'custom-query-save-target', schema: SHARED_SHAPE_SCHEMA });

        try {
            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));

            // Opening `accounts` last leaves the sidebar on the other table than the query reads,
            // which is the state that used to decide where the custom query's edit went.
            await openTable(page, source, 'people');
            await openTable(page, source, 'accounts');

            const customQuery = page.getByPlaceholder('select * from myTable limit 100;');
            await customQuery.fill('select * from people;');

            // Wait for the query to come back: the grid below still shows the open table until then.
            const queryRan = page.waitForResponse((response) => response.url().endsWith('/api/runQuery'));
            await customQuery.press('Enter');
            await queryRan;

            // The grid shows people's row even though accounts is the table open in the sidebar.
            const editor = await openResultCellEditor(page, 1);
            await expect(editor).toHaveValue('Ada');

            await commitResultCell(editor, 'Ada Lovelace');
            await expect(page.getByText('1 pending change')).toBeVisible();

            await expectUpdateTarget(page, '"people"');
            await page.getByTestId('save-bar-save').click();

            await expectOnlyPeopleChanged(request, source.connectionId);
        } finally {
            await source.cleanup();
        }
    });
});
