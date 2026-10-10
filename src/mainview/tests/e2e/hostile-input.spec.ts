// The values a real database holds are not the ones a fixture picks: reserved words as table and
// column names, quotes and statement separators inside text, CJK and emoji outside the BMP, binary
// columns, and triggers and views that watch the table. This spec drives those through the grid on
// both engines and reads every result back out of the database, because a hand-built INSERT that
// forgets to escape a quote, or a driver that round-trips text through the wrong encoding, fails
// nothing else.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { API, MYSQL, createFileSource, createMySqlServerAndConnection, openMySqlTable, post, reloadSidebarRow, requireMySqlDatabase } from './helpers';

/** Quotes, a statement separator, CJK, an emoji and a backslash: what an INSERT has to escape and
 *  what a UTF-8 driver has to carry without mangling. */
const HOSTILE_TEXT = `'; drop table "order"; -- 漢字 🚀 Ünïcødé \\ end`;
const HOSTILE_KEY = `Grace "the quoter" 🚀`;
const BLOB_HEX = '89504e470d0a1a0a00010203ff00';
const SEEDED_MULTILINE = 'Ünïcødé · €\n漢字 🚀';

/** A reserved table name and column, a trigger that records every update, a view over them. */
const HOSTILE_SQLITE_SCHEMA = `
    CREATE TABLE "order" (
        id INTEGER PRIMARY KEY,
        "select" TEXT NOT NULL,
        note TEXT NOT NULL,
        payload BLOB
    );
    CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, "order" INTEGER NOT NULL, action TEXT NOT NULL);
    CREATE TRIGGER order_audit AFTER UPDATE ON "order"
    BEGIN
        INSERT INTO audit ("order", action) VALUES (NEW.id, 'updated');
    END;
    CREATE VIEW order_view AS SELECT id, "select" AS selected, note FROM "order";
    INSERT INTO "order" (id, "select", note, payload) VALUES (1, 'Ada', 'O''Brien; -- drop table', x'${BLOB_HEX}');
`;

async function queryRows(request: APIRequestContext, connectionId: number, sql: string) {
    const result = await post(request, 'runQuery', { connectionId, sql });

    if (result.kind !== 'rows') {
        throw new Error(`Expected a rows result from: ${sql}`);
    }

    return result.rows as Array<Record<string, unknown>>;
}

type StoredRow = Record<string, unknown>;

async function storedRows(request: APIRequestContext, connectionId: number, tableName: string): Promise<StoredRow[]> {
    const data = await post(request, 'getTableData', { connectionId, tableName, limit: 50, offset: 0 });

    return (data.rows as StoredRow[]).slice().sort((left, right) => Number(left.id) - Number(right.id));
}

/** Reads a value the app wrote straight out of the file, past the app's own value mapping. */
function readSqliteCell(databasePath: string, sql: string) {
    const file = new Database(databasePath, { readonly: true });

    try {
        return file.prepare(sql).get() as Record<string, unknown>;
    } finally {
        file.close();
    }
}

/** Opens the in-cell editor on one cell, the way a user navigates to it. */
async function openCellEditor(page: Page, columnIndex: number, rowIndex = 0) {
    const viewport = page.getByTestId('data-grid-viewport').first();
    await viewport.focus();

    for (let index = 0; index < columnIndex; index += 1) {
        await page.keyboard.press('ArrowRight');
    }

    for (let index = 0; index < rowIndex; index += 1) {
        await page.keyboard.press('ArrowDown');
    }

    await page.keyboard.press('Enter');

    const editor = page.locator(`textarea[data-editor-key="${rowIndex}:${columnIndex}"]`);
    await expect(editor).toBeVisible();
    return editor;
}

async function editCell(page: Page, columnIndex: number, value: string, rowIndex = 0) {
    const editor = await openCellEditor(page, columnIndex, rowIndex);
    await editor.fill(value);
    await editor.press('Enter');
    await expect(page.getByText('1 pending change')).toBeVisible();
}

async function saveChanges(page: Page) {
    await page.getByTestId('save-bar-save').click();
    await expect(page.getByText(/pending change/)).toHaveCount(0);
}

/** A fresh load of the app, which is also what a user sees after reopening it. */
async function reloadApp(page: Page) {
    await page.reload();
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
}

