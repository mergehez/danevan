import { executeTextCommand } from '@backend/bunSubprocess.ts';
import { dbTools } from '@backend/db-tools.ts';
import type { DbType, SqlDiagnosticMarker, SqlDiagnosticsResult } from '@utils/appClient';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type SqlFluffRuntime = {
    command: string;
    argsPrefix: string[];
    source: 'system' | 'managed';
};

type SqlFluffViolation = {
    start_line_no?: number;
    start_line_pos?: number;
    end_line_no?: number;
    end_line_pos?: number;
    code?: string;
    description?: string;
    name?: string;
    warning?: boolean;
};

type SqlFluffLintResult = {
    filepath?: string;
    violations?: SqlFluffViolation[];
};

const SQLFLUFF_RUNTIME_DIR = 'sqlfluff-runtime';
let sqlFluffRuntimePromise: Promise<SqlFluffRuntime | undefined> | undefined;

function canResolveCommand(command: string) {
    if (command.includes('/') || command.includes('\\')) {
        return existsSync(command);
    }

    try {
        return Boolean(Bun.which(command));
    } catch {
        return false;
    }
}

function getManagedPythonPath(runtimeDir: string) {
    return process.platform === 'win32' ? join(runtimeDir, 'Scripts', 'python.exe') : join(runtimeDir, 'bin', 'python');
}

function getPythonCandidates() {
    return process.platform === 'win32'
        ? [
              { command: 'py', argsPrefix: ['-3'] },
              { command: 'python', argsPrefix: [] },
          ]
        : [
              { command: 'python3', argsPrefix: [] },
              { command: 'python', argsPrefix: [] },
          ];
}

function getSqlFluffDialect(dialect: DbType | undefined) {
    if (dialect === 'postgresql') {
        return 'postgres';
    }

    if (dialect === 'sqlserver') {
        return 'tsql';
    }

    if (dialect === 'msaccess') {
        return undefined;
    }

    return dialect ?? 'mysql';
}

function getSqlFluffSeverity(violation: SqlFluffViolation): SqlDiagnosticMarker['severity'] {
    const code = String(violation.code ?? '').toUpperCase();
    const name = String(violation.name ?? '').toLowerCase();

    if (code.startsWith('PRS') || code.startsWith('TMP') || name.startsWith('parsing.') || name.startsWith('templating.')) {
        return 'error';
    }

    if (name.startsWith('layout.') || name.startsWith('capitalisation.')) {
        return 'hint';
    }

    return violation.warning ? 'info' : 'warning';
}

function isFormattingViolation(violation: SqlFluffViolation) {
    const code = String(violation.code ?? '').toUpperCase();
    const name = String(violation.name ?? '').toLowerCase();

    return code.startsWith('LT') || code.startsWith('CP') || name.startsWith('layout.') || name.startsWith('capitalisation.');
}

function normalizeSqlFluffMarkers(results: SqlFluffLintResult[], params: { includeFormatting: boolean }): SqlDiagnosticMarker[] {
    return results.flatMap((result) =>
        (result.violations ?? [])
            .filter((violation) => params.includeFormatting || !isFormattingViolation(violation))
            .map((violation) => ({
                message: violation.description?.trim() || 'SQLFluff reported a SQL issue.',
                severity: getSqlFluffSeverity(violation),
                startLineNumber: Math.max(1, violation.start_line_no ?? 1),
                startColumn: Math.max(1, violation.start_line_pos ?? 1),
                endLineNumber: Math.max(1, violation.end_line_no ?? violation.start_line_no ?? 1),
                endColumn: Math.max(2, violation.end_line_pos ?? (violation.start_line_pos ?? 1) + 1),
                source: violation.code ? `sqlfluff:${violation.code}` : 'sqlfluff',
            }))
    );
}

