import { defineConfig } from '@playwright/test';

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '3263', 10);

export default defineConfig({
    testDir: './src/mainview/tests/e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: 'html',
    timeout: 60_000,
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