async function openTable(page: Page, serverId: number, connectionId: number, tableName: string) {
    await reloadSidebarRow(page.locator(`[data-node-id="server:${serverId}"]`));

    const tableRow = page.locator(`[data-node-id="table:${connectionId}:${tableName}"]`);
    await expect(tableRow).toBeVisible();
    await tableRow.dispatchEvent('dblclick');
    await expect(page.getByTestId('data-grid-viewport').first()).toBeVisible();
}

test.describe('Hostile values on SQLite', () => {
    test('reads, edits and inserts around quotes, reserved words, CJK and a BLOB', async ({ page, request }) => {
        const source = await createFileSource(request, { label: 'hostile-sqlite', schema: HOSTILE_SQLITE_SCHEMA });

        try {
            // The second row carries a value no UI text field could type: a newline between a
            // combining-free latin/currency string and CJK with an emoji, inserted with parameters.
            const file = new Database(source.databasePath);
            file.prepare('INSERT INTO "order" (id, "select", note, payload) VALUES (?, ?, ?, NULL)').run(2, '漢字 🚀', SEEDED_MULTILINE);
            file.close();

            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await openTable(page, source.serverId, source.connectionId, 'order');

            // The rows the file holds survive the read, including the reserved column, the quote in
            // the text and the newline. (The SQLite driver reports integers as exact decimal text,
            // so the key is normalised before the comparison.)
            const seeded = (await storedRows(request, source.connectionId, 'order')).map((row) => ({ id: Number(row.id), select: row.select, note: row.note }));
            expect(seeded).toEqual([
                { id: 1, select: 'Ada', note: "O'Brien; -- drop table" },
                { id: 2, select: '漢字 🚀', note: SEEDED_MULTILINE },
            ]);

            await editCell(page, 2, HOSTILE_TEXT);
            await saveChanges(page);

            await expect.poll(async () => (await storedRows(request, source.connectionId, 'order'))[0]!.note).toBe(HOSTILE_TEXT);

            // The other columns of the row were not rewritten with it.
            const edited = (await storedRows(request, source.connectionId, 'order'))[0]!;
            expect(edited.select).toBe('Ada');

            // The binary column still holds exactly the bytes the file had.
            expect(readSqliteCell(source.databasePath, 'SELECT hex(payload) AS hex FROM "order" WHERE id = 1').hex).toBe(BLOB_HEX.toUpperCase());

            // The trigger fired once for that update, and the view reports the new text.
            expect(readSqliteCell(source.databasePath, 'SELECT count(*) AS count FROM audit').count).toBe(1);
            expect(await queryRows(request, source.connectionId, 'SELECT selected, note FROM order_view WHERE id = 1')).toEqual([{ selected: 'Ada', note: HOSTILE_TEXT }]);

            // The grid shows what was written, not a stale or formatted version of it.
            await reloadApp(page);
            await openTable(page, source.serverId, source.connectionId, 'order');
            const reopened = await openCellEditor(page, 2);
            await expect(reopened).toHaveValue(HOSTILE_TEXT);
            await reopened.press('Escape');
            await expect(page.getByText(/pending change/)).toHaveCount(0);

            // A new row goes through the app's own hand-built INSERT, which has to escape the quote,
            // the separator and the backslash in both text columns.
            await page.getByTestId('grid-add-row').click();
            const form = page.getByTestId('add-row-form');
            await form.getByTestId('add-row-value-id').fill('3');
            await form.getByTestId('add-row-value-select').fill(HOSTILE_KEY);
            await form.getByTestId('add-row-value-note').fill(HOSTILE_TEXT);
            await form.getByTestId('add-row-null-payload').click();
            await form.getByTestId('add-row-submit').click();
            await saveChanges(page);

            await expect.poll(async () => (await storedRows(request, source.connectionId, 'order')).length).toBe(3);

            const inserted = (await storedRows(request, source.connectionId, 'order'))[2]!;
            expect(inserted.select).toBe(HOSTILE_KEY);
            expect(inserted.note).toBe(HOSTILE_TEXT);
            expect(inserted.payload).toBeNull();

            // An insert is not an update: the trigger records nothing, and the view lists all rows.
            expect(readSqliteCell(source.databasePath, 'SELECT count(*) AS count FROM audit').count).toBe(1);
            expect((await queryRows(request, source.connectionId, 'SELECT id FROM order_view')).map((row) => Number(row.id))).toEqual([1, 2, 3]);
        } finally {
            await source.cleanup();
        }
    });
});

