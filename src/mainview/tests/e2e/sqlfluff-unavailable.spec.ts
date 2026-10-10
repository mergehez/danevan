// SQLFluff is provisioned on demand (a venv plus an install), so the app has to work on a machine
// where that never happened: the Problems panel names the reason instead of claiming the SQL is
// clean, Format fails loudly instead of doing nothing, and Copy as DDL still copies the DDL. The
// backend that produces those answers is unit tested; this drives the UI that has to render them.
import { expect, test, type Page } from '@playwright/test';
import { clearClipboard, createFileSource, expandSidebarRow, openSidebarRowMenu, post, readClipboard } from './helpers';

const LINT_REASON = 'The SQLFluff runtime is unavailable.';
const FORMAT_REASON = 'SQLFluff could not be installed, so the SQL was not formatted.';

/** The marker the backend answers with when it cannot run the linter at all. */
const DEGRADED_MARKERS = {
    markers: [{ message: LINT_REASON, severity: 'warning', startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2, source: 'sqlfluff' }],
    problemMarkers: [{ message: LINT_REASON, severity: 'warning', startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2, source: 'sqlfluff' }],
};

const SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO people (id, name) VALUES (1, 'Ada');
`;

function panelTab(page: Page, name: 'Result' | 'Problems' | 'History') {
    return page.getByRole('button', { name: new RegExp(`^${name}`) });
}

async function openScript(page: Page, connectionId: number, scriptId: number, expectedText: string) {
    const groupRow = page.locator(`[data-node-id="script-connection:${connectionId}"]`);
    await expect(groupRow).toBeVisible();

    if ((await groupRow.getAttribute('data-sidebar-collapsed')) === 'true') {
        await groupRow.dispatchEvent('click');
    }

    const scriptRow = page.locator(`[data-node-id="script:${scriptId}"]`);
    await expect(scriptRow).toBeVisible();
    await scriptRow.dispatchEvent('dblclick');
    await expect(page.locator('.monaco-editor .view-lines')).toContainText(expectedText);
}

test('names the missing SQLFluff runtime and keeps the rest of the editor working', async ({ page, request }) => {
    const source = await createFileSource(request, { label: 'sqlfluff-missing', schema: SCHEMA });

    try {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        // The backend's degraded answers: no lint result, and a format request that fails.
        await page.route('**/api/getSqlDiagnostics', (route) => route.fulfill({ json: DEGRADED_MARKERS }));
        await page.route('**/api/formatSql', (route) => route.fulfill({ status: 500, json: { error: FORMAT_REASON } }));

        const withScript = await post(request, 'createScript', { connectionId: source.connectionId, name: 'offline lint', sqlText: 'select 1 as fine;' });
        const scriptId = (withScript.scripts as Array<{ id: number; name: string }>).find((script) => script.name === 'offline lint')!.id;

        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
        await openScript(page, source.connectionId, scriptId, 'fine');

        // The Problems panel reports the reason, and it is a warning: it must not read like a parser
        // error, which would be the app's own claim that the SQL is broken.
        await expect(panelTab(page, 'Problems')).toHaveText('Problems1');
        await expect(page.getByText(LINT_REASON)).toBeVisible();

        const formatButton = page.getByRole('button', { name: 'Format', exact: true });
        await expect(formatButton).toBeEnabled();

        // Formatting is the one thing the linter is required for: the failure reaches the user and
        // the editor keeps the SQL it had.
        await formatButton.click();
        await expect(page.getByText(FORMAT_REASON)).toBeVisible();
        await expect(page.locator('.monaco-editor .view-lines')).toContainText('select 1 as fine;');

        // Copy as DDL does not need the formatter: the table's DDL is copied unformatted.
        await expandSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
        const tableRow = page.locator(`[data-node-id="table:${source.connectionId}:people"]`);
        await expect(tableRow).toBeVisible();
        await openSidebarRowMenu(tableRow);
        await clearClipboard(page);
        await page.locator('.v-menu-item', { hasText: 'Copy as DDL' }).click();

        // The copy runs the formatter first, which fails and falls back to the DDL itself.
        await expect.poll(async () => (await readClipboard(page)).includes('CREATE TABLE')).toBe(true);

        const ddl = await readClipboard(page);
        expect(ddl).toContain('people');
    } finally {
        await source.cleanup();
    }
});
