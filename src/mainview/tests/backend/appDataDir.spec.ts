// @vitest-environment node
// The backend cannot serve anything without a writable app data directory. The shell turns whatever
// this throws into its "Request failed" panel (covered by failure-modes.spec.ts), so the message has
// to name the directory or file that stopped it rather than failing somewhere further away.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATABASE_FILE_NAME, useAppDb } from '../../../backend/db-app.ts';
import { resolveAppDataDir } from '../../../electronUtils/useDatabase.ts';

let tempDir = '';

function makeTempDir(prefix: string) {
    tempDir = mkdtempSync(join(tmpdir(), prefix));
    return tempDir;
}

function capture(fn: () => void): Error | undefined {
    try {
        fn();
        return undefined;
    } catch (error) {
        return error as Error;
    }
}

afterEach(() => {
    delete process.env.APP_DATA_DIR;

    if (tempDir) {
        chmodSync(tempDir, 0o700);
        rmSync(tempDir, { recursive: true, force: true });
        tempDir = '';
    }
});

describe('the app data directory', () => {
    it('is the APP_DATA_DIR the environment asks for', () => {
        const dir = makeTempDir('danevan-data-');
        process.env.APP_DATA_DIR = dir;

        expect(resolveAppDataDir()).toBe(dir);
    });

    it('reports the unwritable directory instead of starting anyway', () => {
        const dir = makeTempDir('danevan-readonly-');
        chmodSync(dir, 0o500);
        const nested = join(dir, 'workspace');
        process.env.APP_DATA_DIR = nested;

        const failure = capture(() => useAppDb().configureDatabase());

        expect(failure?.message).toContain('EACCES');
        // The path is what the user needs to act on.
        expect(failure?.message).toContain(nested);
    });

    it('reports an app database file it cannot write', () => {
        const dir = makeTempDir('danevan-readonly-db-');
        const databasePath = join(dir, DATABASE_FILE_NAME);
        writeFileSync(databasePath, '');
        chmodSync(databasePath, 0o400);
        process.env.APP_DATA_DIR = dir;

        const failure = capture(() => useAppDb().configureDatabase());

        expect(failure?.message).toMatch(/readonly|read-only/i);
    });
});
