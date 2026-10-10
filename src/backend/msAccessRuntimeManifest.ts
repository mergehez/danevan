import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type { MsAccessRuntimeStatus } from '../shared/types';

export type MsAccessRuntimeArtifact = {
    groupId: string;
    artifactId: string;
    version: string;
};

export const MS_ACCESS_RUNTIME_FOLDER_NAME = 'msaccess-runtime';
export const MS_ACCESS_RUNTIME_LIB_FOLDER_NAME = 'lib';
export const MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME = 'jre';
export const MS_ACCESS_RUNTIME_JRE_FOLDER_NAME = 'jre';
export const MS_ACCESS_RUNTIME_BRIDGE_FILE_NAME = 'MsAccessBridge.java';
export const MS_ACCESS_RUNTIME_MANIFEST_FILE_NAME = 'manifest.json';
export const MS_ACCESS_RUNTIME_MAVEN_BASE_URL = 'https://repo1.maven.org/maven2';
export const MS_ACCESS_RUNTIME_SUPPORTED_JRE_PLATFORMS = ['darwin', 'win32'] as const;

export const msAccessRuntimeArtifacts: MsAccessRuntimeArtifact[] = [
    { groupId: 'io.github.spannm', artifactId: 'ucanaccess', version: '5.1.5' },
    { groupId: 'io.github.spannm', artifactId: 'jackcess', version: '5.1.3' },
    { groupId: 'org.hsqldb', artifactId: 'hsqldb', version: '2.7.4' },
    { groupId: 'org.apache.poi', artifactId: 'poi', version: '5.5.1' },
    { groupId: 'commons-codec', artifactId: 'commons-codec', version: '1.20.0' },
    { groupId: 'org.apache.commons', artifactId: 'commons-collections4', version: '4.5.0' },
    { groupId: 'org.apache.commons', artifactId: 'commons-math3', version: '3.6.1' },
    { groupId: 'commons-io', artifactId: 'commons-io', version: '2.21.0' },
    { groupId: 'com.zaxxer', artifactId: 'SparseBitSet', version: '1.3' },
    { groupId: 'org.apache.logging.log4j', artifactId: 'log4j-api', version: '2.24.3' },
];

export function getMsAccessRuntimeJarName(artifact: MsAccessRuntimeArtifact) {
    return `${artifact.artifactId}-${artifact.version}.jar`;
}

export function getMsAccessRuntimeJarUrl(artifact: MsAccessRuntimeArtifact) {
    return `${MS_ACCESS_RUNTIME_MAVEN_BASE_URL}/${artifact.groupId.replaceAll('.', '/')}/${artifact.artifactId}/${artifact.version}/${getMsAccessRuntimeJarName(artifact)}`;
}

export function getMsAccessRuntimePlatformJreFolderName(platform: string) {
    return `${MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME}-${platform}`;
}

type BundledMsAccessRuntime = {
    rootDir: string;
    libDir: string;
    javaCommand?: string;
};

export function getMsAccessRuntimeDir(appDataDir: string) {
    return join(appDataDir, MS_ACCESS_RUNTIME_FOLDER_NAME);
}

export function getBundledJavaCandidates(runtimeRootDir: string) {
    const javaBinaryName = process.platform === 'win32' ? 'java.exe' : 'java';
    const candidates = [
        process.env.DANEVAN_MSACCESS_JAVA_HOME?.trim() ? join(process.env.DANEVAN_MSACCESS_JAVA_HOME.trim(), 'bin', javaBinaryName) : undefined,
        join(runtimeRootDir, getMsAccessRuntimePlatformJreFolderName(process.platform), 'bin', javaBinaryName),
        join(runtimeRootDir, MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME, 'bin', javaBinaryName),
        join(runtimeRootDir, MS_ACCESS_RUNTIME_JRE_FOLDER_NAME, 'bin', javaBinaryName),
    ];

    return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

function getBundledJrePlatforms(runtimeRootDir: string) {
    return [...MS_ACCESS_RUNTIME_SUPPORTED_JRE_PLATFORMS].filter((platform) => existsSync(join(runtimeRootDir, getMsAccessRuntimePlatformJreFolderName(platform))));
}

function getBundledRuntimeCandidateDirs() {
    const execDir = dirname(process.execPath);
    const candidates = [
        process.env.DANEVAN_MSACCESS_RUNTIME_DIR?.trim(),
        resolve(process.cwd(), 'assets', MS_ACCESS_RUNTIME_FOLDER_NAME),
        process.platform === 'darwin'
            ? resolve(execDir, '..', 'Resources', 'app', MS_ACCESS_RUNTIME_FOLDER_NAME)
            : resolve(execDir, 'resources', 'app', MS_ACCESS_RUNTIME_FOLDER_NAME),
        resolve(execDir, '..', 'resources', 'app', MS_ACCESS_RUNTIME_FOLDER_NAME),
    ];

    return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

export function findBundledRuntime(): BundledMsAccessRuntime | undefined {
    for (const runtimeRootDir of getBundledRuntimeCandidateDirs()) {
        const libDir = join(runtimeRootDir, MS_ACCESS_RUNTIME_LIB_FOLDER_NAME);
        const hasAllJars = msAccessRuntimeArtifacts.every((artifact) => existsSync(join(libDir, getMsAccessRuntimeJarName(artifact))));

        if (!hasAllJars) {
            continue;
        }

        const javaCommand = getBundledJavaCandidates(runtimeRootDir).find((candidate) => existsSync(candidate));

        return {
            rootDir: runtimeRootDir,
            libDir,
            javaCommand,
        } satisfies BundledMsAccessRuntime;
    }

    return undefined;
}

function hasDownloadedRuntime(appDataDir: string) {
    const libDir = join(getMsAccessRuntimeDir(appDataDir), MS_ACCESS_RUNTIME_LIB_FOLDER_NAME);
    return msAccessRuntimeArtifacts.every((artifact) => existsSync(join(libDir, getMsAccessRuntimeJarName(artifact))));
}

export function inspectMsAccessRuntime(appDataDir: string): MsAccessRuntimeStatus {
    const bundledRuntime = findBundledRuntime();
    const downloadedRuntime = hasDownloadedRuntime(appDataDir);
    const runtimePath = bundledRuntime?.rootDir ?? (downloadedRuntime ? getMsAccessRuntimeDir(appDataDir) : undefined);

    return {
        runtimeSource: bundledRuntime ? 'bundled' : downloadedRuntime ? 'downloaded' : 'missing',
        runtimePath,
        currentPlatform: process.platform,
        hasGenericBundledJre: bundledRuntime
            ? existsSync(join(bundledRuntime.rootDir, MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME)) || existsSync(join(bundledRuntime.rootDir, MS_ACCESS_RUNTIME_JRE_FOLDER_NAME))
            : false,
        bundledJrePlatforms: bundledRuntime ? getBundledJrePlatforms(bundledRuntime.rootDir) : [],
        currentPlatformHasBundledJre: bundledRuntime
            ? existsSync(join(bundledRuntime.rootDir, getMsAccessRuntimePlatformJreFolderName(process.platform))) ||
              existsSync(join(bundledRuntime.rootDir, MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME)) ||
              existsSync(join(bundledRuntime.rootDir, MS_ACCESS_RUNTIME_JRE_FOLDER_NAME))
            : false,
        runtimeDownloadsDisabled: /^(1|true|yes|on)$/i.test(process.env.DANEVAN_MSACCESS_DISABLE_RUNTIME_DOWNLOADS || ''),
    } satisfies MsAccessRuntimeStatus;
}
