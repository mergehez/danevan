import { SpawnOptions } from 'bun';

async function readText(stream: SpawnOptions.ReadableToIO<any>) {
    if (!stream) {
        return '';
    }

    return await new Response(stream as ReadableStream).text();
}

async function readBuffer(stream: SpawnOptions.ReadableToIO<any>) {
    if (!stream) {
        return Buffer.alloc(0);
    }

    return Buffer.from(await new Response(stream as ReadableStream).arrayBuffer());
}

function writeInput(stdin: SpawnOptions.WritableToIO<any>, input: string | undefined) {
    if (input === undefined || stdin === undefined || typeof stdin === 'number') {
        return;
    }

    stdin.write(input);
    stdin.flush?.();
    stdin.end();
}

type CommandParams = {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    detached?: boolean;
};
function spawnProcess(params: CommandParams) {
    const child = Bun.spawn({
        cmd: [params.command, ...params.args],
        cwd: params.cwd,
        env: params.env,
        stdin: params.input !== undefined ? 'pipe' : 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    });

    if (params.detached) {
        child.unref();
    }

    writeInput(child.stdin, params.input);

    return child;
}

export async function executeTextCommand(params: CommandParams) {
    const child = spawnProcess(params);
    return await Promise.all([readText(child.stdout), readText(child.stderr), child.exited]);
}

export async function executeBufferCommand(params: CommandParams) {
    const child = spawnProcess(params);
    return await Promise.all([readBuffer(child.stdout), readText(child.stderr), child.exited]);
}
