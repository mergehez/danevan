import { expect, test, type Locator, type Page } from '@playwright/test';
import { createFileSource, openSidebarTable, reloadSidebarRow } from './helpers';

/**
 * Short column names and short values keep every column at the 72px minimum
 * (`DATA_GRID_COLUMN_MIN_WIDTH`), so a cell's centre is `42 + 72 * column + 36`
 * after the 42px row-number gutter (`DATA_GRID_ROW_NUMBER_MIN_WIDTH`).
 */
const GUTTER_WIDTH = 42;
const COLUMN_WIDTH = 72;
const FIRST_ROW_Y = 46;
const ROW_HEIGHT = 25;

const FK_SCHEMA = `
    PRAGMA foreign_keys = ON;
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE pets (id INTEGER PRIMARY KEY, owner INTEGER REFERENCES people(id), pet TEXT NOT NULL);
    CREATE TABLE toys (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO people (id, name) VALUES (1, 'Ada'), (2, 'Grace');
    INSERT INTO pets (id, owner, pet) VALUES (1, 1, 'Rex'), (2, 1, 'Mia'), (3, 2, 'Bo'), (4, NULL, 'Solo');
    INSERT INTO toys (id, name) VALUES (1, 'Ball');
`;

type Source = Awaited<ReturnType<typeof createFileSource>>;

/** The main grid's viewport; every peek popover appends its own after it. */
function mainGrid(page: Page) {
    return page.getByTestId('data-grid-viewport').first();
}

/** Right-clicks one cell of the main grid and picks an entry from the cell menu. */
async function cellMenu(page: Page, columnIndex: number, rowIndex: number, item: string) {
    const box = await mainGrid(page).boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.click(box!.x + GUTTER_WIDTH + COLUMN_WIDTH * columnIndex + COLUMN_WIDTH / 2, box!.y + FIRST_ROW_Y + rowIndex * ROW_HEIGHT, {
        button: 'right',
    });

    const menuItem = page.getByRole('menuitem', { name: item });
    await expect(menuItem).toBeVisible();
    await menuItem.click();
}

async function openTable(page: Page, source: Source, tableName: string) {
    await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
    await openSidebarTable(page, source.connectionId, tableName);
}

/** The newest popover of the peek stack. */
function topPeek(page: Page) {
    return page.locator('[data-peek-popover-id]').last();
}

/** Waits for a peek popover to have its rows drawn, reporting the popover's own state meanwhile. */
async function waitForPeekRows(popover: Locator) {
    await expect
        .poll(
            async () => {
                if (await popover.getByTestId('peek-rows-loading').count()) {
                    return 'loading';
                }

                if (await popover.getByTestId('peek-rows-error').count()) {
                    return (await popover.getByTestId('peek-rows-error').innerText()).trim();
                }

                return (await popover.getByTestId('data-grid-viewport').count()) ? 'rows' : 'no popover grid';
            },
            { message: 'the peek popover should draw the rows it answered with' }
        )
        .toBe('rows');
}

/**
 * Reads one cell of the newest peek popover through its in-cell editor.
 * The peek grid is transposed (rows are the target table's columns, columns are
 * 'Column' plus one per matched row) and a fresh popover starts on `0:0`, so
 * walking right then down reaches `row:column`.
 *
 * The walk is repeated until the editor really opens: a key the grid is not ready for yet is
 * dropped, and an attempt that was ignored leaves the active cell where it started, so the next one
 * begins from the same place. Waiting a fixed time on the editor is what used to time out.
 */
async function openPeekEditor(page: Page, rowIndex: number, columnIndex: number) {
    const popover = topPeek(page);
    const editor = popover.locator(`textarea[data-editor-key="${rowIndex}:${columnIndex}"]`);

    await waitForPeekRows(popover);

    await expect
        .poll(
            async () => {
                await popover.getByTestId('data-grid-viewport').focus();

                for (let index = 0; index < columnIndex; index += 1) {
                    await page.keyboard.press('ArrowRight');
                }

                for (let index = 0; index < rowIndex; index += 1) {
                    await page.keyboard.press('ArrowDown');
                }

                await page.keyboard.press('Enter');

                return await editor.count();
            },
            { message: `the peek editor of cell ${rowIndex}:${columnIndex} should open` }
        )
        .toBe(1);

    return editor;
}

test.describe('Foreign-key peek', () => {
    test('opens the referenced row and says so when there is none', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'fk-peek', schema: FK_SCHEMA });

        try {
            await page.goto('/');
            await openTable(page, source, 'pets');

            // pets.owner -> people.id, opened on Rex (owner 1).
            await cellMenu(page, 1, 0, 'Peek Relation');

            const popover = topPeek(page);
            await expect(popover).toContainText('people');
            await expect(popover).toContainText('Matched by id');

            // The popover shows the referenced row: people.id = 1 is Ada.
            const editor = await openPeekEditor(page, 1, 1);
            await expect(editor).toHaveValue('Ada');
            await editor.press('Escape');

            // Clicking outside the peek closes it; Solo has no owner, so the next peek finds nothing.
            await cellMenu(page, 1, 3, 'Peek Relation');

            const missing = topPeek(page);
            await expect(missing).toContainText('Matched by id');
            // The popover opens transposed, and a transposed grid still lists the target
            // table's columns for an empty match; the plain view is where the empty state shows.
            await missing.locator('button:has(i[class*="mdi--swap-horizontal-bold"])').click();
            await expect(missing).toContainText('No related row found.');
        } finally {
            await source.cleanup();
        }
    });

    test('lists the referencing rows and shows what they point at', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'fk-usages', schema: FK_SCHEMA });

        try {
            await page.goto('/');
            await openTable(page, source, 'people');

            // Ada's primary key, which `pets.owner` references twice.
            await cellMenu(page, 0, 0, 'Peek Usages');

            const usages = topPeek(page);
            await expect(usages).toContainText('Peek Usages');
            // The popover names the value it was opened for.
            await expect(usages).toContainText('people.id = 1');
            await expect(usages).toContainText('pets-owner');
            await expect(usages).toContainText('2 rows');

            await usages.getByRole('button', { name: 'See rows' }).click();

            const rows = topPeek(page);
            await expect(rows).toContainText('pets');
            await expect(rows).toContainText('Matched by owner');

            // Two matched rows, transposed: row 2 is `pet`, column 1 is the first owner's row.
            const editor = await openPeekEditor(page, 2, 1);
            await expect(editor).toHaveValue('Rex');
        } finally {
            await source.cleanup();
        }
    });

    test('says when nothing references the cell', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'fk-no-usages', schema: FK_SCHEMA });

        try {
            await page.goto('/');
            await openTable(page, source, 'toys');

            // No table declares a foreign key into `toys`.
            await cellMenu(page, 0, 0, 'Peek Usages');

            await expect(topPeek(page)).toContainText('No foreign key usages found.');
        } finally {
            await source.cleanup();
        }
    });
});
