import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API, MYSQL, createFileSource, createMySqlServerAndConnection, expandSidebarRow, openSidebarTable, post, reloadSidebarRow, requireMySqlDatabase } from './helpers';

/** The row-number gutter, then the first body row and its height, as the canvas draws them. */
const ROW_HEADER_X = 20;
const FIRST_ROW_Y = 46;
const ROW_HEIGHT = 25;

const PEOPLE_SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, nickname TEXT, age INTEGER DEFAULT NULL);
    INSERT INTO people (name, nickname, age) VALUES ('Ada', 'the first', 36), ('Grace', 'the second', 45), ('Alan', 'the third', 41);
`;

/** Five rows, so deleting a range still has to leave the rows outside it untouched. */
const FIVE_PEOPLE_SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, nickname TEXT, age INTEGER DEFAULT NULL);
    INSERT INTO people (name, nickname, age) VALUES
        ('Ada', 'the first', 36),
        ('Grace', 'the second', 45),
        ('Alan', 'the third', 41),
        ('Edsger', 'the fourth', 72),
        ('Barbara', 'the fifth', 84);
`;

type Source = Awaited<ReturnType<typeof createFileSource>>;

async function peopleNames(request: APIRequestContext, connectionId: number) {
    const data = await post(request, 'getTableData', { connectionId, tableName: 'people', limit: 50, offset: 0 });

    return (data.rows as Array<{ name: string }>).map((row) => row.name).sort();
}

async function openPeopleTable(page: Page, source: Source) {
    await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
    await openSidebarTable(page, source.connectionId, 'people');
}

/** Opens the row menu from the row-number gutter and picks an entry. */
async function rowMenu(page: Page, rowIndex: number, item: string) {
    await openRowMenu(page, rowIndex);
    await page.getByRole('menuitem', { name: item }).click();
}

/** Right-clicks the row-number gutter, leaving the menu open for the caller to read. */
async function openRowMenu(page: Page, rowIndex: number) {
    const box = await page.getByTestId('data-grid-viewport').boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.click(box!.x + ROW_HEADER_X, box!.y + FIRST_ROW_Y + rowIndex * ROW_HEIGHT, { button: 'right' });
}

function rowHeaderPoint(page: Page, rowIndex: number) {
    return page
        .getByTestId('data-grid-viewport')
        .boundingBox()
        .then((box) => {
            expect(box).not.toBeNull();
            return { x: box!.x + ROW_HEADER_X, y: box!.y + FIRST_ROW_Y + rowIndex * ROW_HEIGHT };
        });
}

async function saveChanges(page: Page) {
    await page.getByTestId('save-bar-save').click();
}

type MySqlSource = Awaited<ReturnType<typeof createMySqlServerAndConnection>>;

/** Expands a MySQL server down to one of its tables and opens it. */
async function openMySqlTable(page: Page, source: MySqlSource, tableName: string) {
    await expandSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
    await expandSidebarRow(page.locator(`[data-node-id="connection:${source.connectionId}"]`));

    // Tables can sit behind a "tables" group; the collection filter can flatten them.
    const tablesCollection = page.locator(`[data-collection-kind="tables"][data-parent-id="connection:${source.connectionId}"]`);
    const tableRow = page.locator(`[data-node-id="table:${source.connectionId}:${tableName}"]`);

    // The table list arrives asynchronously once the connection expands.
    await expect(tablesCollection.or(tableRow).first()).toBeVisible({ timeout: 15_000 });

    if ((await tablesCollection.count()) > 0) {
        await expandSidebarRow(tablesCollection.first());
    }

    await openSidebarTable(page, source.connectionId, tableName);
}

/** Fills the Edit Row dialog and submits it, staging one change per edited column. */
async function editRow(page: Page, rowIndex: number, values: Record<string, string>) {
    await rowMenu(page, rowIndex, 'Edit Row');

    const form = page.getByTestId('edit-row-form');
    await expect(form).toBeVisible();

    for (const [columnName, value] of Object.entries(values)) {
        await form.getByTestId(`edit-row-value-${columnName}`).fill(value);
    }

    await form.getByTestId('edit-row-submit').click();
    await expect(form).toBeHidden();
}

