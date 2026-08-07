import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "./db.js";
import { purgeTargets, type PurgeKind, type TenantRouting } from "./revalidate-paths.js";
import { enqueueEdgeInvalidation } from "./invalidate-cdn.js";

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
        });

        if (!res.ok) {
            console.warn(`[Revalidate] Path failed: ${res.status}`, await res.text());
        } else {
            console.log(`[Revalidate] Path success: /${tenantDomain}${slug}`);
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
 * calling handlers already hold `grantReadWriteData` on the table (verified in
 * `infra/lib/api.ts` and `infra/lib/api-commerce.ts`), so this adds no IAM surface —
 * the Secrets Manager grant is a different matter for `content/create.ts`, see its comment.
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
 * cache-2: purge the ISR cache entries for a mutated entity, keyed by the tenant's domain.
 *
 * This is the entry point every mutation handler should use. It resolves the tenant's
 * domain here — in the backend, which owns `TenantConfig` and is the authority for the
 * tenant→domain mapping — and leaves the renderer purging exactly the paths it is told
 * (ratified design D2 in the slice doc).
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

    // Layer 1 (CloudFront edge): enqueue the exact changed URI paths for an immediate targeted
    // invalidation. Independent of RENDERER_URL — the debounce Lambda drains this against the
    // distribution directly. This is what makes an ordinary edit go live in seconds.
    await enqueueEdgeInvalidation(targets.map((t) => t.slug));

    // Layer 2 (OpenNext ISR in S3): purge via the renderer. Gated on renderer config — if it
    // is off, Layer 1 has still fired and the nightly S3 flush is the backstop (DoD 3).
    if (!rendererUrl || !secretName) {
        warnRevalidationDisabled(`${kind} ${requested.join(", ")} (tenant ${tenantId})`);
        return;
    }

    for (const target of targets) {
        await revalidatePath(target.domain, target.slug);
    }
}
