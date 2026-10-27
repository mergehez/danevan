import { expect, test, type Page } from '@playwright/test';
import { DATA_GRID_HEADER_HEIGHT } from '../../../datagrid/dataGrid';
import { createFileSource, gridCellPoint, menuItem, openSidebarTable, reloadSidebarRow, API, post } from './helpers';

/**
 * The data tab's query bar has two control sets: Manual is the free-text field it always had, and
 * Interactive builds the same statement from chips and number fields. These specs drive the
 * interactive one the way a user does and read the rows it really returned.
 */
const SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, nickname TEXT, age INTEGER);
    INSERT INTO people (id, name, nickname, age)
    WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM counter WHERE n < 30)
    SELECT n, 'name ' || n, 'nickname ' || n, 19 + n FROM counter;
`;

type Source = Awaited<ReturnType<typeof createFileSource>>;

async function openPeopleTable(page: Page, source: Source) {
    await page.goto('/');
    await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
    await openSidebarTable(page, source.connectionId, 'people');
    await expect(page.getByTestId('query-bar')).toBeVisible();
}

/** The value in the first row of the first result column: the grid is a canvas, the editor is not. */
async function firstCellValue(page: Page) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    await viewport.focus();
    await page.keyboard.press('Meta+ArrowLeft');
    await page.keyboard.press('Meta+ArrowUp');
    await page.keyboard.press('Enter');

    const editor = page.locator('textarea[data-editor-key="0:0"]');

    try {
        await editor.waitFor({ state: 'visible', timeout: 1000 });
        const value = await editor.inputValue();
        await editor.press('Escape');
        return value;
    } catch {
        // Polled by the caller: the grid repaints after the rows arrive.
        return undefined;
    }
}

/** The grid's search counter is `active match / matching cells`, so a single-column result counts its rows. */
async function expectResultRowCount(page: Page, rowCount: number) {
    const search = page.getByPlaceholder('Search grid');
    await search.fill('name');
    await expect(search.locator('xpath=following-sibling::span[1]')).toHaveText(`1/${rowCount}`);
    await search.fill('');
}

async function runInteractiveQuery(page: Page) {
    const queryStarted = page.waitForResponse((response) => response.url().endsWith('/api/runQuery'));
    await page.getByTestId('query-bar-run').click();
    await queryStarted;
}

async function openChip(page: Page, chip: 'columns' | 'where' | 'order') {
    await page.getByTestId(`query-bar-${chip}-trigger`).click();
    await expect(page.getByTestId(`query-bar-${chip}-panel`)).toBeVisible();
}

async function closeChip(page: Page, chip: 'columns' | 'where' | 'order') {
    await page.getByTestId(`query-bar-${chip}-trigger`).click();
    await expect(page.getByTestId(`query-bar-${chip}-panel`)).toHaveCount(0);
}

/** Types a page size into the bar and waits for the grid it reloads at that size. */
async function setBarLimit(page: Page, limit: string) {
    const reloaded = page.waitForResponse((response) => response.url().endsWith('/api/getTableData'));
    const input = page.getByTestId('query-bar-limit');
    await input.fill(limit);
    await input.blur();
    await reloaded;
    await expect(input).toHaveValue(limit);
}

/** Types an offset into the bar and waits for the page it loads. */
async function setBarOffset(page: Page, offset: string) {
    const reloaded = page.waitForResponse((response) => response.url().endsWith('/api/getTableData'));
    const input = page.getByTestId('query-bar-offset');
    await input.fill(offset);
    await input.blur();
    await reloaded;
    await expect(input).toHaveValue(offset);
}

test.describe('Query bar', () => {
    test('stays on the page, sort and page size the grid toolbar is showing', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'query-bar-sync', schema: SCHEMA });
        // The page size is persisted (and the bar writes it), so the spec restores the machine's.
        const originalSettings = await post(request, 'getEditorSettings', undefined);

        try {
            await openPeopleTable(page, source);

            const toolbar = page.locator('#dbdatapanel');
            const pageSizeButton = () => toolbar.getByRole('button', { name: /^\d+-\d+ of \d+$/ });
            const limitInput = page.getByTestId('query-bar-limit');
            const offsetInput = page.getByTestId('query-bar-offset');

            // The page size the toolbar pages by is the number the bar shows.
            await pageSizeButton().click();
            await page.getByTestId('grid-page-size-menu').getByRole('button', { name: /^10\b/ }).click();
            await expect(pageSizeButton()).toHaveText(/^1-10\s*of\s*30$/);
            await expect(limitInput).toHaveValue('10');

            // Paging moves the bar's OFFSET with it (and back to 0 on the first page).
            const nextPage = page.waitForResponse((response) => response.url().endsWith('/api/getTableData'));
            await toolbar.locator('button:has(i[class*="mdi--chevron-right"])').click();
            await nextPage;
            await expect(offsetInput).toHaveValue('10');

            // And an offset typed into the bar loads that page, which the toolbar then reports.
            await setBarOffset(page, '20');
            await expect(pageSizeButton()).toHaveText(/^21-30\s*of\s*30$/);

            // A header click sorts (and reloads); the bar's ORDER BY is that sort. Column 3 is `age`.
            const point = await gridCellPoint(page, 3);
            const sorted = page.waitForResponse((response) => response.url().endsWith('/api/getTableData'));
            await page.mouse.click(point.x, point.viewportTop + DATA_GRID_HEADER_HEIGHT / 2);
            await sorted;
            await expect(offsetInput).toHaveValue('');
            await expect(page.getByTestId('query-bar-order-trigger')).toHaveText(/order by\s*1/);

            await openChip(page, 'order');
            await expect(page.getByTestId('query-bar-order-column-0').locator('select')).toHaveValue('age');
            await expect(page.getByTestId('query-bar-order-direction-0').locator('select')).toHaveValue('DESC');
            await expect(page.getByTestId('query-bar-sql-preview')).toHaveText('SELECT * FROM "people" ORDER BY "age" DESC LIMIT 10');
            await closeChip(page, 'order');

            // The header's own menu sorts without fetching rows, and the bar follows that too.
            await page.mouse.click(point.x, point.viewportTop + DATA_GRID_HEADER_HEIGHT / 2, { button: 'right' });
            await menuItem(page, 'Order By Asc').click();
            await openChip(page, 'order');
            await expect(page.getByTestId('query-bar-order-direction-0').locator('select')).toHaveValue('ASC');
            await closeChip(page, 'order');

            // And a page size typed into the bar is what the toolbar pages by.
            await setBarLimit(page, '20');
            await expect(pageSizeButton()).toHaveText(/^1-20\s*of\s*30$/);

            await pageSizeButton().click();
            await expect(page.getByTestId('grid-page-size-menu').getByRole('button', { name: /^20\b/ })).toBeVisible();
        } finally {
            await request.post(`${API}/updateEditorSettings`, { data: { settings: originalSettings } }).catch(() => {});
            await source.cleanup();
        }
    });

    test('builds a query from chips, limit and offset and runs it', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'query-bar', schema: SCHEMA });
        const originalSettings = await post(request, 'getEditorSettings', undefined);

        try {
            await openPeopleTable(page, source);

            // The whole table fits one page, so the row counts below are the table's, not the page's.
            if ((await page.getByTestId('query-bar-limit').inputValue()) !== '100') {
                await setBarLimit(page, '100');
            }

            // Interactive is the mode the bar opens in, and its statement is the table's own.
            await expect(page.getByTestId('query-bar-mode-trigger')).toContainText('Interactive');
            await expect(page.getByTestId('query-bar-table')).toHaveText('people');
            await expect(page.getByTestId('query-bar-columns-trigger')).toContainText('*');

            // The limit defaults to the grid's row limit, so the SQL is stated in terms of it.
            const limit = (await page.getByTestId('query-bar-limit').inputValue()).trim();
            const limitClause = limit ? ` LIMIT ${limit}` : '';

            // Custom columns start on all of them; leaving only `name` changes the statement.
            await openChip(page, 'columns');
            await page.getByTestId('query-bar-select-mode').locator('select').selectOption('Custom');
            await expect(page.getByTestId('query-bar-column-name').locator('[role="checkbox"]')).toHaveAttribute('aria-checked', 'true');

            for (const column of ['id', 'nickname', 'age']) {
                await page.getByTestId(`query-bar-column-${column}`).click();
            }

            await expect(page.getByTestId('query-bar-sql-preview')).toHaveText(`SELECT "name" FROM "people"${limitClause}`);
            await closeChip(page, 'columns');
            await expect(page.getByTestId('query-bar-columns-trigger')).toContainText('1 column');

            // One order row, on the id, so the rows this spec reads are the ones it means.
            await openChip(page, 'order');
            await page.getByTestId('query-bar-order-add').click();
            await page.getByTestId('query-bar-order-column-0').locator('select').selectOption('id');
            await expect(page.getByTestId('query-bar-order-direction-0').locator('select')).toHaveValue('ASC');
            await expect(page.getByTestId('query-bar-sql-preview')).toHaveText(`SELECT "name" FROM "people" ORDER BY "id" ASC${limitClause}`);
            await closeChip(page, 'order');
            await expect(page.getByTestId('query-bar-order-trigger')).toHaveText(/order by\s*1/);

            await runInteractiveQuery(page);
            await expectResultRowCount(page, 30);
            await expect.poll(() => firstCellValue(page)).toBe('name 1');

            // A condition filters the rows the grid draws.
            await openChip(page, 'where');
            await page.getByTestId('query-bar-where-add').click();
            await page.getByTestId('query-bar-where-0').fill('age > 25');
            await expect(page.getByTestId('query-bar-sql-preview')).toHaveText(`SELECT "name" FROM "people" WHERE (age > 25) ORDER BY "id" ASC${limitClause}`);
            await runInteractiveQuery(page);
            await expectResultRowCount(page, 24);
            // `age` is `id + 19`, so `age > 25` keeps ids 7 to 30 and the oldest order starts at 7.
            await expect.poll(() => firstCellValue(page)).toBe('name 7');
            await expect(page.getByTestId('query-bar-where-trigger')).toHaveText(/where\s*1/);

            // The same order row, turned around, plus paging: one more statement.
            await openChip(page, 'order');
            await page.getByTestId('query-bar-order-direction-0').locator('select').selectOption('DESC');
            await closeChip(page, 'order');
            // A custom query is running, so its page has no toolbar paging: these two only change the
            // statement that Run will send.
            await page.getByTestId('query-bar-limit').fill('5');
            await page.getByTestId('query-bar-offset').fill('2');
            await expect(page.getByTestId('query-bar-limit')).toHaveValue('5');
            await expect(page.getByTestId('query-bar-offset')).toHaveValue('2');

            await runInteractiveQuery(page);
            // Newest first, skipping the first two rows of the filter: 30, 29 then 28.
            await expectResultRowCount(page, 5);
            await expect.poll(() => firstCellValue(page)).toBe('name 28');

            // Reset drops the custom query and puts the controls back on the generated one, which
            // pages by the grid's own page size again.
            const tableReloaded = page.waitForResponse((response) => response.url().endsWith('/api/getTableData'));
            await page.getByTestId('query-bar-reset').click();
            await tableReloaded;

            await expect(page.getByTestId('query-bar-columns-trigger')).toContainText('*');
            await expect(page.getByTestId('query-bar-limit')).toHaveValue('100');
            await expect(page.getByTestId('query-bar-offset')).toHaveValue('');
            await openChip(page, 'where');
            await expect(page.getByTestId('query-bar-where-0')).toHaveCount(0);
            await expect(page.getByTestId('query-bar-sql-preview')).toHaveText('SELECT * FROM "people" LIMIT 100');
            await closeChip(page, 'where');
            await expect.poll(() => firstCellValue(page)).toBe('1');
        } finally {
            await request.post(`${API}/updateEditorSettings`, { data: { settings: originalSettings } }).catch(() => {});
            await source.cleanup();
        }
    });

    test('keeps the manual field, and both modes keep their own state', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'query-bar-manual', schema: SCHEMA });

        try {
            await openPeopleTable(page, source);

            const limit = (await page.getByTestId('query-bar-limit').inputValue()).trim();
            const limitClause = limit ? ` LIMIT ${limit}` : '';

            await page.getByTestId('query-bar-mode-trigger').click();
            await page.getByTestId('query-bar-mode-manual').click();
            await expect(page.getByTestId('query-bar-mode-trigger')).toContainText('Manual');
            await expect(page.getByTestId('query-bar-limit')).toHaveCount(0);

            const manualInput = page.getByTestId('query-bar-manual-input');
            await manualInput.fill('SELECT nickname FROM people WHERE id = 4');

            const queryStarted = page.waitForResponse((response) => response.url().endsWith('/api/runQuery'));
            await manualInput.press('Enter');
            await queryStarted;
            await expect.poll(() => firstCellValue(page)).toBe('nickname 4');

            // The typed text is still there when the bar comes back to manual.
            await page.getByTestId('query-bar-mode-trigger').click();
            await page.getByTestId('query-bar-mode-interactive').click();
            await page.getByTestId('query-bar-mode-trigger').click();
            await page.getByTestId('query-bar-mode-manual').click();
            await expect(page.getByTestId('query-bar-manual-input')).toHaveValue('SELECT nickname FROM people WHERE id = 4');

            // Interactive keeps the controls it was left on, and shows no rows of its own until Run.
            await page.getByTestId('query-bar-mode-trigger').click();
            await page.getByTestId('query-bar-mode-interactive').click();
            await openChip(page, 'where');
            await page.getByTestId('query-bar-where-add').click();
            await page.getByTestId('query-bar-where-0').fill('id = 7');
            await expect(page.getByTestId('query-bar-sql-preview')).toHaveText(`SELECT * FROM "people" WHERE (id = 7)${limitClause}`);
            await closeChip(page, 'where');

            await page.getByTestId('query-bar-mode-trigger').click();
            await page.getByTestId('query-bar-mode-manual').click();
            await page.getByTestId('query-bar-mode-trigger').click();
            await page.getByTestId('query-bar-mode-interactive').click();
            await expect(page.getByTestId('query-bar-where-trigger')).toHaveText(/where\s*1/);
        } finally {
            await source.cleanup();
        }
    });
});
