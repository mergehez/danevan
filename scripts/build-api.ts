/**
 * Build script for a standalone binary that serves both the frontend and API.
 *
 * 1. Builds the Vue frontend (vp build)
 * 2. Cross-compiles standaloneServer.ts into a single .exe with all assets embedded
 *
 * The resulting binary needs nothing else — no IIS, no node_modules, just run it.
 *
 * Usage:  bun run scripts/build-api.ts
 * Env:    BUILD_API_OUTPUT  output directory (default: build/api)
 *         BUILD_TARGET      cross-compile target (default: bun-windows-arm64)
 *         NODE_ENV          set to "production" during build
 */

import { execSync } from 'child_process';
import { rm } from 'fs/promises';
import { join } from 'path';

const projectRoot = new URL('..', import.meta.url).pathname;
const entryPoint = join(projectRoot, 'apps/app/backend/standaloneServer.ts');
const outDir = join(projectRoot, process.env.BUILD_API_OUTPUT || 'build/api');
const outPath = join(outDir, 'danevan-api.exe');
const target = process.env.BUILD_TARGET || 'bun-windows-x64';

await rm(outDir, { recursive: true, force: true }).catch(() => {});

// Step 1: Build the Vue frontend
console.log(`[build-api] Building frontend…`);
const frontendResult = Bun.spawnSync(['bun', 'run', 'vp', 'build'], {
    cwd: projectRoot,
    stdio: ['inherit', 'inherit', 'inherit'],
});

if (frontendResult.exitCode !== 0) {
    process.exit(frontendResult.exitCode);
}

// Strip modulepreload links from dist HTML — Bun's route processor leaves them
// as-is, causing "text/plain" MIME errors when the browser fetches them.
const distHtmlPath = join(projectRoot, 'apps/app/mainview/dist/index.html');
const distHtml = Bun.file(distHtmlPath);
const cleaned = (await distHtml.text()).replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');
await Bun.write(distHtmlPath, cleaned);

// Inject build timestamp into db-app.ts before compiling
const dbAppPath = join(projectRoot, 'apps/app/backend/db-app.ts');
const dbAppContent = await Bun.file(dbAppPath).text();
const timestamped = dbAppContent.replace(/(console\.log\(`App built at: )[\dT:.-]+Z(`\))/, `$1${new Date().toISOString()}$2`);
const needsRestore = timestamped !== dbAppContent;
if (needsRestore) {
    await Bun.write(dbAppPath, timestamped);
}

// Step 2: Compile standalone binary (embeds frontend assets via HTML import)
console.log(`[build-api] Compiling standalone binary…`);
console.log(`[build-api]   Entry:  ${entryPoint}`);
console.log(`[build-api]   Target: ${target}`);
console.log(`[build-api]   Output: ${outPath}`);

const compileResult = Bun.spawnSync(['bun', 'build', '--compile', '--target', target, '--outfile', outPath, entryPoint], {
    cwd: projectRoot,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
});

if (compileResult.exitCode !== 0) {
    process.exit(compileResult.exitCode);
}

console.log(`[build-api] Done: ${outPath}`);
console.log(`[build-api] Run with: ${outPath}`);

execSync('cp build/api/danevan-api.exe /Users/mazlum/Documents/Code/DotNet/GitHub/danevan/danevan-api.exe', { stdio: 'inherit' });
