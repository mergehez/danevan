// A database comparison reads every table's metadata on both sides. It used to be one request per
// table — 163 backend calls and ~650 `information_schema` queries on the developer's largest
// schema — so this spec asserts the request log, not only the numbers the modal shows.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, MYSQL, createMySqlServerAndConnection, expandSidebarRow, openSidebarRowMenu, post, requireFixtureData, requireMySqlDatabase } from './helpers';

/** The same three tables on both sides: one changed column type and one column only the source has. */
const SOURCE_TABLES = [
    'CREATE TABLE people (id bigint unsigned NOT NULL AUTO_INCREMENT, name varchar(200), nickname varchar(200), PRIMARY KEY (id)) ENGINE=InnoDB',
    'CREATE TABLE pets (id bigint unsigned NOT NULL AUTO_INCREMENT, species varchar(200), PRIMARY KEY (id)) ENGINE=InnoDB',
    'CREATE TABLE places (id bigint unsigned NOT NULL AUTO_INCREMENT, label varchar(200), PRIMARY KEY (id)) ENGINE=InnoDB',
];

const TARGET_TABLES = [
    'CREATE TABLE people (id bigint unsigned NOT NULL AUTO_INCREMENT, name varchar(50), PRIMARY KEY (id)) ENGINE=InnoDB',
    'CREATE TABLE pets (id bigint unsigned NOT NULL AUTO_INCREMENT, species varchar(200), PRIMARY KEY (id)) ENGINE=InnoDB',
    'CREATE TABLE places (id bigint unsigned NOT NULL AUTO_INCREMENT, label varchar(200), PRIMARY KEY (id)) ENGINE=InnoDB',
];

const SWEEP_METHODS = /\/api\/(getTableInfo|getTableInfos|refreshTableInfo)$/;

type Sweep = { method: string; connectionId?: number; tableNames?: string[] };

/** Creates the database with the same schema on its own connection, which `createDatabase` adds. */
async function createDatabaseWithSchema(request: APIRequestContext, serverId: number, databaseName: string, statements: string[]) {
    await post(request, 'createDatabase', { serverId, databaseName, collation: 'utf8mb4_unicode_ci' });

    const bootstrap = await post(request, 'getBootstrap', undefined);
    const connection = requireFixtureData(
        (bootstrap.connections as Array<{ id: number; server_id: number; database_name?: string; name: string }>).find(
            (entry) => entry.server_id === serverId && entry.database_name === databaseName
        ),
        `POST /api/createDatabase did not create a connection for "${databaseName}".`
    );

    for (const sql of statements) {
        await post(request, 'runQuery', { connectionId: connection.id, sql });
    }

    return connection;
}

test.describe('Metadata batching', () => {
    test('reads each compared database in one request instead of one per table', async ({ page, request }) => {
        await requireMySqlDatabase(MYSQL.database, 'metadata-batching.spec.ts');

        const suffix = Date.now();
        const sourceDatabase = `e2e_batch_src_${suffix}`;
        const targetDatabase = `e2e_batch_tgt_${suffix}`;
        const server = await createMySqlServerAndConnection(request, MYSQL.database, 'batch');

        try {
            const source = await createDatabaseWithSchema(request, server.serverId, sourceDatabase, SOURCE_TABLES);
            const target = await createDatabaseWithSchema(request, server.serverId, targetDatabase, TARGET_TABLES);

            const sweeps: Sweep[] = [];

            page.on('request', (req) => {
                const match = SWEEP_METHODS.exec(req.url());
                const body = req.postDataJSON() as { connectionId?: number; tableNames?: string[] } | null;

                if (match && req.method() === 'POST') {
                    sweeps.push({ method: match[1]!, connectionId: body?.connectionId, tableNames: body?.tableNames });
                }
            });

            await page.goto('/');
            await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

            await expandSidebarRow(page.locator(`[data-node-id="server:${server.serverId}"]`));

            // Whatever the sidebar loaded on its own is not part of the sweep under test.
            sweeps.length = 0;

            await openSidebarRowMenu(page.locator(`[data-node-id="connection:${source.id}"]`));
            await page.locator('.v-menu-item', { hasText: 'Compare database...' }).click();

            const modal = page.getByTestId('centered-modal-surface');
            await expect(modal).toContainText('Compare databases');

            // Both sides have to be read before anything can be compared.
            const targetLabel = `${target.name} — ${server.serverName}`;
            const targetInput = modal.getByRole('textbox', { name: 'Choose database...' });
            await targetInput.click();
            await targetInput.fill(targetLabel);
            await targetInput.press('ArrowDown');
            await targetInput.press('Enter');
            await expect(targetInput).toHaveValue(targetLabel);

            // The comparison itself is the visible half of the sweep.
            await expect(modal).toContainText('2 differences');

            expect(sweeps.filter((entry) => entry.method === 'getTableInfo' || entry.method === 'refreshTableInfo')).toEqual([]);

            const batches = sweeps.filter((entry) => entry.method === 'getTableInfos');
            expect(batches.map((entry) => ({ connectionId: entry.connectionId, tableNames: [...(entry.tableNames ?? [])].sort() }))).toEqual([
                { connectionId: source.id, tableNames: ['people', 'pets', 'places'] },
                { connectionId: target.id, tableNames: ['people', 'pets', 'places'] },
            ]);
        } finally {
            for (const databaseName of [sourceDatabase, targetDatabase]) {
                await request.post(`${API}/runQuery`, { data: { connectionId: server.connectionId, sql: `DROP DATABASE IF EXISTS \`${databaseName}\`` } }).catch(() => {});
            }

            await request.post(`${API}/deleteServer`, { data: { serverId: server.serverId } }).catch(() => {});
        }
    });
});
