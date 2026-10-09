// The managed SQLFluff runtime lives next to the app DB. A provisioned runtime
// must be reused as-is: running `pip install` on every session was a PyPI
// round-trip on the first diagnostics request after each launch.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeTextCommand: vi.fn<(params: { command: string; args: string[] }) => Promise<[string, string, number | null]>>(),
    validateSql: vi.fn(async () => []),
}));

// `canResolveCommand` probes PATH with `which`; the test drives the managed path only.
vi.mock('child_process', () => ({
    default: {},
    exec: vi.fn(),
    execFile: vi.fn(),
    execFileSync: vi.fn(),
    execSync: vi.fn(() => {
        throw new Error('not found');
    }),
    spawn: vi.fn(),
    spawnSync: vi.fn(),
}));
vi.mock('../../../backend/bunSubprocess.ts', () => ({ executeTextCommand: mocks.executeTextCommand }));
vi.mock('../../../backend/db-tools.ts', () => ({ dbTools: { validateSql: mocks.validateSql } }));

let userDataDir = '';
let managedPythonPath = '';

const VERSION_ARGS = ['-m', 'sqlfluff', '--version'];

function isVersionProbe(args: string[]) {
    return args.at(-1) === '--version';
}

beforeEach(() => {
    vi.resetModules();
    mocks.executeTextCommand.mockReset();
    mocks.validateSql.mockClear();

    userDataDir = mkdtempSync(join(tmpdir(), 'danevan-sqlfluff-'));
    managedPythonPath = join(userDataDir, 'sqlfluff-runtime', 'bin', 'python');
    mkdirSync(join(userDataDir, 'sqlfluff-runtime', 'bin'), { recursive: true });
    writeFileSync(managedPythonPath, '#!/bin/sh\n');

    mocks.executeTextCommand.mockImplementation(async ({ args }) => {
        if (isVersionProbe(args)) {
            return ['sqlfluff 4.1.0', '', 0];
        }

        if (args.includes('lint')) {
            return ['[]', '', 0];
        }

        throw new Error(`unexpected command: ${args.join(' ')}`);
    });
});

afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
});

async function loadDiagnostics() {
    return import('../../../backend/sqlDiagnostics.ts');
}

describe('sqlDiagnostics managed runtime', () => {
    it('reuses a provisioned runtime instead of running pip', async () => {
        const { getSqlDiagnostics } = await loadDiagnostics();

        const result = await getSqlDiagnostics({ sql: 'select 1', dialect: 'mysql', userDataDir });

        expect(mocks.executeTextCommand).toHaveBeenCalledWith({ command: managedPythonPath, args: VERSION_ARGS });
        expect(mocks.executeTextCommand.mock.calls.some(([params]) => params.args.includes('pip'))).toBe(false);
        expect(result.markers).toEqual([]);
    });

    it('installs SQLFluff only when the managed runtime cannot answer', async () => {
        mocks.executeTextCommand.mockImplementation(async ({ args }) => {
            if (isVersionProbe(args)) {
                return ['', 'No module named sqlfluff', 1];
            }

            if (args.includes('pip')) {
                return ['', '', 0];
            }

            if (args.includes('lint')) {
                return ['[]', '', 0];
            }

            throw new Error(`unexpected command: ${args.join(' ')}`);
        });

        const { getSqlDiagnostics } = await loadDiagnostics();

        await getSqlDiagnostics({ sql: 'select 1', dialect: 'mysql', userDataDir });

        const pipCall = mocks.executeTextCommand.mock.calls.find(([params]) => params.args.includes('pip'));

        expect(pipCall?.[0]).toEqual({ command: managedPythonPath, args: ['-m', 'pip', 'install', '--disable-pip-version-check', 'sqlfluff'] });
    });

    it('resolves the runtime once per process', async () => {
        const { getSqlDiagnostics } = await loadDiagnostics();

        await getSqlDiagnostics({ sql: 'select 1', dialect: 'mysql', userDataDir });
        await getSqlDiagnostics({ sql: 'select 2', dialect: 'mysql', userDataDir });

        expect(mocks.executeTextCommand.mock.calls.filter(([params]) => isVersionProbe(params.args))).toHaveLength(1);
    });
});
