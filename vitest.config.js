import vueTsx from '@vitejs/plugin-vue-jsx';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        vueTsx({
            defineComponentName: ['defineComponent', 'component', 'componentGeneric'],
        }),
    ],
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/**/*.spec.{ts,tsx}'],
        // Keep vitest's own defaults (dist, cache dirs) instead of replacing them wholesale.
        // Playwright owns the browser (`e2e`) and Electron (`tests/electron`) specs.
        exclude: [...configDefaults.exclude, '**/e2e/**', '**/playwright/**', '**/tests/electron/**'],
        setupFiles: ['./src/mainview/tests/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text-summary', 'json-summary', 'html'],
            // Every source file counts, including the ones no spec imports yet, so the
            // percentage reflects the app rather than the tested subset.
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.spec.{ts,tsx}', 'src/**/*.d.ts', 'src/mainview/tests/**'],
            // Ratchets at most one point below today's numbers: they exist to catch a
            // regression, not to look good. The per-area floors keep a gap from hiding behind
            // well-covered code once the aggregate average swallows it.
            thresholds: {
                statements: 42,
                branches: 35,
                functions: 41,
                lines: 43,
                'src/backend/**': { statements: 60, branches: 53, functions: 61, lines: 60 },
                'src/datagrid/**': { statements: 56, branches: 47, functions: 62, lines: 56 },
                'src/shared/**': { statements: 66, branches: 49, functions: 61, lines: 66 },
                'src/directives/**': { statements: 87, branches: 78, functions: 94, lines: 88 },
            },
        },
    },
});
