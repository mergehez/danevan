// A table without a primary key has no WHERE clause that names a row. The grid used to fall back
// to the first column, so saving one edit overwrote every row sharing that value. The edit is now
// refused where the user made it, on a real MySQL table (the drivers that reach a server are the
// ones whose save is built from the staged change).
import { expect, test } from '@playwright/test';
import { API, MYSQL, createMySqlServerAndConnection, openMySqlTable, post, requireMySqlDatabase } from './helpers';

test.describe('Keyless table editing', () => {
    test('refuses the edit instead of overwriting every row that looks the same', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'keyless-table.spec.ts');

        const source = await createMySqlServerAndConnection(request, MYSQL.database, 'keyless');
        const tableName = `e2e_keyless_${Date.now()}`;
        // The table has no ORDER BY of its own, so what it holds is compared as a set of notes.
        const storedNotes = async () =>
            ((await post(request, 'getTableData', { connectionId: source.connectionId, tableName, limit: 50, offset: 0 })).rows as Array<{ name: string; note: string }>)
                .map((row) => row.note)
                .sort();

        try {
            await post(request, 'runQuery', {
                connectionId: source.connectionId,
                sql: `CREATE TABLE \`${tableName}\` (\`name\` varchar(50), \`note\` varchar(50)) ENGINE=InnoDB`,
            });
            await post(request, 'runQuery', {
                connectionId: source.connectionId,
                sql: `INSERT INTO \`${tableName}\` (\`name\`, \`note\`) VALUES ('ada', 'first'), ('ada', 'second')`,
            });

            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached' });
            await openMySqlTable(page, source, tableName);

            // Edit the `note` of the first row in place: focus the grid, open the cell editor, commit.
            const viewport = page.getByTestId('data-grid-viewport').first();
            await viewport.focus();
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('Enter');

            const cellEditor = page.locator('textarea[data-editor-key="0:1"]');
            await expect(cellEditor).toBeVisible();
            const storedNote = await cellEditor.inputValue();
            expect(['first', 'second']).toContain(storedNote);

            await cellEditor.fill('changed');
            await cellEditor.press('Enter');

            await expect(page.getByText(/Editing needs a primary key/)).toBeVisible();
            // Nothing was staged, so there is nothing to save and nothing to overwrite.
            await expect(page.getByText(/pending change/)).toHaveCount(0);
            await expect(page.getByTestId('save-bar-save')).toHaveCount(0);

            // The commit moved the active cell down one row; the refused value never reached row 0.
            await viewport.focus();
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press('Enter');
            await expect(page.locator('textarea[data-editor-key="0:1"]')).toHaveValue(storedNote);
            await page.keyboard.press('Escape');
            expect(await storedNotes()).toEqual(['first', 'second']);
        } finally {
            await request.post(`${API}/runQuery`, { data: { connectionId: source.connectionId, sql: `DROP TABLE IF EXISTS \`${tableName}\`` } }).catch(() => {});
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => {});
        }
    });
});
