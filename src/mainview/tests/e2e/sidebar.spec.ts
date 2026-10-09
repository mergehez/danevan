import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API, createFileSource, post } from './helpers';

const SCRIPT_SQL = 'select 11 as sidebar_probe;';

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

/** Expands a sidebar row through a dispatched click; the rows stick and can be covered. */
async function expandRow(row: ReturnType<Page['locator']>) {
    await expect(row).toBeVisible();

    if ((await row.getAttribute('data-sidebar-collapsed')) === 'true') {
        await row.locator('[data-sidebar-toggle-for]').dispatchEvent('click');
        await expect(row).toHaveAttribute('data-sidebar-collapsed', 'false');
    }
}

async function expandScriptGroup(page: Page, connectionId: number) {
    const groupRow = page.locator(`[data-node-id="script-connection:${connectionId}"]`);
    await expect(groupRow).toBeVisible({ timeout: 15_000 });

    if ((await groupRow.getAttribute('data-sidebar-collapsed')) === 'true') {
        await groupRow.dispatchEvent('click');
    }
}

/** Opens the sidebar's own menu and picks an entry; a submenu opens on hover. */
async function sidebarMenu(page: Page, item: string) {
    await page.getByTestId('sidebar-settings').click();

    const menuItem = page.locator('.v-menu-panel > .v-menu-group > .v-menu-item', { hasText: item }).first();
    await expect(menuItem).toBeVisible();
    return menuItem;
}

async function pickSubmenuItem(page: Page, parent: string, item: string) {
    await (await sidebarMenu(page, parent)).hover();

    const childItem = page.locator('.v-menu-children .v-menu-item', { hasText: item }).first();
    await expect(childItem).toBeVisible();
    await childItem.click();
}

async function openScriptTab(page: Page, connectionId: number, scriptId: number, expectedText: string) {
    await expandScriptGroup(page, connectionId);

    const scriptRow = page.locator(`[data-node-id="script:${scriptId}"]`);
    await expect(scriptRow).toBeVisible({ timeout: 15_000 });
    await scriptRow.dispatchEvent('dblclick');

    await expect(page.locator('.monaco-editor .view-lines')).toContainText(expectedText, { timeout: 15_000 });
}

