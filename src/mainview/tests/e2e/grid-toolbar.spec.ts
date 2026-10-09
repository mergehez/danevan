import { expect, test, type Page } from '@playwright/test';
import { API, createFileSource, post } from './helpers';

/** The first body cell of a one-column result set, as the canvas draws it. */
const FIRST_COLUMN_X = 78;
const FIRST_ROW_Y = 46;

/** Thirty rows, so a page of ten still leaves rows on the next page. */
function peopleSchema() {
    const rows = Array.from({ length: 30 }, (_, index) => `(${index + 1}, 'name ${index + 1}', 'nickname ${index + 1}', ${20 + index})`);

    return `
        CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, nickname TEXT, age INTEGER);
        INSERT INTO people (id, name, nickname, age) VALUES ${rows.join(', ')};
    `;
}

type Source = Awaited<ReturnType<typeof createFileSource>>;

async function openPeopleTable(page: Page, source: Source) {
    const serverRow = page.locator(`[data-node-id="server:${source.serverId}"]`);
    await expect(serverRow).toBeVisible();

    // Collapse first: expanding is what loads the table list.
    if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'false') {
        await serverRow.locator('[data-sidebar-toggle-for]').click();
        await expect(serverRow).toHaveAttribute('data-sidebar-collapsed', 'true');
    }

    await serverRow.locator('[data-sidebar-toggle-for]').click();

    const tableRow = page.locator(`[data-node-id="table:${source.connectionId}:people"]`);
    await expect(tableRow).toBeVisible();
    await tableRow.dblclick();

    await expect(page.getByTestId('data-grid-viewport')).toBeVisible();
}

/** Opens the in-cell editor of the first row from the grid's starting active cell. */
async function openFirstRowEditor(page: Page, columnIndex: number) {
    const viewport = page.getByTestId('data-grid-viewport');
    await viewport.focus();

    for (let index = 0; index < columnIndex; index += 1) {
        await page.keyboard.press('ArrowRight');
    }

    await page.keyboard.press('Enter');

    const editor = page.locator(`textarea[data-editor-key="0:${columnIndex}"]`);
    await expect(editor).toBeVisible();
    return editor;
}

function columnButton(page: Page) {
    return page.locator('#dbdatapanel').getByRole('button', { name: /^\d+ of \d+ columns$/ });
}

function pageSizeMenu(page: Page) {
    return page.getByTestId('grid-page-size-menu');
}

/** Reads the limit/offset of the data request `action` triggers. */
async function captureTableRequest(page: Page, action: () => Promise<void>) {
    const request = page.waitForRequest((candidate) => candidate.url().endsWith('/api/getTableData'));
    await action();
    return JSON.parse((await request).postData() ?? '{}') as { limit: number; offset: number };
}

