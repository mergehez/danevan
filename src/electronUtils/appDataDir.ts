import { homedir, platform } from 'os';
import { join } from 'path';
import { appConfig } from './helpers';

/** Where this installation keeps its app DB, scripts and caches. */
export function resolveDefaultAppDataDir(): string {
    if (platform() === 'win32') {
        const appData = process.env.APPDATA;
        if (appData) return join(appData, appConfig.projectName);
    }

    if (platform() === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', appConfig.projectName);
    }

    return join(homedir(), '.local', 'share', appConfig.projectName);
}

/** `APP_DATA_DIR` runs a second installation — a test run with its own DB — beside the first. */
export function resolveAppDataDir(): string {
    return process.env.APP_DATA_DIR || resolveDefaultAppDataDir();
}
