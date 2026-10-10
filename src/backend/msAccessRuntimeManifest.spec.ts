import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    MS_ACCESS_RUNTIME_FOLDER_NAME,
    MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME,
    MS_ACCESS_RUNTIME_JRE_FOLDER_NAME,
    MS_ACCESS_RUNTIME_LIB_FOLDER_NAME,
    MS_ACCESS_RUNTIME_MAVEN_BASE_URL,
    getBundledJavaCandidates,
    getMsAccessRuntimeJarName,
    getMsAccessRuntimeJarUrl,
    getMsAccessRuntimePlatformJreFolderName,
    inspectMsAccessRuntime,
    msAccessRuntimeArtifacts,
} from './msAccessRuntimeManifest';

describe('MS Access runtime manifest', () => {
    it('names every jar after its artifact and version', () => {
        expect(msAccessRuntimeArtifacts.map(getMsAccessRuntimeJarName)).toEqual([
            'ucanaccess-5.1.5.jar',
            'jackcess-5.1.3.jar',
            'hsqldb-2.7.4.jar',
            'poi-5.5.1.jar',
            'commons-codec-1.20.0.jar',
            'commons-collections4-4.5.0.jar',
            'commons-math3-3.6.1.jar',
            'commons-io-2.21.0.jar',
            'SparseBitSet-1.3.jar',
            'log4j-api-2.24.3.jar',
        ]);
    });

    it('builds the Maven URL from the dotted group id', () => {
        const ucanaccess = msAccessRuntimeArtifacts[0]!;
        const log4j = msAccessRuntimeArtifacts.at(-1)!;

        expect(getMsAccessRuntimeJarUrl(ucanaccess)).toBe(`${MS_ACCESS_RUNTIME_MAVEN_BASE_URL}/io/github/spannm/ucanaccess/5.1.5/ucanaccess-5.1.5.jar`);
        expect(getMsAccessRuntimeJarUrl(log4j)).toBe(`${MS_ACCESS_RUNTIME_MAVEN_BASE_URL}/org/apache/logging/log4j/log4j-api/2.24.3/log4j-api-2.24.3.jar`);
    });

    it('keeps a per-platform JRE folder beside the generic one', () => {
        expect(getMsAccessRuntimePlatformJreFolderName('darwin')).toBe(`${MS_ACCESS_RUNTIME_JRE_FOLDER_NAME}-darwin`);
        expect(getMsAccessRuntimePlatformJreFolderName('win32')).toBe('jre-win32');
    });
});

/**
 * Runtime discovery decides whether the Java bridge can start at all: a bundled runtime, one
 * downloaded into the app data directory, or nothing. Driven with temp directories and the
 * `DANEVAN_MSACCESS_*` overrides, so no Java and no download are involved.
 */
