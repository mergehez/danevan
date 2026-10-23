// The grid draws to a canvas, so a column's width is only observable through the scrollable content
// it lays out (the spacer the viewport scrolls) and through what the canvas draws.
import { expect, test, type Page } from '@playwright/test';
import { createFileSource, openFileTable } from './helpers';

/** The width the grid lays out: the row gutter plus every column (the spacer the viewport scrolls). */
async function contentWidth(page: Page) {
    return page
        .getByTestId('data-grid-viewport')
        .first()
        .evaluate((viewport) => {
            const spacer = viewport.lastElementChild as HTMLElement | null;
            return spacer ? Number.parseFloat(spacer.style.width) : 0;
        });
}

/**
 * Scrolls the grid to its widest point and returns the right edge of the last column on screen.
 * The spacer the viewport scrolls carries the layout width (`gutter + every column`).
 */
async function lastColumnEdge(page: Page) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    const box = (await viewport.boundingBox())!;

    const metrics = await viewport.evaluate((element) => {
        const spacer = element.lastElementChild as HTMLElement | null;
        const layoutWidth = spacer ? Number.parseFloat(spacer.style.width) : 0;
        element.scrollLeft = element.scrollWidth;
        return { layoutWidth, clientWidth: element.clientWidth, scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth };
    });

    return { x: box.x + metrics.layoutWidth - metrics.scrollLeft - 2, y: box.y + 16 };
}

test.describe('Grid column resize', () => {
    test('widens the last column, which holds the longest text', async ({ page, request }) => {
        const source = await createFileSource(request, {
            label: 'grid-resize-last',
            schema: `
                CREATE TABLE notes (id integer primary key, title text, body text);
                INSERT INTO notes (id, title, body) VALUES (1, 'note', '${'long body text '.repeat(30)}');
            `,
        });

        try {
            await openFileTable(page, source, 'notes');
            await expect(page.getByTestId('data-grid-viewport').first()).toBeVisible();

            const before = await contentWidth(page);
            const edge = await lastColumnEdge(page);

            await page.mouse.move(edge.x, edge.y);
            await page.mouse.down();
            await page.mouse.move(edge.x + 160, edge.y, { steps: 10 });
            await page.mouse.up();

            await expect.poll(() => contentWidth(page)).toBeGreaterThan(before + 100);

            // The width is persisted for this table, so the next visit opens the same way.
            await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), `data-grid-layout:${source.connectionId}:notes`)).toContain('"body"');

            const stored = await page.evaluate((key) => localStorage.getItem(key), `data-grid-layout:${source.connectionId}:notes`);
            expect(JSON.parse(stored ?? '{}').columnWidths?.body).toBeGreaterThan(520);
        } finally {
            await source.cleanup();
        }
    });
});
