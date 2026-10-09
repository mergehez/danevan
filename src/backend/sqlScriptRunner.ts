import { randomUUID } from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import { createReadStream, readFileSync } from 'fs';
import type { RunSqlScriptRunnerKind, RunSqlScriptStatus } from '../shared/types';
import { splitSqlStatements } from '../shared/utils/sqlStatements.ts';
import { findClientExecutable, getWindowsMysqlCandidatePaths, mysqlClientCandidatePaths } from './clientExecutables.ts';
import { dbTools } from './db-tools.ts';

/** Long scripts can print far more than a dialog can show; keep the output bounded. */
const MAX_OUTPUT_LENGTH = 200_000;
const OUTPUT_TRUNCATION_NOTICE = '\n-- Output truncated: the runner produced too much output.\n';
/** Runs the renderer stopped polling for are dropped after this long. */
const RUN_RETENTION_MS = 30 * 60_000;

type SqlScriptRunTarget = {
    connectionId: number;
    database: string;
    filePath: string;
    runnerKind: RunSqlScriptRunnerKind;
    executable?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
};

type SqlScriptRun = {
    id: string;
    connectionId: number;
    filePath: string;
    database: string;
    runnerKind: RunSqlScriptRunnerKind;
    runnerLabel: string;
    status: RunSqlScriptStatus['status'];
    output: string;
    outputTruncated: boolean;
    error?: string;
    exitCode?: number | null;
    startedAt: number;
    finishedAt?: number;
    cancelled: boolean;
    statementCount?: number;
    completedStatements?: number;
    child?: ChildProcess;
};

const runs = new Map<string, SqlScriptRun>();

let mysqlClientPathCache: string | null | undefined;

/** Memoized `mysql` client lookup: the result cannot change while the app runs. */
export async function findMysqlClientPath(): Promise<string | undefined> {
    if (mysqlClientPathCache === undefined) {
        mysqlClientPathCache =
            (await findClientExecutable({
                commandName: 'mysql',
                candidatePaths: process.platform === 'win32' ? getWindowsMysqlCandidatePaths('mysql.exe') : mysqlClientCandidatePaths,
                scanDir: process.platform === 'win32' ? { dir: process.env.ProgramFiles || 'C:\\Program Files', prefix: 'MySQL' } : { dir: '/usr/local', prefix: 'mysql' },
                versionArgs: ['--version'],
            })) ?? null;
    }

    return mysqlClientPathCache ?? undefined;
}

function runnerLabelFor(runnerKind: RunSqlScriptRunnerKind, executable: string | undefined) {
    return runnerKind === 'client' && executable ? `mysql client (${executable})` : 'built-in driver';
}

function appendOutput(run: SqlScriptRun, chunk: string) {
    if (!chunk || run.outputTruncated) {
        return;
    }

    run.output += chunk;

    if (run.output.length > MAX_OUTPUT_LENGTH) {
        run.output = run.output.slice(0, MAX_OUTPUT_LENGTH) + OUTPUT_TRUNCATION_NOTICE;
        run.outputTruncated = true;
    }
}

/** Runs are finished exactly once: the CLI can report both `error` and `close`. */
function finishRun(run: SqlScriptRun, outcome: { status: 'succeeded' | 'failed'; error?: string }) {
    if (run.status !== 'running') {
        return;
    }

    run.status = outcome.status;
    run.error = outcome.error;
    run.finishedAt = Date.now();
    run.child = undefined;
}

function pruneRuns() {
    const cutoff = Date.now() - RUN_RETENTION_MS;

    for (const [id, run] of runs) {
        if ((run.finishedAt ?? run.startedAt) >= cutoff) {
            continue;
        }

        run.cancelled = true;
        run.child?.kill('SIGTERM');
        runs.delete(id);
    }
}

function buildMysqlClientArgs(target: SqlScriptRunTarget) {
    const args = [`--host=${target.host}`];

    if (target.port !== undefined) {
        args.push(`--port=${target.port}`);
    }

    if (target.username) {
        args.push(`--user=${target.username}`);
    }

    if (target.database) {
        args.push(`--database=${target.database}`);
    }

    return args;
}

