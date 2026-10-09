import { expect, test, type Page } from '@playwright/test';
import { createFileSource, post } from './helpers';

/**
 * Regression test for the SQL editor cursor-jump bug.
 *
 * Repro (as reported): open a script tab, click the editor, select all,
 * delete, type, then press Enter a few times. With the bug, typing triggers a
 * value round-trip: onDidChangeContent -> query.queryText -> draft sync ->
 * setTabs -> the nav-state watcher re-fires activateTab (because its source
 * was a fresh array) -> scripts.selectScript() runs -> and, while that call is
 * pending, the newer typing gets clobbered by the stale draftSql, which makes
 * Monaco call model.setValue() and the cursor jumps back to the start.
 *
 * The fix makes the nav-state watcher key a primitive string, so draft-sync
 * setTabs with unchanged tab hashes no longer re-runs activation.
 */
const SELECT_ALL = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

function editorText(page: Page) {
    return page
        .locator('.view-line')
        .allTextContents()
        .then((lines) => lines.join('\n').replace(/\u00A0/g, ' '));
}

test.describe('SQL editor cursor stability', () => {
    test('cursor stays at the end while typing and pressing Enter', async ({ page, request }) => {
        // The spec used to pick an existing script out of a developer's app DB; it now
        // builds its own source, connection and script, so it also runs on a clean database.
        const source = await createFileSource(request, { label: 'sql-cursor', tableCount: 2 });
        const bootstrap = await post(request, 'createScript', {
            connectionId: source.connectionId,
            name: 'cursor probe',
            sqlText: 'select 1;',
        });
        const scriptId = bootstrap.scripts.find((entry: { name: string }) => entry.name === 'cursor probe').id;

        try {
            await page.goto('/');

            // Single click only selects; double click activates.
            const scriptRow = page.locator(`[data-node-id="script:${scriptId}"]`);
            await expect(scriptRow).toBeVisible();
            await scriptRow.dblclick();

            const editor = page.locator('.monaco-editor').first();
            await expect(editor).toBeVisible();
            await expect.poll(() => editorText(page)).toContain('select 1;');

            // The bug is most reliably hit on a scratch tab: activation there calls
            // scripts.selectScript(undefined), and a spurious re-activation clobbers typing.
            const callsWhileTyping: string[] = [];
            let typing = false;
            page.on('request', (outgoing) => {
                if (typing && outgoing.url().includes('/api/selectScript')) {
                    callsWhileTyping.push(outgoing.url());
                }
            });

            await page.locator('main button:has(.icon-\\[mdi--plus\\])').first().click();

            // The scratch tab is empty; wait for that activation to land before typing.
            await expect.poll(() => editorText(page)).not.toContain('select 1;');

            const box = await editor.boundingBox();
            expect(box).not.toBeNull();
            await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

            // select all -> delete -> type -> Enter a few times. The text matches no
            // table or column, so Monaco's suggest widget stays out of the way.
            typing = true;
            await page.keyboard.press(SELECT_ALL);
            await page.keyboard.press('Delete');
            await page.keyboard.type('hello world', { delay: 20 });

            for (let press = 0; press < 6; press += 1) {
                await page.keyboard.press('Enter');
            }

            typing = false;

            // The typed text must survive the draft round-trip.
            await expect.poll(() => editorText(page)).toContain('hello world');

            // The caret must be below the first line: a jump to the start puts it back on line one.
            const cursorBox = await page.locator('.monaco-editor .cursor').first().boundingBox();
            const firstLineBox = await page.locator('.view-line').first().boundingBox();

            expect(cursorBox).not.toBeNull();
            expect(firstLineBox).not.toBeNull();
            expect(cursorBox!.y).toBeGreaterThan(firstLineBox!.y + firstLineBox!.height);

            // ...and typing must not have triggered another script activation.
            expect(callsWhileTyping).toEqual([]);
        } finally {
            await source.cleanup();
        }
    });
});
