// A read-only connection is the app's own policy, so the write has to be refused where the user made
// it — with the connection named — instead of being sent to the database. The sidebar says which
// connection it is, and the same menu flips the flag back.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createFileSource, openSidebarTable, openSidebarRowMenu, post, reloadSidebarRow } from './helpers';

const SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO people (name) VALUES ('Ada'), ('Grace');
`;

type Source = Awaited<ReturnType<typeof createFileSource>>;

async function storedNames(request: APIRequestContext, connectionId: number) {
    const data = await post(request, 'getTableData', { connectionId, tableName: 'people', limit: 50, offset: 0 });

    return (data.rows as Array<{ name: string }>).map((row) => row.name);
}

/** Marks the connection read-only (or writable again) through the API the sidebar menu calls. */
async function setReadOnly(request: APIRequestContext, source: Source, readonly: boolean) {
    await post(request, 'updateConnection', {
        connectionId: source.connectionId,
        connection: { name: source.connectionName, readonly },
    });
}

async function openPeople(page: Page, source: Source) {
    await page.goto('/');
    await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
    await openSidebarTable(page, source.connectionId, 'people');
}

/** Stages an edit of the first row's `name` through the in-cell editor. */
async function stageNameEdit(page: Page, name: string) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    await viewport.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    const editor = page.locator('textarea[data-editor-key="0:1"]');
    await expect(editor).toBeVisible();
    await editor.fill(name);
    await editor.press('Enter');
    await expect(page.getByText('1 pending change')).toBeVisible();
}

test.describe('Read-only connection', () => {
    test('refuses the save, names the connection and writes nothing', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'readonly-save', schema: SCHEMA });

        try {
            await setReadOnly(request, source, true);
            await openPeople(page, source);

            // The source row carries the lock, because a file source has no connection row.
            await expect(page.locator(`[data-node-id="server:${source.serverId}"] [data-testid="readonly-lock"]`)).toBeVisible();

            await stageNameEdit(page, 'Blocked');

            await page.getByTestId('save-bar-save').click();

            const error = page.getByTestId('save-bar-error');
            await expect(error).toContainText(source.connectionName);
            await expect(error).toContainText('is read-only, so the write was refused');
            // The change is kept, so the user can allow writes and save it.
            await expect(page.getByText('1 pending change')).toBeVisible();
            expect(await storedNames(request, source.connectionId)).toEqual(['Ada', 'Grace']);
        } finally {
            await source.cleanup();
        }
    });

    test('allows the same save after the sidebar menu allows writes', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'readonly-allowed', schema: SCHEMA });

        try {
            await setReadOnly(request, source, true);
            await openPeople(page, source);
            await stageNameEdit(page, 'Ada Lovelace');

            await page.getByTestId('save-bar-save').click();
            await expect(page.getByTestId('save-bar-error')).toContainText('is read-only');

            // The connection menu states the flag and flips it.
            const sourceRow = page.locator(`[data-node-id="server:${source.serverId}"]`);
            await openSidebarRowMenu(sourceRow);
            await expect(page.getByRole('menuitem', { name: 'Allow writes' })).toBeVisible();
            await page.getByRole('menuitem', { name: 'Allow writes' }).click();
            await expect(sourceRow.locator('[data-testid="readonly-lock"]')).toHaveCount(0);

            await page.getByTestId('save-bar-save').click();

            await expect.poll(() => storedNames(request, source.connectionId)).toEqual(['Ada Lovelace', 'Grace']);
        } finally {
            await source.cleanup();
        }
    });

    test('refuses a statement in the SQL editor and still shows the rows of a read', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'readonly-query', schema: SCHEMA });

        try {
            await setReadOnly(request, source, true);
            await post(request, 'createScript', { connectionId: source.connectionId, name: 'readonly-probe', sqlText: "update people set name = 'Blocked';" });

            const bootstrap = (await post(request, 'getBootstrap', undefined)) as { scripts: Array<{ id: number; name: string }> };
            const scriptId = bootstrap.scripts.find((script) => script.name === 'readonly-probe')?.id;

            await openPeople(page, source);
            await page.locator(`[data-node-id="script:${scriptId}"]`).dispatchEvent('dblclick');
            await expect(page.locator('.monaco-editor .view-lines')).toContainText('Blocked');

            await page.getByRole('button', { name: 'Run', exact: true }).click();

            await expect(page.getByText(/is read-only/)).toBeVisible();
            expect(await storedNames(request, source.connectionId)).toEqual(['Ada', 'Grace']);
        } finally {
            await source.cleanup();
        }
    });
});
