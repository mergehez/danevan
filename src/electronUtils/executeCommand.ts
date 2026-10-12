import { spawn } from 'child_process';
import { currentRequestAbortSignal } from './requestContext.ts';

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
    /** Kills the child when it is still running after this many milliseconds. */
    timeoutMs?: number;
    /** Kills the child when this signal aborts. Falls back to the abort signal of the request being served. */
    signal?: AbortSignal;
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

    const abortSignal = params.signal ?? currentRequestAbortSignal();
    let timedOut = false;
    let abortReason: unknown;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const killChild = () => {
        if (!child.killed) {
            child.kill('SIGKILL');
        }
    };

    const onAbort = () => {
        abortReason = abortSignal?.reason ?? new Error('Command cancelled.');
        killChild();
    };

    if (abortSignal) {
        if (abortSignal.aborted) {
            onAbort();
        } else {
            abortSignal.addEventListener('abort', onAbort, { once: true });
        }
    }

    if (!abortReason && params.timeoutMs !== undefined && params.timeoutMs > 0) {
        killTimer = setTimeout(() => {
            timedOut = true;
            killChild();
        }, params.timeoutMs);
    }

    if (params.input !== undefined && child.stdin) {
        // A killed child can close its stdin before the write lands.
        child.stdin.on('error', () => {});
        child.stdin.write(params.input);
        child.stdin.end();
    }

    const res = await new Promise<[stdout: Buffer, stdOutString: string, stderr: string, exitCode: number]>((resolve, reject) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        const cleanup = () => {
            if (killTimer !== undefined) {
                clearTimeout(killTimer);
                killTimer = undefined;
            }
            abortSignal?.removeEventListener('abort', onAbort);
        };

        child.stdout?.on('data', (chunk: Buffer | string) => {
            stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
            stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.on('error', (error) => {
            cleanup();
            reject(error);
        });
        child.on('close', (code, signal) => {
            cleanup();
            const out = Buffer.concat(stdoutChunks);
            const outStr = params.bufferOnly ? '' : out.toString('utf8');
            resolve([out, outStr, Buffer.concat(stderrChunks).toString('utf8'), code ?? (signal ? 1 : 0)]);
        });
    });

    const [, stdout, stderr, exitCode] = res;

    if (timedOut) {
        throw new Error(`Command timed out after ${params.timeoutMs}ms: ${params.command} ${params.args.join(' ')}`);
    }

    if (abortReason !== undefined) {
        const reasonMessage = abortReason instanceof Error ? abortReason.message : String(abortReason);
        throw new Error(`Command cancelled: ${reasonMessage}`);
    }

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
