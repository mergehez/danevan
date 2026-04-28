import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';

export default defineConfig({
    plugins: [vue(), tailwindcss()],
    pack: {
        dts: false,
        // dts: {
        //     tsgo: true,
        // },
        exports: true,
        // outDir: '../../dist/datagrid',
        clean: true,
        minify: false,
    },
    resolve: {
        tsconfigPaths: true,
    },
});
