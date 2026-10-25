import { expect, test, type Page } from '@playwright/test';
import { API, MYSQL, openModifyTablePopup, post } from './helpers';

function tableDdl(tableName: string) {
    return `CREATE TABLE \`${tableName}\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`name\` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  \`path\` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  \`description\` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`foo_user_id\` bigint unsigned DEFAULT NULL,
  \`height\` int unsigned NOT NULL DEFAULT 0,
  \`width\` int unsigned NOT NULL DEFAULT 0,
  \`size\` int unsigned NOT NULL DEFAULT 0,
  \`last_synced_at\` bigint unsigned DEFAULT NULL,
  \`created_at\` bigint unsigned NOT NULL DEFAULT 0,
  \`created_by\` bigint unsigned NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`caps_path_unique\` (\`path\`),
  KEY \`caps_created_by_foreign\` (\`created_by\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

async function setColumnType(page: Page, value: string) {
    await columnTypeInput(page).fill(value);
    await columnTypeInput(page).press('Enter');
}
function columnsGroup(page: Page) {
    return page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="columns"]');
}

function columnItem(page: Page, name: string) {
    return page.locator(`[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="${name}"]`);
}

function columnTypeInput(page: Page) {
    return page.locator('[data-testid="modify-column-type"] input');
}

async function dragColumnOnto(page: Page, sourceName: string, targetName: string) {
    const source = await columnItem(page, sourceName).boundingBox();
    const target = await columnItem(page, targetName).boundingBox();
    if (!source || !target) throw new Error(`Column row not found: ${sourceName} or ${targetName}`);

    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 25 });

    // The dragover handler marks the drop target; wait for it instead of a fixed pause.
    await expect(columnItem(page, targetName)).toHaveClass(/ring-1/);
    await page.mouse.up();
}
test.describe('Modify table popup (e2e)', () => {
    let serverId = -1;
    let connectionId = -1;
    let tableName = '';

    test.beforeAll(async ({ request }) => {
        const suffix = Date.now().toString();
        const serverName = `e2e-mod-${suffix}`;
        const serverBootstrap = await post(request, 'createServer', {
            name: serverName,
            kind: 'server',
            driver: 'mysql',
            filePath: undefined,
            host: MYSQL.host,
            port: MYSQL.port,
            username: MYSQL.username,
            password: MYSQL.password,
        });
        const server = serverBootstrap.servers.find((entry: { name: string }) => entry.name === serverName);
        serverId = server.id;

        const connectionBootstrap = await post(request, 'createConnection', {
            serverId,
            name: `e2e-mod-conn-${suffix}`,
            host: MYSQL.host,
            port: MYSQL.port,
            databaseName: MYSQL.database,
            readonly: false,
        });
        const connection = connectionBootstrap.connections.find((entry: { server_id: number }) => entry.server_id === serverId);
        connectionId = connection.id;
    });

    test.beforeEach(async ({ request }) => {
        tableName = `caps_e2e_${Date.now()}`;
        await post(request, 'runQuery', { connectionId, sql: tableDdl(tableName) });
    });

    test.afterEach(async ({ request }) => {
        if (tableName) {
            await request.post(`${API}/runQuery`, { data: { connectionId, sql: `DROP TABLE IF EXISTS \`${tableName}\`` } }).catch(() => {});
        }
    });

    test.afterAll(async ({ request }) => {
        if (serverId > 0) {
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('opens the Modify Table popup and shows the columns', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await expect(columnItem(page, 'id')).toBeVisible();
        await expect(columnItem(page, 'name')).toBeVisible();
        await expect(columnItem(page, 'path')).toBeVisible();
    });

    test('adds a column through the popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        // Select the "columns" group, then add a new column.
        await columnsGroup(page).click();
        await page.locator('[data-testid="modify-add"]').click();

        await page.locator('[data-testid="modify-column-name"]').fill('test_column');
        await setColumnType(page, 'int');
        await page.locator('[data-testid="modify-apply"]').click();

        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.columns.some((c: any) => c.name === 'test_column')).toBe(true);
    });

    test('changes a column type through the popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await columnsGroup(page).click();
        await columnItem(page, 'name').click();
        await setColumnType(page, 'varchar(500)');
        await page.locator('[data-testid="modify-apply"]').click();

        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        const name = info.columns.find((c: any) => c.name === 'name');
        expect(name.type.toLowerCase()).toContain('varchar(500)');
    });

    test('offers undo and redo while a draft change is pending', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await columnsGroup(page).click();
        await columnItem(page, 'name').click();

        const originalType = await columnTypeInput(page).inputValue();
        expect(originalType).toBe('varchar(200)');
        await expect(page.getByText('No change yet', { exact: true })).toBeVisible();

        await setColumnType(page, 'varchar(500)');
        await expect(columnTypeInput(page)).toHaveValue('varchar(500)');
        await expect(page.getByText('1 statement', { exact: true })).toBeVisible();

        // Both buttons are offered while there is history to walk.
        await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

        // Undo has to bring the draft field back, not just the stored history: the field is what
        // the user is looking at, and the preview has to follow it.
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect(page.getByText('No change yet', { exact: true })).toBeVisible();
        await expect(columnTypeInput(page)).toHaveValue('varchar(200)');

        // Redo re-applies it; nothing reaches the database until Apply.
        await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
        await page.getByRole('button', { name: 'Redo' }).click();
        await expect(columnTypeInput(page)).toHaveValue('varchar(500)');
        await expect(page.getByText('1 statement', { exact: true })).toBeVisible();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.columns.find((c: any) => c.name === 'name').type.toLowerCase()).toContain('varchar(200)');
    });

    test('moves a column down once through the popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        // Select the "columns" group, then the "name" column and move it down once.
        await columnsGroup(page).click();
        await columnItem(page, 'name').click();
        await page.locator('[data-testid="modify-move-down"]').click();
        await page.locator('[data-testid="modify-apply"]').click();

        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        const order = info.columns.map((c: any) => c.name);
        expect(order.indexOf('name')).toBe(order.indexOf('path') + 1);
    });

    test('drags two columns to the front through the popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        // Drag `size`, then `height`, above `id`. The second move has to be applied
        // against the order the first one leaves behind.
        const columnOrder = () =>
            page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"]').evaluateAll((items) => items.map((item) => item.getAttribute('data-nav-title')));

        await dragColumnOnto(page, 'size', 'id');
        await expect.poll(columnOrder).toEqual(['size', 'id', 'name', 'path', 'description', 'foo_user_id', 'height', 'width', 'last_synced_at', 'created_at', 'created_by']);

        await dragColumnOnto(page, 'height', 'id');
        await expect.poll(columnOrder).toEqual(['size', 'height', 'id', 'name', 'path', 'description', 'foo_user_id', 'width', 'last_synced_at', 'created_at', 'created_by']);

        await page.locator('[data-testid="modify-apply"]').click();

        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.columns.map((c: any) => c.name)).toEqual([
            'size',
            'height',
            'id',
            'name',
            'path',
            'description',
            'foo_user_id',
            'width',
            'last_synced_at',
            'created_at',
            'created_by',
        ]);
    });

    test('detects an edit to an existing index and applies it', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="indexes"]').click();
        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="index"][data-nav-title="caps_created_by_foreign"]').click();

        await expect(page.getByText('No change yet', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-index-comment"]').fill('caps comment');

        await expect(page.getByText('2 statements', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.indexes.find((index: any) => index.name === 'caps_created_by_foreign').comment).toBe('caps comment');
    });

    test('detects a change to an index column order', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="indexes"]').click();
        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="index"][data-nav-title="caps_created_by_foreign"]').click();

        await expect(page.getByText('No change yet', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-index-column-order"] select').selectOption('DESC');
        await expect(page.getByText('2 statements', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.indexes.find((index: any) => index.name === 'caps_created_by_foreign').orders).toEqual(['DESC']);
    });

    test('detects an added index', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="indexes"]').click();
        await expect(page.getByText('No change yet', { exact: true })).toBeVisible();
        await page.locator('[data-testid="modify-add"]').click();

        await expect(page.getByText('1 statement', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.indexes.some((index: any) => index.name === `IX_${tableName}_id`)).toBe(true);
    });

    test('detects a deleted index', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="indexes"]').click();
        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="index"][data-nav-title="caps_created_by_foreign"]').click();
        await page.locator('[data-testid="modify-delete"]').click();
        await page.locator('[data-testid="centered-modal-surface"]').getByRole('button', { name: 'Delete' }).click();

        await expect(page.getByText('1 statement', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.indexes.some((index: any) => index.name === 'caps_created_by_foreign')).toBe(false);
    });

    test('detects a column change on an index', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="indexes"]').click();
        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="index"][data-nav-title="caps_created_by_foreign"]').click();

        await expect(page.getByText('No change yet', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-index-column-name"] select').selectOption('size');

        // The field the change came from is marked, like every other edited field in the form.
        await expect(page.getByText('Column Name', { exact: true })).toHaveClass(/text-amber-300/);
        await expect(page.getByText('2 statements', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.indexes.find((index: any) => index.name === 'caps_created_by_foreign').columns).toEqual(['size']);
    });

    test('lists a unique index only under keys, where editing and deleting it works', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        // A unique index is a key; a copy under "indexes" would silently ignore every edit.
        const navItem = (kind: string, title: string) => page.locator(`[data-testid="modify-nav-item"][data-nav-kind="${kind}"][data-nav-title="${title}"]`);
        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="indexes"]').click();
        await expect(navItem('index', 'caps_created_by_foreign')).toBeVisible();
        await expect(navItem('index', 'caps_path_unique')).toHaveCount(0);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="keys"]').click();
        await expect(navItem('key', 'caps_path_unique')).toBeVisible();

        await navItem('key', 'caps_path_unique').click();
        await page.locator('[data-testid="modify-key-column-name"] select').selectOption('name');
        await expect(page.getByText('Column Name', { exact: true })).toHaveClass(/text-amber-300/);
        await expect(page.getByText('2 statements', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.indexes.find((index: any) => index.name === 'caps_path_unique').columns).toEqual(['name']);
    });

    test('detects deleting a unique index from the keys group', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="keys"]').click();
        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="key"][data-nav-title="caps_path_unique"]').click();
        await page.locator('[data-testid="modify-delete"]').click();
        await page.locator('[data-testid="centered-modal-surface"]').getByRole('button', { name: 'Delete' }).click();

        await expect(page.getByText('1 statement', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.indexes.some((index: any) => index.name === 'caps_path_unique')).toBe(false);
    });

    test('detects an added unique key', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="keys"]').click();
        await expect(page.getByText('No change yet', { exact: true })).toBeVisible();
        await page.locator('[data-testid="modify-add"]').click();

        await expect(page.getByText('1 statement', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        const key = info.indexes.find((index: any) => index.name === 'new_key');
        expect([key?.isUnique, key?.columns]).toEqual([true, ['id']]);
    });

    test('detects a new index made unique from the indexes group', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="indexes"]').click();
        await page.locator('[data-testid="modify-add"]').click();
        await page.locator('[data-testid="centered-modal-surface"] label').filter({ hasText: 'Unique' }).click();
        await expect(page.getByText('1 statement', { exact: true })).toBeVisible();

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        const index = info.indexes.find((entry: any) => entry.name === `IX_${tableName}_id`);
        expect([index?.isUnique, index?.columns]).toEqual([true, ['id']]);
    });

    test('offers the item menu on a right click: new, duplicate, edit, delete and revert', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        const columnItem = page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="name"]');
        await columnItem.click({ button: 'right' });

        const menu = page.locator('.v-menu-panel').first();
        await expect(menu.getByRole('menuitem', { name: 'New' })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
        await expect(menu.getByText('⌘D')).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Revert' })).toBeDisabled();

        // New is a submenu with the four entity kinds.
        await menu.getByRole('menuitem', { name: 'New' }).hover();
        const newMenu = page.locator('.v-menu-children .v-menu-panel').first();
        for (const label of ['Column', 'Unique Key', 'Foreign Key', 'Index']) {
            await expect(newMenu.getByRole('menuitem', { name: label })).toBeVisible();
        }

        // Picking one adds it to the draft, on the row that was right-clicked (`name`), like the
        // toolbar's + does on the first column.
        await newMenu.getByRole('menuitem', { name: 'Index' }).click();
        await expect(page.locator(`[data-testid="modify-nav-item"][data-nav-kind="index"][data-nav-title="IX_${tableName}_name"]`)).toBeVisible();
        await expect(page.getByText('1 statement', { exact: true })).toBeVisible();
    });

    test('duplicates, edits and reverts the right-clicked item from its menu', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        const columnItem = page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="name"]');
        await columnItem.click({ button: 'right' });
        await page.locator('.v-menu-panel').first().getByRole('menuitem', { name: 'Duplicate' }).click();

        const copyItem = page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="name_copy"]');
        await expect(copyItem).toBeVisible();
        await expect(page.getByText('1 statement', { exact: true })).toBeVisible();

        // Edit selects the item and puts the caret in its first field.
        await copyItem.click({ button: 'right' });
        await page.locator('.v-menu-panel').first().getByRole('menuitem', { name: 'Edit' }).click();
        await expect(page.locator('[data-testid="modify-column-name"]')).toBeFocused();
        await expect(page.locator('[data-testid="modify-column-name"]')).toHaveValue('name_copy');

        // Revert (the menu's undo) takes the duplicate back out.
        await copyItem.click({ button: 'right' });
        await page.locator('.v-menu-panel').first().getByRole('menuitem', { name: 'Revert' }).click();
        await expect(copyItem).toHaveCount(0);
        await expect(page.getByText('No change yet', { exact: true })).toBeVisible();
    });

    test('deletes the right-clicked item from its menu', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="description"]').click({ button: 'right' });
        await page.locator('.v-menu-panel').first().getByRole('menuitem', { name: 'Delete' }).click();
        await page.locator('[data-testid="centered-modal-surface"]').getByRole('button', { name: 'Delete' }).click();

        // The row is struck through and labelled removed; the plan carries the drop.
        await expect(page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="description"]')).toContainText('removed');
        await expect(page.getByText('1 statement', { exact: true })).toBeVisible();
    });

    test('honours the item menu shortcuts: duplicate, edit, revert and delete', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="name"]').click();
        await page.keyboard.press('Control+d');

        const copyItem = page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="name_copy"]');
        await expect(copyItem).toBeVisible();

        await page.keyboard.press('Control+z');
        await expect(copyItem).toHaveCount(0);
        await expect(page.getByText('No change yet', { exact: true })).toBeVisible();

        await page.keyboard.press('Control+ArrowDown');
        await expect(page.locator('[data-testid="modify-column-name"]')).toBeFocused();

        // Backspace is the menu's delete, with the same confirmation.
        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="description"]').click();
        await page.keyboard.press('Backspace');
        await page.locator('[data-testid="centered-modal-surface"]').getByRole('button', { name: 'Delete' }).click();
        await expect(page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="description"]')).toContainText('removed');
    });

    test('auto-names a new index and follows its columns until a name is typed', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="indexes"]').click();
        await page.locator('[data-testid="modify-add"]').click();

        const name = page.locator('[data-testid="modify-index-name"]');
        await expect(name).toHaveValue(`IX_${tableName}_id`);

        // The generated name follows the column the index covers.
        await page.locator('[data-testid="modify-index-column-name"] select').selectOption('size');
        await expect(name).toHaveValue(`IX_${tableName}_size`);

        // A name the user typed wins over the generator.
        await name.fill('my_index');
        await page.locator('[data-testid="modify-index-column-name"] select').selectOption('height');
        await expect(name).toHaveValue('my_index');

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.indexes.find((index: any) => index.name === 'my_index')?.columns).toEqual(['height']);
    });

    test('auto-names a new foreign key from its column and target table', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="group"][data-group-kind="foreign-keys"]').click();
        await page.locator('[data-testid="modify-add"]').click();

        const name = page.locator('[data-testid="modify-foreign-key-name"]');
        await expect(name).toHaveValue(`FK_${tableName}_id`);

        await page.locator('[data-testid="modify-foreign-key-target"] select').selectOption('users');
        await expect(name).toHaveValue(`FK_${tableName}_id_users`);

        await page.locator('[data-testid="modify-foreign-key-column"] select').selectOption('foo_user_id');
        await expect(name).toHaveValue(`FK_${tableName}_foo_user_id_users`);

        await page.locator('[data-testid="modify-apply"]').click();
        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        const foreignKey = info.foreignKeys.find((entry: any) => entry.name === `FK_${tableName}_foo_user_id_users`);
        expect([foreignKey?.table, foreignKey?.from]).toEqual(['users', 'foo_user_id']);
    });

    test('starts a foreign key from the right-clicked column, with its target and cascade', async ({ page }) => {
        // `user_id` names the table it points at; `created_by` is NOT NULL.
        await post(page.request, 'runQuery', { connectionId, sql: `ALTER TABLE \`${tableName}\` ADD COLUMN \`user_id\` bigint unsigned DEFAULT NULL` });

        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        const navItem = (title: string) => page.locator(`[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="${title}"]`);
        await navItem('user_id').click({ button: 'right' });
        await page.locator('.v-menu-panel').first().getByRole('menuitem', { name: 'New' }).hover();
        await page.locator('.v-menu-children .v-menu-panel').first().getByRole('menuitem', { name: 'Foreign Key' }).click();

        await expect(page.locator('[data-testid="modify-foreign-key-column"] select')).toHaveValue('user_id');
        await expect(page.locator('[data-testid="modify-foreign-key-target"] select')).toHaveValue('users');
        await expect(page.locator('[data-testid="modify-foreign-key-name"]')).toHaveValue(`FK_${tableName}_user_id_users`);
        // `users` is the only table that fits, so there is nothing to suggest.
        await expect(page.locator('[data-testid="modify-foreign-key-suggestions"]')).toBeHidden();
        // The column is nullable, so the reference keeps the database's "no action".
        await expect(page.locator('[data-testid="modify-foreign-key-on-delete"] select')).toHaveValue('no_action');

        // A `_by` column belongs to whoever did it (users), and a NOT NULL column cascades.
        await navItem('created_by').click({ button: 'right' });
        await page.locator('.v-menu-panel').first().getByRole('menuitem', { name: 'New' }).hover();
        await page.locator('.v-menu-children .v-menu-panel').first().getByRole('menuitem', { name: 'Foreign Key' }).click();

        await expect(page.locator('[data-testid="modify-foreign-key-column"] select')).toHaveValue('created_by');
        await expect(page.locator('[data-testid="modify-foreign-key-target"] select')).toHaveValue('users');
        await expect(page.locator('[data-testid="modify-foreign-key-on-delete"] select')).toHaveValue('cascade');
        await expect(page.locator('[data-testid="modify-foreign-key-name"]')).toHaveValue(`FK_${tableName}_created_by_users`);
    });

    test('points person and reference columns at their table, parent at the same table', async ({ page, request }) => {
        // `receiverId` is a person (`users`), `imdbId` its own table, `parent_id` this table.
        await post(request, 'runQuery', {
            connectionId,
            sql: `ALTER TABLE \`${tableName}\` ADD COLUMN \`receiverId\` bigint unsigned DEFAULT NULL, ADD COLUMN \`userID\` bigint unsigned DEFAULT NULL, ADD COLUMN \`imdb_id\` bigint unsigned DEFAULT NULL, ADD COLUMN \`parent_id\` bigint unsigned DEFAULT NULL, ADD COLUMN \`createdBy\` bigint unsigned DEFAULT NULL`,
        });
        await post(request, 'runQuery', { connectionId, sql: 'CREATE TABLE IF NOT EXISTS `imdbs` (id bigint unsigned NOT NULL, PRIMARY KEY (id))' });

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await openModifyTablePopup(page, { serverId, connectionId }, tableName);

            const navItem = (title: string) => page.locator(`[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="${title}"]`);
            async function addForeignKeyFrom(title: string) {
                await navItem(title).click({ button: 'right' });
                await page.locator('.v-menu-panel').first().getByRole('menuitem', { name: 'New' }).hover();
                await page.locator('.v-menu-children .v-menu-panel').first().getByRole('menuitem', { name: 'Foreign Key' }).click();
            }

            // A camel-case person column, an `imdbs` reference, a self reference and a camel `_by`.
            await addForeignKeyFrom('receiverId');
            await expect(page.locator('[data-testid="modify-foreign-key-target"] select')).toHaveValue('users');

            // An all-caps suffix is still camel case (`userID`), unlike `createDBy`.
            await addForeignKeyFrom('userID');
            await expect(page.locator('[data-testid="modify-foreign-key-target"] select')).toHaveValue('users');

            await addForeignKeyFrom('imdb_id');
            await expect(page.locator('[data-testid="modify-foreign-key-target"] select')).toHaveValue('imdbs');

            await addForeignKeyFrom('parent_id');
            await expect(page.locator('[data-testid="modify-foreign-key-target"] select')).toHaveValue(tableName);

            await addForeignKeyFrom('createdBy');
            await expect(page.locator('[data-testid="modify-foreign-key-target"] select')).toHaveValue('users');
        } finally {
            await request.post(`${API}/runQuery`, { data: { connectionId, sql: 'DROP TABLE IF EXISTS `imdbs`' } }).catch(() => {});
        }
    });

    test('suggests the tables a reference column might point at, most probable first', async ({ page, request }) => {
        // Three tables end with `products`, and the edited table is next to none of them.
        // Short names: the generated foreign-key name has to stay inside MySQL's 64 characters.
        const candidates = ['bla_products', 'bla_bla_products', 'shop_products'];
        await post(page.request, 'runQuery', {
            connectionId,
            sql: `ALTER TABLE \`${tableName}\` ADD COLUMN \`product_id\` bigint unsigned DEFAULT NULL`,
        });

        for (const candidate of candidates) {
            await post(page.request, 'runQuery', { connectionId, sql: `CREATE TABLE IF NOT EXISTS \`${candidate}\` (id bigint unsigned NOT NULL, PRIMARY KEY (id))` });
        }

        try {
            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await openModifyTablePopup(page, { serverId, connectionId }, tableName);

            await page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="product_id"]').click({ button: 'right' });
            await page.locator('.v-menu-panel').first().getByRole('menuitem', { name: 'New' }).hover();
            await page.locator('.v-menu-children .v-menu-panel').first().getByRole('menuitem', { name: 'Foreign Key' }).click();

            // No single table is the best fit, so the dialog asks: the target stays empty and every
            // candidate is offered, shortest (most generic) name first.
            await expect(page.locator('[data-testid="modify-foreign-key-target"] select')).toHaveValue('');
            await expect(page.locator('[data-testid="modify-foreign-key-suggestions"] button')).toHaveText(['bla_products', 'shop_products', 'bla_bla_products']);

            // Choosing one fills the target, its column and the generated name.
            await page.locator('[data-testid="modify-foreign-key-suggestion-shop_products"]').click();
            await expect(page.locator('[data-testid="modify-foreign-key-target"] select')).toHaveValue('shop_products');
            await expect(page.locator('[data-testid="modify-foreign-key-name"]')).toHaveValue(`FK_${tableName}_product_id_shop_products`);
            // The chosen table is no longer offered as a suggestion.
            await expect(page.locator('[data-testid="modify-foreign-key-suggestions"] button')).toHaveText(['bla_products', 'bla_bla_products']);

            await page.locator('[data-testid="modify-apply"]').click();
            await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

            const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
            const foreignKey = info.foreignKeys.find((entry: any) => entry.name === `FK_${tableName}_product_id_shop_products`);
            expect([foreignKey?.table, foreignKey?.from]).toEqual(['shop_products', 'product_id']);
        } finally {
            for (const candidate of candidates) {
                await request.post(`${API}/runQuery`, { data: { connectionId, sql: `DROP TABLE IF EXISTS \`${candidate}\`` } }).catch(() => {});
            }
        }
    });

    test('starts an index from the right-clicked column', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await page.locator('[data-testid="modify-nav-item"][data-nav-kind="column"][data-nav-title="path"]').click({ button: 'right' });
        await page.locator('.v-menu-panel').first().getByRole('menuitem', { name: 'New' }).hover();
        await page.locator('.v-menu-children .v-menu-panel').first().getByRole('menuitem', { name: 'Index' }).click();

        await expect(page.locator('[data-testid="modify-index-column-name"] select')).toHaveValue('path');
        await expect(page.locator('[data-testid="modify-index-name"]')).toHaveValue(`IX_${tableName}_path`);
    });

    test('deletes a column through the popup', async ({ page }) => {
        // Seed the table with a column to delete.
        await post(page.request, 'runQuery', {
            connectionId,
            sql: `ALTER TABLE \`${tableName}\` ADD COLUMN \`test_column\` int NULL`,
        });

        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        await openModifyTablePopup(page, { serverId, connectionId }, tableName);

        await columnsGroup(page).click();
        await columnItem(page, 'test_column').click();
        await page.locator('[data-testid="modify-delete"]').click();

        // Deleting a column asks for confirmation.
        await page.locator('[data-testid="centered-modal-surface"]').getByRole('button', { name: 'Delete' }).click();
        await page.locator('[data-testid="modify-apply"]').click();

        await expect(page.locator('[data-testid="modify-apply"]')).toBeHidden();

        const info = await post(page.request, 'getTableInfo', { connectionId, tableName });
        expect(info.columns.some((c: any) => c.name === 'test_column')).toBe(false);
    });
});
