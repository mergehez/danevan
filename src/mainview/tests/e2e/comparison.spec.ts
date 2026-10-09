import { expect, test, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createFileSource, openSidebarRowMenu, reloadSidebarRow } from './helpers';

/** The same table on both sides: one changed column type and one column only the source has. */
const SOURCE_SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, nickname TEXT);
    INSERT INTO people (id, name, nickname) VALUES (1, 'Ada', 'the first');
`;

const TARGET_SCHEMA = `
    CREATE TABLE people (id INTEGER PRIMARY KEY, name VARCHAR(50));
    INSERT INTO people (id, name) VALUES (1, 'Ada');
`;

function section(modal: Locator, title: string) {
    return modal.locator(`section:has(header:has-text("${title}"))`);
}

async function sectionRows(sectionLocator: Locator) {
    return sectionLocator.locator('tbody tr').evaluateAll((rows) => rows.map((row) => Array.from(row.querySelectorAll('td')).map((cell) => (cell.textContent ?? '').trim())));
}

/**
 * Picks an option from one of the modal's search list boxes by typing to filter it
 * and choosing the first match with the keyboard. Clicking an option blurs the
 * input, and the list reopens when `select()` refocuses it, which would leave the
 * list covering the toolbar.
 */
async function pickOption(modal: Locator, placeholder: string, query: string, expected: string) {
    const input = modal.getByRole('textbox', { name: placeholder });
    await input.click();
    await input.fill(query);
    await input.press('ArrowDown');
    await input.press('Enter');

    // The applied label is what the box shows once the choice is committed.
    await expect(input).toHaveValue(expected);
}

test.describe('Table comparison', () => {
    test('lists the differences, filters identical rows and exports the report', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'comparison-source', schema: SOURCE_SCHEMA });
        const target = await createFileSource(request, { label: 'comparison-target', schema: TARGET_SCHEMA });

        try {
            await page.goto('/');

            await reloadSidebarRow(page.locator(`[data-node-id="server:${source.serverId}"]`));

            const tableRow = page.locator(`[data-node-id="table:${source.connectionId}:people"]`);
            await openSidebarRowMenu(tableRow);

            const menuItem = page.locator('.v-menu-item', { hasText: 'Compare with...' });
            await expect(menuItem).toBeVisible();
            await menuItem.click();

            const modal = page.getByTestId('centered-modal-surface');
            await expect(modal).toContainText('Compare tables');

            // Both sides have to be read before anything can be compared.
            const targetLabel = `${target.connectionName} — ${target.serverName}`;
            await pickOption(modal, 'Choose database...', targetLabel, targetLabel);
            await pickOption(modal, 'Choose table...', 'people', 'people');

            await expect(modal).toContainText('2 differences');

            const columns = section(modal, 'Columns');
            await expect(columns.locator('header')).toContainText('2 differences');
            await expect
                .poll(() => sectionRows(columns))
                .toEqual([
                    // The type change, with each side's own type in its own column.
                    ['name', 'type', 'text', 'varchar(50)', 'changed'],
                    // Present in the source only, so it would have to be added to the target.
                    ['nickname', '', 'text', '—', 'added'],
                ]);

            // `Differences only` is on by default, which is what hid the identical `id`.
            // The control is an ARIA checkbox on a span; the native input stays unchecked.
            const differencesOnly = modal.locator('label', { hasText: 'Differences only' }).locator('[role="checkbox"]');
            await expect(differencesOnly).toHaveAttribute('aria-checked', 'true');
            await expect(columns.locator('tbody')).not.toContainText('id');

            await differencesOnly.click();
            await expect(differencesOnly).toHaveAttribute('aria-checked', 'false');

            // Now every matching attribute is listed, and the count is still two.
            await expect(columns.locator('header')).toContainText('2 differences');
            await expect.poll(() => sectionRows(columns)).toContainEqual(['id', '', 'integer', 'integer', 'identical']);
            await expect.poll(() => sectionRows(columns)).toContainEqual(['name', 'nullable', 'yes', 'yes', 'identical']);

            // A breaking change is counted and named.
            const breaking = modal.locator('button[aria-expanded]');
            await expect(breaking).toHaveText('1');
            await breaking.click();
            await expect(modal).toContainText('Breaking changes (1)');
            await expect(modal).toContainText('Column "people.name" type would change from text to varchar(50)');

            // Back to differences only, so the export carries exactly the differences.
            await differencesOnly.click();
            await expect(differencesOnly).toHaveAttribute('aria-checked', 'true');

            const [download] = await Promise.all([page.waitForEvent('download'), modal.locator('button:has(i[class*="mdi--download-outline"])').click()]);

            expect(download.suggestedFilename()).toBe('schema-comparison-people-vs-people.md');

            const markdown = readFileSync((await download.path())!, 'utf8');

            expect(markdown).toContain('# Table comparison');
            expect(markdown).toContain('## Breaking changes (1)');
            expect(markdown).toContain('- Column "people.name" type would change from text to varchar(50)');
            expect(markdown).toContain('## Columns');
            expect(markdown).toContain('| Column | Attribute | Source | Target | Status |');
            expect(markdown).toContain('| name | type | text | varchar(50) | changed |');
            expect(markdown).toContain('| nickname |  | text | — | added |');
            // Identical rows are filtered out of the report too.
            expect(markdown).not.toContain('| id |  | integer | integer | identical |');
        } finally {
            await target.cleanup();
            await source.cleanup();
        }
    });
});
