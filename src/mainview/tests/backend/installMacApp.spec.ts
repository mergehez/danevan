// A signed bundle seals its own layout, so the framework symlinks inside it must survive the copy
// into /Applications: `fs.cp` resolves them into absolute paths into the build directory, which makes
// the framework unsealed and the installed app unable to start (the same white window and prompt exit
// as an unsigned bundle). These specs copy a bundle that has such a symlink and read it back.
// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installMacApp } from './installMacApp.ts';

/** The relative symlinks a real bundle carries (`Versions/Current` and the framework's binary). */
const frameworkLinkTarget = 'Versions/Current/Electron Framework';
const versionsLinkTarget = 'A';

let tempDir: string | undefined;

afterEach(() => {
    if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
        tempDir = undefined;
    }
});

/** An app bundle with the framework symlinks a signed Electron app has. */
function createSignedAppShapedBundle(directory: string, name: string) {
    const appPath = join(directory, name);
    const frameworkPath = join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework');
    mkdirSync(join(frameworkPath, 'Versions', 'A'), { recursive: true });
    mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(frameworkPath, 'Versions', 'A', 'Electron Framework'), 'binary');
    writeFileSync(join(appPath, 'Contents', 'MacOS', 'Probe'), 'binary');
    symlinkSync(versionsLinkTarget, join(frameworkPath, 'Versions', 'Current'));
    symlinkSync(frameworkLinkTarget, join(frameworkPath, 'Electron Framework'));

    return appPath;
}

describe.skipIf(process.platform !== 'darwin')('installMacApp', () => {
    it('copies the bundle without rewriting its framework symlinks', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'electron-utils-install-'));
        const sourcePath = createSignedAppShapedBundle(tempDir, 'Built.app');
        const targetPath = join(tempDir, 'Applications', 'Probe.app');
        mkdirSync(join(tempDir, 'Applications'));

        await installMacApp(sourcePath, targetPath);

        const installedFramework = join(targetPath, 'Contents', 'Frameworks', 'Electron Framework.framework');
        // Absolute targets point back into the build tree, which is what broke the seal.
        expect(readlinkSync(join(installedFramework, 'Electron Framework'))).toBe(frameworkLinkTarget);
        expect(readlinkSync(join(installedFramework, 'Versions', 'Current'))).toBe(versionsLinkTarget);
        expect(existsSync(join(installedFramework, 'Versions', 'A', 'Electron Framework'))).toBe(true);
    });

    it('replaces an app that is already installed', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'electron-utils-install-'));
        const sourcePath = createSignedAppShapedBundle(tempDir, 'Built.app');
        const targetPath = join(tempDir, 'Applications', 'Probe.app');
        mkdirSync(targetPath, { recursive: true });
        writeFileSync(join(targetPath, 'stale'), 'from the previous installation');

        await installMacApp(sourcePath, targetPath);

        expect(existsSync(join(targetPath, 'stale'))).toBe(false);
        expect(existsSync(join(targetPath, 'Contents', 'MacOS', 'Probe'))).toBe(true);
    });

    it('refuses a bundle that is not there', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'electron-utils-install-'));

        await expect(installMacApp(join(tempDir, 'Missing.app'), join(tempDir, 'Installed.app'))).rejects.toThrow('No app bundle to install');
    });
});
