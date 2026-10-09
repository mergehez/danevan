// @vitest-environment node
// `findClientExecutable` shells out to prove a candidate actually runs, so the fixtures are
// real executable scripts in a temp dir rather than mocked fs/spawn calls.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join, win32 } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findClientExecutable, getWindowsMysqlCandidatePaths, type ClientExecutableDeps } from './clientExecutables.ts';

const hasPosixShell = process.platform !== 'win32' && existsSync('/bin/sh');
const missingBinary = 'danegeh-client-that-does-not-exist-9f3c';

let rootDir = '';
let runnableClient = '';
let plainFile = '';
let scannedClient = '';

function writeScript(path: string, body: string, mode: number) {
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, mode);
}

describe.skipIf(!hasPosixShell)('findClientExecutable', () => {
    beforeAll(() => {
        rootDir = mkdtempSync(join(tmpdir(), 'danegeh-client-exec-'));

        runnableClient = join(rootDir, 'runnable-client');
        writeScript(runnableClient, 'echo "runnable-client 1.0"', 0o755);

        plainFile = join(rootDir, 'plain-client');
        writeFileSync(plainFile, 'not a script');
        chmodSync(plainFile, 0o644);

        scannedClient = join(rootDir, 'mysql-9.9', 'bin', 'scanned-client');
        mkdirSync(join(rootDir, 'mysql-9.9', 'bin'), { recursive: true });
        writeScript(scannedClient, 'echo "scanned-client 9.9"', 0o755);
    });

    afterAll(() => {
        rmSync(rootDir, { recursive: true, force: true });
    });

    it('returns the first candidate that really runs, skipping missing paths', async () => {
        const resolved = await findClientExecutable({
            commandName: missingBinary,
            candidatePaths: [join(rootDir, 'absent-client'), runnableClient],
            versionArgs: ['--version'],
        });

        expect(resolved).toBe(runnableClient);
    });

    it('skips a candidate that exists but cannot be executed', async () => {
        const resolved = await findClientExecutable({
            commandName: missingBinary,
            candidatePaths: [plainFile],
            versionArgs: ['--version'],
        });

        expect(resolved).toBeUndefined();
    });

    it('scans a versioned install directory for its bin/<command>', async () => {
        const resolved = await findClientExecutable({
            commandName: 'scanned-client',
            candidatePaths: [],
            scanDir: { dir: rootDir, prefix: 'mysql-' },
            versionArgs: ['--version'],
        });

        expect(resolved).toBe(scannedClient);
    });

    it('resolves a client that is already on PATH', async () => {
        const resolved = await findClientExecutable({
            commandName: 'sh',
            candidatePaths: [],
            versionArgs: ['-c', 'exit 0'],
        });

        expect(resolved).toBeDefined();
        expect(basename(resolved!)).toBe('sh');
        expect(existsSync(resolved!)).toBe(true);
    });

    it('returns undefined when no candidate exists', async () => {
        const resolved = await findClientExecutable({
            commandName: missingBinary,
            candidatePaths: [join(rootDir, 'absent-one'), join(rootDir, 'absent-two')],
            versionArgs: ['--version'],
        });

        expect(resolved).toBeUndefined();
    });
});

/**
 * The Windows branch runs on every platform: the lookup injects the process/fs boundary, so
 * `where.exe`, the `Program Files` candidates and the `.exe` suffix are asserted here even though
 * the real spawn can only happen on Windows.
 */
describe('findClientExecutable on Windows', () => {
    const whereResult = (stdout: string): [string, string, number | null] => [stdout, '', 0];

    function windowsDeps(overrides: Partial<ClientExecutableDeps> = {}): ClientExecutableDeps {
        return {
            platform: 'win32',
            exists: () => false,
            readdir: () => [],
            run: async () => ['', '', 0],
            ...overrides,
        };
    }

    it('asks where.exe instead of a POSIX shell', async () => {
        const commands: Array<{ command: string; args: string[] }> = [];
        const found = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe';

        const resolved = await findClientExecutable(
            { commandName: 'mysqldump', candidatePaths: [], versionArgs: ['--version'] },
            windowsDeps({
                exists: (path) => path === found,
                run: async (command, args) => {
                    commands.push({ command, args });
                    return whereResult(`${found}\r\n`);
                },
            })
        );

        expect(resolved).toBe(found);
        expect(commands).toEqual([
            { command: 'where.exe', args: ['mysqldump'] },
            { command: found, args: ['--version'] },
        ]);
    });

    it('falls through to the Program Files candidates when where.exe finds nothing', async () => {
        const existing = 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe';

        const resolved = await findClientExecutable(
            { commandName: 'mysqldump', candidatePaths: getWindowsMysqlCandidatePaths('mysqldump.exe'), versionArgs: ['--version'] },
            windowsDeps({
                exists: (path) => path === existing,
                run: async (command) => (command === 'where.exe' ? whereResult('INFO: Could not find files.\r\n') : ['', '', 0]),
            })
        );

        expect(resolved).toBe(existing);
    });

    it('scans a versioned install directory for bin/<command>.exe', async () => {
        const installRoot = process.env.ProgramFiles || 'C:\\Program Files';
        const scanned = win32.join(installRoot, 'MySQL Server 9.1', 'bin', 'mysqldump.exe');

        const resolved = await findClientExecutable(
            {
                commandName: 'mysqldump',
                candidatePaths: [],
                scanDir: { dir: installRoot, prefix: 'MySQL' },
                versionArgs: ['--version'],
            },
            windowsDeps({
                exists: (path) => path === scanned || path === installRoot,
                readdir: () => ['MySQL Server 9.1', 'Notepad'],
                run: async (command) => (command === 'where.exe' ? whereResult('') : ['', '', 0]),
            })
        );

        expect(resolved).toBe(scanned);
    });

    it('skips a candidate that cannot run', async () => {
        const broken = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe';

        const resolved = await findClientExecutable(
            { commandName: 'mysqldump', candidatePaths: getWindowsMysqlCandidatePaths('mysqldump.exe'), versionArgs: ['--version'] },
            windowsDeps({
                exists: (path) => path === broken,
                run: async (command) => {
                    if (command === 'where.exe') {
                        return whereResult('');
                    }

                    throw new Error('EACCES');
                },
            })
        );

        expect(resolved).toBeUndefined();
    });

    it('names the Windows candidates and their executable suffix', () => {
        const candidates = getWindowsMysqlCandidatePaths('mysql.exe');

        expect(candidates.every((path) => path.endsWith('mysql.exe'))).toBe(true);
        expect(candidates.some((path) => path.includes('MySQL Server 8.0'))).toBe(true);
        expect(candidates.some((path) => path.includes('MariaDB'))).toBe(true);
    });
});
