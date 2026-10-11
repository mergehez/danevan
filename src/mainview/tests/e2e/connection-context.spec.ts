import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createFileSource, openSidebarTable, post, reloadSidebarRow } from './helpers';

/**
 * Both sources hold a table with the same name and shape, so an action that reads the globally
 * selected connection instead of the one the open tab belongs to writes to the wrong database.
 * The window title follows the selected connection, which is how a test can see the switch.
 */
const peopleSchema = (name: string) => `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO people (id, name) VALUES (1, '${name}');
`;

type Source = Awaited<ReturnType<typeof createFileSource>>;

async function openApp(page: Page) {
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
}

/** Selects another source's connection without touching the open tab. */
async function selectSource(page: Page, source: Source) {
    const selected = page.waitForResponse((response) => response.url().endsWith('/api/selectConnection'));

    await page.locator(`[data-node-id="server:${source.serverId}"]`).dispatchEvent('dblclick');
    await selected;
}

async function openPeopleTable(page: Page, source: Source) {
    await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
    await openSidebarTable(page, source.connectionId, 'people');
    await expect(page.getByText('Loading table data...')).toHaveCount(0);
}

async function createScript(request: APIRequestContext, connectionId: number, name: string, sqlText: string) {
    const bootstrap = await post(request, 'createScript', { connectionId, name, sqlText });
    const script = bootstrap.scripts.find((entry: { name: string }) => entry.name === name);

    if (!script) {
        throw new Error(`fixture: script ${name} was not created`);
    }

    return script.id as number;
}

/** Opens a script from its sidebar row. */
async function openScriptTab(page: Page, connectionId: number, scriptId: number) {
    const groupRow = page.locator(`[data-node-id="script-connection:${connectionId}"]`);
    await expect(groupRow).toBeVisible({ timeout: 15_000 });

    if ((await groupRow.getAttribute('data-sidebar-collapsed')) === 'true') {
        await groupRow.dispatchEvent('click');
    }

    const scriptRow = page.locator(`[data-node-id="script:${scriptId}"]`);
    await expect(scriptRow).toBeVisible({ timeout: 15_000 });
    await scriptRow.dispatchEvent('dblclick');
}

/** Runs the script and returns the connection the request was actually sent to. */
async function runScript(page: Page) {
    const request = page.waitForRequest((candidate) => candidate.url().endsWith('/api/runQuery'));

    await page.getByRole('button', { name: 'Run', exact: true }).click();

    const body = JSON.parse((await request).postData() ?? '{}') as { connectionId: number };
    await expect(page.getByTestId('data-grid-viewport').first()).toBeVisible({ timeout: 15_000 });

    return body.connectionId;
}

/** The grid draws to a canvas, so the in-cell editor is the only place to read a shown value. */
async function openCellEditor(page: Page, columnIndex: number) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    await viewport.focus();
    await page.keyboard.press('Meta+ArrowLeft');
    await page.keyboard.press('Meta+ArrowUp');

    for (let index = 0; index < columnIndex; index += 1) {
        await page.keyboard.press('ArrowRight');
    }

    await page.keyboard.press('Enter');

    const editor = page.locator(`textarea[data-editor-key="0:${columnIndex}"]`);
    await expect(editor).toBeVisible();

    return editor;
}

async function storedNames(request: APIRequestContext, connectionId: number) {
    const data = await post(request, 'getTableData', { connectionId, tableName: 'people', limit: 50, offset: 0 });

    return (data.rows as Array<{ name: string }>).map((row) => row.name);
}

test.describe('Actions follow the connection of the open tab', () => {
    test('saves a grid edit to the connection that table belongs to', async ({ page, request }) => {
        const sourceA = await createFileSource(request, { label: 'conn-context-a', schema: peopleSchema('Ada') });
        const sourceB = await createFileSource(request, { label: 'conn-context-b', schema: peopleSchema('Grace') });

        try {
            await openApp(page);
            await openPeopleTable(page, sourceA);

            // Selecting B in the sidebar must not retarget the open table, which is still A's.
            await selectSource(page, sourceB);

            const editor = await openCellEditor(page, 1);
            await expect(editor).toHaveValue('Ada');
            await editor.fill('Changed');
            await editor.press('Enter');
            await expect(editor).toHaveCount(0);

            await expect(page.getByText('1 pending change')).toBeVisible();

            const saveRequest = page.waitForRequest((candidate) => candidate.url().endsWith('/api/applyTableChanges'));
            await page.getByTestId('save-bar-save').click();

            const savedTo = JSON.parse((await saveRequest).postData() ?? '{}') as { connectionId: number };
            expect(savedTo.connectionId).toBe(sourceA.connectionId);

            await expect.poll(() => storedNames(request, sourceA.connectionId)).toEqual(['Changed']);
            expect(await storedNames(request, sourceB.connectionId)).toEqual(['Grace']);
        } finally {
            await sourceA.cleanup();
            await sourceB.cleanup();
        }
    });

    test('runs a script on the connection its tab belongs to', async ({ page, request }) => {
        const sourceA = await createFileSource(request, { label: 'conn-run-a', schema: peopleSchema('Ada') });
        const sourceB = await createFileSource(request, { label: 'conn-run-b', schema: peopleSchema('Grace') });
        const scriptId = await createScript(request, sourceA.connectionId, 'conn-run script', 'select * from people;');

        try {
            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${sourceA.serverId}"]`));
            await openScriptTab(page, sourceA.connectionId, scriptId);

            await runScript(page);
            let editor = await openCellEditor(page, 1);
            await expect(editor).toHaveValue('Ada');
            await editor.press('Escape');
            await expect(editor).toHaveCount(0);

            // Selecting B leaves A's script tab active, so the next run still reads A.
            await selectSource(page, sourceB);

            expect(await runScript(page)).toBe(sourceA.connectionId);
            editor = await openCellEditor(page, 1);
            await expect(editor).toHaveValue('Ada');
        } finally {
            await sourceA.cleanup();
            await sourceB.cleanup();
        }
    });

    test('drops a result when the script tab moves to another database', async ({ page, request }) => {
        const sourceA = await createFileSource(request, { label: 'conn-retarget-a', schema: peopleSchema('Ada') });
        const sourceB = await createFileSource(request, { label: 'conn-retarget-b', schema: peopleSchema('Grace') });
        const scriptId = await createScript(request, sourceA.connectionId, 'conn-retarget script', 'select * from people;');

        try {
            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${sourceA.serverId}"]`));
            await openScriptTab(page, sourceA.connectionId, scriptId);

            await runScript(page);
            const editor = await openCellEditor(page, 1);
            await expect(editor).toHaveValue('Ada');
            await editor.press('Escape');
            await expect(editor).toHaveCount(0);

            // Point the tab at B. A's rows must not stay on screen where a save would write them
            // into B's same-named table.
            await page.getByRole('combobox', { name: 'Server:' }).selectOption(String(sourceB.serverId));

            await expect(page.getByText('Run the selected script to preview its result here.')).toBeVisible();
            await expect(page.getByTestId('save-bar-save')).toHaveCount(0);

            // And the next run reads the database the tab now points at.
            expect(await runScript(page)).toBe(sourceB.connectionId);
            const editorAfterSwitch = await openCellEditor(page, 1);
            await expect(editorAfterSwitch).toHaveValue('Grace');
        } finally {
            await sourceA.cleanup();
            await sourceB.cleanup();
        }
    });
});
