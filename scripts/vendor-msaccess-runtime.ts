import {
    getMsAccessRuntimeJarName,
    getMsAccessRuntimeJarUrl,
    getMsAccessRuntimePlatformJreFolderName,
    MS_ACCESS_RUNTIME_FOLDER_NAME,
    MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME,
    MS_ACCESS_RUNTIME_JRE_FOLDER_NAME,
    MS_ACCESS_RUNTIME_LIB_FOLDER_NAME,
    MS_ACCESS_RUNTIME_MANIFEST_FILE_NAME,
    msAccessRuntimeArtifacts,
} from '@backend/msAccessRuntimeManifest.ts';
import { existsSync, readFileSync } from 'fs';
import { cp, mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runtimeDir = join(projectRoot, 'assets', MS_ACCESS_RUNTIME_FOLDER_NAME);
const libDir = join(runtimeDir, MS_ACCESS_RUNTIME_LIB_FOLDER_NAME);
const manifestPath = join(runtimeDir, MS_ACCESS_RUNTIME_MANIFEST_FILE_NAME);

function parseArgs(argv: string[]) {
    const args = {
        force: false,
        javaHome: process.env.DANEVAN_MSACCESS_JAVA_HOME?.trim() || undefined,
        darwinJavaHome: process.env.DANEVAN_MSACCESS_JAVA_HOME_DARWIN?.trim() || undefined,
        win32JavaHome: process.env.DANEVAN_MSACCESS_JAVA_HOME_WIN32?.trim() || undefined,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];

        if (value === '--force') {
            args.force = true;
            continue;
        }

        if (value === '--java-home') {
            args.javaHome = argv[index + 1]?.trim() || undefined;
            index += 1;
            continue;
        }

        if (value === '--darwin-java-home') {
            args.darwinJavaHome = argv[index + 1]?.trim() || undefined;
            index += 1;
            continue;
        }

        if (value === '--win32-java-home') {
            args.win32JavaHome = argv[index + 1]?.trim() || undefined;
            index += 1;
        }
    }

    return args;
}

async function downloadFile(url: string, destinationPath: string) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to download ${url} (${response.status}).`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(destinationPath, bytes);
}

async function bundleJavaRuntime(javaHome: string, targetFolderName = MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME) {
    const resolvedJavaHome = resolve(javaHome);
    const targetDir = join(runtimeDir, targetFolderName);

    if (!existsSync(resolvedJavaHome)) {
        throw new Error(`The provided Java home does not exist: ${resolvedJavaHome}`);
    }

    await rm(targetDir, { recursive: true, force: true });
    await cp(resolvedJavaHome, targetDir, { recursive: true, dereference: true });
    return targetDir;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
        version: string;
    };

    await mkdir(libDir, { recursive: true });

    for (const artifact of msAccessRuntimeArtifacts) {
        const jarPath = join(libDir, getMsAccessRuntimeJarName(artifact));

        if (!args.force && existsSync(jarPath)) {
            console.log(`Using cached ${getMsAccessRuntimeJarName(artifact)}`);
            continue;
        }

        console.log(`Downloading ${getMsAccessRuntimeJarName(artifact)}`);
        await downloadFile(getMsAccessRuntimeJarUrl(artifact), jarPath);
    }

    let bundledJavaHome: string | undefined;
    const bundledJavaHomes = {} as Record<string, string>;

    if (args.javaHome) {
        bundledJavaHome = await bundleJavaRuntime(args.javaHome, MS_ACCESS_RUNTIME_JRE_FOLDER_NAME);
        console.log(`Bundled Java runtime from ${args.javaHome}`);
        bundledJavaHomes.generic = `./${MS_ACCESS_RUNTIME_JRE_FOLDER_NAME}`;
    }

    if (args.darwinJavaHome) {
        await bundleJavaRuntime(args.darwinJavaHome, getMsAccessRuntimePlatformJreFolderName('darwin'));
        console.log(`Bundled macOS Java runtime from ${args.darwinJavaHome}`);
        bundledJavaHomes.darwin = `./${getMsAccessRuntimePlatformJreFolderName('darwin')}`;
    }

    if (args.win32JavaHome) {
        await bundleJavaRuntime(args.win32JavaHome, getMsAccessRuntimePlatformJreFolderName('win32'));
        console.log(`Bundled Windows Java runtime from ${args.win32JavaHome}`);
        bundledJavaHomes.win32 = `./${getMsAccessRuntimePlatformJreFolderName('win32')}`;
    }

    await writeFile(
        manifestPath,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                packageVersion: packageJson.version,
                artifacts: msAccessRuntimeArtifacts.map((artifact) => ({
                    ...artifact,
                    fileName: getMsAccessRuntimeJarName(artifact),
                })),
                bundledJavaHome: bundledJavaHome ? `./${MS_ACCESS_RUNTIME_JRE_FOLDER_NAME}` : undefined,
                bundledJavaHomes,
            },
            null,
            2
        ) + '\n',
        'utf8'
    );

    console.log(`MS Access runtime bundled at ${runtimeDir}`);
}

await main();
