// A read-only connection is the app's own policy, so the write has to be refused where the user made
// it — with the connection named — instead of being sent to the database. The sidebar says which
// connection it is, and the same menu flips the flag back.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API, MYSQL, createFileSource, createMySqlServerAndConnection, openMySqlTable, openSidebarRowMenu, openSidebarTable, post, reloadSidebarRow, requireMySqlDatabase } from './helpers';

const SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO people (name) VALUES ('Ada'), ('Grace');
`;

type Source = Awaited<ReturnType<typeof createFileSource>>;

async function storedNames(request: APIRequestContext, connectionId: number, tableName = 'people') {
    const data = await post(request, 'getTableData', { connectionId, tableName, limit: 50, offset: 0 });

    return (data.rows as Array<{ name: string }>).map((row) => row.name);
}

/** Marks the connection read-only (or writable again) through the API the sidebar menu calls. */
async function setReadOnly(request: APIRequestContext, source: { connectionId: number; connectionName: string }, readonly: boolean) {
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
            // The target prefix names the connection, then the refusal itself — not the JSON
            // envelope (and escaped quotes) the API answered with.
            await expect(error).toHaveText(
                `${source.connectionName}: The connection "${source.connectionName}" is read-only, so the write was refused. Allow writes from its sidebar menu to change that.`
            );
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

// The same policy on a server connection, where the lock is on the connection's table collection and
// the refusal has to happen before the UPDATE reaches MySQL.
test.describe('Read-only MySQL connection', () => {
    /** A table of its own, so the spec can edit and re-read it without touching the fixtures. */
    async function createTable(request: APIRequestContext, source: { connectionId: number }, tableName: string) {
        await post(request, 'runQuery', {
            connectionId: source.connectionId,
            sql: `CREATE TABLE \`${tableName}\` (id int NOT NULL, name varchar(50) NOT NULL, PRIMARY KEY (id))`,
        });
        await post(request, 'runQuery', {
            connectionId: source.connectionId,
            sql: `INSERT INTO \`${tableName}\` (id, name) VALUES (1, 'Ada'), (2, 'Grace')`,
        });
    }

    async function dropTable(request: APIRequestContext, source: { connectionId: number; serverId: number }, tableName: string) {
        await request.post(`${API}/runQuery`, { data: { connectionId: source.connectionId, sql: `DROP TABLE IF EXISTS \`${tableName}\`` } }).catch(() => undefined);
        await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => undefined);
    }

    function lockOf(page: Page, source: { connectionId: number }) {
        return page.locator(`[data-node-id="connection:${source.connectionId}"] [data-testid="readonly-lock"]`);
    }

    /**
     * The switch is flipped from the sidebar menu, not the API: `updateConnection` writes every
     * field it is given, so a partial payload wipes a server connection's host, port and database.
     */
    async function toggleReadOnly(page: Page, source: { connectionId: number }, label: 'Make read-only' | 'Allow writes') {
        await openSidebarRowMenu(page.locator(`[data-node-id="connection:${source.connectionId}"]`));
        await expect(page.getByRole('menuitem', { name: label })).toBeVisible();
        await page.getByRole('menuitem', { name: label }).click();
    }

    test('refuses the save, names the connection and leaves the row alone', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'the read-only MySQL spec');

        const source = await createMySqlServerAndConnection(request, MYSQL.database, 'readonly');
        const tableName = `e2e_readonly_${Date.now()}`;

        try {
            await createTable(request, source, tableName);

            await page.goto('/');
            await openMySqlTable(page, source, tableName);

            // The read drew its rows while the connection was still writable.
            await expect(page.locator('#dbdatapanel').getByRole('button', { name: /^1-2 of 2$/ })).toBeVisible();

            await toggleReadOnly(page, source, 'Make read-only');

            // The connection row carries the lock, and the read still works under it.
            await expect(lockOf(page, source)).toBeVisible();
            await expect(page.locator('#dbdatapanel').getByRole('button', { name: /^1-2 of 2$/ })).toBeVisible();

            await stageNameEdit(page, 'Blocked');
            await page.getByTestId('save-bar-save').click();

            await expect(page.getByTestId('save-bar-error')).toHaveText(
                `${source.connectionName} (${MYSQL.host}:${MYSQL.port}/${MYSQL.database}): The connection "${source.connectionName}" is read-only, so the write was refused. Allow writes from its sidebar menu to change that.`
            );
            await expect(page.getByText('1 pending change')).toBeVisible();
            expect(await storedNames(request, source.connectionId, tableName)).toEqual(['Ada', 'Grace']);
        } finally {
            await dropTable(request, source, tableName);
        }
    });

    test('allows the same save after the connection menu allows writes', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'the read-only MySQL spec');

        const source = await createMySqlServerAndConnection(request, MYSQL.database, 'readonly-allowed');
        const tableName = `e2e_readonly_allowed_${Date.now()}`;

        try {
            await createTable(request, source, tableName);

            await page.goto('/');
            await openMySqlTable(page, source, tableName);
            await toggleReadOnly(page, source, 'Make read-only');
            await expect(lockOf(page, source)).toBeVisible();

            await stageNameEdit(page, 'Ada Lovelace');

            await page.getByTestId('save-bar-save').click();
            await expect(page.getByTestId('save-bar-error')).toContainText('is read-only');

            // The same menu states the flag the other way and flips it.
            await toggleReadOnly(page, source, 'Allow writes');
            await expect(lockOf(page, source)).toHaveCount(0);

            // The save now reaches MySQL: a real UPDATE ... WHERE id = 1 lands.
            await page.getByTestId('save-bar-save').click();

            await expect.poll(() => storedNames(request, source.connectionId, tableName)).toEqual(['Ada Lovelace', 'Grace']);
        } finally {
            await dropTable(request, source, tableName);
        }
    });
});
