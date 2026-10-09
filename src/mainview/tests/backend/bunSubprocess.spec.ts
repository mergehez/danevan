// @vitest-environment node
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { executeCommandToFile } from '../../../backend/bunSubprocess.ts';

const isPosixShell = process.platform !== 'win32' && existsSync('/bin/sh');

function createTempDir() {
    return mkdtempSync(join(tmpdir(), 'danegeh-subprocess-'));
}

function isProcessAlive(marker: string) {
    try {
        return execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' }).trim().length > 0;
    } catch (error) {
        // pgrep exits with code 1 when nothing matches. Any other failure means we cannot
        // tell, and answering `false` would let the liveness assertion pass vacuously.
        if ((error as { status?: number }).status === 1) {
            return false;
        }

        throw new Error(`Cannot tell whether the "${marker}" process is still running: pgrep is unavailable.`, { cause: error });
    }
}

describe.skipIf(!isPosixShell)('executeCommandToFile', () => {
    it('waits for the process to exit before reporting its exit code', async () => {
        const dir = createTempDir();
        const outputPath = join(dir, 'closes-stdout-first.sql');

        try {
            // stdout is closed before the process exits: the output file is finished
            // while the exit code is still unknown, which used to be reported as
            // `exited with code null`.
            const [stderr, exitCode, signal] = await executeCommandToFile({
                command: '/bin/sh',
                args: ['-c', 'exec 1>&-; sleep 0.25; exit 7'],
                outputPath,
            });

            expect(exitCode).toBe(7);
            expect(signal).toBeNull();
            expect(stderr).toBe('');
            expect(existsSync(outputPath)).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('writes stdout to the output file and returns the exit code with stderr', async () => {
        const dir = createTempDir();
        const outputPath = join(dir, 'ok.sql');

        try {
            const [stderr, exitCode, signal] = await executeCommandToFile({
                command: '/bin/sh',
                args: ['-c', 'printf "dump body"; printf "a warning" >&2; exit 0'],
                outputPath,
            });

            expect(exitCode).toBe(0);
            expect(signal).toBeNull();
            expect(stderr).toBe('a warning');
            expect(readFileSync(outputPath, 'utf8')).toBe('dump body');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rejects with the write error and stops the command when the output cannot be created', async () => {
        const dir = createTempDir();
        const outputPath = join(dir, 'missing-directory', 'dump.sql');
        const marker = `danegeh-subprocess-marker-${Date.now()}`;

        try {
            await expect(
                executeCommandToFile({
                    command: '/bin/sh',
                    args: ['-c', `sleep 5 # ${marker}`],
                    outputPath,
                })
            ).rejects.toThrow(/Could not write the output file .*dump\.sql/);

            // The command must not be left running with a stdout pipe nobody reads.
            expect(isProcessAlive(marker)).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
