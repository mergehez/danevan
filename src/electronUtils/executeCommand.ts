import { spawn } from 'child_process';

type CommandParams = {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    detached?: boolean;
    bufferOnly?: boolean; // no need to stream the output, just buffer it and return it at the end
    allowedExitCodes: number[];
    getErrorToThrow: (stdout: string, stderr: string, exitCode: number) => void;
};

export async function executeCommand(params: CommandParams) {
    const child = spawn(params.command, params.args, {
        cwd: params.cwd,
        env: params.env,
        detached: params.detached === true,
        stdio: [params.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    if (params.detached) {
        child.unref();
    }

    if (params.input !== undefined && child.stdin) {
        child.stdin.write(params.input);
        child.stdin.end();
    }

    const res = await new Promise<[stdout: Buffer, stdOutString: string, stderr: string, exitCode: number]>((resolve, reject) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout?.on('data', (chunk: Buffer | string) => {
            stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
            stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            const out = Buffer.concat(stdoutChunks);
            const outStr = params.bufferOnly ? '' : out.toString('utf8');
            resolve([out, outStr, Buffer.concat(stderrChunks).toString('utf8'), code ?? (signal ? 1 : 0)]);
        });
    });

    const [, stdout, stderr, exitCode] = res;
    if (params.allowedExitCodes && !params.allowedExitCodes.includes(exitCode)) {
        if (params.getErrorToThrow) {
            const normalizedStderr = stderr.trim();
            const normalizedStdout = stdout.trim();
            throw params.getErrorToThrow(normalizedStdout, normalizedStderr, exitCode);
        } else {
            throw new Error(`Command exited with code ${exitCode}.\n\n${stderr}`);
        }
    }
    return res;
}
