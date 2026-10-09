// @vitest-environment node
// `findClientExecutable` shells out to prove a candidate actually runs, so the fixtures are
// real executable scripts in a temp dir rather than mocked fs/spawn calls.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findClientExecutable } from './clientExecutables.ts';

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