async function canRunSqlFluff(command: string, argsPrefix: string[]) {
    if (!canResolveCommand(command)) {
        return undefined;
    }

    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
        [stdout, stderr, exitCode] = await executeTextCommand({
            command,
            args: [...argsPrefix, '--version'],
        });
    } catch {
        return undefined;
    }

    if (exitCode !== 0) {
        return undefined;
    }

    return (stdout || stderr).trim() || 'sqlfluff';
}

async function ensureManagedSqlFluffRuntime(userDataDir: string) {
    const runtimeDir = join(userDataDir, SQLFLUFF_RUNTIME_DIR);
    const pythonPath = getManagedPythonPath(runtimeDir);

    mkdirSync(runtimeDir, { recursive: true });

    if (!existsSync(pythonPath)) {
        let created = false;

        for (const candidate of getPythonCandidates()) {
            const [, stderr, exitCode] = await executeTextCommand({
                command: candidate.command,
                args: [...candidate.argsPrefix, '-m', 'venv', runtimeDir],
            });

            if (exitCode === 0) {
                created = true;
                break;
            }

            if (stderr.trim()) {
                console.warn('Failed to create SQLFluff runtime with candidate:', candidate.command, stderr.trim());
            }
        }

        if (!created || !existsSync(pythonPath)) {
            throw new Error('Python 3 is required to provision the managed SQLFluff runtime.');
        }
    }

    const [, installStderr, installExitCode] = await executeTextCommand({
        command: pythonPath,
        args: ['-m', 'pip', 'install', '--disable-pip-version-check', 'sqlfluff'],
    });

    if (installExitCode !== 0) {
        throw new Error(installStderr.trim() || 'Failed to install SQLFluff into the managed runtime.');
    }

    return {
        command: pythonPath,
        argsPrefix: ['-m', 'sqlfluff'],
        source: 'managed',
    } satisfies SqlFluffRuntime;
}

async function resolveSqlFluffRuntime(userDataDir: string) {
    sqlFluffRuntimePromise ??= (async () => {
        const directVersion = await canRunSqlFluff('sqlfluff', []);

        if (directVersion) {
            return {
                command: 'sqlfluff',
                argsPrefix: [],
                source: 'system',
            } satisfies SqlFluffRuntime;
        }

        for (const candidate of getPythonCandidates()) {
            const version = await canRunSqlFluff(candidate.command, [...candidate.argsPrefix, '-m', 'sqlfluff']);

            if (version) {
                return {
                    command: candidate.command,
                    argsPrefix: [...candidate.argsPrefix, '-m', 'sqlfluff'],
                    source: 'system',
                } satisfies SqlFluffRuntime;
            }
        }

        return ensureManagedSqlFluffRuntime(userDataDir);
    })().catch((error) => {
        sqlFluffRuntimePromise = undefined;
        throw error;
    });

    return sqlFluffRuntimePromise;
}

async function lintWithSqlFluff(sql: string, dialect: DbType | undefined, userDataDir: string): Promise<{ markers: SqlDiagnosticMarker[]; problemMarkers: SqlDiagnosticMarker[] }> {
    const sqlFluffDialect = getSqlFluffDialect(dialect);

    if (!sqlFluffDialect) {
        return { markers: [], problemMarkers: [] };
    }

    try {
        const runtime = await resolveSqlFluffRuntime(userDataDir);

        if (!runtime) {
            throw new Error('SQLFluff runtime is unavailable.');
        }

        const [stdout, stderr, exitCode] = await executeTextCommand({
            command: runtime.command,
            args: [
                ...runtime.argsPrefix,
                'lint',
                '--nofail',
                '--nocolor',
                '--disable-progress-bar',
                '--ignore-local-config',
                '--templater',
                'raw',
                '--dialect',
                sqlFluffDialect,
                '--format',
                'json',
                '--stdin-filename',
                `inline.${sqlFluffDialect}.sql`,
                '-',
            ],
            cwd: userDataDir,
            input: sql,
        });

        if (exitCode !== 0 && !stdout.trim()) {
            throw new Error(stderr.trim() || 'SQLFluff failed to lint the SQL text.');
        }

        if (!stdout.trim()) {
            return { markers: [], problemMarkers: [] };
        }

        const results = JSON.parse(stdout) as SqlFluffLintResult[];

        return {
            markers: normalizeSqlFluffMarkers(results, { includeFormatting: false }),
            problemMarkers: normalizeSqlFluffMarkers(results, { includeFormatting: true }),
        };
    } catch (error) {
        const marker = {
            message: error instanceof Error ? error.message : String(error),
            severity: 'warning' as const,
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 2,
            source: 'sqlfluff',
        };

        return {
            markers: [marker],
            problemMarkers: [marker],
        };
    }
}

