import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createFileSource, post } from './helpers';

/** The row-number gutter, then the first body row and its height, as the canvas draws them. */
const ROW_HEADER_X = 20;
const FIRST_ROW_Y = 46;
const ROW_HEIGHT = 25;

const PEOPLE_SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, nickname TEXT, age INTEGER DEFAULT NULL);
    INSERT INTO people (name, nickname, age) VALUES ('Ada', 'the first', 36), ('Grace', 'the second', 45), ('Alan', 'the third', 41);
`;

type Source = Awaited<ReturnType<typeof createFileSource>>;

async function peopleNames(request: APIRequestContext, connectionId: number) {
    const data = await post(request, 'getTableData', { connectionId, tableName: 'people', limit: 50, offset: 0 });

    return (data.rows as Array<{ name: string }>).map((row) => row.name).sort();
}

async function openPeopleTable(page: Page, source: Source) {
    const serverRow = page.locator(`[data-node-id="server:${source.serverId}"]`);
    await expect(serverRow).toBeVisible();

    if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'false') {
        await serverRow.locator('[data-sidebar-toggle-for]').click();
        await expect(serverRow).toHaveAttribute('data-sidebar-collapsed', 'true');
    }

    await serverRow.locator('[data-sidebar-toggle-for]').click();

    // A single click only toggles the row's details; the table opens on double click.
    const tableRow = page.locator(`[data-node-id="table:${source.connectionId}:people"]`);
    await expect(tableRow).toBeVisible();
    await tableRow.dblclick();

    await expect(page.getByTestId('data-grid-viewport')).toBeVisible();
}

/** Opens the row menu from the row-number gutter and picks an entry. */
async function rowMenu(page: Page, rowIndex: number, item: string) {
    const box = await page.getByTestId('data-grid-viewport').boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.click(box!.x + ROW_HEADER_X, box!.y + FIRST_ROW_Y + rowIndex * ROW_HEIGHT, { button: 'right' });

    await page.getByRole('menuitem', { name: item }).click();
}

async function saveChanges(page: Page) {
    await page.getByTestId('save-bar-save').click();
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
});
