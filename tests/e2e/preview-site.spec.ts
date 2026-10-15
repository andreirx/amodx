import { test, expect } from '@playwright/test';

// Safety net for preview URLs of tenants with NO custom domain (`/_site/<id>/…`), slice
// SITEID-BINDING-1. Middleware changes have broken these URLs before, and nothing else on
// staging exercises them.
//
// Fixture: tenant `preview-probe` on staging, created by the operator (placeholder domain
// `preview-probe.localhost`; home page contains the marker `PREVIEW-PROBE-HOME` and a hero
// button linking to `/contact`). This spec reads no credentials.
//
// No trailing slash: `/_site/preview-probe/` answers 308 → `/_site/preview-probe` (Next's
// trailing-slash normalisation). The hero link is the one that preview rendering prefixes
// with `/_site/preview-probe`; the page also has an un-prefixed `/contact` link, which is a
// separate preview-link finding and is deliberately not the one clicked here.
const PREVIEW_HOME = '/_site/preview-probe';

test('Preview URL of a tenant without a domain renders and its links stay inside the preview', async ({ page }) => {
    const home = await page.goto(PREVIEW_HOME);
    expect(home?.status()).toBe(200);
    await expect(page.locator('body')).toContainText('PREVIEW-PROBE-HOME');

    await page.locator(`a[href="${PREVIEW_HOME}/contact"]`).first().click();
    await expect(page).toHaveURL(/\/_site\/preview-probe\/contact$/);

    // The click may be a client-side navigation (no document response to inspect), so load
    // the landed URL as a document to prove the contact page itself answers 200.
    const contact = await page.reload();
    expect(contact?.status()).toBe(200);
    await expect(page.getByText('This page could not be found')).toHaveCount(0);
});
