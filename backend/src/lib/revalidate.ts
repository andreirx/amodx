import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "./db.js";
import { purgeTargets, type PurgeKind, type PurgeTarget, type TenantRouting } from "./revalidate-paths.js";
import { enqueueEdgeInvalidation, markCdnPending } from "./invalidate-cdn.js";

/**
 * Phase 4: Backend revalidation helper.
 * Calls the renderer's /api/revalidate endpoint with a secure token.
 *
 * Usage (cache-2 onwards):
 * - After a content/product/category mutation:
 *       await revalidateTenantPaths(tenantId, "page", [newSlug, oldSlug])
 *   which resolves the tenant's domain and purges the domain-keyed ISR entries.
 * - `revalidatePath(tenantDomain, slug)` / `revalidateTag(tag)` remain the low-level
 *   transport. Call them directly only if you already hold the **domain** — passing a
 *   tenant id is the bug cache-2 fixed (see `revalidate-paths.ts` for why).
 * - BULK-PURGE-FOOTER-1: after a bulk mutation (a handler wrapped by `withInvalidation()`), the
 *   whole tenant's stored pages: `withInvalidation(handler, purgeStoredPagesOfRequestTenant)`, or
 *   `purgeStoredPagesOfDomains([...])` when the handler holds the domain(s) itself.
 *
 * The renderer's /api/revalidate contract is unchanged: `{ domain, slug }` or `{ tag }`.
 */

let cachedSecret: string | null = null;
const secretName = process.env.REVALIDATION_SECRET_NAME;
const rendererUrl = process.env.RENDERER_URL;

const secretsClient = new SecretsManagerClient({});

async function getRevalidationSecret(): Promise<string | null> {
    if (!secretName) return null;
    if (cachedSecret) return cachedSecret;

    try {
        const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));
        if (res.SecretString) {
            cachedSecret = res.SecretString.trim();
            return cachedSecret;
        }
    } catch (e) {
        console.error("Failed to fetch revalidation secret:", e);
    }
    return null;
}

/**
 * cache-2 / DoD 3. The old code logged "Skipping" at `console.log` with no context, so a
 * deployment with ISR revalidation switched off was indistinguishable from a healthy one
 * in CloudWatch. Name what was skipped and what the consequence is.
 *
 * `RENDERER_URL` is unset (empty, in practice — `infra/lib/api.ts` passes
 * `props.rendererUrl || ''`) on any deployment without a configured root domain:
 * `amodx-stack.ts` computes `rendererBaseUrl = rootDomain ? https://<rootDomain> : undefined`.
 * The consequence is bounded but real: Layer 2 (S3 ISR) then only clears on the nightly
 * flush, so an edit can stay invisible for up to 24h even after CloudFront is invalidated.
 */
function warnRevalidationDisabled(what: string): void {
    const missing = !rendererUrl ? "RENDERER_URL" : "REVALIDATION_SECRET_NAME";
    console.warn(
        `[Revalidate] DISABLED (${missing} is not set) — skipped ISR purge of ${what}. ` +
        `Layer 2 (S3) will only clear on the nightly flush (up to 24h stale). ` +
        `RENDERER_URL requires a configured root domain — see docs/caching-architecture.md §5.`,
    );
}

/**
 * Revalidate a specific path for a tenant.
 *
 * @param tenantDomain - The tenant's domain (e.g., "shop.example.com"). **Not** the tenant
 *                       id: the ISR entry is keyed by the domain middleware rewrote to.
 * @param slug - The path to revalidate (e.g., "/about", "/product/widget")
 */
