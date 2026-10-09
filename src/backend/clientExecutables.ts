import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, win32 } from 'path';
import { executeTextCommand } from './bunSubprocess.ts';

export const mysqldumpCandidatePaths = [
    '/usr/local/mysql/bin/mysqldump',
    '/usr/local/bin/mysqldump',
    '/usr/bin/mysqldump',
    '/opt/homebrew/bin/mysqldump',
    '/opt/local/bin/mysqldump',
    '/usr/local/mariadb/bin/mysqldump',
    join(homedir(), 'bin/mysqldump'),
];

export const mysqlClientCandidatePaths = [
    '/usr/local/mysql/bin/mysql',
    '/usr/local/bin/mysql',
    '/usr/bin/mysql',
    '/opt/homebrew/bin/mysql',
    '/opt/homebrew/opt/mysql-client/bin/mysql',
    '/opt/local/bin/mysql',
    '/usr/local/mariadb/bin/mysql',
    join(homedir(), 'bin/mysql'),
];

/** MySQL and MariaDB install into `C:\Program Files` under their own versioned folder. */
export function getWindowsMysqlCandidatePaths(executableName: `${string}.exe`): string[] {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    // `win32.join` keeps these real Windows paths even when a test builds them on another host.
    return [
        win32.join(programFiles, 'MySQL', 'MySQL Server 8.4', 'bin', executableName),
        win32.join(programFiles, 'MySQL', 'MySQL Server 8.0', 'bin', executableName),
        win32.join(programFiles, 'MariaDB 11.4', 'bin', executableName),
        win32.join(programFiles, 'MariaDB 10.11', 'bin', executableName),
        win32.join(programFilesX86, 'MySQL', 'MySQL Server 8.0', 'bin', executableName),
        win32.join('C:\\xampp\\mysql\\bin', executableName),
        win32.join('C:\\laragon\\bin\\mysql', executableName),
    ];
}

/** What the lookup needs beyond the platform: everything here is the process/fs boundary. */
export type ClientExecutableDeps = {
    platform: NodeJS.Platform;
    exists: (path: string) => boolean;
    readdir: (path: string) => string[];
    run: (command: string, args: string[]) => Promise<[string, string, number | null]>;
};

const defaultDeps: ClientExecutableDeps = {
    platform: process.platform,
    exists: existsSync,
    readdir: (path: string) => readdirSync(path),
    run: (command: string, args: string[]) => executeTextCommand({ command, args }),
};

type FindClientExecutableOptions = {
    /** Binary name, without an extension. */
    commandName: string;
    /** Absolute paths probed after the PATH lookup. */
    candidatePaths: string[];
    /** Directory whose `<prefix>*` entries may hold a `bin/<commandName>` binary. */
    scanDir?: { dir: string; prefix: string };
    /** Arguments that prove a candidate actually runs, e.g. `--version`. */
    versionArgs: string[];
};

/** Windows has no `command -v`; `where.exe` is its PATH lookup. */
function getPathLookup(platform: NodeJS.Platform, commandName: string) {
    return platform === 'win32' ? { command: 'where.exe', args: [commandName] } : { command: 'sh', args: ['-c', `command -v ${commandName}`] };
}

function getBinaryFileName(platform: NodeJS.Platform, commandName: string) {
    return platform === 'win32' ? `${commandName}.exe` : commandName;
}

/**
 * Resolves a database client binary. A candidate on PATH can be a broken Finder
 * alias or a non-executable file, so a path is only accepted once it runs.
 */
export async function findClientExecutable(options: FindClientExecutableOptions, deps: Partial<ClientExecutableDeps> = {}): Promise<string | undefined> {
    const { platform, exists, readdir, run } = { ...defaultDeps, ...deps };
    const candidates: string[] = [];
    const lookup = getPathLookup(platform, options.commandName);

    try {
        const [stdout] = await run(lookup.command, lookup.args);
        // `where.exe` can answer with several hits; the first one wins.
        const resolved = stdout
            .split('\n')
            .map((line) => line.trim())
            .find(Boolean);

        if (resolved) {
            candidates.push(resolved);
        }
    } catch {
        // PATH lookup failed; fall through to the common install directories.
    }

    candidates.push(...options.candidatePaths);

    const pathJoin = platform === 'win32' ? win32.join : join;

    if (options.scanDir && exists(options.scanDir.dir)) {
        try {
            for (const entry of readdir(options.scanDir.dir)) {
                if (entry.startsWith(options.scanDir.prefix)) {
                    candidates.push(pathJoin(options.scanDir.dir, entry, 'bin', getBinaryFileName(platform, options.commandName)));
                }
            }
        } catch {
            // ignore directory scan errors.
        }
    }

    for (const candidate of new Set(candidates)) {
        if (!exists(candidate)) {
            continue;
        }

        try {
            await run(candidate, options.versionArgs);
            return candidate;
        } catch {
            // Not runnable as a real binary; keep probing the next candidate.
        }
    }

    return undefined;
}
