import { defineConfig } from '@playwright/test';

// The packaged-app smoke test. Separate from `playwright.electron.config.ts` for two reasons: it
// only runs when `build/mac-arm64/Danevan.app` exists (so the fast dev-shell run must not require a
// packaging step), and the packaged app binds the same hard-coded API port (3264) as the browser
// dev server, so it needs a run of its own. Build and run: `bun run test:e2e:packaged`.
export default defineConfig({
    testDir: './src/mainview/tests/electron',
    testMatch: '**/packaged.spec.ts',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,
    reporter: 'html',
    timeout: 10_000,
    use: {
        trace: 'on-first-retry',
    },
});