export async function revalidatePath(tenantDomain: string, slug: string): Promise<void> {
    if (!rendererUrl || !secretName) {
        warnRevalidationDisabled(`/${tenantDomain}${slug}`);
        return;
    }

    try {
        const secret = await getRevalidationSecret();
        if (!secret) {
            console.warn("[Revalidate] No secret available");
            return;
        }

        const res = await fetch(`${rendererUrl}/api/revalidate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-revalidation-token': secret,
            },
            body: JSON.stringify({ domain: tenantDomain, slug }),
            // CACHE-10: `revalidateTenantPaths()` now runs this BEFORE the edge fast-lane enqueue,
            // so an unbounded wait here would delay — or, past the 29s Lambda timeout, cancel —
            // Layer 1. 10s covers a renderer cold start plus the S3 list+delete; an abort is
            // caught below like any other transport error, and the enqueue then still runs.
            signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
            console.warn(`[Revalidate] Path failed: ${res.status}`, await res.text());
        } else {
            // The body carries `purged: <count>` (CACHE-10) — log it so CloudWatch shows how many
            // S3 ISR objects the renderer deleted (`null` = renderer has no cache bucket configured).
            console.log(`[Revalidate] Path success: /${tenantDomain}${slug}`, await res.text());
        }
    } catch (e) {
        console.error('[Revalidate] Path error:', e);
        // Don't fail the request - revalidation is best-effort
    }
}

/**
 * Revalidate all pages associated with a cache tag.
 *
 * @param tag - The cache tag (e.g., "product-123", "category-456", "tenant-abc")
 */
export async function revalidateTag(tag: string): Promise<void> {
    if (!rendererUrl || !secretName) {
        warnRevalidationDisabled(`tag:${tag}`);
        return;
    }

    try {
        const secret = await getRevalidationSecret();
        if (!secret) {
            console.warn("[Revalidate] No secret available");
            return;
        }

        const res = await fetch(`${rendererUrl}/api/revalidate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-revalidation-token': secret,
            },
            body: JSON.stringify({ tag }),
        });

        if (!res.ok) {
            console.warn(`[Revalidate] Tag failed: ${res.status}`, await res.text());
        } else {
            console.log(`[Revalidate] Tag success: ${tag}`);
        }
    } catch (e) {
        console.error('[Revalidate] Tag error:', e);
    }
}

/**
 * Read the two tenant attributes that decide a public URL.
 *
 * `domain` is a DynamoDB reserved word, hence the `ExpressionAttributeNames` alias. The
 * projection keeps this to the ~5ms single-item read it needs to be — the tenant record
 * carries the whole site config (theme, nav, commerce), none of which is wanted here.
 *
 * Not cached across invocations on purpose: a stale domain would purge the *wrong* key
 * after a domain change, which is worse than one extra GetItem per mutation. All six
 * ordinary handlers (`revalidateTenantPaths`) already hold `grantReadWriteData` on the table (verified in
 * `infra/lib/api.ts` and `infra/lib/api-commerce.ts`), so this adds no IAM surface —
 * the Secrets Manager grant is a different matter for `content/create.ts`, see its comment.
 * BULK-PURGE-FOOTER-1: the bulk handlers reach it through `purgeStoredPagesOfTenant`. Three of their
 * Lambdas held only `grantWriteData` (`CreatePopupFunc`, `CreateReviewFunc`, `DeleteReviewFunc`); since
 * round 2 (ruling BPF1-REVIEWS-READ = A, 2026-11-02) each also holds `dynamodb:GetItem` — only that —
 * for this one read. Every purge-enabled Lambda's grants: record `docs/slices/bulk-purge-footer-1.md` § 2.3.
 */
async function getTenantRouting(tenantId: string): Promise<TenantRouting> {
    const res = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
        ProjectionExpression: "#domain, urlPrefixes",
        ExpressionAttributeNames: { "#domain": "domain" },
    }));
    return { domain: res.Item?.domain, urlPrefixes: res.Item?.urlPrefixes };
}

/**
 * Layer 2 (OpenNext ISR in S3) transport — the ONE place both purge classes reach the renderer
 * (BULK-PURGE-FOOTER-1 extracted it from `revalidateTenantPaths`). Gated on renderer config: when
 * `RENDERER_URL` or `REVALIDATION_SECRET_NAME` is unset it logs the DISABLED warning and does
 * nothing. Otherwise one `revalidatePath()` call per target, in order; since CACHE-10 each call makes
 * the renderer delete the WHOLE tenant's S3 ISR objects for that domain. Never throws:
 * `revalidatePath()` logs and swallows every failure, and its fetch is bounded (10s abort).
 *
 * @param targets renderer calls to make (`{ domain, slug }`)
 * @param what    what is purged, for the DISABLED warning
 */
async function purgeIsrTargets(targets: PurgeTarget[], what: string): Promise<void> {
    if (!rendererUrl || !secretName) {
        warnRevalidationDisabled(what);
        return;
    }
    for (const target of targets) {
        await revalidatePath(target.domain, target.slug);
    }
}

