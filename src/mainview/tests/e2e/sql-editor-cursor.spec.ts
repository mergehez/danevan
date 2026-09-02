import { expect, test } from '@playwright/test';

/**
 * Regression test for the SQL editor cursor-jump bug.
 *
 * Repro (as reported): open a script tab, click the editor, select all,
 * delete, type, then press Enter a few times. With the bug, typing triggers a
 * value round-trip: onDidChangeContent -> query.queryText -> draft sync ->
 * setTabs -> the nav-state watcher re-fires activateTab (because its source
 * was a fresh array) -> scripts.selectScript() runs (visible as the
 * "selectScript" busy indicator at the bottom-right) -> and, while that call
 * is pending, the newer typing gets clobbered by the stale draftSql, which
 * makes Monaco call model.setValue() and the cursor jumps back to the start.
 *
 * The fix makes the nav-state watcher key a primitive string, so draft-sync
 * setTabs with unchanged tab hashes no longer re-runs activation. This test
 * asserts the cursor stays at the end of the typed text after several Enter
 * presses and that no "selectScript" call is triggered while typing.
 */
test.describe('SQL editor cursor stability', () => {
    test('cursor stays at the end while typing and pressing Enter', async ({ page }) => {
        await page.goto('/');

        // Wait for the app to mount and the sidebar scripts tree to render.
        await page.waitForSelector('[data-node-id^="script:"]', { state: 'attached', timeout: 20_000 });
        await page.waitForTimeout(1500);

        // Open the LAST script from the sidebar (single click only selects;
        // double click activates, per the app's activateOnDoubleClick). This
        // also makes the tab-bar "New scratch tab" plus button appear.
        const scriptRows = page.locator('[data-node-id^="script:"]');
        const scriptCount = await scriptRows.count();
        expect(scriptCount).toBeGreaterThan(0);
        const lastScript = scriptRows.nth(scriptCount - 1);
        await lastScript.dblclick({ timeout: 15_000 });

        // Wait for the Monaco editor, then create a scratch tab — the bug
        // (unconditional scripts.selectScript(undefined) on re-activation)
        // is most reliably hit there.
        const editor = page.locator('.monaco-editor').first();
        await editor.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(500);

        const scratchPlus = page.locator('main button:has(.icon-\\[mdi--plus\\])').first();
        await scratchPlus.click({ timeout: 10_000 });
        await page.waitForTimeout(1000);

        // Focus the editor by clicking its center.
        const box = await editor.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.waitForTimeout(300);

        // select all -> delete -> type -> Enter a few times. Use a string that
        // won't match any table/column so Monaco's suggest widget stays out of
        // the way.
        await page.keyboard.press('Meta+a');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);
        await page.keyboard.type('hello world', { delay: 20 });
        await page.waitForTimeout(300);

        for (let i = 0; i < 6; i++) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(250);
        }

        // Allow any (wrong) background selectScript/activation to settle.
        await page.waitForTimeout(800);

        // The typed text must be intact at the start (not clobbered by a stale
        // draftSql round-trip). Monaco renders spaces as non-breaking and may
        // split long lines into view-lines, so normalize before comparing.
        const lines = await page.locator('.view-line').allTextContents();
        const text = lines.join('\n').replace(/\u00A0/g, ' ');
        expect(text).toContain('hello world');

        // The cursor must be on the LAST line (i.e. NOT at the start). Monaco
        // renders the caret as .monaco-editor .cursor with style.top/left.
        const cursorTop = await page
            .locator('.monaco-editor .cursor')
            .first()
            .evaluate((el) => (el as HTMLElement).style.top);
        const topPx = parseFloat(cursorTop || '0');

        // With 6 Enter presses the cursor is several lines down; a jump to the
        // start would put it back at (0px, 0px) on line one.
        expect(topPx).toBeGreaterThan(18 * 4);

        // While typing/pressing Enter, the app must NOT have triggered the
        // spurious scripts.selectScript call (visible as the bottom-right busy
        // indicator). We only assert this when the state is observable.
        const busyAlert = page.locator('.fixed.right-4.bottom-4', { hasText: 'selectScript' });
        const busyCount = await busyAlert.count();
        expect(busyCount).toBe(0);
    });
});