test.describe('Row mutations', () => {
    test('deletes a row through the row menu and writes it only on save', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'row-delete', schema: PEOPLE_SCHEMA });

        try {
            await page.goto('/');
            await openPeopleTable(page, source);

            await rowMenu(page, 1, 'Delete Row');

            await expect(page.getByText('1 pending change')).toBeVisible();
            // Staged, not written: the row is still in the database.
            expect(await peopleNames(request, source.connectionId)).toEqual(['Ada', 'Alan', 'Grace']);

            await saveChanges(page);

            await expect.poll(() => peopleNames(request, source.connectionId)).toEqual(['Ada', 'Alan']);
        } finally {
            await source.cleanup();
        }
    });

    test('edits a row through the dialog, previews the statement and saves it', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'row-edit', schema: PEOPLE_SCHEMA });

        try {
            await page.goto('/');
            await openPeopleTable(page, source);

            await rowMenu(page, 0, 'Edit Row');

            const form = page.getByTestId('edit-row-form');
            await expect(form).toBeVisible();
            await expect(form.getByTestId('edit-row-value-name')).toHaveValue('Ada');
            await expect(form.getByTestId('edit-row-value-nickname')).toHaveValue('the first');

            await form.getByTestId('edit-row-value-name').fill('Ada Lovelace');
            await form.getByTestId('edit-row-submit').click();
            await expect(form).toBeHidden();

            await expect(page.getByText('1 pending change')).toBeVisible();

            // Preview names the statement before anything is written.
            await page.getByRole('button', { name: 'Preview', exact: true }).click();

            const preview = page.getByRole('dialog').filter({ hasText: 'Pending updates' });
            await expect(preview.locator('pre')).toContainText('UPDATE');
            await expect(preview.locator('pre')).toContainText('Ada Lovelace');

            await preview.getByRole('button', { name: 'Close' }).click();
            expect(await peopleNames(request, source.connectionId)).toEqual(['Ada', 'Alan', 'Grace']);

            await saveChanges(page);

            await expect.poll(() => peopleNames(request, source.connectionId)).toEqual(['Ada Lovelace', 'Alan', 'Grace']);
        } finally {
            await source.cleanup();
        }
    });

    test('duplicates a row without copying its primary key', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'row-duplicate', schema: PEOPLE_SCHEMA });

        try {
            await page.goto('/');
            await openPeopleTable(page, source);

            await rowMenu(page, 0, 'Duplicate Row');

            // Duplicate opens the add-row dialog pre-filled, so the copy can be adjusted first.
            const form = page.getByTestId('add-row-form');
            await expect(form).toBeVisible();
            await expect(form.getByTestId('add-row-value-name')).toHaveValue('Ada');
            await expect(form.getByTestId('add-row-value-nickname')).toHaveValue('the first');
            // The key is not copied: the database fills it for the new row.
            await expect(form.getByTestId('add-row-value-id')).toHaveValue('');

            await form.getByTestId('add-row-submit').click();
            await expect(form).toBeHidden();

            await expect(page.getByText('1 pending change')).toBeVisible();
            await saveChanges(page);

            await expect.poll(() => peopleNames(request, source.connectionId)).toEqual(['Ada', 'Ada', 'Alan', 'Grace']);

            const data = await post(request, 'getTableData', { connectionId: source.connectionId, tableName: 'people', limit: 50, offset: 0 });
            const copies = (data.rows as Array<{ id: number; name: string }>).filter((row) => row.name === 'Ada');

            // The duplicate needs its own key, or the insert would have collided with the original.
            expect(new Set(copies.map((row) => Number(row.id))).size).toBe(2);
        } finally {
            await source.cleanup();
        }
    });

    test('undoes and redoes a pending delete before saving it', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'row-history', schema: PEOPLE_SCHEMA });

        try {
            await page.goto('/');
            await openPeopleTable(page, source);

            await rowMenu(page, 1, 'Delete Row');
            await expect(page.getByText('1 pending change')).toBeVisible();

            await page.getByRole('button', { name: 'Undo', exact: true }).click();
            await expect(page.getByText('0 pending changes')).toBeVisible();

            await page.getByRole('button', { name: 'Redo', exact: true }).click();
            await expect(page.getByText('1 pending change')).toBeVisible();

            await saveChanges(page);

            await expect.poll(() => peopleNames(request, source.connectionId)).toEqual(['Ada', 'Alan']);
        } finally {
            await source.cleanup();
        }
    });

    test('deletes the whole selected range from the row menu', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'row-range-delete', schema: FIVE_PEOPLE_SCHEMA });

        try {
            await page.goto('/');
            await openPeopleTable(page, source);

            // Rows 1 to 3: a click on the gutter, then a shift-click to extend the range.
            const anchor = await rowHeaderPoint(page, 1);
            await page.mouse.click(anchor.x, anchor.y);

            const rangeEnd = await rowHeaderPoint(page, 3);
            await page.keyboard.down('Shift');
            await page.mouse.click(rangeEnd.x, rangeEnd.y);
            await page.keyboard.up('Shift');

            await openRowMenu(page, 2);

            // The menu counts the selection: three rows, not the one that was clicked.
            const deleteRows = page.getByRole('menuitem', { name: 'Delete 3 Rows' });
            await expect(deleteRows).toHaveText('Delete 3 Rows');
            await deleteRows.click();

            await expect(page.getByText('3 pending changes')).toBeVisible();
            // Staged, not written: all five rows are still in the database.
            expect(await peopleNames(request, source.connectionId)).toEqual(['Ada', 'Alan', 'Barbara', 'Edsger', 'Grace']);

            await saveChanges(page);

            // Exactly Grace, Alan and Edsger are gone.
            await expect.poll(() => peopleNames(request, source.connectionId)).toEqual(['Ada', 'Barbara']);
        } finally {
            await source.cleanup();
        }
    });
});

