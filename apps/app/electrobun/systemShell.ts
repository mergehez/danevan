import { existsSync } from 'fs';
import { executeTextCommand } from '@backend/bunSubprocess.ts';

type CommandAttempt = {
    command: string;
    args: string[];
};

function runCommand({ command, args }: CommandAttempt, directoryPath: string) {
    return executeTextCommand({
        command,
        args,
        cwd: directoryPath,
        detached: process.platform !== 'win32',
    }).then(([stdout, stderr, exitCode]) => {
        if (exitCode !== 0) {
            throw new Error(stderr.trim() || stdout.trim() || `Command exited with code ${exitCode}.`);
        }
    });
}

export async function openDirectoryInTerminal(ps: { directoryPath: string; applicationPath?: string }) {
    const { directoryPath, applicationPath } = ps;
    const attempts: CommandAttempt[] = (() => {
        const configuredApplicationPath = applicationPath && existsSync(applicationPath) ? applicationPath : undefined;

        if (configuredApplicationPath) {
            if (process.platform === 'darwin') {
                return [{ command: 'open', args: ['-a', configuredApplicationPath, directoryPath] }];
            }

            if (process.platform === 'win32') {
                return [
                    {
                        command: 'cmd.exe',
                        args: ['/c', 'start', '', '/D', directoryPath, configuredApplicationPath],
                    },
                ];
            }

            return [{ command: configuredApplicationPath, args: [] }];
        }

        if (process.platform === 'darwin') {
            return [{ command: 'open', args: ['-a', 'Terminal', directoryPath] }];
        }

        if (process.platform === 'win32') {
            return [
                { command: 'cmd.exe', args: ['/c', 'start', '', 'wt.exe', '-d', directoryPath] },
                {
                    command: 'cmd.exe',
                    args: ['/c', 'start', '', 'cmd.exe', '/K', 'cd', '/d', directoryPath],
                },
            ];
        }

        return [
            { command: 'x-terminal-emulator', args: ['--working-directory', directoryPath] },
            { command: 'gnome-terminal', args: ['--working-directory', directoryPath] },
            { command: 'konsole', args: ['--workdir', directoryPath] },
            { command: 'xfce4-terminal', args: ['--working-directory', directoryPath] },
            { command: 'kitty', args: ['--directory', directoryPath] },
            { command: 'alacritty', args: ['--working-directory', directoryPath] },
        ];
    })();

    let lastError: unknown;

    for (const attempt of attempts) {
        try {
            await runCommand(attempt, directoryPath);
            return;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to open the directory in a terminal application.');
}