/** Streams the script file into the `mysql` client and captures its output. */
function startMysqlClientRun(run: SqlScriptRun, target: SqlScriptRunTarget) {
    const args = buildMysqlClientArgs(target);
    appendOutput(run, `-- ${target.executable} ${args.join(' ')}\n\n`);

    const child = spawn(target.executable!, args, {
        env: target.password ? { ...process.env, MYSQL_PWD: target.password } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    run.child = child;

    child.stdout?.on('data', (chunk: Buffer) => appendOutput(run, chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => appendOutput(run, chunk.toString()));

    child.on('error', (error) => {
        appendOutput(run, `${error.message}\n`);
        finishRun(run, { status: 'failed', error: error.message });
    });

    child.on('close', (exitCode) => {
        run.exitCode = exitCode;

        if (run.cancelled) {
            return;
        }

        if (exitCode === 0) {
            finishRun(run, { status: 'succeeded' });
            return;
        }

        const message = run.error || (exitCode === null ? 'The mysql client was terminated.' : `mysql exited with code ${exitCode}.`);
        appendOutput(run, `${message}\n`);
        finishRun(run, { status: 'failed', error: message });
    });

    const fileStream = createReadStream(run.filePath);

    fileStream.on('error', (error) => {
        appendOutput(run, `${error.message}\n`);
        child.kill('SIGTERM');
        finishRun(run, { status: 'failed', error: error.message });
    });

    fileStream.pipe(child.stdin!);
}

function describeStatement(statement: string) {
    const firstLine = statement
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);

    if (!firstLine) {
        return 'statement';
    }

    return firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine;
}

/** Runs the script statement-by-statement through the connection's own driver. */
async function runWithDriver(run: SqlScriptRun) {
    let sql: string;

    try {
        sql = readFileSync(run.filePath, 'utf8');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendOutput(run, `${message}\n`);
        finishRun(run, { status: 'failed', error: message });
        return;
    }

    const statements = splitSqlStatements(sql);
    run.statementCount = statements.length;

    if (!statements.length) {
        appendOutput(run, '-- The script contains no executable statements.\n');
        finishRun(run, { status: 'succeeded' });
        return;
    }

    appendOutput(run, `-- Running ${statements.length} statement(s) on ${run.database}\n\n`);

    for (const [index, statement] of statements.entries()) {
        if (run.cancelled) {
            return;
        }

        appendOutput(run, `-- [${index + 1}/${statements.length}] ${describeStatement(statement)}\n`);

        try {
            const result = await dbTools.runQuery(run.connectionId, statement);
            appendOutput(run, result.kind === 'rows' ? `-- ${result.rows.length} row(s)\n\n` : '-- OK\n\n');
            run.completedStatements = index + 1;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendOutput(run, `-- ERROR: ${message}\n`);
            finishRun(run, { status: 'failed', error: message });
            return;
        }
    }

    finishRun(run, { status: 'succeeded' });
}

export function startSqlScriptRun(target: SqlScriptRunTarget): string {
    pruneRuns();

    const run: SqlScriptRun = {
        id: randomUUID(),
        connectionId: target.connectionId,
        filePath: target.filePath,
        database: target.database,
        runnerKind: target.runnerKind,
        runnerLabel: runnerLabelFor(target.runnerKind, target.executable),
        status: 'running',
        output: '',
        outputTruncated: false,
        startedAt: Date.now(),
        cancelled: false,
    };

    runs.set(run.id, run);

    // The caller returns the run id immediately and polls for progress, so the
    // execution must never reject into the request that started it.
    if (target.runnerKind === 'client') {
        startMysqlClientRun(run, target);
    } else {
        void runWithDriver(run);
    }

    return run.id;
}

export function getSqlScriptRunStatus(runId: string, offset = 0): RunSqlScriptStatus {
    pruneRuns();

    const run = runs.get(runId);

    if (!run) {
        throw new Error('The SQL script run could not be found. It may have been cancelled or expired.');
    }

    const safeOffset = Math.min(Math.max(0, Math.trunc(offset) || 0), run.output.length);

    return {
        runId: run.id,
        status: run.status,
        runnerKind: run.runnerKind,
        runnerLabel: run.runnerLabel,
        outputChunk: run.output.slice(safeOffset),
        nextOffset: run.output.length,
        durationMs: Math.max(0, Math.round((run.finishedAt ?? Date.now()) - run.startedAt)),
        error: run.error,
        exitCode: run.exitCode,
        statementCount: run.statementCount,
        completedStatements: run.completedStatements,
    };
}

/** Stops a running script (if it is still running) and forgets the run. */
export function stopSqlScriptRun(runId: string): void {
    const run = runs.get(runId);

    if (!run) {
        return;
    }

    run.cancelled = true;
    run.child?.kill('SIGTERM');
    finishRun(run, { status: 'failed', error: 'The script run was cancelled.' });
    runs.delete(runId);
}
