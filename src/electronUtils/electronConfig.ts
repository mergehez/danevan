import type { Configuration } from 'electron-builder';
import { join } from 'node:path';
import { appConfig } from './helpers.ts';
import { signMacApp } from './signMacApp.ts';

export const electronConfig: Configuration = {
    appId: appConfig.appId,
    productName: appConfig.appName,
    copyright: appConfig.copyright,
    directories: {
        output: 'build',
        buildResources: 'assets',
    },
    files: ['dist/**/*', 'dist-electron/**/*', '!node_modules/electron/**'],
    extraResources: [
        {
            from: 'assets',
            to: 'assets',
            filter: ['**/*'],
        },
    ],
    mac: {
        category: 'public.app-category.developer-tools',
        target: [
            {
                target: 'dmg',
                arch: ['arm64'],
            },
        ],
        icon: 'assets/icon.icns',
        artifactName: '${name}-${version}-macos-${arch}.${ext}',
        hardenedRuntime: true,
        gatekeeperAssess: false,
        identity: null,
    },
    nodeGypRebuild: false,
    // `mac.identity: null` means electron-builder does not sign at all, and the bundle it leaves
    // behind cannot start Chromium's helper processes on macOS (see `signMacApp.ts`). This runs
    // after the app is packed and before any signing electron-builder would do.
    afterPack: async (context) => {
        if (context.electronPlatformName !== 'darwin') {
            return;
        }

        await signMacApp(join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`));
    },
};