test.describe('Sidebar management', () => {
    test('creates and deletes a script from its tree', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'sidebar-scripts', schema: 'CREATE TABLE keep_me (id integer primary key, note text);' });

        try {
            await openApp(page);

            // The source has no scripts yet, so its group row only appears once one exists.
            await page.getByTestId('add-script').click();

            const createdBootstrap = await post(request, 'getBootstrap', undefined);
            const created = createdBootstrap.scripts.find((script: { id: number }) => script.id === createdBootstrap.selectedScriptId);

            if (!created) {
                throw new Error('the add-script action did not store a script');
            }

            expect(created.name).toMatch(/^Script [A-Za-z0-9]{5}$/);

            // The tree names the new script and opens it in a tab.
            await expandScriptGroup(page, source.connectionId);
            const newScriptRow = page.locator(`[data-node-id="script:${created.id}"]`);
            await expect(newScriptRow).toBeVisible();
            await expect(newScriptRow).toContainText(created.name);
            await expect(page.locator('.drag-item')).toHaveText(created.name);

            // Deleting asks first and names the script; cancelling keeps it.
            await newScriptRow.dispatchEvent('contextmenu', { clientX: 48, clientY: 48 });
            await page.locator('.v-menu-item', { hasText: 'Delete script' }).click();

            const confirmation = page.getByTestId('centered-modal-surface');
            await expect(confirmation).toContainText(`This will permanently delete ${created.name}.`);
            await confirmation.getByRole('button', { name: 'Cancel' }).click();

            await expect(newScriptRow).toBeVisible();

            // Confirming deletes both the row and the tab that showed it.
            await newScriptRow.dispatchEvent('contextmenu', { clientX: 48, clientY: 48 });
            await page.locator('.v-menu-item', { hasText: 'Delete script' }).click();
            await page.getByTestId('centered-modal-surface').getByRole('button', { name: 'Delete', exact: true }).click();

            await expect(newScriptRow).toHaveCount(0);
            await expect(page.locator('.drag-item')).toHaveCount(0);

            const remainingIds = (await post(request, 'getBootstrap', undefined)).scripts.map((script: { id: number }) => script.id);
            expect(remainingIds).not.toContain(created.id);
        } finally {
            await source.cleanup();
        }
    });

    test('collapses every source from the sidebar menu', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'sidebar-collapse', tableCount: 2 });
        // Creating a script selects its connection, so the second source has to come last:
        // the tree keeps the *selected* source visible, and `source` is the one that must fold.
        await createScript(request, source.connectionId, 'collapse script', SCRIPT_SQL);
        const selected = await createFileSource(request, { label: 'sidebar-collapse-selected', tableCount: 1 });

        try {
            await openApp(page);

            await expandRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
            await expandRow(page.locator(`[data-node-id="server:${selected.serverId}"]`));
            await expect(page.locator(`[data-node-id="table:${source.connectionId}:table_00"]`)).toBeVisible();
            // Not opened in a tab: that would select this connection and keep it revealed.
            await expect(page.locator(`[data-node-id="script-connection:${source.connectionId}"]`)).toBeVisible();

            await (await sidebarMenu(page, 'Collapse all')).click();

            // Everything folds back to the first depth...
            await expect(page.locator(`[data-node-id="server:${source.serverId}"]`)).toHaveAttribute('data-sidebar-collapsed', 'true');
            await expect(page.locator(`[data-node-id="table:${source.connectionId}:table_00"]`)).toHaveCount(0);
            await expect(page.locator(`[data-node-id="script-connection:${source.connectionId}"]`)).toHaveCount(0);

            // ...except the selected source, whose row the tree keeps visible.
            await expect(page.locator(`[data-node-id="server:${selected.serverId}"]`)).toHaveAttribute('data-sidebar-collapsed', 'false');
        } finally {
            await selected.cleanup();
            await source.cleanup();
        }
    });

    test('clears the metadata caches and the tree state', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'sidebar-clear', tableCount: 2 });

        try {
            await openApp(page);

            // Start from the collapsed state, so dropping the stored state is observable.
            const serverRow = page.locator(`[data-node-id="server:${source.serverId}"]`);
            await expandRow(serverRow);
            await serverRow.locator('[data-sidebar-toggle-for]').dispatchEvent('click');
            await expect(serverRow).toHaveAttribute('data-sidebar-collapsed', 'true');
            await expect(page.locator(`[data-node-id="table:${source.connectionId}:table_00"]`)).toHaveCount(0);

            await (await sidebarMenu(page, 'Clear metadata caches')).click();

            // It says what it did; the stored tree state is gone, so the source falls back
            // to its default (expanded) and reads its tables again.
            await expect(page.getByText('Metadata caches and sidebar tree state cleared.')).toBeVisible();
            await expect(serverRow).toHaveAttribute('data-sidebar-collapsed', 'false');
            await expect(page.locator(`[data-node-id="table:${source.connectionId}:table_00"]`)).toBeVisible();
        } finally {
            await source.cleanup();
        }
    });

    test('hides a collection through the collection filter', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'sidebar-filter', tableCount: 1 });
        // The filter is persisted, so the spec restores whatever the machine had.
        const originalSettings = await post(request, 'getEditorSettings', undefined);

        try {
            await openApp(page);

            await expandRow(page.locator(`[data-node-id="server:${source.serverId}"]`));

            const tableRow = page.locator(`[data-node-id="table:${source.connectionId}:table_00"]`);
            await expandRow(tableRow);

            const columnsCollection = page.locator('[data-node-id^="columns:"]');
            await expect(columnsCollection).toHaveCount(1);
            await expect(page.locator('[data-node-id^="keys:"]')).toHaveCount(1);

            await pickSubmenuItem(page, 'Filter collections', 'Columns');

            // Only the columns collection goes away; the filter applies immediately.
            await expect(columnsCollection).toHaveCount(0);
            await expect(page.locator('[data-node-id^="keys:"]')).toHaveCount(1);
        } finally {
            await request.post(`${API}/updateEditorSettings`, { data: { settings: originalSettings } }).catch(() => {});
            await source.cleanup();
        }
    });

    test('lists what was run in the SQL history modal', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'sidebar-history', schema: 'CREATE TABLE keep_me (id integer primary key, note text);' });
        const scriptId = await createScript(request, source.connectionId, 'history script', SCRIPT_SQL);

        try {
            await openApp(page);
            await openScriptTab(page, source.connectionId, scriptId, 'sidebar_probe');

            await page.getByRole('button', { name: 'Run', exact: true }).click();
            await expect(page.getByText('sidebar_probe').first()).toBeVisible({ timeout: 15_000 });

            await page.locator('aside button:has(i[class*="mdi--history"])').click();

            const modal = page.getByTestId('centered-modal-surface');
            await expect(modal).toContainText('SQL History');
            await expect(modal.locator('pre')).toHaveText('select 11 as sidebar_probe');
            await expect(modal.getByText('success', { exact: true })).toBeVisible();
            await expect(modal.getByText('query', { exact: true })).toBeVisible();

            await modal.getByRole('button', { name: 'Close' }).click();
            await expect(modal).toHaveCount(0);
        } finally {
            await source.cleanup();
        }
    });
});
