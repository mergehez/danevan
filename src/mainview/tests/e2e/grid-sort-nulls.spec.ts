import { expect, test, type Page } from '@playwright/test';
import { DATA_GRID_HEADER_HEIGHT } from '../../../datagrid/dataGrid';
import { createFileSource, gridCellPoint, menuItem, openFileTable } from './helpers';

/**
 * NULL is the smallest value on SQLite (as on MySQL and SQL Server): ORDER BY … DESC lists it
 * last, ASC first. The grid's client-side sort used to treat NULL as the largest value, so a
 * header DESC sort showed NULLs first — contradicting the server order the grid had just loaded.
 * Values are read back through the in-cell editor in visual order, since the grid paints to a
 * canvas.
 */
const SCHEMA = `
    CREATE TABLE readings (id INTEGER PRIMARY KEY, v INTEGER NULL);
    INSERT INTO readings (id, v) VALUES (1, 30), (2, NULL), (3, 10), (4, NULL);
`;

type Point = Awaited<ReturnType<typeof gridCellPoint>>;

async function sortByHeaderMenu(page: Page, point: Point, label: string) {
    await page.mouse.click(point.x, point.viewportTop + DATA_GRID_HEADER_HEIGHT / 2, { button: 'right' });

    const item = menuItem(page, label);
    await expect(item).toBeVisible();
    await item.click();
}

/** The id column top to bottom, whatever the current sort order is. */
async function visualIdColumn(page: Page, count: number) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    await viewport.focus();
    await page.keyboard.press('Meta+ArrowLeft');
    await page.keyboard.press('Meta+ArrowUp');

    const values: string[] = [];

    for (let visualRow = 0; visualRow < count; visualRow += 1) {
        if (visualRow > 0) {
            await page.keyboard.press('ArrowDown');
        }

        await page.keyboard.press('Enter');

        const editor = page.locator('textarea[data-editor-key]');
        await expect(editor).toBeVisible();
        values.push(await editor.inputValue());
        await editor.press('Escape');
    }

    return values;
}

test('sorts nulls last on DESC and first on ASC', async ({ page, request }) => {
    const source = await createFileSource(request, { label: 'grid-sort-nulls', schema: SCHEMA });

    try {
        await page.goto('/');
        await openFileTable(page, source, 'readings');

        // Column 1 is `v`.
        const point = await gridCellPoint(page, 1);

        await sortByHeaderMenu(page, point, 'Order By Desc');
        expect(await visualIdColumn(page, 4)).toEqual(['1', '3', '2', '4']);

        await sortByHeaderMenu(page, point, 'Order By Asc');
        expect(await visualIdColumn(page, 4)).toEqual(['2', '4', '3', '1']);
    } finally {
        await source.cleanup();
    }
});
