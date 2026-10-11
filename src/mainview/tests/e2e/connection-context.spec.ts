import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createFileSource, createScript, openScriptTab, openSidebarTable, post, reloadSidebarRow } from './helpers';

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

test.describe('The sidebar selection and the open tab agree', () => {
    test('clears the workspace when the selected source has no tab of its own', async ({ page, request }) => {
        const sourceA = await createFileSource(request, { label: 'conn-context-a', schema: peopleSchema('Ada') });
        const sourceB = await createFileSource(request, { label: 'conn-context-b', schema: peopleSchema('Grace') });

        try {
            await openApp(page);
            await openPeopleTable(page, sourceA);

            // Selecting B in the sidebar must not leave A's table on screen under B's database.
            await selectSource(page, sourceB);

            await expect(page.getByText('Open a table from the sidebar or create a script or scratch tab')).toBeVisible();
            await expect(page.getByTestId('data-grid-viewport')).toHaveCount(0);
            await expect(page.getByTestId('save-bar-save')).toHaveCount(0);

            // A's tab is still in the tab bar; activating it returns to A and its rows.
            await page.locator(`#table-${sourceA.connectionId}-people`).click();

            const editor = await openCellEditor(page, 1);
            await expect(editor).toHaveValue('Ada');
            await editor.press('Escape');
            await expect(editor).toHaveCount(0);
            expect(await storedNames(request, sourceA.connectionId)).toEqual(['Ada']);
            expect(await storedNames(request, sourceB.connectionId)).toEqual(['Grace']);
        } finally {
            await sourceA.cleanup();
            await sourceB.cleanup();
        }
    });

    test('activates the selected source\'s own tab when it has one', async ({ page, request }) => {
        const sourceA = await createFileSource(request, { label: 'conn-context-tab-a', schema: peopleSchema('Ada') });
        const sourceB = await createFileSource(request, { label: 'conn-context-tab-b', schema: peopleSchema('Grace') });

        try {
            await openApp(page);
            await reloadSidebarRow(page.locator(`[data-node-id="server:${sourceB.serverId}"]`));
            await openSidebarTable(page, sourceB.connectionId, 'people');
            await expect(page.getByText('Loading table data...')).toHaveCount(0);

            await openPeopleTable(page, sourceA);

            // Back to B: its own table tab comes forward instead of A's staying on screen.
            await selectSource(page, sourceB);

            const editor = await openCellEditor(page, 1);
            await expect(editor).toHaveValue('Grace');
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
