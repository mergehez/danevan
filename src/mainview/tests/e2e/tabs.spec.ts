import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createFileSource, post } from './helpers';

const ALPHA_SQL = 'select 1 as alpha_probe;';
const BETA_SQL = 'select 2 as beta_probe;';

async function createScript(request: APIRequestContext, connectionId: number, name: string, sqlText: string) {
    const bootstrap = await post(request, 'createScript', { connectionId, name, sqlText });
    const script = bootstrap.scripts.find((entry: { name: string }) => entry.name === name);

    if (!script) {
        throw new Error(`fixture: script ${name} was not created`);
    }

    return script.id as number;
}

async function openApp(page: Page) {
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
}

/** Scripts live in their own tree: a connection group that expands on click, rows that open on double click. */
async function openScriptTab(page: Page, connectionId: number, scriptId: number, expectedText: string) {
    const groupRow = page.locator(`[data-node-id="script-connection:${connectionId}"]`);
    await expect(groupRow).toBeVisible({ timeout: 15_000 });

    if ((await groupRow.getAttribute('data-sidebar-collapsed')) === 'true') {
        await groupRow.dispatchEvent('click');
    }

    const scriptRow = page.locator(`[data-node-id="script:${scriptId}"]`);
    await expect(scriptRow).toBeVisible({ timeout: 15_000 });
    await scriptRow.dispatchEvent('dblclick');

    await expect(editorLines(page)).toContainText(expectedText, { timeout: 15_000 });
}

function editorLines(page: Page) {
    return page.locator('.monaco-editor .view-lines');
}

/** A script tab is identified by its hash, which is derived from the script id. */
function scriptTab(page: Page, scriptId: number) {
    return page.locator(`#script-${scriptId}`);
}

function tabNames(page: Page) {
    return page.locator('.drag-item').allInnerTexts();
}

/** The active tab is the only green one. */
async function expectActive(page: Page, scriptId: number) {
    await expect(scriptTab(page, scriptId)).toHaveClass(/bg-green-700/);
}

async function pickTabMenuItem(page: Page, scriptId: number, item: string) {
    await scriptTab(page, scriptId).click({ button: 'right' });

    const menuItem = page.locator('.v-menu-item', { hasText: item });
    await expect(menuItem).toBeVisible();
    await menuItem.click();
}

test.describe('Tabs', () => {
    test('closes to the neighbour, reopens the closed tab and closes all', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'tabs', schema: 'CREATE TABLE keep_me (id integer primary key, note text);' });

        try {
            const alpha = await createScript(request, source.connectionId, 'alpha script', ALPHA_SQL);
            const beta = await createScript(request, source.connectionId, 'beta script', BETA_SQL);

            await openApp(page);
            await openScriptTab(page, source.connectionId, alpha, 'alpha_probe');
            await openScriptTab(page, source.connectionId, beta, 'beta_probe');

            await expect.poll(() => tabNames(page)).toEqual(['alpha script', 'beta script']);
            await expectActive(page, beta);

            // The close button only appears on hover; closing the active tab hands over to its neighbour.
            await scriptTab(page, beta).locator('span:has(i[class*="mdi--close"])').click();

            await expect.poll(() => tabNames(page)).toEqual(['alpha script']);
            await expectActive(page, alpha);
            await expect(editorLines(page)).toContainText('alpha_probe');

            // Reopening brings the closed tab back and makes it active again.
            await pickTabMenuItem(page, alpha, 'Reopen closed tab');

            await expect.poll(() => tabNames(page)).toEqual(['alpha script', 'beta script']);
            await expectActive(page, beta);
            await expect(editorLines(page)).toContainText('beta_probe');

            // Closing every tab leaves the workspace asking for one.
            await pickTabMenuItem(page, beta, 'Close all');

            await expect(page.locator('.drag-item')).toHaveCount(0);
            await expect(page.getByRole('heading', { name: 'Open a tab' })).toBeVisible();
        } finally {
            await source.cleanup();
        }
    });

    test('keeps the editor content with its tab across a drag reorder', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'tabs-drag', schema: 'CREATE TABLE keep_me (id integer primary key, note text);' });

        try {
            const alpha = await createScript(request, source.connectionId, 'alpha script', ALPHA_SQL);
            const beta = await createScript(request, source.connectionId, 'beta script', BETA_SQL);

            await openApp(page);
            await openScriptTab(page, source.connectionId, alpha, 'alpha_probe');
            await openScriptTab(page, source.connectionId, beta, 'beta_probe');

            await expect.poll(() => tabNames(page)).toEqual(['alpha script', 'beta script']);

            // Drag the first tab past the second one.
            await scriptTab(page, alpha).dragTo(scriptTab(page, beta));

            await expect.poll(() => tabNames(page)).toEqual(['beta script', 'alpha script']);

            // Whichever tab the drag leaves selected, the editor must show that tab's script —
            // the drag must not leave the tab list and the editor pointing at different scripts.
            const activeName = await page.locator('.drag-item.bg-green-700').innerText();
            await expect(editorLines(page)).toContainText(activeName.startsWith('alpha') ? 'alpha_probe' : 'beta_probe');

            // ...and every tab still shows its own script.
            await scriptTab(page, beta).click();
            await expect(editorLines(page)).toContainText('beta_probe');

            await scriptTab(page, alpha).click();
            await expect(editorLines(page)).toContainText('alpha_probe');
        } finally {
            await source.cleanup();
        }
    });
});
