import { expect, test, type Page } from '@playwright/test';
import { DATA_GRID_HEADER_HEIGHT } from '../../../datagrid/dataGrid';
import { createFileSource, gridCellPoint, menuItem, openFileTable } from './helpers';

/**
 * A timestamp display type changes what every cell of an integer column shows, and the grid
 * paints those cells to a canvas. Two things have to hold: the formatted text is the ISO
 * rendering (proven through the grid's search, which runs over the displayed text), and the
 * canvas repaints right away (proven by comparing viewport pixels before and after — the
 * switch used to update the stored layout without repainting, so it looked like nothing
 * happened until some unrelated interaction redrew the grid).
 */
const SCHEMA = `
    CREATE TABLE readings (id INTEGER PRIMARY KEY, taken_at INTEGER NOT NULL);
    INSERT INTO readings (id, taken_at) VALUES (1, 1764713739), (2, 1700000000);
`;

type Point = Awaited<ReturnType<typeof gridCellPoint>>;

function submenuItem(page: Page, label: string | RegExp) {
    return page.locator('.v-menu-children .v-menu-item', { hasText: label }).first();
}

async function openDisplayTypeSubmenu(page: Page, point: Point) {
    await page.mouse.click(point.x, point.viewportTop + DATA_GRID_HEADER_HEIGHT / 2, { button: 'right' });

    const parent = menuItem(page, 'Change Display Type');
    await expect(parent).toBeVisible();
    await parent.focus();
    await expect(submenuItem(page, 'Timestamp (Seconds)')).toBeVisible();
}

/** The grid's search counter, next to the search input. */
function searchCounter(page: Page) {
    return page.getByPlaceholder('Search grid').locator('xpath=following-sibling::span[1]');
}

async function viewportPixels(page: Page) {
    return page.getByTestId('data-grid-viewport').first().screenshot();
}

test('applies a timestamp display type to an integer column', async ({ page, request }) => {
    const source = await createFileSource(request, { label: 'display-type-timestamp', schema: SCHEMA });

    try {
        await page.goto('/');
        await openFileTable(page, source, 'readings');

        // Column 1 is `taken_at`.
        const point = await gridCellPoint(page, 1);
        const search = page.getByPlaceholder('Search grid');

        // Without a display type the raw integers are what the grid displays and searches.
        await search.fill('1764713');
        await expect(searchCounter(page)).toHaveText('1/1');
        await search.fill('');
        await expect(searchCounter(page)).toHaveText('0/0');

        const before = await viewportPixels(page);

        await openDisplayTypeSubmenu(page, point);
        await submenuItem(page, 'Timestamp (Seconds)').press('Enter');

        // The canvas repaints with the new text on its own: no reload, no scroll, no search.
        await expect.poll(async () => ((await viewportPixels(page)).equals(before) ? 'same' : 'different')).toBe('different');

        // And the new text is the ISO rendering (1764713739 is 2025-12-02).
        await search.fill('2025-12');
        await expect(searchCounter(page)).toHaveText('1/1');
        await search.fill('1764713');
        await expect(searchCounter(page)).toHaveText('0/0');
        await search.fill('');
    } finally {
        await source.cleanup();
    }
});
