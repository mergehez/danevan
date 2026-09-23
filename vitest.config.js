import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [vue()],
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/**/*.spec.ts'],
        exclude: ['**/e2e/**', '**/playwright/**', '**/tests/integration/**', '**/node_modules/**'],
        setupFiles: ['./src/mainview/tests/setup.ts'],
    },
});
