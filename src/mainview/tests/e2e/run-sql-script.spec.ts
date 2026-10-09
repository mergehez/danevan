import { expect, test, type APIRequestContext } from '@playwright/test';
import { rmSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { API, MYSQL, createMySqlServerAndConnection, post, requireMySqlDatabase } from './helpers';

/** Polls a started run until it settles, collecting the streamed output. */
async function waitForRunToSettle(request: APIRequestContext, runId: string) {
    let offset = 0;
    let output = '';
    let status = 'running';
    let error: string | undefined;
    const deadline = Date.now() + 8_000;

    while (status === 'running' && Date.now() < deadline) {
        const snapshot = await post(request, 'getRunSqlScriptStatus', { runId, offset });
        output += snapshot.outputChunk;
        offset = snapshot.nextOffset;
        status = snapshot.status;
        error = snapshot.error;

        if (status === 'running') {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    return { status, output, error };
}

test.describe('Run SQL script', () => {
    test('startRunSqlScript executes a real SQL file and streams its output', async ({ page }) => {
        await requireMySqlDatabase(MYSQL.database, 'run-sql-script.spec.ts');

        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request, MYSQL.database, 'run-script');
        const suffix = Date.now().toString();
        const tableName = `e2e_run_script_${suffix}`;
        const scriptPath = `/tmp/e2e-run-sql-script-${suffix}.sql`;

        writeFileSync(
            scriptPath,
            [
                `DROP TABLE IF EXISTS ${tableName};`,
                `CREATE TABLE ${tableName} (id INT PRIMARY KEY, note VARCHAR(30));`,
                `INSERT INTO ${tableName} VALUES (1, 'ran from a file');`,
                `SELECT note FROM ${tableName};`,
                '',
            ].join('\n')
        );

        try {
            const defaults = await post(page.request, 'getRunSqlScriptDefaults', { connectionId, filePath: scriptPath });
            expect(defaults.scriptName).toBe(basename(scriptPath));
            expect(defaults.scriptSize).toBeGreaterThan(0);
            expect(defaults.database).toBe(MYSQL.database);
            expect(['client', 'driver']).toContain(defaults.runner);

            const { runId } = await post(page.request, 'startRunSqlScript', {
                connectionId,
                filePath: scriptPath,
                executable: defaults.executable,
            });
            expect(typeof runId).toBe('string');

            const run = await waitForRunToSettle(page.request, runId);
            expect(run.error).toBeUndefined();
            expect(run.status).toBe('succeeded');
            // The runner's own output is captured for the dialog: the mysql client
            // prints the selected row, the built-in driver prints the statements.
            expect(run.output.length).toBeGreaterThan(0);
            expect(run.output).toContain('ran from a file');

            // The script really ran: the table it created is now visible.
            const tables = await post(page.request, 'getTables', { connectionId });
            expect(tables.some((table: { name: string }) => table.name === tableName)).toBe(true);

            await page.request.post(`${API}/stopRunSqlScript`, { data: { runId } });
            const forgottenResp = await page.request.post(`${API}/getRunSqlScriptStatus`, { data: { runId, offset: 0 } });
            expect(forgottenResp.ok()).toBe(false);
        } finally {
            await page.request.post(`${API}/runQuery`, { data: { connectionId, sql: `DROP TABLE IF EXISTS ${tableName}` } }).catch(() => {});
            rmSync(scriptPath, { force: true });
            await page.request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    test('connection menu runs a picked SQL file and shows the finished alert', async ({ page }) => {
        await requireMySqlDatabase(MYSQL.database, 'run-sql-script.spec.ts');

        const { serverId, connectionId } = await createMySqlServerAndConnection(page.request, MYSQL.database, 'run-script');
        const suffix = Date.now().toString();
        const tableName = `e2e_run_script_ui_${suffix}`;
        const scriptPath = `/tmp/e2e-run-sql-script-ui-${suffix}.sql`;
        const sql = `CREATE TABLE ${tableName} (id INT PRIMARY KEY);\nDROP TABLE ${tableName};\n`;
        writeFileSync(scriptPath, sql);

        // The native open dialog cannot be shown by the browser dev server, so the
        // picker answers with the script we just wrote and everything else goes to the API.
        await page.addInitScript(({ api, pickedPath }: { api: string; pickedPath: string }) => {
            window.electronAPI = {
                invoke: (method: string, ...args: unknown[]) => {
                    if (method === 'pickDatabaseFile') {
                        return Promise.resolve(pickedPath);
                    }

                    const params = args[0];
                    return fetch(`${api}/${method}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: params !== undefined ? JSON.stringify(params) : undefined,
                    }).then(async (response) => {
                        const text = await response.text();
                        const body = text.trim() ? JSON.parse(text) : undefined;

                        if (!response.ok) {
                            throw new Error(body?.error || response.statusText);
                        }

                        return body;
                    });
                },
                onNativeCommand: () => () => {},
                sendDiagnostic: () => undefined,
            };
        }, { api: API, pickedPath: scriptPath });

        try {
            await page.goto('/');

            const serverRow = page.locator(`[data-node-id="server:${serverId}"]`);
            await expect(serverRow).toBeVisible();

            if ((await serverRow.getAttribute('data-sidebar-collapsed')) === 'true') {
                await serverRow.click();
            }

            const connectionRow = page.locator(`[data-node-id="connection:${connectionId}"]`);
            await expect(connectionRow).toBeVisible();

            await connectionRow.click({ button: 'right' });

            const menuItem = page.locator('.v-menu-item', { hasText: 'Run SQL script...' });
            await expect(menuItem).toBeVisible();
            await menuItem.click();

            // The confirmation dialog names the script, its size and the target database.
            const modal = page.locator('[data-testid="centered-modal-surface"]');
            await expect(modal).toBeVisible();
            await expect(modal).toContainText('Run SQL script');
            await expect(modal).toContainText(basename(scriptPath));
            await expect(modal).toContainText(`${Buffer.byteLength(sql)} B`);
            await expect(modal).toContainText(MYSQL.database);

            await page.screenshot({ path: 'test-results/run-sql-script-confirm.png', fullPage: true });

            await modal.getByRole('button', { name: 'Run script' }).click();

            // The dialog shows the run and then the finished alert.
            await expect(modal).toContainText('Script finished successfully');
            await page.screenshot({ path: 'test-results/run-sql-script-finished.png', fullPage: true });

            await modal.getByRole('button', { name: 'Close' }).click();
            await expect(modal).toBeHidden();
        } finally {
            await page.request.post(`${API}/runQuery`, { data: { connectionId, sql: `DROP TABLE IF EXISTS ${tableName}` } }).catch(() => {});
            rmSync(scriptPath, { force: true });
            await page.request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });
});
