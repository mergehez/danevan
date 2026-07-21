import { defineConfig } from '@playwright/test';

const BACKEND_PORT = parseInt(process.env.API_PORT || '3264', 10);
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '3263', 10);

export default defineConfig({
    testDir: './tests/e2e',
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
    webServer: [
        {
            command: `bun run apps/app/backend/devServer.ts`,
            port: BACKEND_PORT,
            reuseExistingServer: !process.env.CI,
            cwd: process.cwd(),
            timeout: 30_000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            command: `echo 'the dev server should already be running on port ${FRONTEND_PORT}'`,
            port: FRONTEND_PORT,
            reuseExistingServer: !process.env.CI,
            cwd: process.cwd(),
            timeout: 30_000,
            stdout: 'pipe',
            stderr: 'pipe',
            env: {
                VITE_DEV2: 'true',
            },
        },
    ],
});
