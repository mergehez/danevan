import { expect, test, type Page } from '@playwright/test';
import { createFileSource, expectClipboardText, menuItem, openFileTable, post } from './helpers';

/**
 * A value typed over a selection (or a block pasted into it) is a bulk edit: every selected cell
 * takes it, the whole thing is one pending change set and one Undo step.
 */
const SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, active INTEGER);
    INSERT INTO people (id, name, active) VALUES
        (1, 'Ada', 1), (2, 'Grace', 1), (3, 'Alan', 1), (4, 'Edsger', 1), (5, 'Barbara', 1);
    CREATE TABLE target (id INTEGER PRIMARY KEY, name TEXT, active INTEGER);
    INSERT INTO target (id, name, active) VALUES
        (1, 'one', 0), (2, 'two', 0), (3, 'three', 0);
`;

function cell(page: Page, rowIndex: number, columnIndex: number) {
    return page.locator(`[data-grid-row="${rowIndex}"] [data-grid-cell="${columnIndex}"]`);
}

async function cellCenter(page: Page, rowIndex: number, columnIndex: number) {
    const box = (await cell(page, rowIndex, columnIndex).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags a rectangular selection from one cell to another, as the pointer layer does. */
async function selectCells(page: Page, from: { rowIndex: number; columnIndex: number }, to: { rowIndex: number; columnIndex: number }) {
    const start = await cellCenter(page, from.rowIndex, from.columnIndex);
    const end = await cellCenter(page, to.rowIndex, to.columnIndex);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
}

test.describe('Grid bulk edit', () => {
    test.beforeEach(async ({ page }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    });

    test('typing over a selection fills every selected cell and undoes as one step', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'grid-fill', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'people');

            // `active` is column 2. Select rows 0..3 of it and type `0`.
            await selectCells(page, { rowIndex: 0, columnIndex: 2 }, { rowIndex: 3, columnIndex: 2 });
            await page.keyboard.type('0');

            // Typing opens the editor on the selection; committing fills all four cells.
            await expect(page.locator('textarea[data-editor-key]')).toHaveValue('0');
            await page.keyboard.press('Enter');

            for (const rowIndex of [0, 1, 2, 3]) {
                await expect(cell(page, rowIndex, 2)).toHaveText('0');
            }

            // The untouched fifth row keeps its value.
            await expect(cell(page, 4, 2)).toHaveText('1');
            await expect(page.getByText('4 pending changes')).toBeVisible();

            // One Undo reverts the whole fill, not one cell of it.
            await page.locator('#dbdatapanel').getByRole('button', { name: 'Undo', exact: true }).click();
            for (const rowIndex of [0, 1, 2, 3]) {
                await expect(cell(page, rowIndex, 2)).toHaveText('1');
            }

            await expect(page.getByText('0 pending changes')).toBeVisible();

            // ...and Redo puts the whole fill back.
            await page.locator('#dbdatapanel').getByRole('button', { name: 'Redo', exact: true }).click();
            for (const rowIndex of [0, 1, 2, 3]) {
                await expect(cell(page, rowIndex, 2)).toHaveText('0');
            }

            // Saving writes every cell of the fill; the database is the judge of that.
            await page.getByTestId('save-bar-save').click();
            await expect(page.getByText(/pending change/)).toHaveCount(0);

            const afterSave = await post(request, 'getTableData', { connectionId: source.connectionId, tableName: 'people', limit: 50, offset: 0 });
            const activeValues = (afterSave.rows as Array<{ id: string; active: string }>).sort((left, right) => Number(left.id) - Number(right.id)).map((row) => row.active);

            expect(activeValues).toEqual(['0', '0', '0', '0', '1']);
        } finally {
            await source.cleanup();
        }
    });

    test('typing two characters appends them instead of replacing the first', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'grid-typing', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'people');

            // A single cell: the seeded editor must keep the caret after the first character.
            await cell(page, 0, 1).click();
            await page.keyboard.type('12');

            const editor = page.locator('textarea[data-editor-key="0:1"]');
            await expect(editor).toHaveValue('12');
            await editor.press('Enter');

            await expect(cell(page, 0, 1)).toHaveText('12');
            await expect(page.getByText('1 pending change')).toBeVisible();
        } finally {
            await source.cleanup();
        }
    });

    test('sets a whole selection to null from the cell menu', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'grid-menu-fill', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'people');

            // `name` is column 1: select two of its cells and set them to NULL from one menu.
            await selectCells(page, { rowIndex: 0, columnIndex: 1 }, { rowIndex: 1, columnIndex: 1 });
            const target = await cellCenter(page, 1, 1);
            await page.mouse.click(target.x, target.y, { button: 'right' });

            const parent = menuItem(page, 'Set Value');
            await expect(parent).toBeVisible();
            await parent.focus();
            await page.locator('.v-menu-children .v-menu-item', { hasText: '(null)' }).first().click();

            await expect(cell(page, 0, 1)).toHaveText('NULL');
            await expect(cell(page, 1, 1)).toHaveText('NULL');
            await expect(cell(page, 2, 1)).toHaveText('Alan');
            await expect(page.getByText('2 pending changes')).toBeVisible();
        } finally {
            await source.cleanup();
        }
    });

    test('pastes a copied block into another table', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'grid-paste', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'people');

            // Copy a 2×2 block: `name`/`active` of the first two rows.
            await selectCells(page, { rowIndex: 0, columnIndex: 1 }, { rowIndex: 1, columnIndex: 2 });
            await page.keyboard.press('Meta+C');
            await expectClipboardText(page, 'Ada\t1\nGrace\t1');

            // Paste it into the other table, starting at its first `name` cell.
            await openFileTable(page, source, 'target');
            await cell(page, 0, 1).click();
            await page.keyboard.press('Meta+V');

            await expect(cell(page, 0, 1)).toHaveText('Ada');
            await expect(cell(page, 0, 2)).toHaveText('1');
            await expect(cell(page, 1, 1)).toHaveText('Grace');
            await expect(cell(page, 1, 2)).toHaveText('1');
            await expect(cell(page, 2, 1)).toHaveText('three');
            await expect(page.getByText('4 pending changes')).toBeVisible();
        } finally {
            await source.cleanup();
        }
    });

    test('pastes a single value into the whole selection', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'grid-paste-fill', schema: SCHEMA });

        try {
            await openFileTable(page, source, 'people');

            // Copy one value, then fill a two-cell selection with it.
            await cell(page, 2, 1).click();
            await page.keyboard.press('Meta+C');
            await expectClipboardText(page, 'Alan');

            await selectCells(page, { rowIndex: 0, columnIndex: 1 }, { rowIndex: 1, columnIndex: 1 });
            await page.keyboard.press('Meta+V');

            await expect(cell(page, 0, 1)).toHaveText('Alan');
            await expect(cell(page, 1, 1)).toHaveText('Alan');
            await expect(cell(page, 2, 1)).toHaveText('Alan');
            await expect(page.getByText('2 pending changes')).toBeVisible();
        } finally {
            await source.cleanup();
        }
    });
});
