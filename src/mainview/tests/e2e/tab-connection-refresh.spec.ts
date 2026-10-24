// Two databases can hold a table of the same name, and a session can keep tabs of both. Activating
// one tab must refresh that tab's connection only: verifying every table tab's connection at once
// made a dead server elsewhere raise its "connection lost" error over the table the user was
// looking at, and refreshed a database they were not reading.
import { expect, test, type Page, type Request } from '@playwright/test';
import { createFileSource, openSidebarTable, reloadSidebarRow } from './helpers';

type DataRequest = {
    url: string;
    connectionId: number | undefined;
    tableName: string | undefined;
};

function readBody(request: Request): { connectionId?: number; tableName?: string } {
    try {
        return JSON.parse(request.postData() ?? '{}') as { connectionId?: number; tableName?: string };
    } catch {
        return {};
    }
}

async function collectDataRequests(page: Page): Promise<DataRequest[]> {
    const requests: DataRequest[] = [];

    page.on('request', (entry) => {
        if (/\/(getTables|getTableInfo|getTableData)$/.test(entry.url())) {
            const body = readBody(entry);
            requests.push({ url: entry.url(), connectionId: body.connectionId, tableName: body.tableName });
        }
    });

    return requests;
}

test.describe('A tab refreshes its own connection only', () => {
    test('activating a tab does not load another tab’s database', async ({ page, request }) => {
        const sourceA = await createFileSource(request, {
            label: 'tab-context-a',
            schema: `CREATE TABLE notes (id integer primary key, body text); INSERT INTO notes (id, body) VALUES (1, 'from a');`,
        });
        const sourceB = await createFileSource(request, {
            label: 'tab-context-b',
            schema: `CREATE TABLE notes (id integer primary key, body text); INSERT INTO notes (id, body) VALUES (1, 'from b');`,
        });

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await reloadSidebarRow(page.locator(`[data-node-id="server:${sourceA.serverId}"]`));
            await reloadSidebarRow(page.locator(`[data-node-id="server:${sourceB.serverId}"]`));
            await openSidebarTable(page, sourceA.connectionId, 'notes');
            await openSidebarTable(page, sourceB.connectionId, 'notes');

            // Listen before the reload: a cold session restores the tab and activates it.
            const requests = await collectDataRequests(page);

            await page.reload();
            await expect(page.getByTestId('data-grid-viewport').first()).toBeVisible({ timeout: 15_000 });

            // The restored tab refreshed its own database and left A's alone, even though A's tab
            // is open beside it.
            await expect.poll(() => requests.some((entry) => entry.url.endsWith('/getTableData') && entry.connectionId === sourceB.connectionId)).toBe(true);
            expect(requests.filter((entry) => entry.connectionId === sourceA.connectionId)).toEqual([]);

            // Opening A's tab is what refreshes A, and it names A's connection.
            const loadedA = page.waitForResponse((response) => response.url().endsWith('/api/getTableData') && readBody(response.request()).connectionId === sourceA.connectionId);
            await page.locator(`#table-${sourceA.connectionId}-notes`).click();
            await loadedA;

            expect(requests.some((entry) => entry.url.endsWith('/getTableData') && entry.connectionId === sourceA.connectionId && entry.tableName === 'notes')).toBe(true);

            // The other tab is still there, still on its own connection.
            await expect(page.locator(`#table-${sourceB.connectionId}-notes`)).toBeVisible();
        } finally {
            await sourceA.cleanup();
            await sourceB.cleanup();
        }
    });
});
