/// <reference types="bun" />

import { existsSync, readFileSync } from 'fs';
import { cp, mkdir, mkdtemp, readdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

type EnvMap = Record<string, string>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const scriptPath = fileURLToPath(import.meta.url);
const projectEnvPath = join(projectRoot, '.env');
const assetsDir = join(projectRoot, 'assets');
const iconSvgPath = join(assetsDir, 'icon.svg');
const iconIcnsPath = join(assetsDir, 'icon.icns');
const iconsetDir = join(assetsDir, 'icon.iconset');
const buildTargetDir = join(projectRoot, 'build', `stable-macos-${process.arch}`);
const artifactsDir = join(projectRoot, 'artifacts');
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
    name: string;
    productName?: string;
};
const appBundleName = `${packageJson.productName || packageJson.name}.app`;
const requiredIconFiles = [
    'icon_16x16.png',
    'icon_16x16@2x.png',
    'icon_32x32.png',
    'icon_32x32@2x.png',
    'icon_128x128.png',
    'icon_128x128@2x.png',
    'icon_256x256.png',
    'icon_256x256@2x.png',
    'icon_512x512.png',
    'icon_512x512@2x.png',
];

function readEnvFile(filePath: string): EnvMap {
    if (!existsSync(filePath)) {
        return {};
    }

    const values: EnvMap = {};

    for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();

        if (!line || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

function cleanValue(value: string | undefined) {
    return value?.replace(/^ELECTROBUN_DEVELOPER_ID:\s*/, '').trim() || '';
}

function combineEnv() {
    const fileEnv = Object.fromEntries(Object.entries(readEnvFile(projectEnvPath)).filter(([, value]) => value !== ''));
    return {
        ...fileEnv,
        ...process.env,
    } as NodeJS.ProcessEnv;
}

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env, cwd = projectRoot) {
    const processHandle = Bun.spawn([command, ...args], {
        cwd,
        env,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
    });

    const exitCode = await processHandle.exited;
    if (exitCode !== 0) {
        throw new Error(`${command} ${args.join(' ')} exited with code ${exitCode}.`);
    }
}

async function pathExists(path: string) {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function findAppBundle(directoryPath: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));

    if (!appEntry) {
        throw new Error(`No .app bundle found in ${directoryPath}.`);
    }

    return join(directoryPath, appEntry.name);
}

async function findArtifact(extension: string) {
    if (!(await pathExists(artifactsDir))) {
        throw new Error(`Artifacts directory not found at ${artifactsDir}.`);
    }

    const prefix = `stable-macos-${process.arch}-`;
    const entries = await readdir(artifactsDir, { withFileTypes: true });
    const matches = entries.filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(extension)).map((entry) => join(artifactsDir, entry.name));

    if (matches.length !== 1) {
        throw new Error(`Expected exactly one ${extension} artifact in ${artifactsDir}, found ${matches.length}.`);
    }

    return matches[0];
}

async function verifySignedMacApp(appPath: string, env: NodeJS.ProcessEnv) {
    console.log(`Verifying code signature for ${appPath}.`);
    await runCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], env);

    console.log(`Running Gatekeeper assessment for ${appPath}.`);
    await runCommand('/usr/sbin/spctl', ['-a', '-t', 'exec', '-v', appPath], env);
}

