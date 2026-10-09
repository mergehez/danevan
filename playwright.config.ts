import { defineConfig } from '@playwright/test';

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '3263', 10);

export default defineConfig({
    testDir: './src/mainview/tests/e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    // No retries: the suite is sleep-free and deterministic, so a retry would only hide
    // the flake it should be reporting. The slowest test runs in ~3s.
    retries: 0,
    workers: 1,
    reporter: 'html',
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
    },
});
