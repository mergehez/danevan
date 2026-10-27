import { expect, test, type Page } from '@playwright/test';
import { createFileSource, openSidebarTable, reloadSidebarRow } from './helpers';

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

test.describe('Query bar', () => {
    test('builds a query from chips, limit and offset and runs it', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'query-bar', schema: SCHEMA });

        try {
            await openPeopleTable(page, source);

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
            await page.getByTestId('query-bar-limit').fill('5');
            await page.getByTestId('query-bar-offset').fill('2');

            await runInteractiveQuery(page);
            // Newest first, skipping the first two rows of the filter: 30, 29 then 28.
            await expectResultRowCount(page, 5);
            await expect.poll(() => firstCellValue(page)).toBe('name 28');

            // Reset drops the custom query and puts the controls back on the generated one.
            const tableReloaded = page.waitForResponse((response) => response.url().endsWith('/api/getTableData'));
            await page.getByTestId('query-bar-reset').click();
            await tableReloaded;

            await expect(page.getByTestId('query-bar-columns-trigger')).toContainText('*');
            await openChip(page, 'where');
            await expect(page.getByTestId('query-bar-where-0')).toHaveCount(0);
            await expect(page.getByTestId('query-bar-sql-preview')).toHaveText(`SELECT * FROM "people"${limitClause}`);
            await closeChip(page, 'where');
            await expect.poll(() => firstCellValue(page)).toBe('1');
        } finally {
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
