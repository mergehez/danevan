// The built bundle is signed (see `signMacApp.ts`) and a signature seals the bundle's *layout*, so
// the framework symlinks inside it have to survive the copy into /Applications. `fs.cp` resolves
// them and writes absolute paths into the build directory instead of `Versions/Current/…`; macOS
// then reports "unsealed contents present in the root directory of an embedded framework", the
// signature no longer verifies, and the installed app dies a second after launch exactly like an
// unsigned one. `ditto` is the copy macOS keeps for signed bundles: it preserves symlinks, extended
// attributes and the signature itself.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

const dittoPath = '/usr/bin/ditto';

function runDitto(args: string[]) {
    return new Promise<number>((resolve, reject) => {
        const child = spawn(dittoPath, args, { stdio: 'inherit' });
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 1));
    });
}

/** Replaces the app at `targetPath` with the built one, keeping the bundle's signature intact. */
export async function installMacApp(sourcePath: string, targetPath: string) {
    if (process.platform !== 'darwin') {
        console.log(`Not macOS: not installing ${sourcePath} to ${targetPath}.`);
        return;
    }

    if (!existsSync(sourcePath)) {
        throw new Error(`No app bundle to install at ${sourcePath}.`);
    }

    if (existsSync(targetPath)) {
        console.log(`Removing existing application at ${targetPath}.`);
        await rm(targetPath, { recursive: true, force: true });
        // The app being replaced may still be shutting down; give the system a moment before copying.
        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (existsSync(targetPath)) {
            throw new Error(`Could not remove the application at ${targetPath}.`);
        }
    }

    const code = await runDitto([sourcePath, targetPath]);

    if (code !== 0) {
        throw new Error(`ditto exited with ${code} while installing ${targetPath}.`);
    }

    console.log(`Installed ${targetPath}.`);
}
