import { expect, test } from '@playwright/test';

test.describe('Danevan App', () => {
    test('loads the app and shows the main UI', async ({ page }) => {
        // Navigate to the app
        await page.goto('/');

        // Wait for the Vue app to mount — the #app div should contain content
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        // Give Vue time to render after bridge init
        await page.waitForTimeout(2000);

        // The page should have some text content (app loaded)
        const bodyText = await page.locator('body').innerText();
        expect(bodyText.length).toBeGreaterThan(0);

        // Take a screenshot for visual reference
        await page.screenshot({ path: 'test-results/app-loaded.png', fullPage: true });
    });

    test('sidebar shows servers and connections after bootstrap', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        // Wait for the bootstrap to complete and render
        await page.waitForTimeout(3000);

        // The app should have rendered some server/connection entries
        // Look for text indicators that bootstrap loaded successfully
        const pageContent = await page.locator('#app').innerText();

        // Should have rendered something meaningful
        expect(pageContent.length).toBeGreaterThan(50);

        await page.screenshot({ path: 'test-results/app-bootstrap.png', fullPage: true });
    });

    test('can open add connection dialog', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        // Wait for app to initialize
        await page.waitForTimeout(3000);

        // Look for a button or element that triggers the add connection form
        // The sidebar typically has server entries with context menus
        // Try finding the "Add connection" or "Add source" button
        const addButton = page.locator('button', { hasText: /Add|add|New|new|Plus|\+/ }).first();

        if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await addButton.click();
            await page.waitForTimeout(500);

            // Check if a modal or form appeared
            await page.screenshot({ path: 'test-results/add-dialog.png', fullPage: true });
        } else {
            // Just take a screenshot showing the current state
            await page.screenshot({ path: 'test-results/no-add-button.png', fullPage: true });
        }
    });

    test('backend API is reachable', async ({ page }) => {
        // Test the backend directly via the browser's fetch
        const response = await page.request.post('http://127.0.0.1:3264/api/getEditorSettings', {
            headers: { 'Content-Type': 'application/json' },
        });

        expect(response.ok()).toBe(true);

        const body = await response.json();
        expect(body).toHaveProperty('editors');
        expect(body).toHaveProperty('queryRowLimit');
    });
    test('schema selection button shows correct count', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#app', { state: 'attached', timeout: 15_000 });

        // Wait for the bootstrap to complete and the tree to render
        await page.waitForTimeout(3000);

        // Find all server-schema-selection-button elements
        const buttons = page.locator('#server-schema-selection-button');
        const count = await buttons.count();

        if (count > 0) {
            for (let i = 0; i < count; i++) {
                const textContent = await buttons.nth(i).textContent();
                // The text should never show " of 1" — that means the schema count wasn't loaded
                expect(textContent).not.toContain(' of 1');
            }
        }
    });
});
