import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createFileSource, post, requireSqlFluffRuntime } from './helpers';

const MESSY_SQL = 'select  1  as ok ,2 as two from (select 1) t;';
const FORMATTED_SQL = 'select\n    1 as ok,\n    2 as two\nfrom (select 1) t';
const BROKEN_SQL = 'select from where';

async function createScript(request: APIRequestContext, connectionId: number, name: string, sqlText: string, groupName?: string) {
    const bootstrap = await post(request, 'createScript', { connectionId, name, sqlText, groupName });
    const script = bootstrap.scripts.find((entry: { name: string }) => entry.name === name);

    if (!script) {
        throw new Error(`fixture: script ${name} was not created`);
    }

    return script.id as number;
}

async function openSourceWithScript(request: APIRequestContext, label: string, sqlText: string) {
    const source = await createFileSource(request, { label, schema: 'CREATE TABLE keep_me (id integer primary key, note text);' });
    const scriptId = await createScript(request, source.connectionId, `${label} script`, sqlText);

    return { source, scriptId };
}

async function openApp(page: Page) {
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
}

function editorLines(page: Page) {
    return page.locator('.monaco-editor .view-lines');
}

/** Expands the scripts tree down to a connection's scripts. */
async function expandScriptGroup(page: Page, connectionId: number) {
    const groupRow = page.locator(`[data-node-id="script-connection:${connectionId}"]`);
    await expect(groupRow).toBeVisible({ timeout: 15_000 });

    if ((await groupRow.getAttribute('data-sidebar-collapsed')) === 'true') {
        await groupRow.dispatchEvent('click');
    }
}

/** Scripts live in their own tree: a connection group that expands on click, rows that open on double click. */
async function openScriptTab(page: Page, connectionId: number, scriptId: number, expectedText: string) {
    await expandScriptGroup(page, connectionId);

    const scriptRow = page.locator(`[data-node-id="script:${scriptId}"]`);
    await expect(scriptRow).toBeVisible({ timeout: 15_000 });
    await scriptRow.dispatchEvent('dblclick');

    await expect(editorLines(page)).toContainText(expectedText, { timeout: 15_000 });
}

