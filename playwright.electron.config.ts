import { defineConfig } from '@playwright/test';

// The Electron shell starts its own backend in-process (dist-electron/backend.cjs) on the
// port hard-coded in package.json `config.apiPort`, so it cannot share a run with the
// browser dev-server config: that one mounts the same API on the same port. Hence a second
// config with its own testDir and no webServer. Build first: `bun run test:e2e:electron`.
export default defineConfig({
    testDir: './src/mainview/tests/electron',
    // The packaged-app smoke test has its own config and needs `build/mac-arm64/Danevan.app`.
    testIgnore: '**/packaged.spec.ts',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    // Same rule as the browser config: the specs are sleep-free and deterministic, so a retry
    // would only hide the flake it should report.
    retries: 0,
    workers: 1,
    // The flow specs share the browser suite's `require*` preconditions, so the same rule applies:
    // a skipped precondition fails the run instead of reporting a shell that was never driven.
    reporter: [['html'], ['./src/mainview/tests/e2e/failOnSkipReporter.ts']],
    timeout: 10_000,
    use: {
        trace: 'on-first-retry',
    },
});
