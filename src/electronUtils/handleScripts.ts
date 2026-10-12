import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
export function handleScripts() {
    const action = process.argv[2];

    function runFile(filePath: string, args: string[] = []) {
        // `perf` is the one task whose script is app-specific, so a project without it says so
        // instead of failing inside `bun run`.
        if (!existsSync(filePath)) {
            console.error(`No ${filePath} in this project, so the "${action}" task has nothing to run.`);
            process.exitCode = 1;
            return;
        }

        spawnSync('bun', ['run', filePath, ...args], { stdio: 'inherit' });
    }
    const args = process.argv.slice(3);

    switch (action) {
        case 'release':
        case 'mac':
            runFile('src/electronUtils/releaseHelpers.ts', args);
            break;
        case 'audit':
            execSync('bash src/electronUtils/release-audit.sh', { stdio: 'inherit' });
            break;
        case 'perf':
            runFile('scripts/perfBaseline.ts', args);
            break;
    }
}
