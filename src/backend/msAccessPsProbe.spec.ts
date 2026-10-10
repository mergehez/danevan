// @vitest-environment node
// `useMsAccessWindowsDriver` only ever probes PowerShell on a Windows machine. The lookup,
// the probe-answer parsing and the resulting provider choice inject the process/fs boundary, so
// they are asserted here on any platform; the real spawn stays for a Windows run.
import { describe, expect, it } from 'vitest';
import {
    buildResultFileScript,
    getDefaultPsPaths,
    getPowerShellInvocation,
    isTransientPowerShellStderr,
    parsePowerShellResult,
    parseProviderProbeResult,
    probeAccessProvider,
    PS_TRANSIENT_ERROR,
    runPowerShellCandidates,
} from './msAccessPsProbe.ts';

const WINDIR = 'C:\\Windows';
const NATIVE_PS = `${WINDIR}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const X64_PS = `${WINDIR}\\SysArm32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const X86_PS = `${WINDIR}\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe`;
const X64_CMD = `${WINDIR}\\SysArm32\\cmd.exe`;
const PATH_PS = 'powershell.exe';
const PS_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

async function captureError(run: () => Promise<unknown>): Promise<Error> {
    try {
        await run();
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected the run to fail');
}

describe('getDefaultPsPaths', () => {
    it('prefers the native host, then the bitness fallbacks, then the PATH lookup', () => {
        expect(getDefaultPsPaths(WINDIR, () => true)).toEqual([NATIVE_PS, X64_PS, X86_PS, `CMD_WRAPPER:${X64_CMD}`, PATH_PS]);
    });

    it('skips the hosts this machine does not have', () => {
        expect(getDefaultPsPaths(WINDIR, (path) => path === X86_PS)).toEqual([X86_PS, PATH_PS]);
    });

    it('falls back to the PATH lookup alone when windir is unknown', () => {
        expect(getDefaultPsPaths(undefined, () => true)).toEqual([PATH_PS]);
    });

    it('asks the filesystem about every known host', () => {
        const probed: string[] = [];

        getDefaultPsPaths(WINDIR, (path) => {
            probed.push(path);
            return false;
        });

        expect(probed).toEqual([NATIVE_PS, X64_PS, X86_PS, X64_CMD]);
    });
});

describe('getPowerShellInvocation', () => {
    const scriptPath = 'C:\\Users\\me\\AppData\\Local\\Temp\\danevan-ps\\script.ps1';

    it('spawns a discovered powershell.exe directly', () => {
        expect(getPowerShellInvocation(NATIVE_PS, scriptPath)).toEqual({
            executable: NATIVE_PS,
            args: [...PS_ARGS, '-File', scriptPath],
        });
    });

    it('routes the x64 cmd.exe wrapper through powershell.exe', () => {
        expect(getPowerShellInvocation(`CMD_WRAPPER:${X64_CMD}`, scriptPath)).toEqual({
            executable: X64_CMD,
            args: ['/c', 'powershell.exe', ...PS_ARGS, '-File', scriptPath],
        });
    });
});

describe('buildResultFileScript', () => {
    const resultPath = 'C:\\Users\\me\\result.json';
    const outFile = `Out-File -Encoding UTF8 '${resultPath}'`;

    it('replaces every console write with the result file', () => {
        const script = [
            '[System.Console]::WriteLine($json)',
            '[System.Console]::WriteLine($errObjJson)',
            '[System.Console]::WriteLine($outputJson)',
            '[System.Console]::WriteLine($output | ConvertTo-Json -Depth 5)',
        ].join('\n');

        expect(buildResultFileScript(script, resultPath).split('\n')).toEqual([
            `$json | ${outFile}`,
            `$errObjJson | ${outFile}`,
            `$outputJson | ${outFile}`,
            `($output | ConvertTo-Json -Depth 5) | ${outFile}`,
        ]);
    });

    it('escapes a single quote in the result path so PowerShell reads one literal path', () => {
        const built = buildResultFileScript('[System.Console]::WriteLine($json)', "C:\\Users\\O'Brien\\result.json");

        expect(built).toBe("$json | Out-File -Encoding UTF8 'C:\\Users\\O''Brien\\result.json'");
    });

    it('leaves the rest of the script untouched', () => {
        const script = '$conn.Open()\n$result = $result';

        expect(buildResultFileScript(script, resultPath)).toBe(script);
    });
});

describe('isTransientPowerShellStderr', () => {
    it('retries the CLIXML and progress noise a fresh PowerShell host writes', () => {
        expect(isTransientPowerShellStderr('#< CLIXML\r\n<Objs Version="1.1.0.1">')).toBe(true);
        expect(isTransientPowerShellStderr('<S S="progress">Preparing modules for first use.</S>')).toBe(true);
    });

    it('does not call a real error transient', () => {
        expect(isTransientPowerShellStderr('Exception calling "Open" with "1" argument(s): "Unspecified error"')).toBe(false);
    });
});

describe('parsePowerShellResult', () => {
    it('reads the data array a query script wrote', () => {
        expect(parsePowerShellResult('{"success":true,"data":[{"name":"Customers"}]}')).toEqual([{ name: 'Customers' }]);
    });

    it('reads a single object answer, which is how the probe reports its provider', () => {
        const answer = { provider: 'Microsoft.ACE.OLEDB.16.0', tried: [] };

        expect(parsePowerShellResult(`{"success":true,"data":${JSON.stringify(answer)}}`)).toEqual(answer);
    });

    it('answers with no rows when the script succeeded without data', () => {
        expect(parsePowerShellResult('{"success":true}')).toEqual([]);
    });

    it('ignores the whitespace Out-File adds around the JSON', () => {
        expect(parsePowerShellResult('\n  {"success":true,"data":[]}  \n')).toEqual([]);
    });

    it('surfaces the script error message', () => {
        expect(() => parsePowerShellResult('{"success":false,"error":"No working Access OLEDB provider."}')).toThrow('No working Access OLEDB provider.');
    });

    it('says so when the script failed without a message', () => {
        expect(() => parsePowerShellResult('{"success":false}')).toThrow('PowerShell reported a failure without a message.');
    });

    it('shows the truncated content when the result is not JSON', () => {
        expect(() => parsePowerShellResult('not json at all')).toThrow('Failed to parse result. Content: not json at all');
        expect(() => parsePowerShellResult('x'.repeat(500))).toThrow(`Failed to parse result. Content: ${'x'.repeat(200)}`);
    });
});

describe('parseProviderProbeResult', () => {
    const answer = { provider: 'Microsoft.ACE.OLEDB.16.0', tried: [] };

    it('unwraps the array ConvertTo-Json writes for a single object', () => {
        expect(parseProviderProbeResult([answer])).toEqual(answer);
    });

    it('accepts a bare object answer', () => {
        expect(parseProviderProbeResult(answer)).toEqual(answer);
    });

    it.each([
        ['an empty answer', []],
        ['a nested array', [[answer]]],
        ['a probe that tried every provider and failed', [{ tried: [{ provider: 'Microsoft.ACE.OLEDB.16.0' }] }]],
        ['an empty provider name', [{ provider: '' }]],
        ['a whitespace provider name', [{ provider: '   ' }]],
        ['a non-string provider', [{ provider: 16 }]],
        ['nothing at all', undefined],
        ['null', null],
        ['a plain string', 'Microsoft.ACE.OLEDB.16.0'],
    ])('rejects %s', (_label, data) => {
        expect(parseProviderProbeResult(data)).toBeNull();
    });
});

describe('probeAccessProvider', () => {
    const answer = { provider: 'Microsoft.ACE.OLEDB.16.0', tried: [] };

    it('returns the first host that reports a provider', async () => {
        const probed: string[] = [];

        const probe = await probeAccessProvider([NATIVE_PS, X64_PS], async (psPath) => {
            probed.push(psPath);
            return [answer];
        });

        expect(probe).toEqual({ psPath: NATIVE_PS, provider: 'Microsoft.ACE.OLEDB.16.0', result: answer });
        expect(probed).toEqual([NATIVE_PS]);
    });

    it('skips a host that fails and keeps the next one', async () => {
        const failures: string[] = [];

        const probe = await probeAccessProvider(
            [X64_PS, NATIVE_PS],
            async (psPath) => {
                if (psPath === X64_PS) throw new Error('could not load System.Data.OleDb');
                return [answer];
            },
            (message) => failures.push(message)
        );

        expect(probe?.psPath).toBe(NATIVE_PS);
        expect(failures).toEqual([`[ps-probe] ${X64_PS} failed: Error: could not load System.Data.OleDb`]);
    });

    it('keeps going when a host answers without a provider', async () => {
        const failures: string[] = [];

        const probe = await probeAccessProvider(
            [X64_PS, NATIVE_PS],
            async (psPath) => (psPath === X64_PS ? [{ tried: [{ provider: 'Microsoft.ACE.OLEDB.16.0' }] }] : [answer]),
            (message) => failures.push(message)
        );

        expect(probe?.psPath).toBe(NATIVE_PS);
        expect(failures).toEqual([]);
    });

    it('gives up when no host has a working provider', async () => {
        const failures: string[] = [];

        const probe = await probeAccessProvider(
            [NATIVE_PS, X64_PS],
            async () => {
                throw new Error('No working Access OLEDB provider.');
            },
            (message) => failures.push(message)
        );

        expect(probe).toBeNull();
        expect(failures).toEqual([
            `[ps-probe] ${NATIVE_PS} failed: Error: No working Access OLEDB provider.`,
            `[ps-probe] ${X64_PS} failed: Error: No working Access OLEDB provider.`,
        ]);
    });

    it('returns null with no candidates to try', async () => {
        expect(await probeAccessProvider([], async () => [answer])).toBeNull();
    });

    it('stays quiet when the caller does not want the failures reported', async () => {
        const probe = await probeAccessProvider([NATIVE_PS], async () => {
            throw new Error('No working Access OLEDB provider.');
        });

        expect(probe).toBeNull();
    });
});

describe('runPowerShellCandidates', () => {
    const first = NATIVE_PS;
    const second = PATH_PS;

    it('returns the first successful result without touching the later hosts', async () => {
        const tried: string[] = [];

        const result = await runPowerShellCandidates([first, second], async (psPath) => {
            tried.push(psPath);
            return `${psPath} answered`;
        });

        expect(result).toBe(`${first} answered`);
        expect(tried).toEqual([first]);
    });

    it('retries the same host once after a transient failure', async () => {
        const tried: string[] = [];

        const result = await runPowerShellCandidates([first, second], async (psPath) => {
            tried.push(psPath);
            if (tried.length === 1) throw new Error(PS_TRANSIENT_ERROR);
            return `${psPath} answered`;
        });

        expect(result).toBe(`${first} answered`);
        expect(tried).toEqual([first, first]);
    });

    it('moves to the next host after a real failure', async () => {
        const tried: string[] = [];

        const result = await runPowerShellCandidates([first, second], async (psPath) => {
            tried.push(psPath);
            if (psPath === first) throw new Error('PowerShell exited with code 1: access denied');
            return `${psPath} answered`;
        });

        expect(result).toBe(`${second} answered`);
        expect(tried).toEqual([first, second]);
    });

    it('reports the last error when every host fails', async () => {
        const error = await captureError(() => runPowerShellCandidates([first, second], async (psPath) => Promise.reject(new Error(`boom on ${psPath}`))));

        expect(error.message).toBe(`All PowerShell paths failed. Last error: boom on ${second}`);
    });

    it('reports the retry error, not the transient marker, when the retry fails too', async () => {
        let attempts = 0;

        const error = await captureError(() =>
            runPowerShellCandidates([first], async () => {
                attempts += 1;
                throw new Error(attempts === 1 ? PS_TRANSIENT_ERROR : 'still broken');
            })
        );

        expect(error.message).toBe('All PowerShell paths failed. Last error: still broken');
        expect(attempts).toBe(2);
    });

    it('carries a non-Error rejection into the aggregate', async () => {
        const error = await captureError(() => runPowerShellCandidates([first], async () => Promise.reject('powershell.exe is not recognized')));

        expect(error.message).toBe('All PowerShell paths failed. Last error: powershell.exe is not recognized');
    });

    it('carries a non-Error retry rejection into the aggregate', async () => {
        let attempts = 0;

        const error = await captureError(() =>
            runPowerShellCandidates([first], async () => {
                attempts += 1;
                throw attempts === 1 ? new Error(PS_TRANSIENT_ERROR) : 'the wrapper crashed';
            })
        );

        expect(error.message).toBe('All PowerShell paths failed. Last error: the wrapper crashed');
    });

    it('names the missing host when there is no candidate at all', async () => {
        const error = await captureError(() => runPowerShellCandidates([], async () => 'unreachable'));

        expect(error.message).toBe('No PowerShell host was available to try.');
    });
});
