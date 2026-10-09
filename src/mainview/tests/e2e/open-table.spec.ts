import { expect, test, type Page } from '@playwright/test';
import { API, MYSQL, createMySqlServerAndConnection, post, requireFixtureData, requireMySqlDatabase } from './helpers';

async function expand(locator: ReturnType<Page['locator']>) {
    await expect(locator).toBeVisible();

    if ((await locator.getAttribute('data-sidebar-collapsed')) === 'true') {
        await locator.click();
    }
}

/** Expands the sidebar down to a table row (server > connection > "tables" collection). */
async function openTableRow(page: Page, serverId: number, connectionId: number, tableName: string) {
    await expand(page.locator(`[data-node-id="server:${serverId}"]`));
    await expand(page.locator(`[data-node-id="connection:${connectionId}"]`));

    // Tables can sit behind a "tables" group; the connection filter can flatten them.
    const tablesCollection = page.locator('[data-collection-kind="tables"]');
    if ((await tablesCollection.count()) > 0) {
        await expand(tablesCollection.first());
    }

    return page.locator(`[data-node-id="table:${connectionId}:${tableName}"]`);
}

test.describe('Opening a table from the sidebar', () => {
    test('shows the panel loading state and then the table rows', async ({ page }) => {
        await requireMySqlDatabase(MYSQL.database, 'open-table.spec.ts');

        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request, MYSQL.database, 'open-table');

        try {
            const tableList = await post(page.request, 'getTables', { connectionId });
            const table = requireFixtureData(
                tableList.find((entry: { type: string; rowCount: number }) => entry.type === 'table' && entry.rowCount > 0),
                `The MySQL database "${MYSQL.database}" has no table with rows; insert rows into a table before running this spec.`
            );

            // Hold the table list back so the loading state is observable: that phase
            // used to leave the panel looking idle.
            await page.route('**/api/getTables', async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 1200));
                await route.continue();
            });

            await page.goto('/');

            const tableRow = await openTableRow(page, serverId, connectionId, table.name);
            await expect(tableRow).toBeVisible();

            await tableRow.dblclick();

            // The panel must say that it is loading instead of looking idle.
            const panel = page.locator('main');
            await expect(panel.getByText('Loading table data...')).toBeVisible();
            await page.screenshot({ path: 'test-results/open-table-loading.png', fullPage: true });

            // ...and the rows must actually arrive: the toolbar reports the page range.
            await expect(panel.getByRole('button', { name: /^1-\d+ of/ })).toBeVisible();
            await expect(panel.getByText(table.name, { exact: true }).first()).toBeVisible();

            await page.screenshot({ path: 'test-results/open-table-loaded.png', fullPage: true });
        } finally {
            await page.request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('a huge table reports an estimated row count instead of scanning it', async ({ page }) => {
        await requireMySqlDatabase(MYSQL.largeDatabase, 'open-table.spec.ts');

        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request, MYSQL.largeDatabase, 'open-table');

        try {
            // The table list comes from the database catalog, so it must not wait for
            // a COUNT(*) of every table in the database.
            const startedAt = Date.now();
            const tableList = await post(page.request, 'getTables', { connectionId });
            const listDurationMs = Date.now() - startedAt;

            // Every listed table is an estimate now, so pick an actually huge one:
            // only above the exact-count limit does an opened table keep the estimate.
            const estimatedTable = requireFixtureData(
                tableList.find(
                    (entry: { rowCountIsEstimated?: boolean; rowCount: number }) => entry.rowCountIsEstimated === true && Number(entry.rowCount) > 100_000
                ),
                `The MySQL database "${MYSQL.largeDatabase}" has no table with a row estimate above 100000; load a large table into it (or set E2E_MYSQL_LARGE_DATABASE) before running this spec.`
            );

            expect(listDurationMs).toBeLessThan(10_000);

            // The list must never run a COUNT(*) per table: every row reports the
            // catalog estimate, and only an opened table pays for an exact count.
            expect(tableList.length).toBeGreaterThan(0);
            expect(tableList.every((entry: { rowCountIsEstimated?: boolean }) => entry.rowCountIsEstimated === true)).toBe(true);

            const rowsResponse = await page.request.post(`${API}/getTableData`, {
                data: { connectionId, tableName: estimatedTable.name, limit: 100, offset: 0 },
            });
            expect(rowsResponse.ok()).toBe(true);
            const data = await rowsResponse.json();
            expect(data.rowCountIsEstimated).toBe(true);
            expect(data.rowCount).toBeGreaterThan(100_000);
            expect(data.rows.length).toBeGreaterThan(0);

            await page.goto('/');

            // The sidebar marks the estimate instead of pretending it is exact.
            const tableRow = await openTableRow(page, serverId, connectionId, estimatedTable.name);
            await expect(tableRow).toBeVisible();
            await expect(tableRow).toContainText('~');

            // Opening it shows rows immediately, with the estimate marked in the toolbar.
            await tableRow.dblclick();

            const panel = page.locator('main');
            await expect(panel.getByRole('button', { name: /^1-\d+ of ~\d+$/ })).toBeVisible();
            await page.screenshot({ path: 'test-results/open-table-estimated-count.png', fullPage: true });
        } finally {
            await page.request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });
});
