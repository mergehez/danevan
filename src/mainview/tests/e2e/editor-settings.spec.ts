// The Monaco settings dropdown is the only place the editor's font size can be changed, and the
// value has to reach the editor the user is looking at and survive a restart. Monaco renders into
// its own DOM, so only a browser can see the size it ended up with.
import { expect, test, type Page } from '@playwright/test';
import { createFileSource } from './helpers';

const SCHEMA = 'CREATE TABLE keep_me (id integer primary key, note text);';

/** Opens a scratch editor, which is where the header's settings button lives. */
async function openScratchEditor(page: Page) {
    await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });
    await page.getByTestId('new-scratch-tab').click();
    await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
}

/** The size Monaco paints the editor's text with, which is what the user reads. */
function editorFontSize(page: Page) {
    return page
        .locator('.monaco-editor .view-lines')
        .first()
        .evaluate((element) => getComputedStyle(element).fontSize);
}

async function openSettings(page: Page) {
    await page.getByTestId('editor-settings-button').click();

    const dialog = page.getByRole('dialog', { name: 'Diff settings' });
    await expect(dialog).toContainText('Font Size');
    return dialog;
}

test('changes the editor font size from the settings dropdown and keeps it', async ({ page, request }) => {
    const source = await createFileSource(request, { label: 'editor-settings', schema: SCHEMA });

    try {
        await page.goto('/');
        await openScratchEditor(page);
        await expect.poll(() => editorFontSize(page)).toBe('12px');

        const dialog = await openSettings(page);
        const numberInput = dialog.locator('input[type="number"]');
        const rangeInput = dialog.locator('input[type="range"]');

        await expect(numberInput).toHaveValue('12');

        await numberInput.fill('20');
        await numberInput.press('Enter');

        // The editor the user is looking at takes the new size, and both controls show it.
        await expect.poll(() => editorFontSize(page)).toBe('20px');
        await expect(numberInput).toHaveValue('20');
        await expect(rangeInput).toHaveValue('20');

        // Escape closes the dropdown instead of leaving it over the editor.
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);

        // A restart draws the editor at the size that was chosen.
        await page.reload();
        await openScratchEditor(page);
        await expect.poll(() => editorFontSize(page)).toBe('20px');
        await expect((await openSettings(page)).locator('input[type="number"]')).toHaveValue('20');
    } finally {
        await source.cleanup();
    }
});
