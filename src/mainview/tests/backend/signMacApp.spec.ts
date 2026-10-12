// The packaged app only starts Chromium's helper processes when its helper bundles are signed with
// the `com.apple.security.inherit` entitlement: without a valid signature macOS refuses them the
// sandbox, the GPU process crash-loops and Chromium aborts the app a second after launch (the window
// shows white, then the app is gone). `electronConfig` packs with `mac.identity: null`, so
// `signMacApp` is the only thing that signs the bundle — these specs drive it against a real
// (copied, renamed) Electron helper, the way packaging renames it.
// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signMacApp } from './signMacApp.ts';

const electronFrameworksDir = join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Frameworks');
const helperNames = ['Electron Helper.app', 'Electron Helper (GPU).app'];
/** The entitlements a helper needs, in the order `codesign` prints them. */
const inheritEntitlement = 'com.apple.security.inherit';

let tempDir: string | undefined;

afterEach(() => {
    if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
        tempDir = undefined;
    }
});

/** Runs `codesign` and returns everything it printed; it reports on stderr, not stdout. */
function codesign(args: string[]) {
    const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8' });

    return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function entitlementsOf(bundlePath: string) {
    return codesign(['-d', '--entitlements', '-', bundlePath]);
}

function verify(bundlePath: string) {
    return codesign(['--verify', '--strict', bundlePath]);
}

/** The Info.plist electron-builder writes for a renamed helper: the executable name has to match. */
function helperInfoPlist(executableName: string) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>CFBundleExecutable</key><string>${executableName}</string>
    <key>CFBundleIdentifier</key><string>com.example.electron-utils.sign-spec.${executableName.replace(/[^a-zA-Z]/g, '').toLowerCase()}</string>
    <key>CFBundleName</key><string>${executableName}</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>LSUIElement</key><true/>
</dict></plist>
`;
}

/**
 * An app bundle shaped like the packaged one: helpers renamed out of Electron (binary and
 * Info.plist included, which is what invalidates their signatures) inside `Contents/Frameworks`, and
 * a Mach-O binary at the app's own path.
 */
function createUnpackedApp() {
    tempDir = mkdtempSync(join(tmpdir(), 'electron-utils-sign-'));
    const appPath = join(tempDir, 'Probe.app');
    const frameworksDir = join(appPath, 'Contents', 'Frameworks');
    mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(frameworksDir, { recursive: true });

    for (const helperName of helperNames) {
        const source = join(electronFrameworksDir, helperName);

        if (!existsSync(source)) {
            throw new Error(`The Electron helper bundles are missing at ${electronFrameworksDir}; run "bun install" first.`);
        }

        const executableName = helperName.replace('Electron Helper', 'Probe Helper').replace(/\.app$/, '');
        const helperPath = join(frameworksDir, `${executableName}.app`);
        cpSync(source, helperPath, { recursive: true });
        renameSync(join(helperPath, 'Contents', 'MacOS', executableName.replace('Probe Helper', 'Electron Helper')), join(helperPath, 'Contents', 'MacOS', executableName));
        writeFileSync(join(helperPath, 'Contents', 'Info.plist'), helperInfoPlist(executableName));
    }

    cpSync('/bin/echo', join(appPath, 'Contents', 'MacOS', 'Probe'));
    writeFileSync(
        join(appPath, 'Contents', 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>CFBundleIdentifier</key><string>com.example.electron-utils.sign-spec</string>
    <key>CFBundleExecutable</key><string>Probe</string>
    <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`
    );

    return appPath;
}

describe.skipIf(process.platform !== 'darwin')('signMacApp', () => {
    it('gives every renamed helper the inherit entitlement the Chromium sandbox needs', async () => {
        const appPath = createUnpackedApp();
        const helperPath = join(appPath, 'Contents', 'Frameworks', 'Probe Helper (GPU).app');

        expect(entitlementsOf(helperPath)).not.toContain(inheritEntitlement);

        await signMacApp(appPath);

        expect(entitlementsOf(helperPath)).toContain(inheritEntitlement);
        expect(verify(helperPath)).toBe('');
        expect(verify(appPath)).toBe('');
    });

    it('leaves a bundle that already carries a valid signature alone', async () => {
        const appPath = createUnpackedApp();

        await signMacApp(appPath);
        const signedHelper = entitlementsOf(join(appPath, 'Contents', 'Frameworks', 'Probe Helper.app'));

        await signMacApp(appPath);

        expect(entitlementsOf(join(appPath, 'Contents', 'Frameworks', 'Probe Helper.app'))).toBe(signedHelper);
        expect(verify(appPath)).toBe('');
    });

    it('refuses a path that is not an app bundle', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'electron-utils-sign-'));

        await expect(signMacApp(join(tempDir, 'Missing.app'))).rejects.toThrow('No app bundle to sign');
    });
});
