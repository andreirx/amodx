// The tenant URL prefixes: URL_PREFIX_DEFAULTS, UrlPrefixesSchema, urlPrefixesOf and catalogListingPath.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

// SINGLE SOURCE OF TRUTH for URL prefix defaults — do NOT duplicate these elsewhere
export const URL_PREFIX_DEFAULTS = {
    product: "/product",
    category: "/category",
    cart: "/cart",
    checkout: "/checkout",
    shop: "/shop",
    account: "/account",
    search: "/search",
    interest: "/my-list",   // CAT-INTEREST-1: the interest-list page (catalog tenants only). CDL-2 (§ 7.2): English default
    // CDL-2 (§ 14 item 2): the order-confirmation segment, appended to `checkout` (`/checkout/confirmation`).
    // Not a path of its own: the renderer matches `checkout + checkoutConfirmation` (SitePage `matchCommercePrefix`).
    checkoutConfirmation: "/confirmation",
} as const;

// Configurable URL prefixes per tenant (for i18n-friendly URLs)
export const UrlPrefixesSchema = z.object({
    product: z.string().default(URL_PREFIX_DEFAULTS.product),
    category: z.string().default(URL_PREFIX_DEFAULTS.category),
    cart: z.string().default(URL_PREFIX_DEFAULTS.cart),
    checkout: z.string().default(URL_PREFIX_DEFAULTS.checkout),
    shop: z.string().default(URL_PREFIX_DEFAULTS.shop),
    account: z.string().default(URL_PREFIX_DEFAULTS.account),
    search: z.string().default(URL_PREFIX_DEFAULTS.search),
    interest: z.string().default(URL_PREFIX_DEFAULTS.interest),
    checkoutConfirmation: z.string().default(URL_PREFIX_DEFAULTS.checkoutConfirmation),
});

/**
 * CDL-2 (docs/slices/catalog-data-labels-1.md § 7.1, ruling § 9 item 5) — the ONE path rule: per key, the stored text
 * when it is a string with a non-blank character (kept as stored, not trimmed), else `URL_PREFIX_DEFAULTS[key]`.
 * `stored` is the tenant record's raw `urlPrefixes`: absent, not an object, or an array → every key is its default.
 * Users: the readers that used to fall back on the WHOLE object (`renderer/src/lib/dynamo.ts` `mapTenant`,
 * `admin/src/components/glamPreview.ts` `siteContextOf`, `backend/src/lib/slug-guard.ts`). Same rule as the backend's
 * `revalidate-paths.ts` `prefixPath` and the per-key readers of the renderer.
 */
export function urlPrefixesOf(stored: unknown): Record<keyof typeof URL_PREFIX_DEFAULTS, string> {
    const raw = stored !== null && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
    const out = {} as Record<keyof typeof URL_PREFIX_DEFAULTS, string>;
    for (const key of Object.keys(URL_PREFIX_DEFAULTS) as (keyof typeof URL_PREFIX_DEFAULTS)[]) {
        const value = raw[key];
        out[key] = typeof value === "string" && value.trim() !== "" ? value : URL_PREFIX_DEFAULTS[key];
    }
    return out;
}

/**
 * CAT-IMPORT-PROFILE-1B — the public path of a catalog page (moved here from `catalog-listing.ts` by CDL-2, ruling
 * CDL2-SHARED-DAG, so that it reads `URL_PREFIX_DEFAULTS` without an import cycle), without any `basePath` (the
 * caller prepends its own: the renderer its preview base, the admin preview ""). `prefixes` = the tenant's prefixes
 * after `urlPrefixesOf` (both callers read them so).
 *   - shop (`categorySlug` undefined): `prefixes.shop`, or `URL_PREFIX_DEFAULTS.shop` when it is empty (CDL-2 § 7.1;
 *     the Romanian literal fallback of the 1b record is gone);
 *   - category: `${prefixes.category}/${categorySlug}`.
 * The path is an input of the URL-budget rule (`selectionFits`), so both callers must pass the same string.
 */
export function catalogListingPath(prefixes: { shop?: string; category?: string }, categorySlug: string | undefined): string {
    return categorySlug === undefined ? prefixes.shop || URL_PREFIX_DEFAULTS.shop : `${prefixes.category}/${categorySlug}`;
}
