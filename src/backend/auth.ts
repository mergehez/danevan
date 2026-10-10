import { createHash } from 'node:crypto';
import { resolveAppDataDir, resolveDefaultAppDataDir } from '../electronUtils/appDataDir.ts';
import { executeTextCommand } from './bunSubprocess.ts';

const KEYCHAIN_SERVICE_NAME = 'Danevan';

/**
 * Everything the keychain needs beyond this module: the process it spawns, the platform it runs on,
 * and the data dir whose secrets it keeps. All of it is the process boundary, injected so a spec can
 * assert the real `security` argv instead of mocking this module.
 */
export type KeychainDeps = {
    platform: NodeJS.Platform;
    run: (command: string, args: string[]) => Promise<[string, string, number | null]>;
    appDataDir: string;
};

const defaultDeps: KeychainDeps = {
    platform: process.platform,
    run: (command, args) => executeTextCommand({ command, args }),
    appDataDir: resolveAppDataDir(),
};

/**
 * The account name a data dir stores its secrets under. The installation that predates the
 * namespacing keeps `danevan-server-password-<id>`, so the passwords it already stored still
 * resolve. Every other data dir — a second installation, a test run — gets its own namespace:
 * its ids restart at 1, and one dir must never read, or delete, the other's entries.
 */
export function getKeychainAccountSuffix(appDataDir: string, defaultAppDataDir = resolveDefaultAppDataDir()) {
    return appDataDir === defaultAppDataDir ? '' : `-${createHash('sha256').update(appDataDir).digest('hex').slice(0, 8)}`;
}

export function useKeychain(deps: KeychainDeps = defaultDeps) {
    const accountSuffix = getKeychainAccountSuffix(deps.appDataDir);
    /**
     * Reading a secret spawns a `security` process (~16 ms measured), and one UI interaction issues
     * several backend calls, so the secret is cached per account. Every write drops the cached entry.
     */
    const secretCache = new Map<string, string | null>();

    async function runSecurityCommand(args: string[], allowedExitCodes: number[] = [0]) {
        const [stdout, stderr, exitCode] = await deps.run('security', args);

        if (exitCode !== null && !allowedExitCodes.includes(exitCode)) {
            throw new Error(stderr.trim() || stdout.trim() || 'Keychain command failed.');
        }

        return stdout.trim();
    }

    async function storeKeychainSecret(accountName: string, label: string, secret: string) {
        await runSecurityCommand(['add-generic-password', '-a', accountName, '-s', KEYCHAIN_SERVICE_NAME, '-l', label, '-w', secret, '-U']);
    }

    async function readKeychainSecret(accountName: string) {
        const [stdout, stderr, exitCode] = await deps.run('security', ['find-generic-password', '-a', accountName, '-s', KEYCHAIN_SERVICE_NAME, '-w']);

        if (exitCode === 44) {
            return null;
        }

        if (exitCode !== 0) {
            throw new Error(stderr.trim() || stdout.trim() || 'Keychain command failed.');
        }

        return stdout.trim();
    }

    async function deleteKeychainSecret(accountName: string) {
        await runSecurityCommand(['delete-generic-password', '-a', accountName, '-s', KEYCHAIN_SERVICE_NAME], [0, 44]);
    }

    async function readKeychainSecretCached(accountName: string) {
        if (secretCache.has(accountName)) {
            return secretCache.get(accountName) ?? null;
        }

        const secret = await readKeychainSecret(accountName);
        secretCache.set(accountName, secret);

        return secret;
    }

    function ensureSupportedPlatform() {
        if (deps.platform !== 'darwin') {
            throw new Error('Secure account storage is currently supported on macOS only.');
        }
    }

    function getConnectionPasswordAccountName(connectionId: number) {
        return `danevan-connection-password${accountSuffix}-${connectionId}`;
    }

    function getServerPasswordAccountName(serverId: number) {
        return `danevan-server-password${accountSuffix}-${serverId}`;
    }

    async function storeConnectionPassword(connectionId: number, label: string, password: string) {
        ensureSupportedPlatform();

        await storeKeychainSecret(getConnectionPasswordAccountName(connectionId), label, password);
        secretCache.delete(getConnectionPasswordAccountName(connectionId));
    }

    async function deleteConnectionPassword(connectionId: number) {
        ensureSupportedPlatform();

        await deleteKeychainSecret(getConnectionPasswordAccountName(connectionId));
        secretCache.delete(getConnectionPasswordAccountName(connectionId));
    }

    async function readConnectionPassword(connectionId: number) {
        ensureSupportedPlatform();

        return await readKeychainSecretCached(getConnectionPasswordAccountName(connectionId));
    }

    async function storeServerPassword(serverId: number, label: string, password: string) {
        ensureSupportedPlatform();

        await storeKeychainSecret(getServerPasswordAccountName(serverId), label, password);
        secretCache.delete(getServerPasswordAccountName(serverId));
    }

    async function deleteServerPassword(serverId: number) {
        ensureSupportedPlatform();

        await deleteKeychainSecret(getServerPasswordAccountName(serverId));
        secretCache.delete(getServerPasswordAccountName(serverId));
    }

    async function readServerPassword(serverId: number) {
        ensureSupportedPlatform();

        return await readKeychainSecretCached(getServerPasswordAccountName(serverId));
    }

    return {
        getConnectionPasswordAccountName,
        getServerPasswordAccountName,
        storeConnectionPassword,
        deleteConnectionPassword,
        readConnectionPassword,
        storeServerPassword,
        deleteServerPassword,
        readServerPassword,
    };
}

const defaultKeychain = useKeychain();

export const storeConnectionPassword = defaultKeychain.storeConnectionPassword;
export const deleteConnectionPassword = defaultKeychain.deleteConnectionPassword;
export const readConnectionPassword = defaultKeychain.readConnectionPassword;
export const storeServerPassword = defaultKeychain.storeServerPassword;
export const deleteServerPassword = defaultKeychain.deleteServerPassword;
export const readServerPassword = defaultKeychain.readServerPassword;
