import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';
import { resolve } from 'path';

export default defineConfig({
    staged: {
        '*': 'vp check --fix',
    },

    plugins: [vue(), tailwindcss()],
    base: './',
    root: 'apps/app/mainview',
    resolve: {
        // tsconfigPaths: true,
        alias: {
            // "@directives/*": ["./packages/directives/src/*"],
            // "@directives": ["./packages/directives/src/index"],
            // "@shared/*": ["./packages/shared/src/*"],
            // "@ui/*": ["./packages/shared/src/components/*"],
            // "@utils/*": ["./packages/shared/src/utils/*"],
            // "@datagrid/*": ["./packages/datagrid/src/*"],
            // "@datagrid": ["./packages/datagrid/src/index"],
            // "@backend/*": ["./apps/app/backend/*"],
            // "@electrobun/*": ["./apps/app/electrobun/*"],
            // "@electrobun": ["./apps/app/electrobun/index"],
            // "@lib/*": ["./apps/app/mainview/lib/*"],
            // "@composables/*": ["./apps/app/mainview/composables/*"],
            // "@components/*": ["./apps/app/mainview/components/*"]
            // replacement: resolve(__dirname, './src/server/')

            '@directives': resolve(__dirname, './packages/directives/src'),
            '@shared': resolve(__dirname, './packages/shared/src'),
            '@ui': resolve(__dirname, './packages/shared/src/components'),
            '@utils': resolve(__dirname, './packages/shared/src/utils'),
            '@datagrid': resolve(__dirname, './packages/datagrid/src'),
            '@backend': resolve(__dirname, './apps/app/backend'),
            '@electrobun': resolve(__dirname, './apps/app/electrobun'),
            '@lib': resolve(__dirname, './apps/app/mainview/lib'),
            '@composables': resolve(__dirname, './apps/app/mainview/composables'),
            '@components': resolve(__dirname, './apps/app/mainview/components'),
        },
    },
    fmt: {
        semi: true,
        singleQuote: true,
        printWidth: 180,
        trailingComma: 'es5',
        tabWidth: 4,
        singleAttributePerLine: false,
        experimentalSortPackageJson: false,
        ignorePatterns: ['builder.html', 'assets/*'],
    },
    lint: {
        plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'vue', 'promise', 'node'],
        jsPlugins: [{ name: 'import-js', specifier: 'eslint-plugin-import' }],
        settings: {
            'import/resolver': {
                typescript: true,
                node: {
                    extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.d.ts', '.vue'],
                },
            },
        },
        rules: {
            'import-js/no-unresolved': ['error', { ignore: ['^bun:'] }],
            'no-floating-promises': 'allow',
            'no-unused-vars': 'off',
            'no-empty-file': 'off',
        },
        options: {
            typeCheck: true,
            typeAware: true,
        },
    },
    run: {
        cache: false,
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
        watch: {
            // ignored: ['**/sandbox/**'],
        },
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['../../../tests/**/*.spec.ts'],
        exclude: ['../../../tests/e2e/**'],
        setupFiles: ['../../../tests/setup.ts'],
    },
});
