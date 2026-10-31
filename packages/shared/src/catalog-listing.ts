// CAT-IMPORT-PROFILE-1B — the catalog listing rule (design docs/slices/cat-import-profile-1.md § 5.2, ruling
// CIP1-PREVIEW = A). PURE: no I/O, no clock — `today` is an input.
//
// Which products a catalog site lists on its shop or on one category page, in which order, and the public path of
// that page. Moved here from the renderer (`getCatalogListing` membership/date/sort, `isProductAvailable`, the two
// path expressions of `SitePage.tsx`) so that the admin's import preview (slice 1c) applies the SAME rule to the
// dry-run plan that the site applies to the stored products. Users: `renderer/src/lib/dynamo.ts` (`getCatalogListing`,
// and every other availability check of that file), `renderer/src/components/SitePage.tsx` (the two paths); slice 1c
// (admin preview). The behaviour is the base commit's, field for field — pinned by the 1b golden
// (`test/cat-import-profile-1b-golden.test.ts`).

/** The fields of a product item the listing rule reads. Anything else on the item is passed through untouched. */
export type CatalogListingItem = {
    id?: unknown;
    status?: unknown;
    categoryIds?: unknown;
    sortOrder?: unknown;
    availableFrom?: unknown;
    availableUntil?: unknown;
};

/**
 * The calendar day of `now` in UTC, `YYYY-MM-DD` — the `today` every function below expects. The date window is
 * compared on the UTC day (a product whose `availableFrom` is "2026-11-01" is listed from 00:00 UTC that day).
 */
export function utcDay(now: Date): string {
    return now.toISOString().split("T")[0];
}

/**
 * The availability window: true when `today` (a `utcDay`) is inside [`availableFrom`, `availableUntil`], both
 * inclusive, either bound optional. A product with neither bound is always available. The comparison is on the
 * `YYYY-MM-DD` strings, as stored.
 */
export function isProductAvailable(p: { availableFrom?: unknown; availableUntil?: unknown }, today: string): boolean {
    const from = p.availableFrom as string | undefined;
    const until = p.availableUntil as string | undefined;
    if (!from && !until) return true;
    if (from && today < from) return false;
    if (until && today > until) return false;
    return true;
}

/**
 * The products of one catalog page, in page order.
 *   - shop (`categoryId` undefined): `status === "active"`;
 *   - category: `!status || status === "active"` (a status-less legacy product is listed on its category page, not on
 *     the shop) and `categoryIds` is an array that contains `categoryId`;
 *   - both: `isProductAvailable(p, today)`, then the sort by `sortOrder` (absent = 0), ties by `id` in code-unit
 *     order — the order no longer depends on the order in which the items were read.
 * Returns a new array of the same item objects.
 */
export function catalogListing<P extends CatalogListingItem>(items: readonly P[], categoryId: string | undefined, today: string): P[] {
    const member = categoryId === undefined
        ? (p: P) => p.status === "active"
        : (p: P) => (!p.status || p.status === "active") && Array.isArray(p.categoryIds) && p.categoryIds.includes(categoryId);
    return items
        .filter(member)
        .filter((p) => isProductAvailable(p, today))
        .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The public path of a catalog page, without any `basePath` (the caller prepends its own: the renderer its preview
 * base, the admin preview ""). `prefixes` = the tenant's `urlPrefixes`, or `URL_PREFIX_DEFAULTS` when the tenant has
 * none (the caller decides, as `SitePage.tsx` does).
 *   - shop (`categorySlug` undefined): `prefixes.shop`, or "/magazin" when it is empty — the renderer's literal
 *     fallback, kept as it is (it differs from `URL_PREFIX_DEFAULTS.shop`, "/shop"; recorded in the 1b record);
 *   - category: `${prefixes.category}/${categorySlug}`.
 * The path is an input of the URL-budget rule (`selectionFits`), so both callers must pass the same string.
 */
export function catalogListingPath(prefixes: { shop?: string; category?: string }, categorySlug: string | undefined): string {
    return categorySlug === undefined ? prefixes.shop || "/magazin" : `${prefixes.category}/${categorySlug}`;
}