async function verifyDmgDistributionArtifact(dmgPath: string, env: NodeJS.ProcessEnv) {
    const mountDir = await mkdtemp(join(tmpdir(), 'danevan-dmg-check-'));

    try {
        console.log(`Mounting ${dmgPath} for distribution verification.`);
        await runCommand('/usr/bin/hdiutil', ['attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mountDir], env);

        const mountedAppPath = await findAppBundle(mountDir);
        await verifySignedMacApp(mountedAppPath, env);
        console.log('DMG verification passed.');
    } finally {
        try {
            await runCommand('/usr/bin/hdiutil', ['detach', mountDir], env);
        } catch (error) {
            console.warn(`Failed to detach ${mountDir}: ${error instanceof Error ? error.message : String(error)}`);
        }

        await rm(mountDir, { recursive: true, force: true });
    }
}

async function iconsetIsFresh() {
    if (!(await pathExists(iconSvgPath)) || !(await pathExists(iconsetDir))) {
        return false;
    }

    const sourceStat = await stat(iconSvgPath);
    const scriptStat = await stat(scriptPath);

    for (const fileName of requiredIconFiles) {
        const iconPath = join(iconsetDir, fileName);

        if (!(await pathExists(iconPath))) {
            return false;
        }

        const iconStat = await stat(iconPath);
        if (iconStat.mtimeMs < sourceStat.mtimeMs || iconStat.mtimeMs < scriptStat.mtimeMs) {
            return false;
        }
    }

    return true;
}

async function ensureMacIconset() {
    if (await iconsetIsFresh()) {
        return iconsetDir;
    }

    console.log('Generating macOS iconset and ICNS from SVG source.');

    if (!(await pathExists(iconSvgPath))) {
        throw new Error(`Missing icon source at ${iconSvgPath}.`);
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'danevan-icon-'));
    const tempIconsetDir = join(tempDir, 'icon.iconset');
    const previewPath = join(tempDir, 'icon.png');

    try {
        await mkdir(tempIconsetDir, { recursive: true });
        await runCommand('/usr/bin/sips', ['-s', 'format', 'png', iconSvgPath, '--out', previewPath]);

        const sizes: Array<[string, number]> = [
            ['icon_16x16.png', 16],
            ['icon_16x16@2x.png', 32],
            ['icon_32x32.png', 32],
            ['icon_32x32@2x.png', 64],
            ['icon_128x128.png', 128],
            ['icon_128x128@2x.png', 256],
            ['icon_256x256.png', 256],
            ['icon_256x256@2x.png', 512],
            ['icon_512x512.png', 512],
        ];

        for (const [fileName, size] of sizes) {
            await runCommand('/usr/bin/sips', ['-z', String(size), String(size), previewPath, '--out', join(tempIconsetDir, fileName)]);
        }

        await Bun.write(join(tempIconsetDir, 'icon_512x512@2x.png'), Bun.file(previewPath));

        if (await pathExists(iconsetDir)) {
            await rm(iconsetDir, { recursive: true, force: true });
        }

        await cp(tempIconsetDir, iconsetDir, { recursive: true });
        await runCommand('/usr/bin/iconutil', ['-c', 'icns', iconsetDir, '-o', iconIcnsPath]);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }

    return iconsetDir;
}

function prepareElectrobunEnv(shouldSign: boolean, shouldNotarize: boolean) {
    const env = combineEnv();
    const developerId = cleanValue(env.ELECTROBUN_DEVELOPER_ID);
    const teamId = env.ELECTROBUN_TEAMID || '';
    const appleId = env.ELECTROBUN_APPLEID || '';
    const appleIdPass = env.ELECTROBUN_APPLEIDPASS || '';

    env.ELECTROBUN_MAC_ICONS = iconsetDir;
    env.ELECTROBUN_CREATE_DMG = 'true';
    env.ELECTROBUN_CODESIGN = shouldSign ? 'true' : 'false';
    env.ELECTROBUN_NOTARIZE = shouldNotarize ? 'true' : 'false';

    if (!shouldSign) {
        delete env.ELECTROBUN_DEVELOPER_ID;
        delete env.ELECTROBUN_TEAMID;
        delete env.ELECTROBUN_APPLEID;
        delete env.ELECTROBUN_APPLEIDPASS;
        return env;
    }

    if (!developerId) {
        throw new Error('Signing requires ELECTROBUN_DEVELOPER_ID in the environment or .env file.');
    }

    env.ELECTROBUN_DEVELOPER_ID = developerId;
    if (teamId) {
        env.ELECTROBUN_TEAMID = teamId;
    }

    if (!shouldNotarize) {
        return env;
    }

    if (!appleId || !appleIdPass || !teamId) {
        throw new Error('Notarization requires ELECTROBUN_APPLEID, ELECTROBUN_APPLEIDPASS, and ELECTROBUN_TEAMID.');
    }

    env.ELECTROBUN_APPLEID = appleId;
    env.ELECTROBUN_APPLEIDPASS = appleIdPass;
    env.ELECTROBUN_TEAMID = teamId;

    return env;
}

async function main() {
    const shouldNotarize = process.argv.includes('--notarize');
    const shouldSign = shouldNotarize || process.argv.includes('--signed');
    const shouldInstall = !process.argv.includes('--no-install');

    await ensureMacIconset();
    const env = prepareElectrobunEnv(shouldSign, shouldNotarize);

    if (shouldNotarize) {
        console.log('Building a signed and notarized macOS release with Electrobun.');
    } else if (shouldSign) {
        console.log('Building a signed macOS release with Electrobun.');
    } else {
        console.log('Building an unsigned macOS release with Electrobun.');
    }

    await runCommand('bun', ['run', 'build:stable'], env);

    const builtAppPath = await findAppBundle(buildTargetDir);
    const dmgPath = await findArtifact('.dmg');

    if (shouldSign) {
        await verifySignedMacApp(builtAppPath, env);
    }

    if (shouldNotarize) {
        await verifyDmgDistributionArtifact(dmgPath, env);
    }

    if (shouldInstall) {
        const applicationsPath = join('/Applications', appBundleName);

        if (await pathExists(applicationsPath)) {
            console.log(`Removing existing application at ${applicationsPath}.`);
            await rm(applicationsPath, { recursive: true, force: true });
        }

        await cp(builtAppPath, applicationsPath, { recursive: true });
        console.log(`Installed ${appBundleName} to /Applications.`);
    }

    console.log(`App bundle: ${builtAppPath}`);
    console.log(`DMG artifact: ${dmgPath}`);
    console.log(`Artifacts directory: ${artifactsDir}`);
}

await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});