/**
 * cache-2: purge the ISR cache entries for a mutated entity, keyed by the tenant's domain.
 *
 * This is the entry point every mutation handler should use. It resolves the tenant's
 * domain here — in the backend, which owns `TenantConfig` and is the authority for the
 * tenant→domain mapping (ratified design D2 in the cache-2 slice doc). Since CACHE-10 the
 * renderer's S3 purge clears the WHOLE tenant's ISR cache on every call (the `slug` still
 * names the `revalidatePath` target); the S3 key layout is known only to the renderer route.
 * Order (CACHE-10): S3 purge (awaited) → edge fast lane for the exact paths → bulk `/*` marker
 * (`CDN_PENDING`; fires ≤15 min after the first pending change — CACHE-10 max wait) so dependent
 * listings also refresh.
 *
 * Best-effort, like everything on this path: a lookup failure, a missing domain or a failed
 * HTTP call is logged and swallowed. Revalidation must never fail the mutation that
 * triggered it — the nightly flush is the backstop.
 *
 * @param tenantId tenant whose ISR entries to purge
 * @param kind     URL shape of the entity (`page` | `product` | `category`)
 * @param slugs    affected slugs; pass the old slug too on a rename (blanks/dupes dropped)
 */
export async function revalidateTenantPaths(
    tenantId: string,
    kind: PurgeKind,
    slugs: Array<string | undefined>,
): Promise<void> {
    const requested = slugs.filter((s): s is string => !!s && !!s.trim());
    if (requested.length === 0) return;

    // cache-4a: the tenant routing read now happens BEFORE the renderer gate, because it feeds
    // BOTH cache layers and Layer 1 does not need the renderer. Previously this early-returned
    // when RENDERER_URL was unset, saving one GetItem — but ordinary handlers no longer carry
    // the `withInvalidation()` `/*` backstop, so the edge fast lane (Layer 1) must fire even on
    // a deployment without a configured root domain. Cost: one ~5ms GetItem per ordinary
    // mutation when revalidation is otherwise disabled. It is the reason the edge goes live.
    let routing: TenantRouting;
    try {
        routing = await getTenantRouting(tenantId);
    } catch (e) {
        console.error(
            `[Revalidate] Tenant routing lookup failed for ${tenantId}; skipped BOTH the edge ` +
            `fast-lane and the ISR purge of ${kind} ${requested.join(", ")}`, e,
        );
        return;
    }

    const targets = purgeTargets(routing, kind, requested);
    if (targets.length === 0) {
        console.warn(
            `[Revalidate] Tenant ${tenantId} has no 'domain' on its tenant record — skipped ` +
            `edge + ISR purge of ${kind} ${requested.join(", ")}. Production traffic is keyed by ` +
            `domain, so there is no cache entry to address until a domain is configured.`,
        );
        return;
    }

    // CACHE-10 ORDERING: Layer 2 (S3) is purged BEFORE Layer 1 (edge) is enqueued. The edge
    // refills from S3: if CloudFront is invalidated first (the CACHE-9 drain fires ~1s after the
    // enqueue) and a request arrives before the renderer has deleted the S3 objects (a renderer
    // cold start alone is 1-3s), the edge re-caches the STALE page with `s-maxage=31536000` —
    // stale until the nightly flush. Purging S3 first closes that window. `revalidatePath()`
    // never throws and its fetch is bounded (10s abort), so Layer 1 below always runs.

    // Layer 2 (OpenNext ISR in S3): purge via the renderer. Gated on renderer config — if it
    // is off, Layer 1 still fires below and the nightly S3 flush is the backstop (DoD 3).
    await purgeIsrTargets(targets, `${kind} ${requested.join(", ")} (tenant ${tenantId})`);

    // Layer 1 (CloudFront edge): enqueue the exact changed URI paths for an immediate targeted
    // invalidation. Independent of RENDERER_URL — the debounce Lambda drains this against the
    // distribution directly. This is what makes an ordinary edit go live in seconds.
    await enqueueEdgeInvalidation(targets.map((t) => t.slug));

    // Listings (CACHE-10, human ruling 2026-10-13: listings go live within ~15 min). A page that
    // SHOWS the edited content (blogroll, post grid, nav) has its own URL, which the exact-path
    // fast lane above cannot name; its S3 copy is already gone (the renderer purged the whole
    // tenant), but its edge copy is not. Arm the bulk lane: debounce-flush fires ONE `/*` at the
    // earlier of 15 min of quiet and 15 min after the first pending change (max wait, so steady
    // cross-tenant edits cannot defer it); a burst of edits normally coalesces into that one `/*`
    // (mid-flush/concurrent exceptions: `bulkFlushDueAt` docstring). `/*` is the only tenant-wide edge purge
    // (CloudFront paths carry no host). Written LAST so a `/*` can never precede the S3 purge.
    // `markCdnPending()` never throws (logs + swallows); the nightly flush backstops a failure.
    await markCdnPending();
}

