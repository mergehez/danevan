import { expect, test, type Page } from '@playwright/test';
import { createFileSource, gridCellPoint, menuItem, openFileTable } from './helpers';

/**
 * The cell menu's `Set Value` entries stage an edit without opening an editor. The value is stored
 * and the save bar counts it, but the grid paints to a canvas: the cell has to repaint too, or the
 * screen keeps showing the old text while the bar claims a pending change.
 */
const SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, nickname TEXT);
    INSERT INTO people (id, name, nickname) VALUES (1, 'Ada', 'lovelace'), (2, 'Grace', 'hopper');
`;

type Point = Awaited<ReturnType<typeof gridCellPoint>>;

function submenuItem(page: Page, label: string) {
    return page.locator('.v-menu-children .v-menu-item', { hasText: label }).first();
}

async function openCellMenu(page: Page, point: Point) {
    await page.mouse.click(point.x, point.y, { button: 'right' });

    const parent = menuItem(page, 'Set Value');
    await expect(parent).toBeVisible();
    await parent.focus();
}

/** The grid's search counter, next to the search input: it counts the cells whose drawn text matches. */
function searchCounter(page: Page) {
    return page.getByPlaceholder('Search grid').locator('xpath=following-sibling::span[1]');
}

async function expectDrawnTexts(page: Page, texts: { null: string; old: string }) {
    const search = page.getByPlaceholder('Search grid');

    await search.fill('null');
    await expect(searchCounter(page)).toHaveText('1/1');
    await search.fill(texts.old);
    await expect(searchCounter(page)).toHaveText('0/0');
    await search.fill('');
    await expect(searchCounter(page)).toHaveText('0/0');
}

test('sets a cell to null from the cell menu and repaints it', async ({ page, request }) => {
    const source = await createFileSource(request, { label: 'cell-set-value', schema: SCHEMA });

    try {
        await page.goto('/');
        await openFileTable(page, source, 'people');

        // Column 2 is `nickname`.
        const point = await gridCellPoint(page, 2);
        const before = await page.getByTestId('data-grid-viewport').first().screenshot();

        await openCellMenu(page, point);
        await submenuItem(page, '(null)').click();

        // The row is staged as a change…
        await expect(page.getByText('1 pending change')).toBeVisible();

        // …the canvas repaints on its own…
        await expect.poll(async () => ((await page.getByTestId('data-grid-viewport').first().screenshot()).equals(before) ? 'same' : 'different')).toBe('different');

        // …and the cell draws NULL instead of the old value.
        await expectDrawnTexts(page, { null: 'null', old: 'lovelace' });
    } finally {
        await source.cleanup();
    }
});
