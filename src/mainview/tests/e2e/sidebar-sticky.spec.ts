import { expect, test, type Page } from '@playwright/test';
import { createFileSource } from './helpers';

const ROW_HEIGHT = 24;

function serverRow(page: Page, serverId: number) {
    return page.locator(`[data-node-id="server:${serverId}"]`);
}

test.describe('Sidebar first-depth rows', () => {
    test('stack at the top instead of sliding over each other', async ({ page, request }) => {
        const sources: Awaited<ReturnType<typeof createFileSource>>[] = [];

        for (let index = 0; index < 3; index += 1) {
            sources.push(await createFileSource(request, { label: 'sticky', tableCount: 12 }));
        }

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            const lastServerId = sources[2]!.serverId;
            const lastRow = serverRow(page, lastServerId);
            await expect(lastRow).toBeVisible();

            if ((await lastRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await lastRow.click();
            }

            const panel = lastRow.locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]');

            const totalFirstDepth = await page.locator('aside [data-node-id^="server:"]').count();
            const firstSlot = totalFirstDepth - sources.length;
            const panelTop = (await panel.boundingBox())!.y;
            const pinnedTop = async (serverId: number) => (await serverRow(page, serverId).boundingBox())!.y - panelTop;

            // Nothing scrolled yet: a later source is still at its own position, not pinned.
            await expect.poll(() => pinnedTop(lastServerId)).toBeGreaterThan((firstSlot + 2) * ROW_HEIGHT + 100);

            // Scrolled into the last source: every source above it keeps its slot, in order.
            await panel.evaluate((element) => (element.scrollTop = element.scrollHeight));

            await expect.poll(() => pinnedTop(sources[0]!.serverId)).toBeCloseTo(firstSlot * ROW_HEIGHT, 0);
            await expect.poll(() => pinnedTop(sources[1]!.serverId)).toBeCloseTo((firstSlot + 1) * ROW_HEIGHT, 0);
            await expect.poll(() => pinnedTop(sources[2]!.serverId)).toBeCloseTo((firstSlot + 2) * ROW_HEIGHT, 0);

            // Pinned rows paint an opaque base, otherwise rows scrolling underneath show through
            // the half-transparent selection/hover tint.
            for (const source of sources) {
                const base = await serverRow(page, source.serverId).evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
                expect(base).toMatch(/^rgb\(/);
            }

            // Clicking a pinned header goes back to its section, instead of toggling a subtree that
            // is hidden behind the stacked headers and making the click look like a no-op.
            const firstTable = page.locator(`[data-node-id="table:${sources[2]!.connectionId}:table_00"]`);
            const childOffset = async () => {
                const box = await firstTable.boundingBox();
                return box ? box.y - panelTop : Number.NEGATIVE_INFINITY;
            };
            const headerTop = (firstSlot + 2) * ROW_HEIGHT;
            const collapsedBefore = await lastRow.getAttribute('data-sidebar-collapsed');
            const scrollBefore = await panel.evaluate((element) => element.scrollTop);

            await expect(firstTable).toHaveCount(1);
            expect(await childOffset()).toBeLessThan(headerTop + ROW_HEIGHT);

            await lastRow.click();

            await expect.poll(childOffset, { timeout: 5000 }).toBeGreaterThan(headerTop + ROW_HEIGHT);
            // ...and directly under that header, not somewhere else in the list.
            expect(await childOffset()).toBeLessThan(headerTop + 2 * ROW_HEIGHT);
            expect(await panel.evaluate((element) => element.scrollTop)).toBeLessThan(scrollBefore);
            expect(await lastRow.getAttribute('data-sidebar-collapsed')).toBe(collapsedBefore);
            expect(await pinnedTop(lastServerId)).toBeCloseTo(headerTop, 0);

            // Once the row sits at its own position again, the click toggles the section as before.
            await expect.poll(() => lastRow.evaluate((row) => {
                const section = row.parentElement;
                return !!section && section.getBoundingClientRect().top - row.getBoundingClientRect().top >= -1;
            })).toBe(true);

            await lastRow.click();
            await expect.poll(() => lastRow.getAttribute('data-sidebar-collapsed')).not.toBe(collapsedBefore);

            // The chevron is an explicit toggle, so it keeps toggling even while the row is pinned.
            await panel.evaluate((element) => (element.scrollTop = element.scrollHeight));

            await lastRow.locator('[data-sidebar-toggle-for]').click();
            await expect.poll(() => lastRow.getAttribute('data-sidebar-collapsed')).toBe(collapsedBefore);
        } finally {
            for (const source of sources) {
                await source.cleanup();
            }
        }
    });
});
