import { execSync, spawnSync } from 'node:child_process';
export function handleScripts() {
    const action = process.argv[2];

    function runFile(filePath: string, args: string[] = []) {
        // execSync(`bun run ${filePath}`, args, { stdio: 'inherit', });
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
    }
}
