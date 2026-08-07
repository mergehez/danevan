/**
 * Compiles Electron main/preload TypeScript files into dist-electron/
 * using Vite's SSR build (Rolldown under the hood).
 * The resulting CJS files are what electron-builder packages into
 * the app asar archive.
 */
import { resolve } from 'path';
import { build } from 'vite';

const __dirname = new URL('.', import.meta.url).pathname;
const projectRoot = resolve(__dirname, '..');
const distDir = resolve(projectRoot, 'dist-electron');

async function main() {
    // Main process — bundle everything for Node.js
    await build({
        root: projectRoot,
        base: './',
        build: {
            outDir: distDir,
            emptyOutDir: true,
            lib: {
                entry: resolve(projectRoot, 'src/electron/main.ts'),
                formats: ['cjs'],
                fileName: () => 'main.cjs',
            },
            rollupOptions: { external: [/node_modules/] },
            ssr: true,
            target: 'node22',
            minify: false,
        },
    });

    // Preload script — separate bundle with electron external
    await build({
        root: projectRoot,
        base: './',
        build: {
            outDir: distDir,
            emptyOutDir: false,
            lib: {
                entry: resolve(projectRoot, 'src/electron/preload.ts'),
                formats: ['cjs'],
                fileName: () => 'preload.cjs',
            },
            rollupOptions: { external: ['electron', /node_modules/] },
            ssr: true,
            target: 'node22',
            minify: false,
        },
    });

    console.log(`[build-electron] Compiled to ${distDir}`);
}

await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[build-electron] Failed: ${message}`);
    process.exit(1);
});
