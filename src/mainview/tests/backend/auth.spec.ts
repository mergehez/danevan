// A keychain read spawns a `security` process (~16 ms measured) and one UI
// interaction issues several backend calls, so the secret is cached in-process
// and every write through this module drops the cached entry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeTextCommand: vi.fn<(params: { command: string; args: string[] }) => Promise<[string, string, number | null]>>(),
}));

vi.mock('../../../backend/bunSubprocess.ts', () => ({ executeTextCommand: mocks.executeTextCommand }));

const originalPlatform = process.platform;

async function loadAuth() {
    return import('../../../backend/auth.ts');
}

beforeEach(() => {
    vi.resetModules();
    mocks.executeTextCommand.mockReset();
    mocks.executeTextCommand.mockImplementation(async ({ args }) => (args[0] === 'find-generic-password' ? ['secret-value', '', 0] : ['', '', 0]));
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});

afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

describe('keychain secret cache', () => {
    it('spawns security once for repeated reads of the same account', async () => {
        const { readServerPassword } = await loadAuth();

        expect(await readServerPassword(1)).toBe('secret-value');
        expect(await readServerPassword(1)).toBe('secret-value');
        expect(await readServerPassword(1)).toBe('secret-value');

        expect(mocks.executeTextCommand).toHaveBeenCalledTimes(1);
    });

    it('reads distinct accounts separately', async () => {
        const { readServerPassword } = await loadAuth();

        await readServerPassword(1);
        await readServerPassword(2);

        expect(mocks.executeTextCommand).toHaveBeenCalledTimes(2);
    });

    it('drops the cached secret when it is stored again', async () => {
        const { readServerPassword, storeServerPassword } = await loadAuth();

        await readServerPassword(1);
        mocks.executeTextCommand.mockImplementation(async ({ args }) => (args[0] === 'find-generic-password' ? ['rotated', '', 0] : ['', '', 0]));
        await storeServerPassword(1, 'label', 'rotated');

        expect(await readServerPassword(1)).toBe('rotated');
        expect(mocks.executeTextCommand.mock.calls.filter(([params]) => params.args[0] === 'find-generic-password')).toHaveLength(2);
    });

    it('caches a missing secret until it is written', async () => {
        mocks.executeTextCommand.mockImplementation(async ({ args }) => (args[0] === 'find-generic-password' ? ['', '', 44] : ['', '', 0]));
        const { readConnectionPassword, storeConnectionPassword } = await loadAuth();

        expect(await readConnectionPassword(5)).toBeNull();
        expect(await readConnectionPassword(5)).toBeNull();
        expect(mocks.executeTextCommand.mock.calls.filter(([params]) => params.args[0] === 'find-generic-password')).toHaveLength(1);

        await storeConnectionPassword(5, 'label', 'fresh');
        mocks.executeTextCommand.mockImplementation(async ({ args }) => (args[0] === 'find-generic-password' ? ['fresh', '', 0] : ['', '', 0]));

        expect(await readConnectionPassword(5)).toBe('fresh');
    });
});
