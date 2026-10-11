// The first-depth source rows pin to the top of the sidebar. Two things break when they stack: a
// pinned row can cover the one above it (each row has to keep its own slot, in order), and a click
// on a row pinned over its own hidden section would toggle a subtree nobody can see instead of going
// back to that section. The assertions measure the rows the browser really drew, and use the same
// "is this row pinned" test the sidebar itself uses (its section starts above it), because the
// sections are laid out with a gap and their flow positions are not the sticky slot pitch.
import { expect, test, type Page } from '@playwright/test';
import { createFileSource, deleteAllServers, expandSidebarRow } from './helpers';

type SidebarRow = { nodeId: string; top: number; height: number; bottom: number; pinned: boolean };

function serverRow(page: Page, serverId: number) {
    return page.locator(`[data-node-id="server:${serverId}"]`);
}

/** Every first-depth row, in the order the sidebar drew it, measured against the panel's top edge. */
async function sidebarRows(page: Page, panelTop: number): Promise<SidebarRow[]> {
    return page.locator('aside [data-node-id^="server:"]').evaluateAll(
        (elements, top) =>
            elements.map((element) => {
                const box = element.getBoundingClientRect();
                const section = element.parentElement;
                const sectionTop = section ? section.getBoundingClientRect().top : box.top;

                return {
                    nodeId: element.getAttribute('data-node-id') ?? '',
                    top: box.top - top,
                    height: box.height,
                    bottom: box.bottom - top,
                    // A pinned row is drawn above its own section, which is the test the sidebar's
                    // click handler uses to decide between scrolling back and toggling.
                    pinned: sectionTop - box.top < -1,
                };
            }),
        panelTop
    );
}

test.describe('Sidebar first-depth rows', () => {
    test('stack at the top instead of sliding over each other', async ({ page, request }) => {
        // The assertions below are about the whole first-depth list (which rows pin, and in what
        // order), so the spec owns that list: sources earlier specs left behind used to push the
        // first of these three out of the pinned stack.
        await deleteAllServers(request);

        const sources: Awaited<ReturnType<typeof createFileSource>>[] = [];

        for (let index = 0; index < 3; index += 1) {
            sources.push(await createFileSource(request, { label: 'sticky', tableCount: 12 }));
        }

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            const [first, , last] = sources as [
                Awaited<ReturnType<typeof createFileSource>>,
                Awaited<ReturnType<typeof createFileSource>>,
                Awaited<ReturnType<typeof createFileSource>>,
            ];
            const lastRow = serverRow(page, last.serverId);
            await expect(lastRow).toBeVisible();

            // Every source is expanded, so each held-open section is long enough to scroll past.
            for (const source of sources) {
                await expandSidebarRow(serverRow(page, source.serverId));
            }

            const panel = lastRow.locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]');
            const panelTop = (await panel.boundingBox())!.y;
            const scrollPanelToBottom = async () => {
                await panel.evaluate((element) => (element.scrollTop = element.scrollHeight));
                await expect.poll(() => panel.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(1);
            };

            // The list is long enough to pin rows at all.
            expect(await panel.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(200);

            await scrollPanelToBottom();

            const rows = await sidebarRows(page, panelTop);
            const rowFor = (nodeId: string) => rows.find((row) => row.nodeId === nodeId)!;

            // Each row starts where the row above it ends (within a rounding pixel): none slides over
            // another, and the three sources keep the order they were added in.
            for (let index = 1; index < rows.length; index += 1) {
                expect(rows[index]!.top - rows[index - 1]!.bottom).toBeGreaterThanOrEqual(-1);
            }

            // These three are the whole first-depth list: `deleteAllServers` cleared what earlier specs
            // left behind, so the pinned-stack assertions below are about this run's own rows.
            expect(rows.map((row) => row.nodeId)).toEqual(sources.map((source) => `server:${source.serverId}`));

            // The first source is scrolled past, so it is pinned at the top edge; the rows pinned
            // with it keep that stack tight instead of drifting apart.
            expect(rowFor(`server:${first.serverId}`).pinned).toBe(true);
            expect(rowFor(`server:${first.serverId}`).top).toBeLessThan(1);

            const pinnedRows = rows.filter((row) => row.pinned);
            expect(pinnedRows.length).toBeGreaterThan(1);

            for (let index = 1; index < pinnedRows.length; index += 1) {
                expect(pinnedRows[index]!.top - pinnedRows[index - 1]!.bottom).toBeGreaterThanOrEqual(-1);
                expect(pinnedRows[index]!.top - pinnedRows[index - 1]!.bottom).toBeLessThanOrEqual(1);
            }

            // Pinned rows paint an opaque base, otherwise rows scrolling underneath show through
            // the half-transparent selection/hover tint.
            for (const source of sources) {
                const base = await serverRow(page, source.serverId).evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
                expect(base).toMatch(/^rgb\(/);
            }

            // Clicking a pinned header goes back to its section, instead of toggling a subtree that
            // is hidden behind the stacked headers and making the click look like a no-op.
            const firstTable = page.locator(`[data-node-id="table:${first.connectionId}:table_00"]`);
            const collapsedBefore = await serverRow(page, first.serverId).getAttribute('data-sidebar-collapsed');
            const scrollBefore = await panel.evaluate((element) => element.scrollTop);
            const childTop = async () => (await firstTable.boundingBox())!.y - panelTop;
            const rowBox = async () => (await serverRow(page, first.serverId).boundingBox())!;

            await expect(firstTable).toHaveCount(1);
            // While the header is pinned, the rows of its own section are above the viewport.
            expect(await childTop()).toBeLessThan(0);

            await serverRow(page, first.serverId).click();

            // The header is back at its own position with its rows directly under it, so the click
            // reached the section instead of toggling it away.
            await expect.poll(childTop, { timeout: 5000 }).toBeGreaterThan((await rowBox()).y + (await rowBox()).height - panelTop - 1);
            expect(await childTop()).toBeLessThan((await rowBox()).y + (await rowBox()).height - panelTop + 2 * (await rowBox()).height);
            expect(await panel.evaluate((element) => element.scrollTop)).toBeLessThan(scrollBefore);
            expect(await serverRow(page, first.serverId).getAttribute('data-sidebar-collapsed')).toBe(collapsedBefore);

            // Once the row sits at its own position again, a click toggles the section as before.
            await expect
                .poll(() =>
                    serverRow(page, first.serverId).evaluate((row) => {
                        const section = row.parentElement;
                        return !!section && section.getBoundingClientRect().top - row.getBoundingClientRect().top >= -1;
                    })
                )
                .toBe(true);

            await serverRow(page, first.serverId).click();
            await expect.poll(() => serverRow(page, first.serverId).getAttribute('data-sidebar-collapsed')).not.toBe(collapsedBefore);

            // The chevron is an explicit toggle, so it keeps toggling even while the row is pinned.
            await scrollPanelToBottom();
            expect((await sidebarRows(page, panelTop)).find((row) => row.nodeId === `server:${first.serverId}`)!.pinned).toBe(true);

            await serverRow(page, first.serverId).locator('[data-sidebar-toggle-for]').click();
            await expect.poll(() => serverRow(page, first.serverId).getAttribute('data-sidebar-collapsed')).toBe(collapsedBefore);
        } finally {
            for (const source of sources) {
                await source.cleanup();
            }
        }
    });
});
