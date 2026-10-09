import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { API, post } from './helpers';

/**
 * What the SQL editor shows must be what Run sends. The editor is a controlled
 * component: Monaco emits every change through `onChange`, and `Run` executes
 * `useQuery.queryText`. If that handler is not called (e.g. because a second
 * `onChange` on the same element was merged into an array by the JSX transform),
 * the visible text and the executed SQL drift apart and Run replays an older
 * script from the same tab.
 */

async function createFileSource(request: APIRequestContext, scriptText: string) {
    const suffix = Date.now().toString();
    const dbPath = `/tmp/e2e-sql-run-${suffix}.sqlite`;
    const file = new Database(dbPath);

    file.exec('CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
    file.close();

    const serverName = `e2e-sql-run-${suffix}`;
    const bootstrap = await post(request, 'createServer', { name: serverName, kind: 'file', driver: 'sqlite', filePath: dbPath });
    const serverId = bootstrap.servers.find((entry: { name: string }) => entry.name === serverName).id;
    const connectionName = `${serverName}-conn`;
    const withConnection = await post(request, 'createConnection', { serverId, name: connectionName, readonly: false });
    const connectionId = withConnection.connections.find((entry: { name: string }) => entry.name === connectionName).id;
    const scriptName = `${serverName}-script`;
    const withScript = await post(request, 'createScript', { connectionId, name: scriptName, sqlText: scriptText });
    const scriptId = withScript.scripts.find((entry: { name: string }) => entry.name === scriptName).id;

    return { serverId, connectionId, scriptId, dbPath };
}

async function openApp(page: Page) {
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
}

/** Scripts live in their own sidebar tree: a connection group that has to be
 *  expanded before its script rows exist, and script rows open on double click. */
async function openScriptTab(page: Page, connectionId: number, scriptId: number, expectedText: string) {
    const dispatch = (selector: string, type: 'click' | 'dblclick') =>
        page.locator(selector).evaluate((element, eventType) => element.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true })), type);

    const scriptRow = page.locator(`[data-node-id="script:${scriptId}"]`);

    if (!(await scriptRow.isVisible().catch(() => false))) {
        await expect(page.locator(`[data-node-id="script-connection:${connectionId}"]`)).toBeVisible({ timeout: 15_000 });
        await dispatch(`[data-node-id="script-connection:${connectionId}"]`, 'click');
        await expect(scriptRow).toBeVisible({ timeout: 15_000 });
    }

    await dispatch(`[data-node-id="script:${scriptId}"]`, 'dblclick');
    await expect(page.locator('.monaco-editor .view-lines')).toContainText(expectedText, { timeout: 15_000 });
}

async function replaceEditorText(page: Page, text: string) {
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(text);
}

test.describe('SQL editor run', () => {
    test('runs the text that is in the editor, not an older script from the tab', async ({ page, request }) => {
        const source = await createFileSource(request, 'select 1111 as old_probe;');
        const sentSql: unknown[] = [];
        const consoleErrors: string[] = [];

        page.on('request', (req) => {
            if (req.url().endsWith('/api/runQuery')) {
                sentSql.push(req.postDataJSON()?.sql);
            }
        });
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });

        try {
            await openApp(page);
            await openScriptTab(page, source.connectionId, source.scriptId, 'old_probe;');

            // The reported flow: replace the whole script, then run straight away.
            await replaceEditorText(page, 'select 2222 as new_probe;');
            // `name` matches substrings, and the sidebar rows of this source contain "run".
            await page.getByRole('button', { name: 'Run', exact: true }).click();

            // The batch splits statements, so the trailing `;` is not sent.
            await expect.poll(() => sentSql, { timeout: 15_000 }).toEqual(['select 2222 as new_probe']);

            // The result on screen has to come from that same statement.
            await expect(page.getByText('new_probe').first()).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText('old_probe')).toHaveCount(0);

            // A change handler that is not a function (a merged prop) fails on every keystroke.
            expect(consoleErrors.filter((text) => text.includes('props.onChange'))).toEqual([]);
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
            rmSync(source.dbPath, { force: true });
        }
    });

    test('keeps the typed text when the app reloads', async ({ page, request }) => {
        const source = await createFileSource(request, 'select 1111 as old_probe;');

        try {
            await openApp(page);
            await openScriptTab(page, source.connectionId, source.scriptId, 'old_probe;');

            await replaceEditorText(page, 'select 3333 as kept_probe;');
            // The tab's draft is written on a short timer; reload only once it reached the cache.
            await expect.poll(() => page.evaluate(() => localStorage.getItem('settings') ?? '')).toContain('kept_probe');
            await openApp(page);

            await expect(page.locator('.monaco-editor .view-lines')).toContainText('kept_probe', { timeout: 15_000 });
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
            rmSync(source.dbPath, { force: true });
        }
    });
});
