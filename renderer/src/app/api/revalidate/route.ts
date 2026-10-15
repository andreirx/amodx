import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

// Phase 2.5: Secure revalidation endpoint with secret token
const REVALIDATION_SECRET = process.env.REVALIDATION_SECRET;

/*
 * CACHE-10 — the S3 ISR purge. Read this before touching the path branch below.
 *
 * WHY revalidatePath IS NOT ENOUGH
 * `revalidatePath` is tag-based (implicit `_N_T_` tags). Under open-next@3.1.3,
 * `adapters/cache.js#set()` wrote tag rows only for `kind === "PAGE"` (Pages Router). Every page
 * here is App Router (`APP_PAGE`), so no tag row existed, `getByTag` found nothing, and the S3
 * entry stayed "fresh" (`revalidate = false` ⇒ `s-maxage=31536000`). The CloudFront fast lane
 * then re-fetched that unchanged S3 copy. Root-caused on staging 2026-10-13 (docs/TECH-DEBT.md).
 * Since slice opennext-1b (@opennextjs/aws 4.1.9) the tag rows ARE written for `APP_PAGE` and
 * `revalidatePath('/<domain>/<slug>')` makes that page a MISS (bundle row B-TAG, with this purge
 * neutralized). It still does NOT refresh LISTING pages that show the edited content: no tag links
 * a listing to the edited page, and `revalidatePath('/<domain>', 'layout')` reaches no stored
 * listing (bundle row B-LISTING variant 2: the listing stays a HIT with the old title; ruling
 * OPENNEXT1-CACHE10-PURGE = A keeps this purge).
 * So we call `revalidatePath`, and then delete the tenant's S3 cache objects directly so the next
 * request for any of its pages re-renders from DynamoDB.
 *
 * WHAT IS DELETED — the whole tenant
 * The route has always asked for `revalidatePath('/<domain>', 'layout')`: "the tenant's whole
 * site goes fresh". The purge honours that intent at the S3 layer, which also refreshes listing
 * pages (post grids, nav) that show the edited content.
 *
 * THE KEY LAYOUT (a function of the Next version this renderer runs — that is why it lives here)
 * The adapter's `buildS3Key` = `<CACHE_BUCKET_KEY_PREFIX>/<buildId>/<key>.cache` (@opennextjs/aws
 * 4.1.9 `overrides/incrementalCache/s3.js:14-16`; open-next 3.1.3 `cache/incremental/s3.js`, same
 * layout — OBSERVED on both by bundle row B-ISO).
 * next 16.3.8 passes `key` = `route-cache/<kind>/<sha256(sourceRoute)>/$/<path>`, so a tenant
 * entry is (VERIFIED on staging 2026-10-13):
 *   _cache/<buildId>/route-cache/APP_PAGE/<ownerHash>/$/<domain>.cache          (tenant home)
 *   _cache/<buildId>/route-cache/APP_PAGE/<ownerHash>/$/<domain>/<slug...>.cache (pages)
 * Pre-16.3.8 builds used `_cache/<buildId>/<domain>[/<slug...>].cache`; we purge that too (cheap,
 * and it protects a rollback). The owner hash depends on Next's route identity, so it is
 * DISCOVERED by listing, never computed. `_cache/__fetch/` (the data cache, keyed by hash, not by
 * domain) shows up as one more "buildId" and simply yields no matches.
 *
 * TENANT ISOLATION
 * A tenant matches exactly `<base>/…` and the object `<base>.cache` — never a bare `<base>`
 * prefix, so `shop.example.com` cannot match `shop.example.com.evil`. A domain must also contain
 * a `.` and no `/`: no fixed layout segment (`route-cache`, `APP_PAGE`, `$`, a buildId, a hash,
 * `__fetch`) contains a dot, so a dotted domain can never address another tenant's prefix, while
 * a domain such as `route-cache` would match every tenant's objects.
 *
 * FAILURE IS LOUD
 * A List/Delete error, or any per-key error in a DeleteObjects response, returns 500. A purge
 * that silently fails is the defect this slice fixes; the backend logs every non-2xx.
 */

const DELETE_BATCH_MAX = 1000; // S3 DeleteObjects hard limit per request

let s3Client: S3Client | undefined;

/** All object keys and CommonPrefixes under `prefix`, across every page of results. */
async function listAll(
    client: S3Client,
    bucket: string,
    prefix: string,
    delimiter?: string,
): Promise<{ keys: string[]; prefixes: string[] }> {
    const keys: string[] = [];
    const prefixes: string[] = [];
    let token: string | undefined;
    do {
        const res = await client.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            Delimiter: delimiter,
            ContinuationToken: token,
        }));
        for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
        for (const p of res.CommonPrefixes ?? []) if (p.Prefix) prefixes.push(p.Prefix);
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return { keys, prefixes };
}

