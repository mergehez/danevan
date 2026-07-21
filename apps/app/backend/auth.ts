import { executeTextCommand } from '@backend/bunSubprocess.ts';

const KEYCHAIN_SERVICE_NAME = 'Danevan';

async function runSecurityCommand(args: string[], allowedExitCodes: number[] = [0]) {
    const [stdout, stderr, exitCode] = await executeTextCommand({
        command: 'security',
        args,
    });

    if (!allowedExitCodes.includes(exitCode)) {
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
}

export async function deleteConnectionPassword(connectionId: number) {
    ensureSupportedPlatform();

    await deleteKeychainSecret(KEYCHAIN_SERVICE_NAME, getConnectionPasswordAccountName(connectionId));
}

export async function readConnectionPassword(connectionId: number) {
    ensureSupportedPlatform();

    return await readKeychainSecret(KEYCHAIN_SERVICE_NAME, getConnectionPasswordAccountName(connectionId));
}

export async function storeServerPassword(serverId: number, label: string, password: string) {
    ensureSupportedPlatform();

    await storeKeychainSecret(KEYCHAIN_SERVICE_NAME, getServerPasswordAccountName(serverId), label, password);
}

export async function deleteServerPassword(serverId: number) {
    ensureSupportedPlatform();

    await deleteKeychainSecret(KEYCHAIN_SERVICE_NAME, getServerPasswordAccountName(serverId));
}

export async function readServerPassword(serverId: number) {
    ensureSupportedPlatform();

    return await readKeychainSecret(KEYCHAIN_SERVICE_NAME, getServerPasswordAccountName(serverId));
}