test.describe('Grid toolbar', () => {
    test('hides the chosen column, pages, reloads and runs a custom query', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'grid-toolbar', schema: peopleSchema() });
        // The page size is persisted, so the spec restores whatever the machine had.
        const originalSettings = await post(request, 'getEditorSettings', undefined);

        try {
            await page.goto('/');
            await openPeopleTable(page, source);

            const toolbar = page.locator('#dbdatapanel');
            await expect(columnButton(page)).toHaveText('4 of 4 columns');

            // Column index 3 is `age` before anything is hidden.
            const editor = await openFirstRowEditor(page, 3);
            await expect(editor).toHaveValue('20');
            await editor.press('Escape');
            await expect(editor).toHaveCount(0);

            await columnButton(page).click();

            const columnMenu = page.getByTestId('grid-column-menu');
            await expect(columnMenu).toBeVisible();
            await expect(columnMenu.getByRole('checkbox', { name: 'nickname', exact: true })).toBeChecked();

            await columnMenu.getByRole('checkbox', { name: 'nickname', exact: true }).uncheck();

            // The count follows, and the right column is the one that went away.
            await expect(columnButton(page)).toHaveText('3 of 4 columns');
            await expect(columnMenu.getByRole('checkbox', { name: 'nickname', exact: true })).not.toBeChecked();
            await expect(columnMenu.getByRole('checkbox', { name: 'name', exact: true })).toBeChecked();
            await expect(columnMenu.getByRole('checkbox', { name: 'age', exact: true })).toBeChecked();

            await columnButton(page).click();
            await expect(columnMenu).toHaveCount(0);

            // The grid really dropped it: the active `age` cell moved one column to the left.
            await page.getByTestId('data-grid-viewport').focus();
            await page.keyboard.press('Enter');

            const shifted = page.locator('textarea[data-editor-key="0:2"]');
            await expect(shifted).toHaveValue('20');
            await shifted.press('Escape');
            await expect(shifted).toHaveCount(0);

            // Page size drives the LIMIT, and the toolbar reports the visible range.
            await toolbar.getByRole('button', { name: /^1-30 of 30$/ }).click();
            await expect(pageSizeMenu(page)).toBeVisible();

            const pageSizeRequest = await captureTableRequest(page, async () => {
                await pageSizeMenu(page).getByRole('button', { name: /^10\b/ }).click();
            });
            expect(pageSizeRequest).toMatchObject({ limit: 10, offset: 0 });
            await expect(pageSizeMenu(page)).toHaveCount(0);
            await expect(toolbar.getByRole('button', { name: /^1-10 of 30$/ })).toBeVisible();

            const nextRequest = await captureTableRequest(page, async () => {
                await toolbar.locator('button:has(i[class*="mdi--chevron-right"])').click();
            });
            expect(nextRequest).toMatchObject({ limit: 10, offset: 10 });
            await expect(toolbar.getByRole('button', { name: /^11-20 of 30$/ })).toBeVisible();

            const previousRequest = await captureTableRequest(page, async () => {
                await toolbar.locator('button:has(i[class*="mdi--chevron-left"])').click();
            });
            expect(previousRequest).toMatchObject({ limit: 10, offset: 0 });
            await expect(toolbar.getByRole('button', { name: /^1-10 of 30$/ })).toBeVisible();

            // Reload fetches rows that arrived after the grid was opened.
            await post(request, 'runQuery', {
                connectionId: source.connectionId,
                sql: `INSERT INTO people (id, name, nickname, age) VALUES (31, 'name 31', 'nickname 31', 50)`,
            });

            const reloadRequest = await captureTableRequest(page, async () => {
                await toolbar.locator('button:has(i[class*="mdi--reload"])').click();
            });
            expect(reloadRequest).toMatchObject({ limit: 10, offset: 0 });
            await expect(toolbar.getByRole('button', { name: /^1-10 of 31$/ })).toBeVisible();

            // A custom query replaces the generated one, and its result is what the grid draws.
            const customQuery = page.getByPlaceholder('select * from myTable limit 100;');
            await customQuery.fill('SELECT nickname FROM people WHERE id = 4');
            await customQuery.press('Enter');

            await expect(toolbar.getByText('Filters are disabled. To re-enable: click the "Reset to generated query" button.')).toBeVisible();
            await expect(toolbar.locator('button:has(i[class*="mdi--backup-restore"])')).toBeVisible();

            // One row of one column: the cell holds `nickname 4`, which `SELECT *` would never show first.
            const viewportBox = await page.getByTestId('data-grid-viewport').boundingBox();
            expect(viewportBox).not.toBeNull();
            await page.mouse.click(viewportBox!.x + FIRST_COLUMN_X, viewportBox!.y + FIRST_ROW_Y, { button: 'right' });

            await page.getByRole('menuitem', { name: 'Edit in modal' }).click();
            await expect(page.getByTestId('modal-edit-value')).toHaveValue('nickname 4');
        } finally {
            await request.post(`${API}/updateEditorSettings`, { data: { settings: originalSettings } }).catch(() => {});
            await source.cleanup();
        }
    });
});
