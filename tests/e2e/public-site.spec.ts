import { test, expect } from '@playwright/test';

test('Non-existent tenant shows 404', async ({ page }) => {
    const randomTenant = `test-404-${Date.now()}`;
    const response = await page.goto(`/tenant/${randomTenant}/home`);

    // Contract since the cache track (D3, "route not-founds dynamically"):
    // unknown paths are rewritten by the middleware to the _dyn force-dynamic
    // twin, which returns a REAL HTTP 404 with no-store — never a cacheable
    // 200 "Site Not Found" soft-404 (the old pre-cache-track behavior this
    // spec used to assert).
    expect(response?.status()).toBe(404);
    await expect(page.getByText('This page could not be found')).toBeVisible();
});