test.describe('Hostile values on MySQL', () => {
    test('reads, edits and refetches around reserved names, CJK and a BLOB', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'hostile-input.spec.ts');

        const suffix = Date.now();
        const tableName = `e2e_hostile_${suffix}`;
        const triggerName = `e2e_hostile_touch_${suffix}`;
        const viewName = `e2e_hostile_view_${suffix}`;
        const source = await createMySqlServerAndConnection(request, MYSQL.database, 'hostile');

        const dropObjects = async () => {
            await request.post(`${API}/runQuery`, { data: { connectionId: source.connectionId, sql: `DROP VIEW IF EXISTS \`${viewName}\`` } }).catch(() => {});
            await request.post(`${API}/runQuery`, { data: { connectionId: source.connectionId, sql: `DROP TRIGGER IF EXISTS \`${triggerName}\`` } }).catch(() => {});
            await request.post(`${API}/runQuery`, { data: { connectionId: source.connectionId, sql: `DROP TABLE IF EXISTS \`${tableName}\`` } }).catch(() => {});
        };

        try {
            // Reserved words as column names, binary-safe text, a trigger that stamps every update
            // and a view over the table.
            await post(request, 'runQuery', {
                connectionId: source.connectionId,
                sql: `CREATE TABLE \`${tableName}\` (
                    \`id\` int NOT NULL,
                    \`select\` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
                    \`order\` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
                    \`payload\` blob,
                    \`touched\` int NOT NULL DEFAULT 0,
                    PRIMARY KEY (\`id\`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            });
            await post(request, 'runQuery', {
                connectionId: source.connectionId,
                sql: `INSERT INTO \`${tableName}\` VALUES (1, 'Ada', 'O''Brien; -- drop table', UNHEX('${BLOB_HEX}'), 0)`,
            });
            await post(request, 'runQuery', {
                connectionId: source.connectionId,
                sql: `CREATE TRIGGER \`${triggerName}\` BEFORE UPDATE ON \`${tableName}\` FOR EACH ROW SET NEW.touched = OLD.touched + 1`,
            });
            await post(request, 'runQuery', {
                connectionId: source.connectionId,
                sql: `CREATE VIEW \`${viewName}\` AS SELECT \`id\`, \`select\`, \`order\` AS note FROM \`${tableName}\``,
            });

            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
            await openMySqlTable(page, source, tableName);

            const seeded = (await storedRows(request, source.connectionId, tableName)).map((row) => ({ id: Number(row.id), note: row.order }));
            expect(seeded).toEqual([{ id: 1, note: "O'Brien; -- drop table" }]);

            // `note` is the third column of the grid; the reserved names did not shift it.
            await editCell(page, 2, HOSTILE_TEXT);
            await saveChanges(page);

            await expect.poll(async () => (await storedRows(request, source.connectionId, tableName))[0]!.order).toBe(HOSTILE_TEXT);

            const edited = (await storedRows(request, source.connectionId, tableName))[0]!;
            expect(edited.select).toBe('Ada');
            // The trigger the user defined ran on the app's own UPDATE.
            expect(edited.touched).toBe(1);

            // The binary column still holds exactly the bytes that were inserted.
            expect(await queryRows(request, source.connectionId, `SELECT hex(payload) AS hex FROM \`${tableName}\` WHERE id = 1`)).toEqual([{ hex: BLOB_HEX.toUpperCase() }]);
            expect(await queryRows(request, source.connectionId, `SELECT note FROM \`${viewName}\` WHERE id = 1`)).toEqual([{ note: HOSTILE_TEXT }]);

            await reloadApp(page);
            await openMySqlTable(page, source, tableName);
            const reopened = await openCellEditor(page, 2);
            await expect(reopened).toHaveValue(HOSTILE_TEXT);
            await reopened.press('Escape');
        } finally {
            await dropObjects();
            await request.post(`${API}/deleteServer`, { data: { serverId: source.serverId } }).catch(() => undefined);
        }
    });
});
