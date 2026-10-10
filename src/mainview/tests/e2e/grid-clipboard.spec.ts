// Copying out of the grid is the one grid feature whose result lands outside the page: the unit
// specs can plan the menu, but only a browser can prove that the item a user clicks puts the value
// they see on the system clipboard in the format the label promises. (The grid has no paste
// counterpart: values are entered through the cell editor or the add-row dialog.)
import { expect, test, type Page } from '@playwright/test';
import { DATA_GRID_HEADER_HEIGHT, DATA_GRID_ROW_NUMBER_MIN_WIDTH } from '../../../datagrid/dataGrid';
import { clearClipboard, createFileSource, expectClipboardText, gridCellPoint, menuItem, openFileTable, readClipboard } from './helpers';

const SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, note TEXT);
    INSERT INTO people (id, name, note) VALUES (1, 'Ada', 'first'), (2, 'Grace', 'second');
`;

async function pickCopyAs(page: Page, label: string) {
    await menuItem(page, 'Copy As').hover();

    const childItem = page.locator('.v-menu-children .v-menu-item', { hasText: label }).first();
    await expect(childItem).toBeVisible();
    await clearClipboard(page);
    await childItem.click();
}

async function openCellMenu(page: Page, point: { x: number; y: number }) {
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect(menuItem(page, /^Copy$/)).toBeVisible();
}

test.describe('Grid clipboard', () => {
    test.beforeEach(async ({ page }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    });

    test('copies a cell in the format the menu item names', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'clipboard-cell', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'people');

            // Column 1 is `name`; row 0 is Ada.
            const point = await gridCellPoint(page, 1);
            await openCellMenu(page, point);

            await clearClipboard(page);
            await menuItem(page, /^Copy$/).click();
            await expectClipboardText(page, 'Ada');

            await openCellMenu(page, point);
            await pickCopyAs(page, 'As JSON');
            await expectClipboardText(page, '"Ada"');

            await openCellMenu(page, point);
            await pickCopyAs(page, 'As SQL Literal');
            await expectClipboardText(page, "'Ada'");

            await openCellMenu(page, point);
            await pickCopyAs(page, 'As SQL INSERT Statement');
            await expectClipboardText(page, 'INSERT INTO "people"\n("name")\nVALUES\n(\'Ada\');');

            await openCellMenu(page, point);
            await pickCopyAs(page, 'As SQL SELECT Statement');
            // The SQLite driver reports integers as exact decimal text, so the key lands in the
            // statement quoted; the column's integer affinity still matches it.
            await expectClipboardText(page, 'SELECT "name" FROM "people" WHERE "id" IN (\'1\');');
        } finally {
            await source.cleanup();
        }
    });

    test('copies a whole row and a column name', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'clipboard-row', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'people');

            const point = await gridCellPoint(page, 1);

            // The row header on the left edge opens the row menu.
            const viewportBox = (await page.getByTestId('data-grid-viewport').first().boundingBox())!;
            await page.mouse.click(viewportBox.x + DATA_GRID_ROW_NUMBER_MIN_WIDTH / 2, point.y, { button: 'right' });
            await expect(menuItem(page, 'Copy Row')).toBeVisible();

            await clearClipboard(page);
            await menuItem(page, 'Copy Row').click();

            // Copy Row writes the row as tab separated text, in column order.
            await expectClipboardText(page, '1\tAda\tfirst');

            await page.mouse.click(viewportBox.x + DATA_GRID_ROW_NUMBER_MIN_WIDTH / 2, point.y, { button: 'right' });
            await menuItem(page, 'Copy Row As').hover();
            const jsonItem = page.locator('.v-menu-children .v-menu-item', { hasText: 'As JSON' }).first();
            await expect(jsonItem).toBeVisible();
            await clearClipboard(page);
            await jsonItem.click();

            await expect.poll(async () => JSON.parse(await readClipboard(page))).toEqual({ id: '1', name: 'Ada', note: 'first' });

            // The column header menu copies the name of the column it was opened on.
            await page.mouse.click(point.x, point.viewportTop + DATA_GRID_HEADER_HEIGHT / 2, { button: 'right' });
            await clearClipboard(page);
            await menuItem(page, 'Copy Column Name').click();
            await expectClipboardText(page, 'name');
        } finally {
            await source.cleanup();
        }
    });

    test('copies several columns as CSV', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'clipboard-csv', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'people');

            const point = await gridCellPoint(page, 1);
            await openCellMenu(page, point);

            // Selecting every row makes the selection span all three columns, which is what offers
            // the multi-column formats.
            await menuItem(page, 'Select All').click();
            await openCellMenu(page, point);

            await pickCopyAs(page, 'As CSV');
            await expectClipboardText(page, '1,Ada,first\n2,Grace,second');
        } finally {
            await source.cleanup();
        }
    });
});
