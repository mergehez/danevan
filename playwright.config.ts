import { defineConfig } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const APP_DB_FILES = ['danevan.sqlite', 'danevan.sqlite-wal', 'danevan.sqlite-shm'];

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '3263', 10);

/**
 * The browser suite gets its own app DB instead of the developer's real
 * `~/Library/Application Support/danevan`: the real one carries sources, scripts and a selected
 * connection from earlier sessions, which leaked into the assertions (a stale selection whose temp
 * SQLite file is gone made specs wait for a panel that never appeared), and writing to it is a side
 * effect on the machine. A run starts from an empty DB in the workspace — the app DB only, because
 * the same directory holds the provisioned SQLFluff and MS Access runtimes, which are downloads a
 * spec run must not throw away (the SQL formatter specs need them).
 *
 * `APP_DATA_DIR` also namespaces the keychain account names (`auth.ts`), so the test servers cannot
 * read — or delete — the passwords the real installation stored under the same low ids.
 */
function workspaceAppDataDir() {
    if (process.env.APP_DATA_DIR) {
        return process.env.APP_DATA_DIR;
    }

    const appDataDir = join(process.cwd(), '.e2e-data');
    mkdirSync(appDataDir, { recursive: true });

    for (const fileName of APP_DB_FILES) {
        rmSync(join(appDataDir, fileName), { force: true });
    }

    return appDataDir;
}

export default defineConfig({
    testDir: './src/mainview/tests/e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    // No retries: the suite is sleep-free and deterministic, so a retry would only hide
    // the flake it should be reporting. The slowest test runs in ~3s.
    retries: 0,
    workers: 1,
    // The skip guard fails a run that skipped a precondition, so green cannot mean "the
    // database specs did not execute".
    reporter: [['html'], ['./src/mainview/tests/e2e/failOnSkipReporter.ts']],
    timeout: 15_000,
    use: {
        baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
        trace: 'on-first-retry',
    },
    // The dev server hosts both: the renderer on FRONTEND_PORT and the backend
    // API (apiMethods) on the API port, mounted by the vite plugin.
    webServer: {
        command: 'bun run dev',
        port: FRONTEND_PORT,
        reuseExistingServer: !process.env.CI,
        cwd: process.cwd(),
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { APP_DATA_DIR: workspaceAppDataDir() },
    },
});
