import { existsSync } from 'node:fs';

/**
 * PowerShell lookup and probe parsing for the Windows MS Access driver.
 *
 * The provider probe only ever runs on a Windows machine, so everything here is pure or takes
 * the process/fs boundary as an argument: `msAccessPsProbe.spec.ts` drives the parse/choose
 * logic on any platform and leaves the real spawn to a Windows run.
 */

/** Marks an x64 `cmd.exe` that launches an x64 `powershell.exe` (see `getDefaultPsPaths`). */
const CMD_WRAPPER_PREFIX = 'CMD_WRAPPER:';

/** Thrown when PowerShell failed for a reason worth one retry (progress/CLIXML noise). */
export const PS_TRANSIENT_ERROR = '__TRANSIENT__';

export type PowerShellInvocation = {
    /** Executable to spawn: `powershell.exe` itself, or the `cmd.exe` wrapper. */
    executable: string;
    args: string[];
};

/** The candidate PowerShell hosts, most native first, with a PATH lookup as the last resort. */
export function getDefaultPsPaths(windir: string | undefined, exists: (path: string) => boolean = existsSync): string[] {
    const paths: string[] = [];
    const native = windir ? `${windir}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : null;
    const x64 = windir ? `${windir}\\SysArm32\\WindowsPowerShell\\v1.0\\powershell.exe` : null;
    const x86 = windir ? `${windir}\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe` : null;
    const x64Cmd = windir ? `${windir}\\SysArm32\\cmd.exe` : null; // x64 cmd → launches x64 powershell
    if (native && exists(native)) paths.push(native);
    if (x64 && exists(x64)) paths.push(x64);
    if (x86 && exists(x86)) paths.push(x86);
    if (x64Cmd && exists(x64Cmd)) paths.push(`${CMD_WRAPPER_PREFIX}${x64Cmd}`);
    paths.push('powershell.exe');
    return paths;
}

/** Builds the argv for a candidate: a bare `powershell.exe` or the x64 `cmd.exe` wrapper. */
export function getPowerShellInvocation(psPath: string, scriptPath: string): PowerShellInvocation {
    const isCmdWrapper = psPath.startsWith(CMD_WRAPPER_PREFIX);
    const executable = isCmdWrapper ? psPath.slice(CMD_WRAPPER_PREFIX.length) : psPath;
    const args = isCmdWrapper
        ? ['/c', 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
        : ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    return { executable, args };
}

/**
 * Rewrites a script's `[System.Console]::WriteLine(...)` output into a result file: stdout from a
 * Click-to-Run PowerShell host is unreliable, the file is not.
 */
export function buildResultFileScript(script: string, resultPath: string): string {
    const outFile = `Out-File -Encoding UTF8 '${resultPath.replaceAll("'", "''")}'`;
    return script
        .replaceAll('[System.Console]::WriteLine($json)', `$json | ${outFile}`)
        .replaceAll('[System.Console]::WriteLine($errObjJson)', `$errObjJson | ${outFile}`)
        .replaceAll('[System.Console]::WriteLine($outputJson)', `$outputJson | ${outFile}`)
        .replaceAll('[System.Console]::WriteLine($output | ConvertTo-Json -Depth 5)', `($output | ConvertTo-Json -Depth 5) | ${outFile}`);
}

/** PowerShell writes progress and CLIXML noise to stderr; an empty result after that is worth a retry. */
export function isTransientPowerShellStderr(stderr: string): boolean {
    return stderr.includes('progress') || stderr.includes('CLIXML');
}

/** Parses the JSON the result file holds: `{ success, data }` or `{ success, error }`. */
export function parsePowerShellResult(content: string): any[] {
    let parsed: any;
    try {
        parsed = JSON.parse(content.trim());
    } catch {
        throw new Error(`Failed to parse result. Content: ${content.slice(0, 200)}`);
    }
    if (parsed?.success) {
        return parsed.data || [];
    }
    throw new Error(parsed?.error ?? 'PowerShell reported a failure without a message.');
}

/**
 * Walks the candidate paths in order and returns the first result. A transient failure gets one
 * retry on the same host before the next candidate is tried.
 */
export async function runPowerShellCandidates<T>(psPaths: string[], runOne: (psPath: string) => Promise<T>): Promise<T> {
    const errors: Error[] = [];

    for (const psPath of psPaths) {
        try {
            return await runOne(psPath);
        } catch (caught) {
            const error = caught instanceof Error ? caught : new Error(String(caught));
            if (error.message === PS_TRANSIENT_ERROR) {
                try {
                    return await runOne(psPath);
                } catch (retryCaught) {
                    errors.push(retryCaught instanceof Error ? retryCaught : new Error(String(retryCaught)));
                }
            } else {
                errors.push(error);
            }
        }
    }

    if (errors.length === 0) {
        throw new Error('No PowerShell host was available to try.');
    }

    throw new Error(`All PowerShell paths failed. Last error: ${errors[errors.length - 1].message}`);
}

export type AccessProviderProbe = {
    psPath: string;
    provider: string;
    /** The whole probe answer, so the caller can log what the winning host reported. */
    result: Record<string, unknown>;
};

/**
 * Reads the probe answer. `ConvertTo-Json` wraps a single object in an array, so both
 * `[{ provider }]` and `{ provider }` are accepted; an answer without a usable provider means
 * "this host cannot open the file" and the caller tries the next one.
 */
export function parseProviderProbeResult(data: unknown): Record<string, unknown> | null {
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return null;
    }
    const provider = (result as { provider?: unknown }).provider;
    return typeof provider === 'string' && provider.trim() ? (result as Record<string, unknown>) : null;
}

/** Probes each PowerShell host until one reports a working OLEDB provider. */
export async function probeAccessProvider(
    psPaths: string[],
    runProbe: (psPath: string) => Promise<unknown>,
    onFailure: (message: string) => void = () => {}
): Promise<AccessProviderProbe | null> {
    for (const psPath of psPaths) {
        try {
            const result = parseProviderProbeResult(await runProbe(psPath));
            if (result) {
                return { psPath, provider: result.provider as string, result };
            }
        } catch (error) {
            onFailure(`[ps-probe] ${psPath} failed: ${String(error)}`);
        }
    }

    return null;
}
