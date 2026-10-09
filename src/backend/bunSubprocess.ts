import { spawn } from 'child_process';
import { createWriteStream } from 'fs';

function collectStream(stream: NodeJS.ReadableStream | null): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        if (!stream) {
            resolve(Buffer.alloc(0));
            return;
        }

        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

type CommandParams = {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    detached?: boolean;
};

export async function executeTextCommand(params: CommandParams): Promise<[string, string, number | null]> {
    return new Promise((resolve, reject) => {
        const child = spawn(params.command, params.args, {
            cwd: params.cwd,
            env: params.env as Record<string, string> | undefined,
            stdio: params.input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
        });

        if (params.detached) {
            child.unref();
        }

        if (params.input !== undefined && child.stdin) {
            child.stdin.write(params.input);
            child.stdin.end();
        }

        const stdoutPromise = collectStream(child.stdout);
        const stderrPromise = collectStream(child.stderr);

        child.on('error', reject);

        child.on('close', (exitCode) => {
            Promise.all([stdoutPromise, stderrPromise])
                .then(([stdout, stderr]) => {
                    resolve([stdout.toString(), stderr.toString(), exitCode]);
                })
                .catch(reject);
        });
    });
}

export async function executeBufferCommand(params: CommandParams): Promise<[Buffer, string, number | null]> {
    return new Promise((resolve, reject) => {
        const child = spawn(params.command, params.args, {
            cwd: params.cwd,
            env: params.env as Record<string, string> | undefined,
            stdio: params.input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
        });

        if (params.detached) {
            child.unref();
        }

        if (params.input !== undefined && child.stdin) {
            child.stdin.write(params.input);
            child.stdin.end();
        }

        const stdoutPromise = collectStream(child.stdout);
        const stderrPromise = collectStream(child.stderr);

        child.on('error', reject);

        child.on('close', (exitCode) => {
            Promise.all([stdoutPromise, stderrPromise])
                .then(([stdout, stderr]) => {
                    resolve([stdout, stderr.toString(), exitCode]);
                })
                .catch(reject);
        });
    });
}

/** Spawns a command and streams its stdout directly to a file on disk. */
export function executeCommandToFile(params: CommandParams & { outputPath: string }): Promise<[string, number | null, NodeJS.Signals | null]> {
    return new Promise((resolve, reject) => {
        const child = spawn(params.command, params.args, {
            cwd: params.cwd,
            env: params.env as Record<string, string> | undefined,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const outputStream = createWriteStream(params.outputPath);
        const stderrPromise = collectStream(child.stderr);

        child.stdout.pipe(outputStream);

        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;
        let didExit = false;
        let didCloseOutput = false;
        let settled = false;

        // The exit code is known only after the process has closed, while the file is
        // done earlier whenever stdout ends first. Resolving on either event alone can
        // report a finished command as `exited with code null`, so both must be in.
        function settle() {
            if (settled || !didExit || !didCloseOutput) {
                return;
            }

            settled = true;
            stderrPromise.then((stderr) => resolve([stderr.toString(), exitCode, exitSignal]), reject);
        }

        function fail(error: Error) {
            if (settled) {
                return;
            }

            settled = true;
            // The output can never be written, so the command must not be left running
            // with a stdout pipe nobody reads.
            child.stdout?.unpipe(outputStream);
            child.stdout?.resume();
            child.kill('SIGTERM');
            outputStream.destroy();
            reject(error);
        }

        child.on('error', (error) => fail(error));

        child.on('close', (code, signal) => {
            exitCode = code;
            exitSignal = signal;
            didExit = true;
            settle();
        });

        outputStream.on('error', (error) => {
            fail(new Error(`Could not write the output file ${params.outputPath}: ${error.message}`, { cause: error }));
        });

        outputStream.on('close', () => {
            didCloseOutput = true;
            settle();
        });
    });
}
