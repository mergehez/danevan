import { expect, test } from '@playwright/test';
import { createFileSource, openFileTable } from './helpers';

/**
 * The grid draws its rows as HTML. These specs hold the two properties that matter for that:
 * a cell is real, readable text (not pixels), and a huge page mounts only the rows in view.
 */
const SCHEMA = `
    CREATE TABLE big (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO big (id, name)
    WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM counter WHERE n < 2000)
    SELECT n, 'row ' || n FROM counter;
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
});
