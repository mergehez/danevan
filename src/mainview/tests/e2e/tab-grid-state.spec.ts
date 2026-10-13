import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createFileSource, openSidebarTable, post } from './helpers';

/**
 * The data tab's grid is one shared instance behind every tab: a custom query's rows, a staged
 * edit and the active cell used to be reset whenever the view changed (another tab, a stale
 * reload after a script run, a save). These specs pin each of them to the tab that owns them.
 */
const SCHEMA = `
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO accounts (id, name) VALUES (1, 'Account One'), (2, 'Account Two');
    INSERT INTO people (id, name) VALUES (1, 'Ada'), (2, 'Grace');
`;

// The user's report shaped this query: quoted identifiers, a WHERE filter and an ORDER BY.
const FILTERED_QUERY = 'SELECT * FROM `people` WHERE `id` = 2 ORDER BY `name` DESC';

type Source = Awaited<ReturnType<typeof createFileSource>>;

async function openApp(page: Page) {
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
}

/** Opens a table and waits for it to be loaded, not just for the panel. */
async function openTable(page: Page, source: Source, tableName: string) {
    const dataLoaded = page.waitForResponse((response) => response.url().endsWith('/api/getTableData') && (response.request().postData() ?? '').includes(`"${tableName}"`));

    await openSidebarTable(page, source.connectionId, tableName);
    await dataLoaded;
    await expect(page.getByText('Loading table data...')).toHaveCount(0);
}

/** Runs the data tab's custom query and waits for the answer, so the grid below is its result. */
async function runCustomQuery(page: Page, sql: string) {
    const customQuery = page.getByPlaceholder('select * from myTable limit 100;');
    await customQuery.fill(sql);

    const queryRan = page.waitForResponse((response) => response.url().endsWith('/api/runQuery'));
    await customQuery.press('Enter');
    await queryRan;
}

/** The grid's search counter: how many cells the displayed text matches. Retried by the
 *  caller, which also covers the search debounce. */
function searchCounter(page: Page) {
    return page.getByPlaceholder('Search grid').locator('xpath=following-sibling::span[1]');
}

async function expectOnlyFilteredRow(page: Page) {
    const search = page.getByPlaceholder('Search grid');
    await search.fill('Grace');
    await expect(searchCounter(page)).toHaveText('1/1');
    await search.fill('Ada');
    await expect(searchCounter(page)).toHaveText('0/0');
    await search.fill('');
    await expect(searchCounter(page)).toHaveText('0/0');
}

async function displayedCellValue(page: Page, columnIndex: number) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    await viewport.focus();
    await page.keyboard.press('Meta+ArrowLeft');
    await page.keyboard.press('Meta+ArrowUp');

    for (let index = 0; index < columnIndex; index += 1) {
        await page.keyboard.press('ArrowRight');
    }

    await page.keyboard.press('Enter');

    const editor = page.locator(`textarea[data-editor-key="0:${columnIndex}"]`);
    await expect(editor).toBeVisible();
    const value = await editor.inputValue();
    await editor.press('Escape');

    return value;
}

async function commitCellEdit(page: Page, columnIndex: number, value: string) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    await viewport.focus();
    await page.keyboard.press('Meta+ArrowLeft');
    await page.keyboard.press('Meta+ArrowUp');

    for (let index = 0; index < columnIndex; index += 1) {
        await page.keyboard.press('ArrowRight');
    }

    await page.keyboard.press('Enter');

    const editor = page.locator(`textarea[data-editor-key="0:${columnIndex}"]`);
    await expect(editor).toBeVisible();
    await editor.fill(value);
    await editor.press('Enter');
    await expect(editor).toHaveCount(0);
}

/** Runs a script in a scratch tab, which marks every table tab's data stale. */
async function runScratchScript(page: Page, sql: string) {
    await page.getByTestId('new-scratch-tab').click();

    const lines = page.locator('.monaco-editor .view-lines');
    await lines.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(sql);

    const queryRan = page.waitForResponse((response) => response.url().endsWith('/api/runQuery'));
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await queryRan;
}

async function storedNames(request: APIRequestContext, connectionId: number) {
    const data = await post(request, 'getTableData', { connectionId, tableName: 'people', limit: 50, offset: 0 });

    return (data.rows as Array<{ name: string }>).map((row) => row.name);
}

