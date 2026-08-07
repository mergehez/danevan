import type { Configuration } from 'electron-builder';
import { appConfig } from './helpers.ts';

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
};