describe('MS Access runtime discovery', () => {
    let rootDir = '';
    let appDataDir = '';

    function createRuntimeLayout(prefix: string, jreFolder?: string) {
        const dir = join(rootDir, prefix);
        const libDir = join(dir, MS_ACCESS_RUNTIME_LIB_FOLDER_NAME);
        mkdirSync(libDir, { recursive: true });

        for (const artifact of msAccessRuntimeArtifacts) {
            writeFileSync(join(libDir, getMsAccessRuntimeJarName(artifact)), '');
        }

        if (jreFolder) {
            mkdirSync(join(dir, jreFolder, 'bin'), { recursive: true });
        }

        return dir;
    }

    beforeEach(() => {
        rootDir = mkdtempSync(join(tmpdir(), 'danevan-msaccess-'));
        appDataDir = join(rootDir, 'app-data');
        mkdirSync(appDataDir, { recursive: true });
    });

    afterEach(() => {
        delete process.env.DANEVAN_MSACCESS_RUNTIME_DIR;
        delete process.env.DANEVAN_MSACCESS_JAVA_HOME;
        delete process.env.DANEVAN_MSACCESS_DISABLE_RUNTIME_DOWNLOADS;
        rmSync(rootDir, { recursive: true, force: true });
    });

    it('reports a missing runtime when nothing is bundled or downloaded', () => {
        const status = inspectMsAccessRuntime(appDataDir);

        expect(status).toMatchObject({
            runtimeSource: 'missing',
            runtimePath: undefined,
            currentPlatform: process.platform,
            hasGenericBundledJre: false,
            bundledJrePlatforms: [],
            currentPlatformHasBundledJre: false,
            runtimeDownloadsDisabled: false,
        });
    });

    it('finds a bundle whose lib directory holds every jar', () => {
        const bundled = createRuntimeLayout('bundled', MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME);
        process.env.DANEVAN_MSACCESS_RUNTIME_DIR = bundled;

        const status = inspectMsAccessRuntime(appDataDir);

        expect(status.runtimeSource).toBe('bundled');
        expect(status.runtimePath).toBe(bundled);
        expect(status.hasGenericBundledJre).toBe(true);
        expect(status.currentPlatformHasBundledJre).toBe(true);
    });

    it('ignores a bundle that is missing jars and falls back to the downloaded one', () => {
        const incomplete = join(rootDir, 'incomplete');
        mkdirSync(join(incomplete, MS_ACCESS_RUNTIME_LIB_FOLDER_NAME), { recursive: true });
        writeFileSync(join(incomplete, MS_ACCESS_RUNTIME_LIB_FOLDER_NAME, 'ucanaccess-5.1.5.jar'), '');
        process.env.DANEVAN_MSACCESS_RUNTIME_DIR = incomplete;

        // The downloaded layout lives under the app data directory, exactly as the download writes it.
        const downloadedLib = join(appDataDir, MS_ACCESS_RUNTIME_FOLDER_NAME, MS_ACCESS_RUNTIME_LIB_FOLDER_NAME);
        mkdirSync(downloadedLib, { recursive: true });
        for (const artifact of msAccessRuntimeArtifacts) {
            writeFileSync(join(downloadedLib, getMsAccessRuntimeJarName(artifact)), '');
        }

        const status = inspectMsAccessRuntime(appDataDir);

        expect(status.runtimeSource).toBe('downloaded');
        expect(status.runtimePath).toBe(join(appDataDir, MS_ACCESS_RUNTIME_FOLDER_NAME));
    });

    it('lists the bundled JRE folders that exist, including the current platform', () => {
        const bundled = createRuntimeLayout('bundled-jre', getMsAccessRuntimePlatformJreFolderName(process.platform));
        process.env.DANEVAN_MSACCESS_RUNTIME_DIR = bundled;

        const status = inspectMsAccessRuntime(appDataDir);

        expect(status.bundledJrePlatforms).toEqual([process.platform]);
        expect(status.currentPlatformHasBundledJre).toBe(true);
        expect(status.hasGenericBundledJre).toBe(false);
    });

    it('prefers the configured Java home, then the platform, generic and plain JRE folders', () => {
        const runtimeRoot = join(rootDir, 'runtime-root');
        process.env.DANEVAN_MSACCESS_JAVA_HOME = join(rootDir, 'custom-java');

        const javaBinary = process.platform === 'win32' ? 'java.exe' : 'java';

        // The generic and legacy JRE folder names are the same string, so the duplicate collapses.
        expect(getBundledJavaCandidates(runtimeRoot)).toEqual([
            join(rootDir, 'custom-java', 'bin', javaBinary),
            join(runtimeRoot, getMsAccessRuntimePlatformJreFolderName(process.platform), 'bin', javaBinary),
            join(runtimeRoot, MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME, 'bin', javaBinary),
        ]);
        expect(new Set(getBundledJavaCandidates(runtimeRoot)).size).toBe(getBundledJavaCandidates(runtimeRoot).length);
    });

    it('reports downloads as disabled only for the documented truthy values', () => {
        for (const value of ['1', 'true', 'YES', 'on']) {
            process.env.DANEVAN_MSACCESS_DISABLE_RUNTIME_DOWNLOADS = value;
            expect(inspectMsAccessRuntime(appDataDir).runtimeDownloadsDisabled).toBe(true);
        }

        for (const value of ['0', 'false', '']) {
            process.env.DANEVAN_MSACCESS_DISABLE_RUNTIME_DOWNLOADS = value;
            expect(inspectMsAccessRuntime(appDataDir).runtimeDownloadsDisabled).toBe(false);
        }
    });
});
