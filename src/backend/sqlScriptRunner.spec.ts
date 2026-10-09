// @vitest-environment node
// The client runner streams the script into a `mysql` binary; the fixture is a real shell
// script that prints its arguments, the MYSQL_PWD it received and the SQL it read on stdin.
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSqlScriptRunStatus, startSqlScriptRun, stopSqlScriptRun } from './sqlScriptRunner.ts';

const hasPosixShell = process.platform !== 'win32' && existsSync('/bin/sh');

let rootDir = '';
let scriptPath = '';

function writeClient(name: string, body: string) {
    const path = join(rootDir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
}

function writeScriptFile(name: string, sql: string) {
    const path = join(rootDir, name);
    writeFileSync(path, sql);
    return path;
}

async function waitForRunToFinish(runId: string) {
    await expect.poll(() => getSqlScriptRunStatus(runId).status).not.toBe('running');
    return getSqlScriptRunStatus(runId);
}

describe.skipIf(!hasPosixShell)('sqlScriptRunner', () => {
    beforeAll(() => {
        rootDir = mkdtempSync(join(tmpdir(), 'danegeh-script-run-'));
        scriptPath = writeScriptFile('script.sql', 'CREATE TABLE t (id INT);\nINSERT INTO t VALUES (1);\n');
    });

    afterAll(() => {
        rmSync(rootDir, { recursive: true, force: true });
    });

    it('streams the script through the chosen client and reports its label and exit code', async () => {
        const clientPath = writeClient('mysql-ok', 'echo "args:$@"; echo "password:$MYSQL_PWD"; cat');
        const sqlPath = writeScriptFile('success.sql', 'SELECT 41 + 1;\n');

        const runId = startSqlScriptRun({
            connectionId: 12,
            database: 'shop',
            filePath: sqlPath,
            runnerKind: 'client',
            executable: clientPath,
            host: 'db.internal',
            port: 3307,
            username: 'root',
            password: 's3cret',
        });
        const status = await waitForRunToFinish(runId);

        expect(status.status).toBe('succeeded');
        expect(status.runnerKind).toBe('client');
        expect(status.runnerLabel).toBe(`mysql client (${clientPath})`);
        expect(status.exitCode).toBe(0);
        expect(status.error).toBeUndefined();
        expect(status.outputChunk).toBe(
            `-- ${clientPath} --host=db.internal --port=3307 --user=root --database=shop\n\n` +
                'args:--host=db.internal --port=3307 --user=root --database=shop\n' +
                'password:s3cret\n' +
                'SELECT 41 + 1;\n'
        );
        expect(status.nextOffset).toBe(status.outputChunk.length);
    });

    it('returns only the output written after the requested offset', async () => {
        const clientPath = writeClient('mysql-offset', 'cat');
        const sqlPath = writeScriptFile('offset.sql', 'SELECT 1;\n');

        const runId = startSqlScriptRun({ connectionId: 1, database: 'app', filePath: sqlPath, runnerKind: 'client', executable: clientPath, host: 'localhost' });
        const first = await waitForRunToFinish(runId);

        expect(first.outputChunk).toContain('SELECT 1;');
        expect(getSqlScriptRunStatus(runId, first.nextOffset).outputChunk).toBe('');
        expect(getSqlScriptRunStatus(runId, 5).outputChunk).toBe(first.outputChunk.slice(5));
    });

    it('reports a failing client with its exit code and message', async () => {
        const clientPath = writeClient('mysql-fail', 'cat > /dev/null; echo "syntax error at line 3" 1>&2; exit 3');
        const sqlPath = writeScriptFile('broken.sql', 'SELEC 1;\n');

        const runId = startSqlScriptRun({ connectionId: 1, database: 'app', filePath: sqlPath, runnerKind: 'client', executable: clientPath, host: 'localhost' });
        const status = await waitForRunToFinish(runId);

        expect(status.status).toBe('failed');
        expect(status.exitCode).toBe(3);
        expect(status.error).toBe('mysql exited with code 3.');
        expect(status.outputChunk).toContain('syntax error at line 3');
    });

    it('reports a client that cannot be started', async () => {
        const sqlPath = writeScriptFile('missing-client.sql', 'SELECT 1;\n');
        const missingClient = join(rootDir, 'mysql-that-was-deleted');

        const runId = startSqlScriptRun({ connectionId: 1, database: 'app', filePath: sqlPath, runnerKind: 'client', executable: missingClient, host: 'localhost' });
        const status = await waitForRunToFinish(runId);

        expect(status.status).toBe('failed');
        expect(status.error).toContain(`spawn ${missingClient} ENOENT`);
    });

    it('fails the driver runner when the script file cannot be read', async () => {
        const runId = startSqlScriptRun({ connectionId: 1, database: 'app', filePath: join(rootDir, 'absent.sql'), runnerKind: 'driver' });

        const status = await waitForRunToFinish(runId);

        expect(status.status).toBe('failed');
        expect(status.runnerLabel).toBe('built-in driver');
        expect(status.error).toContain('absent.sql');
    });

    it('succeeds without touching the database when the script has no statements', async () => {
        const commentOnly = writeScriptFile('comments.sql', '-- just a note\n\n');

        const runId = startSqlScriptRun({ connectionId: 1, database: 'app', filePath: commentOnly, runnerKind: 'driver' });
        const status = await waitForRunToFinish(runId);

        expect(status.status).toBe('succeeded');
        expect(status.statementCount).toBe(0);
        expect(status.outputChunk).toBe('-- The script contains no executable statements.\n');
    });

    it('forgets a run once it is stopped', async () => {
        const clientPath = writeClient('mysql-slow', 'exec sleep 30');
        const scriptFile = scriptPath;

        const runId = startSqlScriptRun({ connectionId: 1, database: 'app', filePath: scriptFile, runnerKind: 'client', executable: clientPath, host: 'localhost' });

        stopSqlScriptRun(runId);

        expect(() => getSqlScriptRunStatus(runId)).toThrow('The SQL script run could not be found. It may have been cancelled or expired.');
        expect(() => stopSqlScriptRun(runId)).not.toThrow();
    });

    it('rejects an unknown run id', () => {
        expect(() => getSqlScriptRunStatus('not-a-run')).toThrow('The SQL script run could not be found.');
    });
});