export async function formatSql(params: { sql: string; dialect?: DbType; userDataDir: string }) {
    const sqlFluffDialect = getSqlFluffDialect(params.dialect);

    if (!sqlFluffDialect) {
        return params.sql;
    }

    const runtime = await resolveSqlFluffRuntime(params.userDataDir);

    if (!runtime) {
        throw new Error('SQLFluff runtime is unavailable.');
    }

    const diagnostics = await getSqlDiagnostics({
        sql: params.sql,
        dialect: params.dialect,
        userDataDir: params.userDataDir,
    });

    if (diagnostics.markers.some((marker) => marker.severity === 'error')) {
        throw new Error('Formatting is disabled while SQL still has parser or database errors.');
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'danevan-sqlfluff-'));
    const tempFilePath = join(tempDir, `inline.${sqlFluffDialect}.sql`);

    try {
        writeFileSync(tempFilePath, params.sql, 'utf8');

        const [, stderr, exitCode] = await executeTextCommand({
            command: runtime.command,
            args: [
                ...runtime.argsPrefix,
                'format',
                '--nocolor',
                '--disable-progress-bar',
                '--ignore-local-config',
                '--templater',
                'raw',
                '--dialect',
                sqlFluffDialect,
                tempFilePath,
            ],
            cwd: params.userDataDir,
        });

        if (exitCode !== 0) {
            throw new Error(stderr.trim() || 'SQLFluff failed to format the SQL text.');
        }

        return readFileSync(tempFilePath, 'utf8');
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function sortMarkers(markers: SqlDiagnosticMarker[]) {
    const severityRank: Record<SqlDiagnosticMarker['severity'], number> = {
        error: 0,
        warning: 1,
        info: 2,
        hint: 3,
    };

    return [...markers].sort((left, right) => {
        return (
            severityRank[left.severity] - severityRank[right.severity] ||
            left.startLineNumber - right.startLineNumber ||
            left.startColumn - right.startColumn ||
            left.endLineNumber - right.endLineNumber ||
            left.endColumn - right.endColumn ||
            (left.message || '').localeCompare(right.message || '')
        );
    });
}

function dedupeMarkers(markers: SqlDiagnosticMarker[]) {
    const seen = new Set<string>();
    return markers.filter((marker) => {
        const key = [marker.message, marker.severity, marker.startLineNumber, marker.startColumn, marker.endLineNumber, marker.endColumn, marker.source].join('::');

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

export async function getSqlDiagnostics(params: { sql: string; dialect?: DbType; connectionId?: number; userDataDir: string }): Promise<SqlDiagnosticsResult> {
    const normalizedSql = params.sql.trim();

    if (!normalizedSql) {
        return { markers: [], problemMarkers: [] };
    }

    const [lintResult, databaseMarkers] = await Promise.all([
        lintWithSqlFluff(normalizedSql, params.dialect, params.userDataDir),
        typeof params.connectionId === 'number' ? dbTools.validateSql(params.connectionId, normalizedSql) : Promise.resolve([]),
    ]);

    return {
        markers: sortMarkers(dedupeMarkers([...databaseMarkers, ...lintResult.markers])),
        problemMarkers: sortMarkers(dedupeMarkers([...databaseMarkers, ...lintResult.problemMarkers])),
    } satisfies SqlDiagnosticsResult;
}
