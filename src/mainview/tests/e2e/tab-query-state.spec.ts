import { expect, test, type Page } from '@playwright/test';
import { createFileSource, createScript, openScriptTab, reloadSidebarRow } from './helpers';

/**
 * A slow statement gives the test time to leave its tab while the query is still running. The
 * result must wait in the tab that started it: before the query state was keyed per tab, it landed
 * in whichever tab was active on arrival and could be saved into that tab's database.
 */
const SLOW_SQL =
    "with recursive counter(value) as (select 1 union all select value + 1 from counter where value < 300000) select 'slow' as tag, count(*) as total from counter;";
const QUICK_SQL = "select 'quick' as tag;";

type Source = Awaited<ReturnType<typeof createFileSource>>;

async function openApp(page: Page) {
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
}

/** A fresh script tab opens on its Problems panel; the result lives behind the Result tab. */
async function showResultPanel(page: Page) {
    await page.getByRole('button', { name: /^Result/ }).click();
}

test.describe('A tab owns its query state', () => {
    test('keeps a running query and its result in the tab that started it', async ({ page, request }) => {
        const source: Source = await createFileSource(request, {
            label: 'tab-query-state',
            schema: `CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO people (id, name) VALUES (1, 'Ada');`,
        });
        const slowScriptId = await createScript(request, source.connectionId, 'slow script', SLOW_SQL);
        const quickScriptId = await createScript(request, source.connectionId, 'quick script', QUICK_SQL);

        try {
            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
            await openScriptTab(page, source.connectionId, slowScriptId);
            await openScriptTab(page, source.connectionId, quickScriptId);

            // Back to the slow script and run it; the run is still going when we leave the tab.
            await page.locator(`#script-${slowScriptId}`).click();
            await expect(page.locator('.monaco-editor .view-lines')).toContainText('counter');

            const runFinished = page.waitForResponse((response) => response.url().endsWith('/api/runQuery'));
            await page.getByRole('button', { name: 'Run', exact: true }).click();
            await page.locator(`#script-${quickScriptId}`).click();
            await runFinished;

            // The quick tab keeps its own text and shows no result of its own.
            await expect(page.locator('.monaco-editor .view-lines')).toContainText('quick');
            await showResultPanel(page);
            await expect(page.getByText('Run the selected script to preview its result here.')).toBeVisible();
            await expect(page.getByText('Columns 2')).toHaveCount(0);

            // The slow tab kept its text and received its own result (two columns: tag, total).
            await page.locator(`#script-${slowScriptId}`).click();
            await expect(page.locator('.monaco-editor .view-lines')).toContainText('counter');
            await showResultPanel(page);
            await expect(page.getByText('Columns 2')).toBeVisible();

            // And the quick tab still has none of it.
            await page.locator(`#script-${quickScriptId}`).click();
            await showResultPanel(page);
            await expect(page.getByText('Columns 2')).toHaveCount(0);
            await expect(page.getByText('Run the selected script to preview its result here.')).toBeVisible();
        } finally {
            await source.cleanup();
        }
    });
});
