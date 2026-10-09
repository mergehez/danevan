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
        exclude: [...configDefaults.exclude, '**/e2e/**', '**/playwright/**'],
        setupFiles: ['./src/mainview/tests/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text-summary', 'json-summary', 'html'],
            // Every source file counts, including the ones no spec imports yet, so the
            // percentage reflects the app rather than the tested subset.
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.spec.{ts,tsx}', 'src/**/*.d.ts', 'src/mainview/tests/**'],
            // Ratchets two points below today's numbers: they exist to catch a regression,
            // not to look good. Raise them as the gaps in TESTS-AUDIT.md get specs.
            thresholds: {
                statements: 33,
                branches: 26,
                functions: 31,
                lines: 34,
            },
        },
    },
});
