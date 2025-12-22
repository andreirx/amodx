import { test, expect } from '@playwright/test';

test('Non-existent tenant shows 404', async ({ page }) => {
    const randomTenant = `test-404-${Date.now()}`;
    const response = await page.goto(`/tenant/${randomTenant}/home`);

    // The Middleware rewrites to /_site/ID/home
    // If config missing -> Layout returns "Site Not Found" (200 status usually, or 404 if we set it)
    // Our layout returns a div with "Site Not Found".

    await expect(page.getByText('Site Not Found')).toBeVisible();
});
