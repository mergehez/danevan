// A column formatter changes what every cell of that column displays, and the grid paints those
// cells to a canvas, so nothing the app renders proves it worked. The grid's search runs over the
// text it displays, which makes the search counter the visible proof: with a formatter assigned the
// raw value finds nothing and the formatted text finds the row. This spec drives the whole user
// path — create in the manager, assign from the column header, restart, delete — and reads every
// step back out of that counter.
import { expect, test, type Page } from '@playwright/test';
import { DATA_GRID_HEADER_HEIGHT } from '../../../datagrid/dataGrid';
import { createFileSource, gridCellPoint, menuItem, openFileTable, openSidebarTable, reloadSidebarRow } from './helpers';

const SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO people (id, name) VALUES (1, 'Ada'), (2, 'Grace');
`;

/** The worker compiles the template as `format(value)`, so it has to be a function. */
const LENGTH_TEMPLATE = 'function format(value) { return value.length + " chars"; }';

/** A cell measured once per table load: the grid's own re-renders make a fresh measurement drift. */
type Point = Awaited<ReturnType<typeof gridCellPoint>>;

function submenuItem(page: Page, label: string | RegExp) {
    return page.locator('.v-menu-children .v-menu-item', { hasText: label }).first();
}

/**
 * Opens the column header menu and its display-type submenu, which is where the formatters live.
 * The header sits directly above the measured cell, and focusing the submenu's parent keeps it open
 * (`:focus-within` as well as `:hover`) while the pointer moves onto a child item.
 */
async function openDisplayTypeSubmenu(page: Page, point: Point) {
    await page.mouse.click(point.x, point.viewportTop + DATA_GRID_HEADER_HEIGHT / 2, { button: 'right' });

    const parent = menuItem(page, 'Change Display Type');
    await expect(parent).toBeVisible();
    await parent.focus();
    await expect(submenuItem(page, 'Manage Formatters...')).toBeVisible();
}

async function openFormatterManager(page: Page, point: Point) {
    await openDisplayTypeSubmenu(page, point);
    await submenuItem(page, 'Manage Formatters...').press('Enter');

    const modal = page.getByTestId('centered-modal-surface');
    await expect(modal).toContainText('Custom Formatters');
    return modal;
}

async function assignFormatter(page: Page, point: Point, name: string) {
    await openDisplayTypeSubmenu(page, point);
    await submenuItem(page, name).press('Enter');
}

async function isFormatterChecked(page: Page, point: Point, name: string) {
    await openDisplayTypeSubmenu(page, point);
    const checked = await submenuItem(page, name)
        .locator('.v-menu-item-check')
        .isVisible()
        .catch(() => false);
    await page.keyboard.press('Escape');

    return checked;
}

/** The grid's search counter: how many rows the displayed text matches. */
async function searchCounter(page: Page) {
    const search = page.getByPlaceholder('Search grid');
    await search.fill('');
    await expect(search.locator('xpath=following-sibling::span[1]')).toHaveText('0/0');
    return search;
}

/** Closes the manager and waits for its overlay to leave, so the grid takes the next click. */
async function closeFormatterManager(modal: ReturnType<Page['getByTestId']>) {
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toHaveCount(0);
}

/** Creates a formatter through the manager, leaving the modal on it. */
async function createFormatter(page: Page, modal: ReturnType<Page['getByTestId']>, name: string, template: string) {
    await modal.getByRole('button', { name: 'New' }).click();
    await modal.locator('input').first().fill(name);

    // A paste inserts the template verbatim; typing it would be rewritten by Monaco's auto-closing
    // brackets and its format-on-type.
    await modal.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.evaluate((text) => navigator.clipboard.writeText(text), template);
    await page.keyboard.press('ControlOrMeta+v');

    await modal.getByRole('button', { name: 'Save Formatter' }).click();
}

test('formats a column through the manager and keeps it across a restart', async ({ page, request }) => {
    const source = await createFileSource(request, { label: 'grid-formatter', schema: SCHEMA });

    try {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await openFileTable(page, source, 'people');

        // Column 1 is `name`.
        const point = await gridCellPoint(page, 1);
        const search = await searchCounter(page);

        // Without a formatter the raw text is what the grid displays and searches.
        await search.fill('Ada');
        await expect(search.locator('xpath=following-sibling::span[1]')).toHaveText('1/1');
        await search.fill('');

        const modal = await openFormatterManager(page, point);
        await expect(modal).toContainText('No custom formatters saved yet.');

        await createFormatter(page, modal, 'Length', LENGTH_TEMPLATE);

        // The manager lists what was saved, with the template it will run.
        await expect(modal).toContainText('Length');
        await expect(modal).toContainText(LENGTH_TEMPLATE);
        await expect(modal).not.toContainText('No custom formatters saved yet.');
        await closeFormatterManager(modal);

        // Assigning it from the column header marks the item, and the displayed text becomes the
        // formatted one: `Ada` is no longer there, `3 chars` is.
        await assignFormatter(page, point, 'Length');
        await expect.poll(() => isFormatterChecked(page, point, 'Length')).toBe(true);

        await search.fill('Ada');
        await expect(search.locator('xpath=following-sibling::span[1]')).toHaveText('0/0');
        await expect(page.getByText('No matching rows.')).toBeVisible();

        await search.fill('3 chars');
        await expect(search.locator('xpath=following-sibling::span[1]')).toHaveText('1/1');
        await search.fill('');

        // A restart keeps both the formatter and the assignment of this table's column.
        await page.reload();
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
        await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));
        await openSidebarTable(page, source.connectionId, 'people');

        const afterRestart = await gridCellPoint(page, 1);
        const restartedSearch = await searchCounter(page);
        expect(await isFormatterChecked(page, afterRestart, 'Length')).toBe(true);

        await restartedSearch.fill('3 chars');
        await expect(restartedSearch.locator('xpath=following-sibling::span[1]')).toHaveText('1/1');
        await restartedSearch.fill('');

        const reopened = await openFormatterManager(page, afterRestart);
        await expect(reopened).toContainText('Length');

        // Deleting asks for confirmation, and the column falls back to the raw value.
        await reopened.getByRole('button', { name: 'Delete', exact: true }).click();

        const confirmation = page.getByRole('dialog').filter({ hasText: 'Confirmation required' });
        await expect(confirmation).toContainText('This will permanently delete Length.');
        await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(confirmation).toHaveCount(0);
        await expect(reopened).toContainText('No custom formatters saved yet.');
        await closeFormatterManager(reopened);

        await openDisplayTypeSubmenu(page, afterRestart);
        await expect(submenuItem(page, 'Length')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await restartedSearch.fill('Ada');
        await expect(restartedSearch.locator('xpath=following-sibling::span[1]')).toHaveText('1/1');
    } finally {
        await source.cleanup();
    }
});
