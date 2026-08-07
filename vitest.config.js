import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['**/*.spec.ts'],
        exclude: ['**/e2e/**', '**/playwright/**'],
        setupFiles: ['./tests/setup.ts'],
    },
});