async function replaceEditorText(page: Page, text: string) {
    await editorLines(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(text);
}

/** The editor header's Save button, which is the only one while the modal is closed. */
async function openSaveModal(page: Page) {
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    const modal = page.getByTestId('centered-modal-surface');
    await expect(modal).toContainText('Save script');
    return modal;
}

function panelTab(page: Page, name: 'Result' | 'Problems' | 'History') {
    return page.getByRole('button', { name: new RegExp(`^${name}`) });
}

/** Runs the editor text and returns the SQL the backend was asked to execute. */
async function runAndCaptureSql(page: Page) {
    const request = page.waitForRequest((candidate) => candidate.url().endsWith('/api/runQuery'));
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    return (JSON.parse((await request).postData() ?? '{}') as { sql: string }).sql;
}

test.describe('SQL editor panels', () => {
    test('creates a script from a scratch tab through the save modal', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'scratch-save', schema: 'CREATE TABLE keep_me (id integer primary key, note text);' });

        try {
            await openApp(page);
            await page.getByTestId('new-scratch-tab').click();

            await expect(page.locator('.drag-item')).toHaveCount(1);
            await expect(page.locator('.drag-item')).toHaveAttribute('id', /^scratch-/);

            await replaceEditorText(page, 'select 42 as answer;');

            const modal = await openSaveModal(page);
            await modal.getByPlaceholder('Script name').fill('saved from scratch');
            await modal.getByPlaceholder('Optional group').fill('probes');
            await modal.getByRole('button', { name: 'Save' }).click();

            await expect(modal).toHaveCount(0);

            const bootstrap = await post(request, 'getBootstrap', undefined);
            const saved = bootstrap.scripts.find((script: { name: string }) => script.name === 'saved from scratch');

            if (!saved) {
                throw new Error('the save modal did not store the script');
            }

            expect(saved).toMatchObject({ connection_id: source.connectionId, group_name: 'probes' });
            expect(saved.sql_text).toBe('select 42 as answer;');

            // The scratch tab became the saved script's tab — one tab, not a second one.
            await expect(page.locator(`#script-${saved.id}`)).toHaveText('saved from scratch');
            await expect(page.locator('.drag-item')).toHaveCount(1);

            await expandScriptGroup(page, source.connectionId);
            await expect(page.locator(`[data-node-id="script-group:${source.connectionId}:probes"]`)).toBeVisible();
        } finally {
            await source.cleanup();
        }
    });

    test('renames a saved script and moves it into a group', async ({ page, request }) => {
        const { source, scriptId } = await openSourceWithScript(request, 'script-rename', 'select 1 as kept;');

        try {
            await openApp(page);
            await openScriptTab(page, source.connectionId, scriptId, 'kept');

            const modal = await openSaveModal(page);

            // The modal opens on the stored name, with no group.
            await expect(modal.getByPlaceholder('Script name')).toHaveValue('script-rename script');
            await expect(modal.getByPlaceholder('Optional group')).toHaveValue('');

            await modal.getByPlaceholder('Script name').fill('renamed script');
            await modal.getByPlaceholder('Optional group').fill('renamed group');
            await modal.getByRole('button', { name: 'Save' }).click();
            await expect(modal).toHaveCount(0);

            // The sidebar follows the rename, and the group row appears around it.
            const groupRow = page.locator(`[data-node-id="script-group:${source.connectionId}:renamed group"]`);
            await expect(groupRow).toBeVisible();

            if ((await groupRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await groupRow.dispatchEvent('click');
            }

            await expect(page.locator(`[data-node-id="script:${scriptId}"]`)).toContainText('renamed script');

            // Re-activating the tab picks the new name up too.
            await page.locator('.drag-item').click();
            await expect(page.locator('.drag-item')).toHaveText('renamed script');

            const bootstrap = await post(request, 'getBootstrap', undefined);
            expect(bootstrap.scripts.find((script: { id: number }) => script.id === scriptId)).toMatchObject({
                name: 'renamed script',
                group_name: 'renamed group',
                sql_text: 'select 1 as kept;',
            });
        } finally {
            await source.cleanup();
        }
    });

    test('lists the parser problems of the current SQL', async ({ page, request }) => {
        requireSqlFluffRuntime('sql-editor-panels.spec.ts');
        const { source, scriptId } = await openSourceWithScript(request, 'script-problems', 'select 1 as fine;');

        try {
            await openApp(page);
            await openScriptTab(page, source.connectionId, scriptId, 'fine');

            await replaceEditorText(page, BROKEN_SQL);

            // The Problems tab is the default panel. The count is every marker the linter and the
            // database validation reported, minus the sources the panel ignores (LT01/LT12/...).
            await expect(panelTab(page, 'Problems')).toHaveText('Problems4');
            await expect(page.locator('div').filter({ hasText: /^\d+:\d+$/ })).toHaveCount(4);
            await expect(page.getByText("Found unparsable section: 'select'")).toBeVisible();
            await expect(page.getByText('near "from": syntax error')).toBeVisible();

            // Valid SQL clears them again.
            await replaceEditorText(page, 'select 1 as fine;');
            await expect(panelTab(page, 'Problems')).toHaveText('Problems');
            await expect(page.getByText('No linting or formatting problems for the current SQL.')).toBeVisible();
        } finally {
            await source.cleanup();
        }
    });

    test('formats the SQL and runs the formatted text', async ({ page, request }) => {
        requireSqlFluffRuntime('sql-editor-panels.spec.ts');
        const { source, scriptId } = await openSourceWithScript(request, 'script-format', 'select 1 as fine;');

        try {
            await openApp(page);
            await openScriptTab(page, source.connectionId, scriptId, 'fine');
            await replaceEditorText(page, MESSY_SQL);

            await page.getByRole('button', { name: 'Format', exact: true }).click();

            // The formatter runs in the background; its output has to reach the editor first.
            await expect(editorLines(page)).toContainText('select    1 as ok,');

            // Run has to send what the formatter wrote, not the messy text.
            expect(await runAndCaptureSql(page)).toBe(FORMATTED_SQL);

            // A parser error disables formatting instead of formatting broken SQL.
            await replaceEditorText(page, BROKEN_SQL);
            await expect(page.getByRole('button', { name: 'Format', exact: true })).toBeDisabled();
        } finally {
            await source.cleanup();
        }
    });

    test('keeps the query history per script tab', async ({ page, request }) => {
        const { source, scriptId } = await openSourceWithScript(request, 'script-history', 'select 7 as history_probe;');
        const otherScriptId = await createScript(request, source.connectionId, 'other script', 'select 8 as other_probe;');

        try {
            await openApp(page);
            await openScriptTab(page, source.connectionId, scriptId, 'history_probe');
            expect(await runAndCaptureSql(page)).toBe('select 7 as history_probe');

            await panelTab(page, 'History').click();

            await expect(page.locator('pre', { hasText: 'history_probe' })).toHaveText('select 7 as history_probe');
            await expect(page.getByText('success', { exact: true })).toBeVisible();

            // The history belongs to the tab, not to the editor.
            await openScriptTab(page, source.connectionId, otherScriptId, 'other_probe');
            await panelTab(page, 'History').click();
            await expect(page.getByText('No queries have been executed in this script yet.')).toBeVisible();

            // Coming back to the first tab still shows its own entry.
            await page.locator(`#script-${scriptId}`).click();
            await panelTab(page, 'History').click();
            await expect(page.locator('pre', { hasText: 'history_probe' })).toHaveText('select 7 as history_probe');
        } finally {
            await source.cleanup();
        }
    });
});
