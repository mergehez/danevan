// The table-tab row can group (by server / database / add time) and sort by name. Grouping only
// orders a copy of the stored tab list, so returning to "no grouping" has to show the plain order
// again — which is what these assertions are about.
import { expect, test, type Page } from '@playwright/test';
import { createFileSource, openSidebarTable, reloadSidebarRow } from './helpers';

async function openApp(page: Page) {
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
}

/** The table tabs in display order (their element ids are `table-<connection>-<name>`). */
async function tableTabOrder(page: Page) {
    return page.locator('[id^="table-"]').evaluateAll((tabs) => tabs.map((tab) => tab.id.replace(/^table-\d+-/, '')));
}

async function openTableTabsMenu(page: Page) {
    await page.getByTestId('table-tabs-menu').click();
    await expect(page.locator('.v-menu-panel').first()).toBeVisible();
}

async function pickGrouping(page: Page, label: string) {
    await openTableTabsMenu(page);
    await page.getByRole('menuitem', { name: 'Group tabs' }).hover();
    await page.locator('.v-menu-children .v-menu-panel').first().getByRole('menuitem', { name: label }).click();
}

async function toggleSortByName(page: Page) {
    await openTableTabsMenu(page);
    await page.getByRole('menuitem', { name: 'Sort tabs by name' }).click();
    await page.keyboard.press('Escape');
}

test.describe('Table tab grouping and sorting', () => {
    test('groups by server and database, sorts by name, and restores the plain order', async ({ page, request }) => {
        const sourceA = await createFileSource(request, {
            label: 'tab-group-a',
            schema: `CREATE TABLE zulu (id integer primary key); CREATE TABLE alpha (id integer primary key);`,
        });
        const sourceB = await createFileSource(request, {
            label: 'tab-group-b',
            schema: `CREATE TABLE beta (id integer primary key);`,
        });

        try {
            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${sourceA.serverId}"]`));
            await reloadSidebarRow(page.locator(`[data-node-id="server:${sourceB.serverId}"]`));

            // Opening order: A.zulu, B.beta, A.alpha.
            await openSidebarTable(page, sourceA.connectionId, 'zulu');
            await openSidebarTable(page, sourceB.connectionId, 'beta');
            await openSidebarTable(page, sourceA.connectionId, 'alpha');
            await expect.poll(() => tableTabOrder(page)).toEqual(['zulu', 'beta', 'alpha']);

            // By server: A's tabs together (A sorts before B), add order inside.
            await pickGrouping(page, 'By server');
            await expect.poll(() => tableTabOrder(page)).toEqual(['zulu', 'alpha', 'beta']);

            // Sorting by name works inside the groups.
            await toggleSortByName(page);
            await expect.poll(() => tableTabOrder(page)).toEqual(['alpha', 'zulu', 'beta']);

            // The plain order never changed: no grouping and no sort brings it back.
            await pickGrouping(page, 'No grouping');
            await toggleSortByName(page);
            await expect.poll(() => tableTabOrder(page)).toEqual(['zulu', 'beta', 'alpha']);
        } finally {
            await sourceA.cleanup();
            await sourceB.cleanup();
        }
    });

    test('by add time restores the opening order after tabs were dragged', async ({ page, request }) => {
        const source = await createFileSource(request, {
            label: 'tab-group-added',
            schema: `CREATE TABLE zulu (id integer primary key); CREATE TABLE beta (id integer primary key);`,
        });

        try {
            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
            await openSidebarTable(page, source.connectionId, 'zulu');
            await openSidebarTable(page, source.connectionId, 'beta');
            await expect.poll(() => tableTabOrder(page)).toEqual(['zulu', 'beta']);

            // Drag beta in front of zulu: the plain order is now beta, zulu.
            const beta = page.locator(`#table-${source.connectionId}-beta`);
            const zulu = page.locator(`#table-${source.connectionId}-zulu`);
            await beta.dragTo(zulu);
            await expect.poll(() => tableTabOrder(page)).toEqual(['beta', 'zulu']);

            // "Add time" still knows the opening order (and sorting applies on top of it).
            await pickGrouping(page, 'Add time');
            await expect.poll(() => tableTabOrder(page)).toEqual(['zulu', 'beta']);
            await toggleSortByName(page);
            await expect.poll(() => tableTabOrder(page)).toEqual(['beta', 'zulu']);

            // Grouping and sorting survive a reload (they live in the persisted settings).
            await page.reload();
            await expect(page.getByTestId('table-tabs-menu')).toBeVisible();
            await expect.poll(() => tableTabOrder(page)).toEqual(['beta', 'zulu']);

            // Turning the sort off shows the add order again; no grouping returns the dragged order.
            await toggleSortByName(page);
            await expect.poll(() => tableTabOrder(page)).toEqual(['zulu', 'beta']);
            await pickGrouping(page, 'No grouping');
            await expect.poll(() => tableTabOrder(page)).toEqual(['beta', 'zulu']);
        } finally {
            await source.cleanup();
        }
    });
});
