import { test, expect } from '@playwright/test';

const tenantId = `e2e-render-${Date.now()}`;
const pageSlug = "feature-test";

test.describe('End-to-End Content Rendering', () => {

    test.beforeAll(async ({ request }) => {
        const adminUrl = process.env.ADMIN_API_URL;
        const apiKey = process.env.AMODX_API_KEY; // <--- Read Key

        if (!adminUrl || !apiKey) {
            throw new Error("Missing ADMIN_API_URL or AMODX_API_KEY in .env.test");
        }

        console.log(`[Setup] Creating Tenant: ${tenantId}`);

        // 1. Create Tenant
        const tRes = await request.post(`${adminUrl}/tenants`, {
            headers: {
                'Authorization': `Bearer robot`,
                'x-api-key': apiKey // <--- Use Real Key
            },
            data: {
                id: tenantId,
                name: "E2E Test Site",
                domain: `${tenantId}.localhost`,
                theme: { primaryColor: "#FF5733", fontHeading: "Inter" }
            }
        });

        // Better error logging
        if (!tRes.ok()) {
            console.error("Tenant Create Failed:", tRes.status(), await tRes.text());
        }
        expect(tRes.ok()).toBeTruthy();

        // 2. Create Content
        const cRes = await request.post(`${adminUrl}/content`, {
            headers: {
                'x-tenant-id': tenantId,
                'Authorization': `Bearer robot`,
                'x-api-key': apiKey // <--- Use Real Key
            },
            data: {
                title: "Features Page",
                slug: pageSlug,
                status: "Published",
                blocks: [{ type: "hero", attrs: { headline: "E2E Hero", style: "center" } }]
            }
        });
        expect(cRes.ok()).toBeTruthy();

        // 3. Wait for consistency
        await new Promise(r => setTimeout(r, 1000));
    });

    test('Page Renders correctly', async ({ page }) => {
        const url = `/tenant/${tenantId}/${pageSlug}`;
        console.log(`[Test] Navigating to: ${url}`);

        const response = await page.goto(url);

        // Debugging 404s
        if (response?.status() !== 200) {
            console.log("Response Status:", response?.status());
            console.log("Body:", await page.textContent('body'));
        }

        expect(response?.status()).toBe(200);
        await expect(page).toHaveTitle(/Features Page/);

        // Verify Theme Injection
        const primaryColor = await page.evaluate(() => {
            return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
        });
        expect(primaryColor).not.toBe('#000000');

        await expect(page.getByText('E2E Hero')).toBeVisible();
    });
});
