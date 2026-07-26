import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

/**
 * cache-2: construction of the ISR cache keys a mutation must purge.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE
 * -----------------------------------
 * The rule it encodes is the whole point of slice cache-2 and it is invisible from any
 * one handler, so it is stated once, here, and pinned by `test/unit/revalidate-paths.test.ts`
 * — which runs with no AWS credentials and no DynamoDB (see `vitest.unit.config.ts`).
 * It imports nothing but a constant from `@amodx/shared`: importing `db.js` or the AWS SDK
 * here would make that test impossible.
 *
 * THE RULE
 * --------
 * An OpenNext ISR cache entry is keyed by the path **middleware rewrote the request to**,
 * not by the public URL and not by the tenant id:
 *
 *   production traffic   Host: shop.example.com  GET /about
 *                        → middleware rewrites to  /shop.example.com/about
 *                        → S3 key  _cache/<buildId>/shop.example.com/about.cache
 *
 * So the purge must name `/<domain>/<path>`. Until this slice the backend named
 * `/<tenantId>/<path>`, which addresses no cache entry that can exist — a no-op.
 *
 * Test mode (`/tenant/<id>/…`) and preview (`/_site/<id>/…`) are rewritten by
 * `renderer/middleware.ts` to the `force-dynamic` twin (`/<id>/_dyn/…`) and are therefore
 * never stored by either cache layer. That is why nothing here emits a tenantId-keyed
 * path: there is no such entry to purge. (Verified in-slice — see the slice doc's
 * "tenantId-keyed purge" finding.)
 *
 * ONE DOMAIN PER TENANT
 * ---------------------
 * `TenantConfigSchema.domain` is a single `z.string()`, the `GSI_Domain` index has one
 * `Domain` partition key value per tenant item, and `renderer/src/lib/tenant-directory.ts`
 * admits a host only on an exact match of that value. So exactly one host can ever produce
 * an ISR entry for a tenant, and `PurgeTarget[]` varies over *slugs*, not over domains.
 * If tenant→multi-domain is ever added (alias records, apex+www), the change lands here:
 * `TenantRouting.domain` becomes a list and the loop below fans out over it.
 */

/**
 * The tenant fields that decide a public URL. A raw DTO read straight off the tenant
 * record — deliberately not `TenantConfig`, because the caller reads only these two
 * attributes with a `ProjectionExpression` and must not have to satisfy the full schema.
 */
export type TenantRouting = {
    domain?: string;
    urlPrefixes?: Record<string, string | undefined>;
};

/** Exactly the argument pair `revalidate.ts#revalidatePath(tenantDomain, slug)` takes. */
export type PurgeTarget = { domain: string; slug: string };

/**
 * Which public URL shape the mutated entity has.
 * - `page`   — content slugs are already absolute paths (`/about`), no prefix.
 * - `product` / `category` — commerce entities live under a per-tenant configurable prefix.
 */
export type PurgeKind = "page" | "product" | "category";

/** Guarantees exactly one leading slash; returns "" for blank input. */
function normalizeSlug(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * The tenant's own prefix wins over the hardcoded default. `SitePage.tsx#matchCommercePrefix`
 * routes on `config.urlPrefixes`, so the tenant value *is* the real URL — purging
 * `/product/x` for a tenant serving `/produs/x` addresses nothing. This closes
 * docs/caching-architecture.md §Known Gaps 2 for these two entity kinds.
 */
function prefixFor(routing: TenantRouting, kind: PurgeKind): string {
    if (kind === "page") return "";
    const configured = routing.urlPrefixes?.[kind];
    return normalizeSlug(configured || URL_PREFIX_DEFAULTS[kind]);
}

/**
 * Map a mutation to the ISR cache entries it invalidates.
 *
 * @param routing tenant `domain` + `urlPrefixes`, as read off the tenant record
 * @param kind    URL shape of the mutated entity
 * @param slugs   affected slugs — pass the new slug and, on a rename, the old one.
 *                `undefined` / blank entries are dropped, duplicates collapse (so callers
 *                may pass the old slug unconditionally).
 * @returns one target per distinct path; **empty** when the tenant has no usable domain,
 *          which the caller must report rather than silently ignore.
 */
export function purgeTargets(
    routing: TenantRouting,
    kind: PurgeKind,
    slugs: Array<string | undefined>,
): PurgeTarget[] {
    const domain = (routing.domain || "").trim();
    if (!domain) return [];

    const prefix = prefixFor(routing, kind);
    const seen = new Set<string>();
    const targets: PurgeTarget[] = [];

    for (const raw of slugs) {
        if (!raw) continue;
        const slug = normalizeSlug(raw);
        if (!slug) continue;
        const full = `${prefix}${slug}`;
        if (seen.has(full)) continue;
        seen.add(full);
        targets.push({ domain, slug: full });
    }

    return targets;
}
