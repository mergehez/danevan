import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';
export default defineConfig({
    staged: {
        '*': 'vp check --fix',
    },

    plugins: [vue(), tailwindcss()],
    base: './',
    root: 'apps/app/mainview',
    resolve: {
        tsconfigPaths: true,
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
        port: 5173,
        strictPort: true,
        watch: {
            // ignored: ['**/sandbox/**'],
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['**/*.spec.ts'],
        setupFiles: ['./tests/setup.ts'],
    },
});
