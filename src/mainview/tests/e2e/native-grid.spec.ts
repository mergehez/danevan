import { expect, test } from '@playwright/test';
import { createFileSource, openFileTable } from './helpers';

/**
 * The grid draws its rows as HTML. These specs hold the properties that matter for that: a cell is
 * real, readable text (not pixels), a huge page mounts only the rows in view, and the scrolled-to
 * columns are the ones drawn (a window that only ever named the columns at offset 0 left the grid
 * blank once the viewport moved past the first screenful).
 */
const COLUMN_COUNT = 30;

const wideColumnNames = Array.from({ length: COLUMN_COUNT }, (_, index) => `col_${index}`);
const wideColumnDefinitions = wideColumnNames.map((name) => `${name} TEXT`);

const SCHEMA = `
    CREATE TABLE big (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO big (id, name)
    WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM counter WHERE n < 2000)
    SELECT n, 'row ' || n FROM counter;
    CREATE TABLE wide (id INTEGER PRIMARY KEY, ${wideColumnDefinitions.join(', ')});
    INSERT INTO wide (id, ${wideColumnNames.join(', ')})
    VALUES (1, ${wideColumnNames.map((_, index) => `'value ${index}'`).join(', ')});
`;

test.describe('Native grid', () => {
    test('renders the headers and the cells as text, without an editor', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'native-grid-text', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'big');

            const header = page.locator('[data-grid-header-cell="name"]');
            await expect(header).toHaveText('name');

            // The first row's `name` cell is column 1, and its value is the drawn text itself.
            await expect(page.locator('[data-grid-row="0"] [data-grid-cell="1"]')).toHaveText('row 1');
            await expect(page.locator('[data-grid-row="1"] [data-grid-cell="1"]')).toHaveText('row 2');

            // The row numbers are the grid's own gutter, in the page's row order.
            await expect(page.locator('[data-grid-row="0"] [data-grid-row-number]')).toHaveText('1');
        } finally {
            await source.cleanup();
        }
    });

    test('keeps a window of rows mounted while a long page is scrolled', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'native-grid-window', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'big');

            // "All" pages in the 2000 rows at once: the state holds every row, the DOM must not.
            await page
                .locator('#dbdatapanel')
                .getByRole('button', { name: /^\d+-\d+ of \d+$/ })
                .click();
            await page.getByTestId('grid-page-size-menu').getByRole('button', { name: /^All$/ }).click();
            await expect(page.getByTestId('grid-page-label')).toHaveText('1/1');

            const viewport = page.getByTestId('data-grid-viewport').first();
            const mountedRows = await page.locator('[data-grid-row]').count();
            expect(mountedRows).toBeGreaterThan(5);
            expect(mountedRows).toBeLessThan(100);

            // Scrolling to the end draws the last row and unmounts the first ones.
            await viewport.evaluate((element) => {
                element.scrollTop = element.scrollHeight;
            });
            await expect(page.locator('[data-grid-row] [data-grid-cell="1"]', { hasText: 'row 2000' })).toHaveCount(1, { timeout: 5000 });
            await expect(page.locator('[data-grid-row="0"]')).toHaveCount(0);
            expect(await page.locator('[data-grid-row]').count()).toBeLessThan(100);
        } finally {
            await source.cleanup();
        }
    });

    test('draws the columns the viewport has scrolled to', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'native-grid-columns', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'wide');

            const viewport = page.getByTestId('data-grid-viewport').first();
            const lastColumnIndex = COLUMN_COUNT; // `id` is column 0.
            const lastHeader = page.locator(`[data-grid-header-cell="col_${COLUMN_COUNT - 1}"]`);
            const lastCell = page.locator(`[data-grid-row="0"] [data-grid-cell="${lastColumnIndex}"]`);

            // Far to the right: the window follows, so the last columns are the ones mounted.
            await viewport.evaluate((element) => {
                element.scrollLeft = element.scrollWidth;
            });
            await expect(lastHeader).toHaveCount(1, { timeout: 5000 });
            await expect(lastCell).toHaveText(`value ${COLUMN_COUNT - 1}`);
            await expect(page.locator('[data-grid-header-cell="id"]')).toHaveCount(0);

            // The header cell and the body cell of the same column sit on the same pixel: the header
            // is positioned against the scroll offset, the cells are translated as one layer.
            const headerBox = (await lastHeader.boundingBox())!;
            const cellBox = (await lastCell.boundingBox())!;
            expect(Math.abs(headerBox.x - cellBox.x)).toBeLessThanOrEqual(1);
            expect(headerBox.width).toBeCloseTo(cellBox.width, 0);

            // Back at the start the first columns are the ones drawn again.
            await viewport.evaluate((element) => {
                element.scrollLeft = 0;
            });
            await expect(page.locator('[data-grid-header-cell="id"]')).toHaveCount(1);
            await expect(page.locator('[data-grid-row="0"] [data-grid-cell="1"]')).toHaveText('value 0');
            await expect(page.locator('[data-grid-header-cell="col_29"]')).toHaveCount(0);
        } finally {
            await source.cleanup();
        }
    });
});
