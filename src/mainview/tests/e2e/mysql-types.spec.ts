// What the user reads in the grid has to be the value MySQL holds: a DECIMAL keeps every digit, a
// DATE/DATETIME keeps the day and time the server wrote (not an instant shifted into the host's zone),
// and a NULL is not the same cell as an empty string.
import { expect, test, type Page } from '@playwright/test';
import { API, MYSQL, createMySqlServerAndConnection, openMySqlTable, post, requireMySqlDatabase } from './helpers';

/** Opens the in-cell editor on a freshly opened table's first cell and returns what it shows. */
async function readFirstCell(page: Page, rowIndex = 0) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    await viewport.focus();

    for (let index = 0; index < rowIndex; index += 1) {
        await page.keyboard.press('ArrowDown');
    }

    await page.keyboard.press('Enter');

    const editor = page.locator(`textarea[data-editor-key="${rowIndex}:0"]`);
    await expect(editor).toBeVisible();

    const shown = { value: await editor.inputValue(), placeholder: await editor.getAttribute('placeholder') };
    await editor.press('Escape');

    return shown;
}

test.describe('MySQL value fidelity', () => {
    test('hands the grid the values MySQL holds, without rounding or shifting them', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'the MySQL type-fidelity spec');

        const source = await createMySqlServerAndConnection(request, MYSQL.database, 'types');
        const tables = {
            everything: `e2e_types_all_${Date.now()}`,
            amount: `e2e_types_amount_${Date.now()}`,
            happenedAt: `e2e_types_datetime_${Date.now()}`,
            dayOnly: `e2e_types_date_${Date.now()}`,
            note: `e2e_types_note_${Date.now()}`,
            payload: `e2e_types_json_${Date.now()}`,
        };

        async function run(sql: string) {
            await post(request, 'runQuery', { connectionId: source.connectionId, sql });
        }

        try {
            await run(`
                CREATE TABLE \`${tables.everything}\` (
                    id int NOT NULL,
                    amount decimal(12,4) NOT NULL,
                    happened_at datetime(3) NOT NULL,
                    stamped_at timestamp(3) NOT NULL,
                    day_only date NOT NULL,
                    payload json NOT NULL,
                    year_only year NOT NULL,
                    note varchar(20) NULL,
                    PRIMARY KEY (id)
                )
            `);
            await run(`
                INSERT INTO \`${tables.everything}\` VALUES
                    (1, 123456.7891, '2024-02-29 13:45:56.789', '2024-03-01 01:02:03.004', '2024-02-29', '{"a":1,"b":[2,3]}', 2021, ''),
                    (2, -0.0001, '1999-12-31 23:59:59.999', '2000-01-01 00:00:00.000', '2000-01-01', 'null', 1901, NULL)
            `);

            const data = (await post(request, 'getTableData', { connectionId: source.connectionId, tableName: tables.everything, limit: 50, offset: 0 })) as {
                rows: Array<Record<string, unknown>>;
            };

            // The values the API hands the grid, exactly as MySQL holds them. A JS Date would arrive
            // as an ISO instant (a `date` column then shows the day before) and a decimal as a float.
            expect(data.rows[0]).toEqual({
                id: 1,
                amount: '123456.7891',
                happened_at: '2024-02-29 13:45:56.789',
                stamped_at: '2024-03-01 01:02:03.004',
                day_only: '2024-02-29',
                // A JSON column arrives structured, which is what lets the editor prettify it.
                payload: { a: 1, b: [2, 3] },
                year_only: 2021,
                note: '',
            });
            expect(data.rows[1]).toMatchObject({
                id: 2,
                amount: '-0.0001',
                happened_at: '1999-12-31 23:59:59.999',
                day_only: '2000-01-01',
                year_only: 1901,
                note: null,
            });

            // The grid's editor shows the same text, on tables whose interesting column comes first,
            // so each read is the first cell of a table nothing else has selected in.
            for (const [tableName, definition, values] of [
                [tables.amount, 'amount decimal(12,4) NOT NULL', '(123456.7891)'],
                [tables.happenedAt, 'happened_at datetime(3) NOT NULL', "('2024-02-29 13:45:56.789')"],
                [tables.dayOnly, 'day_only date NOT NULL', "('2024-02-29')"],
                [tables.payload, 'payload json NOT NULL', `('{"a":1,"b":[2,3]}')`],
                [tables.note, 'note varchar(20) NULL', "(''), (NULL)"],
            ] as const) {
                const columnName = definition.split(' ')[0]!;
                await run(`CREATE TABLE \`${tableName}\` (${definition})`);
                await run(`INSERT INTO \`${tableName}\` (${columnName}) VALUES ${values}`);
            }

            await page.goto('/');

            const reads: Array<[tableName: string, rows: number, rowIndex: number, shown: { value: string; placeholder: string | null }]> = [
                [tables.amount, 1, 0, { value: '123456.7891', placeholder: null }],
                [tables.happenedAt, 1, 0, { value: '2024-02-29 13:45:56.789', placeholder: null }],
                [tables.dayOnly, 1, 0, { value: '2024-02-29', placeholder: null }],
                [tables.payload, 1, 0, { value: '{"a":1,"b":[2,3]}', placeholder: null }],
                [tables.note, 2, 0, { value: '', placeholder: null }],
                [tables.note, 2, 1, { value: '', placeholder: 'NULL' }],
            ];

            for (const [tableName, rows, rowIndex, shown] of reads) {
                await openMySqlTable(page, source, tableName);

                // The toolbar's range comes from the loaded page: waiting for it keeps the first
                // keystroke from landing while the grid is still filling in the table's columns.
                await expect(page.locator('#dbdatapanel').getByRole('button', { name: new RegExp(`^1-${rows} of ${rows}$`) })).toBeVisible();

                expect(await readFirstCell(page, rowIndex)).toEqual(shown);
            }
        } finally {
            for (const tableName of Object.values(tables)) {
                await request.post(`${API}/runQuery`, { data: { connectionId: source.connectionId, sql: `DROP TABLE IF EXISTS \`${tableName}\`` } }).catch(() => undefined);
            }

            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => undefined);
        }
    });
});
