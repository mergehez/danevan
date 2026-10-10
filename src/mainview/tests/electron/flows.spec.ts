// The browser suite drives the HTTP API the dev server mounts, but a user's every request goes
// through the preload bridge: `electronAPI.invoke`, the in-process backend and the IPC error
// wrapping. Only the shell's own boot was covered there, so nothing proved that editing a cell,
// saving it, applying a modify-table change or running a query works in the artifact users run.
// These specs do exactly those flows in the built shell and read every result back out of the API.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API, createFileSource, createMySqlServerAndConnection, MYSQL, openSidebarRowMenu, openSidebarTable, post, reloadSidebarRow, requireMySqlDatabase } from '../e2e/helpers';
import { closeShell, createAppDataDir, launchShell, openAppWindow, requireShellBuild } from './helpers';

const PEOPLE_SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO people (name) VALUES ('Ada'), ('Grace');
`;

test.beforeAll(() => {
    requireShellBuild();
});

/** The renderer's requests have to travel over the bridge, not the HTTP fallback. */
async function expectPreloadBridge(window: Page) {
    expect(await window.evaluate(() => typeof (window as { electronAPI?: { invoke?: unknown } }).electronAPI?.invoke === 'function')).toBe(true);
}

async function storedNames(request: APIRequestContext, connectionId: number) {
    const data = await post(request, 'getTableData', { connectionId, tableName: 'people', limit: 50, offset: 0 });

    return (data.rows as Array<{ name: string }>).map((row) => row.name);
}

/** The renderer reads the source list once at boot; a fixture the API added needs a reload. */
async function reloadApp(window: Page) {
    await window.reload();
    await expect(window.getByRole('heading', { name: 'Connections' })).toBeVisible();
}

/** Edits the first row's `name` cell through the in-cell editor the grid opens on Enter. */
async function stageNameEdit(window: Page, name: string) {
    const viewport = window.getByTestId('data-grid-viewport').first();
    await viewport.focus();
    await window.keyboard.press('ArrowRight');
    await window.keyboard.press('Enter');

    const editor = window.locator('textarea[data-editor-key="0:1"]');
    await expect(editor).toBeVisible();
    await editor.fill(name);
    await editor.press('Enter');
    await expect(window.getByText('1 pending change')).toBeVisible();
}

test('edits and saves a SQLite row through the preload bridge', async ({ request }) => {
    const appDataDir = createAppDataDir('danevan-flow-edit-');
    const app = await launchShell(appDataDir);

    try {
        const window = await openAppWindow(app);
        await expectPreloadBridge(window);

        const source = await createFileSource(request, { label: 'shell-edit', schema: PEOPLE_SCHEMA });

        try {
            await reloadApp(window);
            await reloadSidebarRow(window.locator(`[data-node-id="server:${source.serverId}"]`));
            await openSidebarTable(window, source.connectionId, 'people');

            await stageNameEdit(window, 'Ada Lovelace');
            await window.getByTestId('save-bar-save').click();

            // The bar only clears the change once the save succeeded...
            await expect(window.getByText('1 pending change')).toHaveCount(0);
            // ...and the row the shell wrote is the row the database hands back.
            await expect.poll(() => storedNames(request, source.connectionId)).toEqual(['Ada Lovelace', 'Grace']);
        } finally {
            await source.cleanup();
        }
    } finally {
        await closeShell(app, appDataDir);
    }
});

test('applies a modify-table change through the preload bridge', async ({ request }) => {
    const appDataDir = createAppDataDir('danevan-flow-ddl-');
    const app = await launchShell(appDataDir);

    try {
        const window = await openAppWindow(app);
        await expectPreloadBridge(window);

        const source = await createFileSource(request, { label: 'shell-ddl', schema: PEOPLE_SCHEMA });

        try {
            await reloadApp(window);
            await reloadSidebarRow(window.locator(`[data-node-id="server:${source.serverId}"]`));

            const tableRow = window.locator(`[data-node-id="table:${source.connectionId}:people"]`);
            await expect(tableRow).toBeVisible();
            await openSidebarRowMenu(tableRow);
            await window.locator('.v-menu-item', { hasText: 'Modify Table...' }).click();

            const columnsGroup = window.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="columns"]');
            await expect(window.locator('[data-testid="modify-nav-item"][data-nav-kind="column"]').first()).toBeVisible();

            await columnsGroup.click();
            await window.locator('[data-testid="modify-add"]').click();
            await window.locator('[data-testid="modify-column-name"]').fill('note');
            await window.locator('[data-testid="modify-column-type"] input').fill('text');
            await window.locator('[data-testid="modify-column-type"] input').press('Enter');

            await window.locator('[data-testid="modify-apply"]').click();
            await expect(window.locator('[data-testid="modify-apply"]')).toBeHidden();

            // The SQLite rebuild the shell asked for is the shape the database reports.
            await expect
                .poll(async () => {
                    const info = await post(request, 'getTableInfo', { connectionId: source.connectionId, tableName: 'people' });
                    return (info.columns as Array<{ name: string }>).map((column) => column.name);
                })
                .toContain('note');

            // The rebuild kept the rows it copied.
            await expect.poll(() => storedNames(request, source.connectionId)).toEqual(['Ada', 'Grace']);
        } finally {
            await source.cleanup();
        }
    } finally {
        await closeShell(app, appDataDir);
    }
});

test('runs a MySQL query through the preload bridge', async ({ request }) => {
    requireMySqlDatabase(MYSQL.database, 'flows.spec.ts');

    const appDataDir = createAppDataDir('danevan-flow-query-');
    const app = await launchShell(appDataDir);

    try {
        const window = await openAppWindow(app);
        await expectPreloadBridge(window);

        const source = await createMySqlServerAndConnection(request, MYSQL.database, 'shell-query');

        try {
            const scriptName = `shell-query-${Date.now()}`;
            const withScript = await post(request, 'createScript', { connectionId: source.connectionId, name: scriptName, sqlText: 'select 6 * 7 as answer;' });
            const scriptId = (withScript.scripts as Array<{ id: number; name: string }>).find((script) => script.name === scriptName)!.id;

            await reloadApp(window);

            const groupRow = window.locator(`[data-node-id="script-connection:${source.connectionId}"]`);
            await expect(groupRow).toBeVisible();

            if ((await groupRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await groupRow.dispatchEvent('click');
            }

            const scriptRow = window.locator(`[data-node-id="script:${scriptId}"]`);
            await expect(scriptRow).toBeVisible();
            await scriptRow.dispatchEvent('dblclick');
            await expect(window.locator('.monaco-editor .view-lines')).toContainText('answer');

            await window.getByRole('button', { name: 'Run', exact: true }).click();

            // A rows result draws the grid; its canvas cells are read through the cell editor.
            const viewport = window.getByTestId('data-grid-viewport').first();
            await expect(viewport).toBeVisible();
            await viewport.focus();
            await window.keyboard.press('Enter');
            await expect(window.locator('textarea[data-editor-key="0:0"]')).toHaveValue('42');
        } finally {
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => undefined);
        }
    } finally {
        await closeShell(app, appDataDir);
    }
});
