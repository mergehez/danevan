// The keychain is driven through an injected process boundary, so what is asserted is the real
// `security` argv an app run would send — the account and service names, the `-U` update flag and the
// exit codes — instead of a mock of this module. The fake keychain stores what `add` wrote, so a
// stored secret can be read back: if `add` and `find` named different accounts, the read returns null.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getKeychainAccountSuffix, useKeychain, type KeychainDeps } from '../../../backend/auth.ts';
import { resolveDefaultAppDataDir } from '../../../electronUtils/appDataDir';

type SecurityCall = { command: string; args: string[] };

/** A keychain that keeps the secrets it was given, the way `security` does. */
function createFakeKeychain() {
    const entries = new Map<string, string>();
    const calls: SecurityCall[] = [];

    async function run(command: string, args: string[]): Promise<[string, string, number | null]> {
        calls.push({ command, args });

        const accountName = args[args.indexOf('-a') + 1] ?? '';

        switch (args[0]) {
            case 'add-generic-password':
                entries.set(accountName, args[args.indexOf('-w') + 1] ?? '');
                return ['', '', 0];
            case 'find-generic-password':
                return entries.has(accountName)
                    ? [entries.get(accountName)!, '', 0]
                    : ['', 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.', 44];
            case 'delete-generic-password':
                return entries.delete(accountName) ? ['', '', 0] : ['', 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.', 44];
            default:
                return ['', `security: unknown command ${args[0]}`, 1];
        }
    }

    return { entries, calls, run };
}

function createKeychain(overrides: Partial<KeychainDeps> = {}) {
    const keychain = createFakeKeychain();

    return {
        keychain,
        auth: useKeychain({
            platform: 'darwin',
            run: keychain.run,
            appDataDir: join(tmpdir(), 'danevan-keychain-fixture'),
            ...overrides,
        }),
    };
}

describe('keychain account names', () => {
    it('keeps the plain name the installed app already stored its passwords under', () => {
        const defaultDir = resolveDefaultAppDataDir();
        const { auth } = createKeychain({ appDataDir: defaultDir });

        expect(getKeychainAccountSuffix(defaultDir)).toBe('');
        expect(auth.getServerPasswordAccountName(7)).toBe('danevan-server-password-7');
        expect(auth.getConnectionPasswordAccountName(12)).toBe('danevan-connection-password-12');
    });

    it('gives every other data dir its own namespace, stable per dir', () => {
        const first = getKeychainAccountSuffix('/tmp/danevan-e2e-a');
        const second = getKeychainAccountSuffix('/tmp/danevan-e2e-b');

        expect(first).toMatch(/^-[0-9a-f]{8}$/);
        expect(getKeychainAccountSuffix('/tmp/danevan-e2e-a')).toBe(first);
        expect(second).not.toBe(first);
    });
});

describe('keychain security argv', () => {
    it('stores a server password with the update flag and reads it back', async () => {
        const { auth, keychain } = createKeychain();
        const accountName = auth.getServerPasswordAccountName(3);

        await auth.storeServerPassword(3, 'e2e server password', 's3cret');

        expect(keychain.calls).toEqual([
            {
                command: 'security',
                args: ['add-generic-password', '-a', accountName, '-s', 'Danevan', '-l', 'e2e server password', '-w', 's3cret', '-U'],
            },
        ]);

        expect(await auth.readServerPassword(3)).toBe('s3cret');
        expect(keychain.calls[1]).toEqual({ command: 'security', args: ['find-generic-password', '-a', accountName, '-s', 'Danevan', '-w'] });
    });

    it('stores a connection password under the connection account and deletes it there', async () => {
        const { auth, keychain } = createKeychain();
        const accountName = auth.getConnectionPasswordAccountName(9);

        await auth.storeConnectionPassword(9, 'e2e connection password', 'p4ss');
        expect(await auth.readConnectionPassword(9)).toBe('p4ss');

        await auth.deleteConnectionPassword(9);

        expect(keychain.calls.at(-1)).toEqual({ command: 'security', args: ['delete-generic-password', '-a', accountName, '-s', 'Danevan'] });
        expect(await auth.readConnectionPassword(9)).toBeNull();
    });

    it('namespaces the stored account when another data dir runs the app', async () => {
        const { auth, keychain } = createKeychain({ appDataDir: '/tmp/danevan-e2e-namespaced' });

        await auth.storeServerPassword(3, 'label', 's3cret');

        const accountName = keychain.calls[0]?.args[2] ?? '';
        expect(accountName).toBe(`danevan-server-password${getKeychainAccountSuffix('/tmp/danevan-e2e-namespaced')}-3`);
        expect(accountName).not.toBe('danevan-server-password-3');
    });
});

describe('keychain failures', () => {
    it('reports a missing secret as no secret, and tolerates the same code when deleting', async () => {
        const { auth } = createKeychain();

        expect(await auth.readServerPassword(1)).toBeNull();
        await expect(auth.deleteServerPassword(1)).resolves.toBeUndefined();
    });

    it('reports what the security command printed when it fails for another reason', async () => {
        const denied = async (): Promise<[string, string, number | null]> => ['', 'security: SecKeychainItemModifyContent: UNIX[Operation not permitted]', 51];
        const { auth } = createKeychain({ run: denied });

        await expect(auth.storeServerPassword(1, 'label', 'secret')).rejects.toThrow('SecKeychainItemModifyContent: UNIX[Operation not permitted]');
        await expect(auth.readServerPassword(1)).rejects.toThrow('SecKeychainItemModifyContent: UNIX[Operation not permitted]');
    });

    it('refuses to touch the keychain on another platform', async () => {
        const { auth, keychain } = createKeychain({ platform: 'linux' });

        await expect(auth.readServerPassword(1)).rejects.toThrow('Secure account storage is currently supported on macOS only.');
        await expect(auth.storeConnectionPassword(1, 'label', 'secret')).rejects.toThrow('Secure account storage is currently supported on macOS only.');
        expect(keychain.calls).toEqual([]);
    });
});

describe('keychain secret cache', () => {
    it('spawns security once for repeated reads of the same account', async () => {
        const { auth, keychain } = createKeychain();

        await auth.storeServerPassword(1, 'label', 'secret-value');

        expect(await auth.readServerPassword(1)).toBe('secret-value');
        expect(await auth.readServerPassword(1)).toBe('secret-value');
        expect(keychain.calls.filter((call) => call.args[0] === 'find-generic-password')).toHaveLength(1);
    });

    it('reads distinct accounts separately and re-reads one after it is stored again', async () => {
        const { auth, keychain } = createKeychain();

        await auth.storeServerPassword(1, 'label', 'first');
        await auth.storeServerPassword(2, 'label', 'second');

        expect(await auth.readServerPassword(1)).toBe('first');
        expect(await auth.readServerPassword(2)).toBe('second');

        await auth.storeServerPassword(1, 'label', 'rotated');

        expect(await auth.readServerPassword(1)).toBe('rotated');
        expect(keychain.calls.filter((call) => call.args[0] === 'find-generic-password')).toHaveLength(3);
    });
});