/** The tenant's objects at one base: everything under `<base>/` plus exactly `<base>.cache`. */
async function tenantKeysAt(client: S3Client, bucket: string, base: string): Promise<string[]> {
    const exact = `${base}.cache`;
    const [nested, homeCandidates] = await Promise.all([
        listAll(client, bucket, `${base}/`),
        listAll(client, bucket, exact),
    ]);
    return [...nested.keys, ...homeCandidates.keys.filter((k) => k === exact)];
}

/**
 * Delete every ISR cache object of `domain`, in both key layouts, under every buildId and every
 * route-owner hash. Returns the number of objects deleted. Throws on any S3 failure.
 */
async function purgeTenantIsrCache(
    client: S3Client,
    bucket: string,
    keyPrefix: string,
    domain: string,
): Promise<number> {
    // Mirrors open-next's `path.posix.join(CACHE_BUCKET_KEY_PREFIX ?? "", buildId, …)`.
    const root = keyPrefix ? `${keyPrefix.replace(/\/+$/, "")}/` : "";
    const { prefixes: buildRoots } = await listAll(client, bucket, root, "/");

    const bases = (await Promise.all(buildRoots.map(async (buildRoot) => {
        const { prefixes: kindRoots } = await listAll(client, bucket, `${buildRoot}route-cache/`, "/");
        const ownerRoots = (await Promise.all(
            kindRoots.map((kindRoot) => listAll(client, bucket, kindRoot, "/")),
        )).flatMap((r) => r.prefixes);
        return [
            `${buildRoot}${domain}`, // legacy (pre-16.3.8) layout
            ...ownerRoots.map((ownerRoot) => `${ownerRoot}$/${domain}`),
        ];
    }))).flat();

    const keys = (await Promise.all(bases.map((base) => tenantKeysAt(client, bucket, base)))).flat();

    for (let i = 0; i < keys.length; i += DELETE_BATCH_MAX) {
        const batch = keys.slice(i, i + DELETE_BATCH_MAX);
        const res = await client.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }));
        // DeleteObjects reports per-key failures in the body with HTTP 200 — it does not throw.
        if (res.Errors && res.Errors.length > 0) {
            const first = res.Errors[0];
            throw new Error(
                `DeleteObjects failed for ${res.Errors.length} of ${batch.length} key(s); ` +
                `first: ${first.Key} ${first.Code} ${first.Message}`,
            );
        }
    }
    return keys.length;
}

export async function POST(req: NextRequest) {
    try {
        // Verify revalidation token
        const token = req.headers.get('x-revalidation-token');
        if (!REVALIDATION_SECRET || token !== REVALIDATION_SECRET) {
            console.warn("[Cache] Unauthorized revalidation attempt");
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { domain, slug, tag } = body;

        // Tag-based revalidation (for product/category updates affecting multiple pages)
        if (tag) {
            console.log(`[Cache] Revalidating tag: ${tag}`);
            // Next.js 16+ requires second argument 'max' for full cache invalidation
            revalidateTag(tag, 'max');
            return NextResponse.json({ revalidated: true, tag, now: Date.now() });
        }

        // Path-based revalidation
        if (!domain) {
            return NextResponse.json({ error: "Missing domain or tag" }, { status: 400 });
        }
        // CACHE-10 tenant isolation — see the header comment for why a dot and no slash.
        if (typeof domain !== "string" || !domain.includes(".") || domain.includes("/")) {
            return NextResponse.json(
                { error: "domain must contain a '.' and no '/' to address a tenant's ISR cache" },
                { status: 400 },
            );
        }

        console.log(`[Cache] Purging: /${domain}${slug || ''}`);

        // Revalidate the rewritten path
        revalidatePath(`/${domain}${slug || ''}`);

        // Also revalidate the layout (theme changes)
        revalidatePath(`/${domain}`, 'layout');

        // CACHE-10: the S3 purge that actually makes the edit visible (see header comment).
        // `purged: null` = purge not attempted (no bucket configured: unit tests, local dev).
        let purged: number | null = null;
        const bucket = process.env.CACHE_BUCKET_NAME;
        if (!bucket) {
            console.warn(
                `[Cache] ISR S3 purge SKIPPED for ${domain} (CACHE_BUCKET_NAME not set) — ` +
                `cached pages stay until the nightly flush.`,
            );
        } else {
            s3Client ??= new S3Client({ region: process.env.CACHE_BUCKET_REGION });
            try {
                purged = await purgeTenantIsrCache(
                    s3Client, bucket, process.env.CACHE_BUCKET_KEY_PREFIX ?? "", domain,
                );
            } catch (err: any) {
                console.error(`[Cache] ISR S3 purge FAILED for ${domain}:`, err);
                return NextResponse.json(
                    { error: `ISR S3 purge failed: ${err?.message ?? String(err)}`, revalidated: false, domain },
                    { status: 500 },
                );
            }
            console.log(`[Cache] ISR S3 purge for ${domain}: deleted ${purged} object(s)`);
        }

        return NextResponse.json({ revalidated: true, path: `/${domain}${slug || ''}`, purged, now: Date.now() });
    } catch (err: any) {
        console.error("[Cache] Revalidation error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
