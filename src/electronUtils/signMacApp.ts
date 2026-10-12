// Packaging renames `Electron Helper*.app` to `<Product> Helper*.app` (and the main binary to the
// product name), which invalidates the signatures Electron ships with. Chromium gives every helper
// process its own macOS sandbox, and a helper can only inherit that sandbox when its bundle is
// signed with the `com.apple.security.inherit` entitlement — without it the GPU process crash-loops
// and Chromium aborts the whole app (`FATAL:gpu_data_manager_impl_private.cc GPU process isn't
// usable. Goodbye.`) about a second after launch, so the window shows white and then the app is
// gone. electron-builder leaves the bundle unsigned here because `electronConfig` sets
// `mac.identity: null`, so this signs the renamed bundles ad-hoc, which is enough to make them valid
// for the sandbox again.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const codesignPath = '/usr/bin/codesign';
const entitlementsDir = join(dirname(fileURLToPath(import.meta.url)), 'entitlements');

/** Runs `codesign` with its output passed through, resolving with the exit code. */
function runCodesign(args: string[]) {
    return new Promise<number>((resolve, reject) => {
        const child = spawn(codesignPath, args, { stdio: 'inherit' });
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 1));
    });
}

/** Whether macOS accepts the bundle's own signature (nested code is Electron's, not ours). */
export function isMacAppSigned(appPath: string) {
    return runCodesign(['--verify', '--strict', appPath]).then((code) => code === 0);
}

/** Makes the packaged app launchable, signing it ad-hoc when it has no valid signature. */
export async function signMacApp(appPath: string) {
    if (process.platform !== 'darwin') {
        console.log(`Not macOS: leaving ${appPath} as it is.`);
        return;
    }

    if (!existsSync(appPath)) {
        throw new Error(`No app bundle to sign at ${appPath}.`);
    }

    if (await isMacAppSigned(appPath)) {
        console.log(`${appPath} already carries a valid signature.`);
        return;
    }

    const frameworksDir = join(appPath, 'Contents', 'Frameworks');
    const helperEntitlements = join(entitlementsDir, 'mac.helper.plist');

    // Nested bundles first: a bundle's signature covers the code it embeds.
    for (const entry of await readdir(frameworksDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.endsWith('.app')) {
            const helperPath = join(frameworksDir, entry.name);
            const code = await runCodesign(['--force', '--sign', '-', '--options', 'runtime', '--entitlements', helperEntitlements, helperPath]);

            if (code !== 0) {
                throw new Error(`codesign exited with ${code} for ${helperPath}.`);
            }
        }
    }

    const appCode = await runCodesign(['--force', '--sign', '-', '--options', 'runtime', '--entitlements', join(entitlementsDir, 'mac.plist'), appPath]);

    if (appCode !== 0) {
        throw new Error(`codesign exited with ${appCode} for ${appPath}.`);
    }

    if (!(await isMacAppSigned(appPath))) {
        throw new Error(`Signing ${appPath} did not produce a signature macOS accepts.`);
    }

    console.log(`Signed ${appPath} ad-hoc, so its helper processes can use the Chromium sandbox.`);
}