/**
 * The slug a whole-tenant purge names: the tenant home. Since CACHE-10 every renderer call deletes
 * ALL of the domain's S3 ISR objects, whatever the slug, so one call per domain is the whole purge.
 * "/" is the slug the ordinary path already sends for a home-page edit (`content/*` with slug "/").
 */
const WHOLE_TENANT_SLUG = "/";

/**
 * BULK-PURGE-FOOTER-1: delete every stored (S3 ISR) page of each named domain — Layer 2 only. The
 * edge (Layer 1) is NOT touched here: the caller's `withInvalidation()` wrapper writes `CDN_PENDING`
 * AFTER the handler (and this purge) returned, which keeps the CACHE-10 order "S3 before edge".
 *
 * Use it when the handler holds the domain itself: `tenant/create` (the new tenant's domain — a
 * previous owner of that host may have left stored pages under it) and `tenant/settings` (the
 * domain before AND after the save, so a domain change also clears the old host's pages).
 *
 * Entries that are not a non-blank string are dropped (`tenant/settings` passes a body value, which
 * no schema checks) and duplicates collapse, so a caller may pass the old and the new domain
 * unconditionally. Best-effort: never throws (see `purgeIsrTargets`).
 */
export async function purgeStoredPagesOfDomains(domains: unknown[]): Promise<void> {
    const unique = [...new Set(domains.flatMap((d) => (typeof d === "string" && d.trim() !== "" ? [d.trim()] : [])))];
    if (unique.length === 0) return;
    await purgeIsrTargets(
        unique.map((domain) => ({ domain, slug: WHOLE_TENANT_SLUG })),
        `all stored pages of ${unique.join(", ")}`,
    );
}

/**
 * BULK-PURGE-FOOTER-1: delete every stored (S3 ISR) page of one tenant — Layer 2 only, as
 * `purgeStoredPagesOfDomains`. Resolves the tenant's domain with the same projected GetItem as
 * `revalidateTenantPaths` (`getTenantRouting`).
 *
 * The renderer gate is checked BEFORE the GetItem: the bulk purge has no Layer-1 work that needs the
 * domain (unlike `revalidateTenantPaths`), so a deployment without renderer config pays no read.
 * No tenant id → nothing to purge, no log. Best-effort: a lookup failure or a missing domain is
 * logged and swallowed; never throws.
 */
export async function purgeStoredPagesOfTenant(tenantId: string | undefined): Promise<void> {
    if (!tenantId) return;
    if (!rendererUrl || !secretName) {
        warnRevalidationDisabled(`all stored pages of tenant ${tenantId}`);
        return;
    }
    let routing: TenantRouting;
    try {
        routing = await getTenantRouting(tenantId);
    } catch (e) {
        console.error(`[Revalidate] Tenant routing lookup failed for ${tenantId}; skipped the purge of its stored pages`, e);
        return;
    }
    if (typeof routing.domain !== "string" || !routing.domain.trim()) {
        console.warn(
            `[Revalidate] Tenant ${tenantId} has no 'domain' on its tenant record — skipped the purge ` +
            `of its stored pages (no domain-keyed cache entry can exist).`,
        );
        return;
    }
    await purgeStoredPagesOfDomains([routing.domain]);
}

/**
 * BULK-PURGE-FOOTER-1: `purgeStoredPagesOfTenant` for the tenant the request names in its
 * `x-tenant-id` header — the tenant every tenant-scoped handler already reads. This is the function
 * the bulk handlers pass to `withInvalidation(handler, purgeStoredPagesOfRequestTenant)`. A request
 * without the header purges nothing. Never throws.
 */
export async function purgeStoredPagesOfRequestTenant(
    event: { headers?: Record<string, string | undefined> } | undefined,
): Promise<void> {
    await purgeStoredPagesOfTenant(event?.headers?.["x-tenant-id"]);
}
