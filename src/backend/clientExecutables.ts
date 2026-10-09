import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
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

type FindClientExecutableOptions = {
    /** Binary name used for the `command -v` lookup. */
    commandName: string;
    /** Absolute paths probed after the PATH lookup. */
    candidatePaths: string[];
    /** Directory whose `<prefix>*` entries may hold a `bin/<commandName>` binary. */
    scanDir?: { dir: string; prefix: string };
    /** Arguments that prove a candidate actually runs, e.g. `--version`. */
    versionArgs: string[];
};

/**
 * Resolves a database client binary. A candidate on PATH can be a broken Finder
 * alias or a non-executable file, so a path is only accepted once it runs.
 */
export async function findClientExecutable(options: FindClientExecutableOptions): Promise<string | undefined> {
    const candidates: string[] = [];

    try {
        const [stdout] = await executeTextCommand({ command: 'sh', args: ['-c', `command -v ${options.commandName}`] });
        const resolved = stdout.trim();

        if (resolved) {
            candidates.push(resolved);
        }
    } catch {
        // PATH lookup failed; fall through to the common install directories.
    }

    candidates.push(...options.candidatePaths);

    if (options.scanDir && existsSync(options.scanDir.dir)) {
        try {
            for (const entry of readdirSync(options.scanDir.dir)) {
                if (entry.startsWith(options.scanDir.prefix)) {
                    candidates.push(join(options.scanDir.dir, entry, 'bin', options.commandName));
                }
            }
        } catch {
            // ignore directory scan errors.
        }
    }

    for (const candidate of new Set(candidates)) {
        if (!existsSync(candidate)) {
            continue;
        }

        try {
            await executeTextCommand({ command: candidate, args: options.versionArgs });
            return candidate;
        } catch {
            // Not runnable as a real binary; keep probing the next candidate.
        }
    }

    return undefined;
}
