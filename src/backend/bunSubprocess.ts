import { spawn } from 'child_process';

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
