// A second launch of the app must not race the first one for the API port. The lock turns it into
// "bring the open window forward": the second process exits immediately, and the first window keeps
// answering. Without the lock the second launch reached neither a window nor an error message.
import { expect, test } from '@playwright/test';
import { closeShell, createAppDataDir, launchShell, post, requireShellBuild, spawnShell } from './helpers';

test.beforeAll(() => {
    requireShellBuild();
});

test('a second launch hands over to the window that is already open', async () => {
    const appDataDir = createAppDataDir('danevan-second-launch-');
    const first = await launchShell(appDataDir);

    try {
        const window = await first.firstWindow();
        await expect(window.getByRole('heading', { name: 'Connections' })).toBeVisible();

        // The same profile, so the second launch meets the running instance's lock rather than
        // trying to take the API port from it.
        const second = spawnShell(appDataDir);

        await expect.poll(() => second.child.exitCode).toBe(0);
        expect(second.stderr()).not.toContain('EADDRINUSE');

        // The first window is still open, and still the one the backend answers on.
        await expect(window.getByRole('heading', { name: 'Connections' })).toBeVisible();
        expect(await post('getBootstrap')).toBeTruthy();
    } finally {
        await closeShell(first, appDataDir);
    }
});