test.describe('A table tab keeps its grid state', () => {
    test('keeps the custom rows when a stale reload follows a tab switch', async ({ page, request }) => {
        const source: Source = await createFileSource(request, { label: 'tab-custom-rows', schema: SCHEMA });

        try {
            await openApp(page);
            await openTable(page, source, 'people');
            await runCustomQuery(page, FILTERED_QUERY);
            await expectOnlyFilteredRow(page);
            expect(await displayedCellValue(page, 1)).toBe('Grace');

            // A script run elsewhere marks the table data stale; coming back reloads the tab.
            await runScratchScript(page, 'select * from people;');

            const reloaded = page.waitForResponse((response) => response.url().endsWith('/api/getTableData') && (response.request().postData() ?? '').includes('"people"'));
            await openSidebarTable(page, source.connectionId, 'people');
            await reloaded;
            await expect(page.getByText('Loading table data...')).toHaveCount(0);

            // The filter still applies: the grid shows the custom row, not the whole table.
            await expectOnlyFilteredRow(page);
            expect(await displayedCellValue(page, 1)).toBe('Grace');

            // And the row is still editable against the table the query reads.
            await commitCellEdit(page, 1, 'Grace Hopper');
            await expect(page.getByText('1 pending change')).toBeVisible();
        } finally {
            await source.cleanup();
        }
    });

    test('keeps the custom filter applied across a save', async ({ page, request }) => {
        const source: Source = await createFileSource(request, { label: 'tab-custom-save', schema: SCHEMA });

        try {
            await openApp(page);
            await openTable(page, source, 'people');
            await runCustomQuery(page, FILTERED_QUERY);

            await commitCellEdit(page, 1, 'Grace Hopper');
            await expect(page.getByText('1 pending change')).toBeVisible();

            await page.getByTestId('save-bar-save').click();

            // The save reached the database and the grid still shows the filtered row. (The
            // save button cannot sync this: with nothing pending it is disabled by design.)
            await expect.poll(() => storedNames(request, source.connectionId)).toEqual(['Ada', 'Grace Hopper']);

            const search = page.getByPlaceholder('Search grid');
            await search.fill('Grace Hopper');
            await expect(searchCounter(page)).toHaveText('1/1');
            await search.fill('Ada');
            await expect(searchCounter(page)).toHaveText('0/0');
            await search.fill('');
            expect(await displayedCellValue(page, 1)).toBe('Grace Hopper');
        } finally {
            await source.cleanup();
        }
    });

    test('keeps a pending edit across a tab switch', async ({ page, request }) => {
        const source: Source = await createFileSource(request, { label: 'tab-pending-edit', schema: SCHEMA });

        try {
            await openApp(page);
            await openTable(page, source, 'people');

            await commitCellEdit(page, 1, 'Ada Lovelace');
            await expect(page.getByText('1 pending change')).toBeVisible();

            await openTable(page, source, 'accounts');
            await openSidebarTable(page, source.connectionId, 'people');

            await expect(page.getByText('1 pending change')).toBeVisible();
            expect(await displayedCellValue(page, 1)).toBe('Ada Lovelace');
        } finally {
            await source.cleanup();
        }
    });

    test('keeps the active cell across a tab switch', async ({ page, request }) => {
        const source: Source = await createFileSource(request, { label: 'tab-active-cell', schema: SCHEMA });

        try {
            await openApp(page);
            await openTable(page, source, 'people');

            // Second row, first column.
            const viewport = page.getByTestId('data-grid-viewport').first();
            await viewport.focus();
            await page.keyboard.press('Meta+ArrowLeft');
            await page.keyboard.press('Meta+ArrowUp');
            await page.keyboard.press('ArrowDown');

            await openTable(page, source, 'accounts');
            await openSidebarTable(page, source.connectionId, 'people');
            await viewport.focus();
            await expect(viewport).toBeVisible();

            await page.keyboard.press('Enter');

            const editor = page.locator('textarea[data-editor-key="1:0"]');
            await expect(editor).toBeVisible();
            await editor.press('Escape');
        } finally {
            await source.cleanup();
        }
    });

    test('keeps a pending edit across a table-to-script switch', async ({ page, request }) => {
        const source: Source = await createFileSource(request, { label: 'tab-script-pending', schema: SCHEMA });

        try {
            await openApp(page);
            await openTable(page, source, 'people');

            await commitCellEdit(page, 1, 'Ada Lovelace');
            await expect(page.getByText('1 pending change')).toBeVisible();

            // Leaving for a script tab unmounts the data panel; coming back remounts it.
            await runScratchScript(page, 'select * from people;');
            await openSidebarTable(page, source.connectionId, 'people');
            await expect(page.getByText('Loading table data...')).toHaveCount(0);

            await expect(page.getByText('1 pending change')).toBeVisible();
            expect(await displayedCellValue(page, 1)).toBe('Ada Lovelace');
        } finally {
            await source.cleanup();
        }
    });

    test('keeps the active cell across a table-to-script switch', async ({ page, request }) => {
        const source: Source = await createFileSource(request, { label: 'tab-script-cell', schema: SCHEMA });

        try {
            await openApp(page);
            await openTable(page, source, 'people');

            // Second row, first column.
            const viewport = page.getByTestId('data-grid-viewport').first();
            await viewport.focus();
            await page.keyboard.press('Meta+ArrowLeft');
            await page.keyboard.press('Meta+ArrowUp');
            await page.keyboard.press('ArrowDown');

            await runScratchScript(page, 'select * from people;');
            await openSidebarTable(page, source.connectionId, 'people');
            await expect(page.getByText('Loading table data...')).toHaveCount(0);
            await viewport.focus();
            await expect(viewport).toBeVisible();

            await page.keyboard.press('Enter');

            const editor = page.locator('textarea[data-editor-key="1:0"]');
            await expect(editor).toBeVisible();
            await editor.press('Escape');
        } finally {
            await source.cleanup();
        }
    });
});