async function mysqlSource(request: APIRequestContext, label: string) {
    await requireMySqlDatabase(MYSQL.database, 'row-mutations.spec.ts');
    return await createMySqlServerAndConnection(request, MYSQL.database, label);
}

async function runSql(request: APIRequestContext, connectionId: number, sql: string) {
    await post(request, 'runQuery', { connectionId, sql });
}

test.describe('Row mutations on MySQL', () => {
    test('lists two pending updates in order and offers the FK check toggle', async ({ page, request }) => {
        const suffix = Date.now();
        const tableName = `e2e_pending_${suffix}`;
        const source = await mysqlSource(request, 'pending-preview');

        try {
            await runSql(request, source.connectionId, `CREATE TABLE \`${tableName}\` (id int NOT NULL, name varchar(50), age int, PRIMARY KEY (id))`);
            await runSql(request, source.connectionId, `INSERT INTO \`${tableName}\` VALUES (1, 'Ada', 36), (2, 'Grace', 45)`);

            await page.goto('/');
            await openMySqlTable(page, source, tableName);

            // Two different columns of the same row, in the table's column order.
            await editRow(page, 0, { name: 'Ada Lovelace', age: '37' });

            await expect(page.getByText('2 pending changes')).toBeVisible();
            // The save bar offers the MySQL foreign-key toggle.
            await expect(page.getByText('Disable FK checks', { exact: true })).toBeVisible();

            await page.getByRole('button', { name: 'Preview', exact: true }).click();

            const preview = page.getByRole('dialog').filter({ hasText: 'Pending updates' });
            await expect(preview).toBeVisible();
            await expect(preview.getByText('Disable foreign key checks')).toBeVisible();

            const statements = await preview.locator('pre').innerText();
            const nameStatement = `UPDATE \`${tableName}\` SET \`name\` = 'Ada Lovelace' WHERE \`id\` = 1;`;
            const ageStatement = `UPDATE \`${tableName}\` SET \`age\` = 37 WHERE \`id\` = 1;`;

            // Both statements, in the order the changes were made.
            expect(statements).toContain(nameStatement);
            expect(statements).toContain(ageStatement);
            expect(statements.indexOf(nameStatement)).toBeLessThan(statements.indexOf(ageStatement));

            await preview.getByRole('button', { name: 'Close' }).click();
            await expect(preview).toBeHidden();
        } finally {
            await request.post(`${API}/runQuery`, { data: { connectionId: source.connectionId, sql: `DROP TABLE IF EXISTS \`${tableName}\`` } }).catch(() => {});
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
        }
    });

    test('surfaces a foreign key violation instead of dropping the change', async ({ page, request }) => {
        const suffix = Date.now();
        const parentTable = `e2e_fk_parent_${suffix}`;
        const childTable = `e2e_fk_child_${suffix}`;
        const source = await mysqlSource(request, 'fk-violation');

        try {
            await runSql(request, source.connectionId, `CREATE TABLE \`${parentTable}\` (id int NOT NULL, PRIMARY KEY (id))`);
            await runSql(
                request,
                source.connectionId,
                `CREATE TABLE \`${childTable}\` (id int NOT NULL, parent_id int, name varchar(50), PRIMARY KEY (id),
                    CONSTRAINT \`fk_${suffix}\` FOREIGN KEY (parent_id) REFERENCES \`${parentTable}\` (id))`
            );
            await runSql(request, source.connectionId, `INSERT INTO \`${parentTable}\` VALUES (1)`);
            await runSql(request, source.connectionId, `INSERT INTO \`${childTable}\` VALUES (1, 1, 'kid')`);

            await page.goto('/');
            await openMySqlTable(page, source, childTable);

            // Point the row at a parent that does not exist, with FK checks turned off.
            await editRow(page, 0, { parent_id: '999' });
            await expect(page.getByText('1 pending change')).toBeVisible();

            await page.getByText('Disable FK checks', { exact: true }).click();
            await saveChanges(page);

            const issues = page.getByRole('dialog').filter({ hasText: 'Foreign key issues detected' });
            await expect(issues).toBeVisible();
            await expect(issues).toContainText(`The changes were saved with foreign key checks disabled, but the final validation found these issues.`);
            await expect(issues.getByText(`${childTable} has 1 foreign key violation for (parent_id) -> ${parentTable}(id).`)).toBeVisible();

            await issues.getByRole('button', { name: 'Close' }).click();
            await expect(issues).toBeHidden();

            // The change reached the database; it was reported, not dropped.
            const data = await post(request, 'getTableData', { connectionId: source.connectionId, tableName: childTable, limit: 50, offset: 0 });
            expect(data.rows.map((row: { parent_id: number }) => Number(row.parent_id))).toEqual([999]);
        } finally {
            await request.post(`${API}/runQuery`, { data: { connectionId: source.connectionId, sql: `DROP TABLE IF EXISTS \`${childTable}\`` } }).catch(() => {});
            await request.post(`${API}/runQuery`, { data: { connectionId: source.connectionId, sql: `DROP TABLE IF EXISTS \`${parentTable}\`` } }).catch(() => {});
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
        }
    });
});
