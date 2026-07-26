/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import electronApiMethods from './vite-export-api-methods.ts';

export default defineConfig({
    plugins: [
        vue(),
        tailwindcss(),
        electronApiMethods,
        // Resolve monaco-editor deep imports that Rolldown can't resolve
        // due to the package's restrictive exports map.
        {
            name: 'monaco-resolve',
            resolveId(source) {
                const prefix = 'monaco-editor/esm/vs/';
                if (source.startsWith(prefix)) {
                    const filePath = resolve(__dirname, 'node_modules/monaco-editor/esm/vs/', source.slice(prefix.length));
                    const withExt = filePath.endsWith('.js') ? filePath : filePath + '.js';
                    if (existsSync(withExt)) {
                        return withExt;
                    }
                }
                return null;
            },
        },
    ],
    base: './',
    root: 'src/mainview',
    worker: {
        format: 'es',
    },
    resolve: {
        tsconfigPaths: true,
        alias: {
            '@directives': resolve(__dirname, './src/directives'),
            '@shared': resolve(__dirname, './src/shared'),
            '@ui': resolve(__dirname, './src/shared/components'),
            '@utils': resolve(__dirname, './src/shared/utils'),
            '@datagrid': resolve(__dirname, './src/datagrid'),
            '@backend': resolve(__dirname, './src/backend'),
            '@electron': resolve(__dirname, './src/electron'),
            '@lib': resolve(__dirname, './src/mainview/lib'),
        },
    },
    build: {
        outDir: '../../dist',
        emptyOutDir: true,
    },
    server: {
        host: '127.0.0.1',
        port: 3263,
        strictPort: true,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:3264',
                changeOrigin: true,
            },
        },
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['**/*.spec.ts'],
        exclude: ['**/e2e/**', '**/playwright/**'],
        setupFiles: ['./tests/setup.ts'],
    },
});
