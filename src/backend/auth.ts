import { executeTextCommand } from './bunSubprocess.ts';

const KEYCHAIN_SERVICE_NAME = 'Danevan';

async function runSecurityCommand(args: string[], allowedExitCodes: number[] = [0]) {
    const [stdout, stderr, exitCode] = await executeTextCommand({
        command: 'security',
        args,
    });

    if (exitCode !== null && !allowedExitCodes.includes(exitCode)) {
        throw new Error(stderr.trim() || stdout.trim() || 'Keychain command failed.');
    }

    return stdout.trim();
}

async function storeKeychainSecret(serviceName: string, accountName: string, label: string, secret: string) {
    await runSecurityCommand(['add-generic-password', '-a', accountName, '-s', serviceName, '-l', label, '-w', secret, '-U']);
}

async function readKeychainSecret(serviceName: string, accountName: string) {
    const [stdout, stderr, exitCode] = await executeTextCommand({
        command: 'security',
        args: ['find-generic-password', '-a', accountName, '-s', serviceName, '-w'],
    });

    if (exitCode === 44) {
        return null;
    }

    if (exitCode !== 0) {
        throw new Error(stderr.trim() || stdout.trim() || 'Keychain command failed.');
    }

    return stdout.trim();
}

async function deleteKeychainSecret(serviceName: string, accountName: string) {
    await runSecurityCommand(['delete-generic-password', '-a', accountName, '-s', serviceName], [0, 44]);
}

/**
 * Reading a secret spawns a `security` process (~16 ms measured), and one UI
 * interaction issues several backend calls, so the secret is cached per account.
 * Every write through this module drops the cached entry.
 */
const keychainSecretCache = new Map<string, string | null>();

async function readKeychainSecretCached(serviceName: string, accountName: string) {
    if (keychainSecretCache.has(accountName)) {
        return keychainSecretCache.get(accountName) ?? null;
    }

    const secret = await readKeychainSecret(serviceName, accountName);
    keychainSecretCache.set(accountName, secret);

    return secret;
}

function ensureSupportedPlatform() {
    if (process.platform !== 'darwin') {
        throw new Error('Secure account storage is currently supported on macOS only.');
    }
}

function getConnectionPasswordAccountName(connectionId: number) {
    return `danevan-connection-password-${connectionId}`;
}

function getServerPasswordAccountName(serverId: number) {
    return `danevan-server-password-${serverId}`;
}

export async function storeConnectionPassword(connectionId: number, label: string, password: string) {
    ensureSupportedPlatform();

    await storeKeychainSecret(KEYCHAIN_SERVICE_NAME, getConnectionPasswordAccountName(connectionId), label, password);
    keychainSecretCache.delete(getConnectionPasswordAccountName(connectionId));
}

export async function deleteConnectionPassword(connectionId: number) {
    ensureSupportedPlatform();

    await deleteKeychainSecret(KEYCHAIN_SERVICE_NAME, getConnectionPasswordAccountName(connectionId));
    keychainSecretCache.delete(getConnectionPasswordAccountName(connectionId));
}

export async function readConnectionPassword(connectionId: number) {
    ensureSupportedPlatform();

    return await readKeychainSecretCached(KEYCHAIN_SERVICE_NAME, getConnectionPasswordAccountName(connectionId));
}

export async function storeServerPassword(serverId: number, label: string, password: string) {
    ensureSupportedPlatform();

    await storeKeychainSecret(KEYCHAIN_SERVICE_NAME, getServerPasswordAccountName(serverId), label, password);
    keychainSecretCache.delete(getServerPasswordAccountName(serverId));
}

export async function deleteServerPassword(serverId: number) {
    ensureSupportedPlatform();

    await deleteKeychainSecret(KEYCHAIN_SERVICE_NAME, getServerPasswordAccountName(serverId));
    keychainSecretCache.delete(getServerPasswordAccountName(serverId));
}

export async function readServerPassword(serverId: number) {
    ensureSupportedPlatform();

    return await readKeychainSecretCached(KEYCHAIN_SERVICE_NAME, getServerPasswordAccountName(serverId));
}
