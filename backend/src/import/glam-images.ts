import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { createHash } from "crypto";
import { GetCommand, QueryCommand, UpdateCommand, type QueryCommandOutput } from "@aws-sdk/lib-dynamodb";
import { deriveGallery } from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { writeCatProductItems, deleteCatProductItems } from "../lib/catprod.js";
import { readTenantMode } from "../lib/catalog-product.js";
import { copyImageToTenantMedia } from "../lib/image-upload.js";
import { loadMediaMap, writeMediaMapEntry } from "../lib/media-map.js";
import { publishAudit } from "../lib/events.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { purgeStoredPagesOfRequestTenant } from "../lib/revalidate.js";
import { checkUpload } from "./glam/map.js";
import {
    collectSources, hiddenWithoutImage, isProducerUrl, planProductWrite, resolveSources, remainingWork,
    type IngestOption, type IngestProduct, type ProductWrite, type SourceHolder, type SourceResult,
} from "./glam/images.js";

/**
 * CAT-IMAGES-1 — `POST /import/glam-pricelist/images`, body `{ producer, sheet }`: copy the producer images of one
 * imported sheet into the tenant's media, one bounded batch per request (CIM-A1-1: the admin page calls again until
 * `complete`). Served by the glam import function (`glam-pricelist.ts` dispatches on `routeKey`).
 *
 * Order: tenant binding + scope (403) → body / upload fields (400) → tenant mode (404 / 403 non-catalog) → the set
 * (the tenant's `PRODUCT#` items selected by `importSource`, as the import does) → `MEDIAMAP#` read once → copy the
 * sources not yet copied until the copy budget, each success recorded in `MEDIAMAP#` at once → one conditional
 * `UpdateCommand` per touched product until the update budget, then its `CATPROD#` rebuild → 200 with per-source
 * results, progress and `complete`. Any failure → 500 naming the step.
 *
 * CAT-IMAGE-GATE-1 (docs/slices/cat-image-gate-1.md § 3 items 3, 4): a product read as `draft` that holds a copied
 * image after its write is published (`status = active`) in that same conditional write (`planProductWrite`) — also a
 * draft whose image is already under the tenant CDN and needs no rewrite (CIG-R2); its `CATPROD#` rebuild carries the
 * new status. Every other status is left as it is. The answer lists the products published by this request
 * (`products.published`) and every product of the set that stays hidden for lack of an image (`hiddenWithoutImage`:
 * no copied image and no producer URL left); the failed sources of such a product are the `sources` entries that name
 * it as a holder, in this answer or an earlier one of the same copy.
 *
 * Write rule (CIG-R1, closes "a stale write overrides a publication another request committed"): a product's write
 * commits only if the `status` it was planned from is still stored (`attribute_exists(PK) AND #status = :read`). A
 * cancelled write re-reads the product (consistent): absent → replaced (as before); present → planned again from
 * that read, with the source results of this request (`rewriteProduct` `read`), at most WRITE_ATTEMPTS times; a
 * product still contended after that is left to a later request. Once a request has published a product, no stale
 * write of another request can commit over it, and a re-planned write never removes a stored copied image — so a
 * product the copy published always holds a copied image. CIG-STALE-WRITE (CAT-IMPORT-GALLERY-1, docs/slices/
 * cat-images-1.md § 11): the condition also names the `variants` value read (`AND #variants = :readVariants`, or
 * `attribute_not_exists(#variants)`), so a stale write is cancelled and re-planned also when the status is unchanged
 * (before § 11 it committed, CAT-IMAGES-1 § 9, and could remove an image another request had copied).
 *
 * Report rule (review-0 CIM-F2): a source is reported with the holders whose product write COMMITTED in this request,
 * and only then. A resolved source whose products were deferred by the update budget is not reported: it is resolved
 * again by a later request (from `MEDIAMAP#` when it was copied) and reported there with those holders. So each
 * (product, option) holding is reported by each request that rewrites it — normally once; again when an overlapping
 * stale write restored its producer URL (slice § 9) and a later request rewrote it. The admin page keeps the latest
 * outcome per holding (`mergeSources`).
 * CAT-IMPORT-GALLERY-1: an option's extras are holdings too (`extra: true`), one per (option, extra address); an extra
 * holding is reported when the committed write applied this request's result to it (`committedHolding`): copied → the
 * CDN URL is in the option's extras after the write and was not before (also a copy recovered by the CIG-R1 rebase);
 * refused/failed → the address was there before and is not after. Extras are rebased like the main image (CIG-R1), by
 * their original holding (`storedCopies` gives the copies other requests stored; the guarantee scope and the frozen
 * residual are stated at `rewriteExtras`). CIG-STALE-WRITE (cat-images-1.md
 * § 11): the write also requires the `variants` value it was planned from, so a stale write never commits over another
 * request's images — it is cancelled, re-read and re-planned (≤ WRITE_ATTEMPTS).
 * `counts.extras` counts, per kind, the reported sources with ≥ 1 extra holding; `progress.remainingExtras` the extra
 * holdings still on a producer URL; `complete` needs both remaining measures at 0. Publication is unchanged: only a
 * copied main image publishes (`holdsCopiedImage`).
 * Copy provenance is reported separately (review-1 CIM-F2): `copied` lists EVERY source this request fetched and
 * stored, committed holders or not, so a source copied here and written from `MEDIAMAP#` by a later request still
 * counts as copied in this session. A refused/failed source with no committed holder is not reported (its deferred
 * holders keep their producer URL; a later request decides them).
 *
 * Time budget (API Gateway answers 503 after 30 s; the clock starts at handler entry):
 *   - no new copy starts after COPY_START_BUDGET_MS = 12 s; a started copy's fetch ends by its own deadline
 *     (SOURCE_DEADLINE_MS = 8 s, all hops + body, lib/image-upload.ts) → fetches end by 20 s;
 *   - no product update starts after UPDATE_START_BUDGET_MS = 24 s, except the first of the request (progress).
 *   Every THIRD-PARTY wait is bounded by these two timers. AWS calls (DynamoDB, S3, EventBridge) rely on their
 *   normal latency, as every amodx route does (operator ruling, slice § 9). An overrun shows in admin as a stopped
 *   batch; copying again is safe, and overlapping requests converge (docs/slices/cat-images-1.md § 8.3).
 */

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const COPY_START_BUDGET_MS = 12_000;
export const UPDATE_START_BUDGET_MS = 24_000;
/** Copies in flight at once (one producer host per sheet; ALPOD's 793 sources at ~0.2 s ≈ 4 requests). */
export const COPY_CONCURRENCY = 4;
/** CIG-R1: a product's write is tried at most this many times (first write + re-plans after a cancelled one). */
export const WRITE_ATTEMPTS = 3;
/** The `uploadedBy` of the `ASSET#` items this route writes. */
const UPLOADED_BY = "glam-pricelist-images";

const json = (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) });

const isConditionFailure = (e: unknown) => e instanceof Error && e.name === "ConditionalCheckFailedException";

/** A stored product as the images route reads it. */
interface StoredProduct {
    id: string;
    slug: string;
    title?: string;
    status?: string;
    imageLink?: string;
    importSource?: string;
    categoryIds?: string[];
    variants?: { options?: IngestOption[]; [key: string]: unknown }[];
}

const _handler: Handler = async (event) => {
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;

    const tenantId = event.headers["x-tenant-id"];
    if (!tenantId) return json(400, { error: "Missing x-tenant-id header" });
    // The same admission as the import: bound to the header's tenant; a service key needs `catalog:write`.
    const auth = event.requestContext.authorizer.lambda;
    try {
        requireRole(auth, ["TENANT_ADMIN", "EDITOR"], tenantId, "catalog:write");
    } catch (e: unknown) {
        return json(403, { error: e instanceof Error ? e.message : "Forbidden" });
    }

    let body: unknown;
    try {
        body = JSON.parse(event.body || "{}");
    } catch {
        return json(400, { error: "The request body is not valid JSON." });
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return json(400, { error: "The request body must be a JSON object." });
    }
    // Only producer and sheet: the server reads the set itself, never product ids or URLs from the request.
    const fields = body as Record<string, unknown>;
    const upload = checkUpload({ producer: fields.producer, sheet: fields.sheet });
    if (upload.kind === "refused") return json(400, { error: upload.error });
    const { producer, sheet, importSource } = upload.upload;

    const bucket = process.env.UPLOADS_BUCKET;
    const cdnUrl = process.env.UPLOADS_CDN_URL;
    if (!bucket || !cdnUrl) return json(500, { error: "The media bucket is not configured for this function." });

    let step = "tenant-read";
    try {
        const mode = await readTenantMode(tenantId);
        if (!mode) return json(404, { error: "Site not found" });
        if (!mode.catalogMode) {
            return json(403, { error: "Copying pricelist images is available only on catalog sites (sites that show products without prices)." });
        }

        step = "products-read";
        const stored = (await readTenantProducts(tenantId)).filter((p) => p.importSource === importSource);
        const set: IngestProduct[] = stored.map((p) => ({ id: p.id, slug: p.slug, options: p.variants?.[0]?.options ?? [] }));

        step = "media-map-read";
        const mediaMap = await loadMediaMap(tenantId);

        step = "copy";
        const sources = collectSources(set, cdnUrl);
        const results = await resolveSources(
            sources,
            mediaMap,
            async (url) => {
                const result = await copyImageToTenantMedia(tenantId, url, bucket, cdnUrl, UPLOADED_BY);
                if (result.kind === "copied") await writeMediaMapEntry(tenantId, url, result.cdnUrl);
                return result;
            },
            () => elapsed() < COPY_START_BUDGET_MS,
            COPY_CONCURRENCY,
        );

        step = "update";
        /** Products this request wrote (committed). */
        const written = new Set<string>();
        /** The latest stored state this request knows per product: its committed write's item, or a re-read. */
        const latest = new Map<string, StoredProduct>();
        /** Per written product, its options before (the state the committed write was planned from) and after it. */
        const commits = new Map<string, { before: readonly IngestOption[]; after: readonly IngestOption[] }>();
        const replaced: { productId: string; slug: string }[] = [];
        const published: { productId: string; slug: string }[] = [];
        let attempted = 0;
        for (let i = 0; i < set.length; i++) {
            const product = stored[i];
            const read = set[i].options;
            let state: StoredProduct = product;
            let plan = planProductWrite(stateOf(state), read, results, deriveGallery, cdnUrl);
            if (plan.kind === "none") continue;
            if (attempted > 0 && elapsed() >= UPDATE_START_BUDGET_MS) break;
            attempted++;
            for (let attempt = 1; plan.kind === "write" && attempt <= WRITE_ATTEMPTS; attempt++) {
                const newItem = await writeProduct(tenantId, state, plan);
                if (newItem !== null) {
                    written.add(product.id);
                    latest.set(product.id, newItem as StoredProduct);
                    commits.set(product.id, { before: optionsOf(state), after: optionsOf(newItem as StoredProduct) });
                    if (plan.publish) published.push({ productId: product.id, slug: product.slug });
                    await deleteCatProductItems(tenantId, product.id, state.categoryIds ?? []);
                    await writeCatProductItems(tenantId, cardOf(newItem));
                    break;
                }
                // Cancelled: the product is gone (replaced by an import), or its status changed since `state` was read.
                const fresh = await readProduct(tenantId, product.id);
                if (fresh === null || fresh.importSource !== importSource) {
                    replaced.push({ productId: product.id, slug: product.slug });
                    break;
                }
                state = fresh;
                latest.set(product.id, fresh);
                // CAT-IMPORT-GALLERY-1 (R-CIG-REBASE): the copies other requests stored for the read's extras, read
                // after `fresh`, so the rebase can match them to their holdings (one stored image per holding in read
                // order when every stored copy is identified; residual otherwise — glam/images.ts `rewriteExtras`).
                plan = planProductWrite(stateOf(fresh), read, results, deriveGallery, cdnUrl, await storedCopies(tenantId, read, cdnUrl));
            }
        }

        const live = set.filter((p) => !replaced.some((r) => r.productId === p.id));
        const remaining = remainingWork(live, new Map([...latest].map(([id, p]) => [id, optionsOf(p)])), cdnUrl);
        const hidden = stored
            .filter((p) => !replaced.some((r) => r.productId === p.id))
            .filter((p) => {
                const now = latest.get(p.id) ?? p;
                return hiddenWithoutImage(now.status, optionsOf(now), now.imageLink, cdnUrl);
            })
            .map((p) => ({ productId: p.id, slug: p.slug, title: p.title ?? "" }));
        // Only committed holdings: a holding is reported when this request's committed write changed that holding.
        const sourceResults = sources
            .filter((s) => results.has(s.url))
            .map((s) => ({ ...results.get(s.url)!, holders: s.holders.filter((h) => committedHolding(commits.get(h.productId), h, s.url, results.get(s.url)!)) }))
            .filter((s) => s.holders.length > 0);
        const counts = { ...countKinds(sourceResults), extras: countKinds(sourceResults.filter((s) => s.holders.some((h) => h.extra === true))) };
        // Provenance, independent of commits: the sources this request copied (fetched + stored + MEDIAMAP# written).
        const copied = [...results.values()].flatMap((r) => (r.kind === "ingested" ? [{ url: r.url, cdnUrl: r.cdnUrl }] : []));

        if (written.size > 0) {
            step = "audit";
            await publishAudit({
                tenantId,
                actor: { id: auth.sub, email: auth.email },
                action: "GLAM_PRICELIST_IMAGES",
                target: { title: `Imagini ${producer} / ${sheet}`, id: importSource },
                details: {
                    ...counts, productsUpdated: written.size, productsReplaced: replaced.length, productsPublished: published.length,
                    remainingOptions: remaining.options, remainingExtras: remaining.extras, remainingSources: remaining.sources,
                },
                ip: event.requestContext.http.sourceIp,
            });
        }

        return json(200, {
            producer,
            sheet,
            importSource,
            sources: sourceResults,
            copied,
            counts,
            products: { updated: written.size, replaced, published },
            hiddenWithoutImage: hidden,
            progress: {
                sourcesAtStart: sources.length,
                resolved: results.size,
                remainingOptions: remaining.options,
                remainingExtras: remaining.extras,
                remainingSources: remaining.sources,
            },
            complete: remaining.options === 0 && remaining.extras === 0,
        });
    } catch (e: unknown) {
        console.error(`[glam-images] failed at step ${step}:`, e);
        return json(500, {
            error: e instanceof Error ? e.message : "Image copy failed",
            failedStep: step,
            recovery: "Copy the images again: images already copied are not fetched again.",
        });
    }
};

export const imagesHandler = withInvalidation(_handler, purgeStoredPagesOfRequestTenant);

/** The attributes the images route reads of a product (the set query and the re-read of CIG-R1). */
const PRODUCT_PROJECTION = "id, slug, title, #status, imageLink, categoryIds, importSource, variants";

const optionsOf = (p: StoredProduct): readonly IngestOption[] => p.variants?.[0]?.options ?? [];
const stateOf = (p: StoredProduct) => ({ options: optionsOf(p), imageLink: p.imageLink, status: p.status });

/**
 * Whether this request's committed write of the holder's product changed that holding (the report rule above); options
 * matched by value. A main holding: the option's `imageLink` differs before/after (CAT-IMAGES-1, unchanged). An extra
 * holding of `url`: copied → its CDN URL is among the option's extras after the write and was not before; refused or
 * failed → `url` was among them before and is not after. No committed write → false.
 */
function committedHolding(
    commit: { before: readonly IngestOption[]; after: readonly IngestOption[] } | undefined,
    holder: SourceHolder,
    url: string,
    result: SourceResult,
): boolean {
    if (commit === undefined) return false;
    const before = commit.before.find((o) => o.value === holder.option);
    const after = commit.after.find((o) => o.value === holder.option);
    if (holder.extra !== true) return before?.imageLink !== after?.imageLink;
    const was = before?.additionalImageLinks ?? [];
    const is = after?.additionalImageLinks ?? [];
    switch (result.kind) {
        case "ingested":
        case "cached":
            return !was.includes(result.cdnUrl) && is.includes(result.cdnUrl);
        case "refused":
        case "failed":
            return was.includes(url) && !is.includes(url);
        default: {
            const unhandled: never = result;
            throw new Error(`Unhandled source result ${JSON.stringify(unhandled)}`);
        }
    }
}

/**
 * CAT-IMPORT-GALLERY-1 (R-CIG-REBASE) — the `MEDIAMAP#` CDN URL of every producer extra of `read`, each read strongly
 * consistent: the identity by which the rebase (`rewriteExtras`, ./glam/images.ts) matches a copy another request
 * stored to its holding (each copy is recorded in `MEDIAMAP#` before its product write). Only on a re-plan after a
 * cancelled write. The key is lib/media-map.ts's rule (`MEDIAMAP#<md5(url)>`; its `hashUrl` is not exported).
 */
async function storedCopies(tenantId: string, read: readonly IngestOption[], cdnUrl: string): Promise<Map<string, string>> {
    const stored = new Map<string, string>();
    for (const url of new Set(read.flatMap((o) => o.additionalImageLinks ?? []))) {
        if (!isProducerUrl(url, cdnUrl)) continue;
        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `MEDIAMAP#${createHash("md5").update(url).digest("hex")}` },
            ConsistentRead: true,
            ProjectionExpression: "newUrl",
        }));
        if (typeof result.Item?.newUrl === "string") stored.set(url, result.Item.newUrl);
    }
    return stored;
}

/** One product, strongly consistent; `null` when it no longer exists. */
async function readProduct(tenantId: string, id: string): Promise<StoredProduct | null> {
    const result = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${id}` },
        ConsistentRead: true,
        ProjectionExpression: PRODUCT_PROJECTION,
        ExpressionAttributeNames: { "#status": "status" },
    }));
    return (result.Item as StoredProduct | undefined) ?? null;
}

/**
 * Every product of the tenant: `PRODUCT#` query, strongly consistent, every page; the set is selected in code by
 * `importSource`, as the import selects its previous set (glam-pricelist.ts `readTenantProducts`).
 */
async function readTenantProducts(tenantId: string): Promise<StoredProduct[]> {
    const products: StoredProduct[] = [];
    let startKey: Record<string, any> | undefined;
    do {
        const page: QueryCommandOutput = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "PRODUCT#" },
            ProjectionExpression: PRODUCT_PROJECTION,
            ExpressionAttributeNames: { "#status": "status" },
            ConsistentRead: true,
            ExclusiveStartKey: startKey,
        }));
        for (const item of page.Items ?? []) products.push(item as StoredProduct);
        startKey = page.LastEvaluatedKey;
    } while (startKey);
    return products;
}

/**
 * One product's write, as `plan` says: the options of its variant group and the two derived fields (`imageLink`
 * REMOVED when the product has no image left, CM-D7), and/or `status = active` (CAT-IMAGE-GATE-1 — one write, never a
 * second one). Condition (CIG-R1): the product exists (`attribute_exists(PK)`: never re-created — an unconditional
 * update upserts) AND its `status` is still the one `state` was read with. Returns the stored item, or `null` when the
 * condition cancelled the write (nothing written, nothing published; the caller re-reads to tell why).
 */
async function writeProduct(
    tenantId: string,
    state: StoredProduct,
    plan: Extract<ProductWrite, { kind: "write" }>,
): Promise<Record<string, any> | null> {
    // DynamoDB refuses an unused name or value: each is added only with the clause that uses it.
    const names: Record<string, string> = { "#updatedAt": "updatedAt", "#status": "status", "#variants": "variants" };
    const values: Record<string, unknown> = { ":now": new Date().toISOString() };
    const set = ["#updatedAt = :now"];
    let remove = "";
    const images = plan.images;
    if (images !== null) {
        names["#additional"] = "additionalImageLinks";
        names["#imageLink"] = "imageLink";
        values[":variants"] = [{ ...(state.variants?.[0] ?? {}), options: images.options }, ...(state.variants ?? []).slice(1)];
        values[":additional"] = images.additionalImageLinks;
        set.unshift("#variants = :variants", "#additional = :additional");
        if (images.imageLink !== undefined) {
            values[":imageLink"] = images.imageLink;
            set.push("#imageLink = :imageLink");
        } else {
            remove = " REMOVE #imageLink";
        }
    }
    if (plan.publish) {
        values[":active"] = "active";
        set.push("#status = :active");
    }
    let condition = "attribute_exists(PK) AND attribute_not_exists(#status)";
    if (state.status !== undefined) {
        values[":read"] = state.status;
        condition = "attribute_exists(PK) AND #status = :read";
    }
    // CIG-STALE-WRITE (CAT-IMPORT-GALLERY-1, docs/slices/cat-images-1.md § 11): the write replaces `variants`, so it also
    // requires the `variants` value it was planned from (DynamoDB compares the whole list value).
    if (state.variants !== undefined) {
        values[":readVariants"] = state.variants;
        condition += " AND #variants = :readVariants";
    } else {
        condition += " AND attribute_not_exists(#variants)";
    }
    try {
        const result = await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${state.id}` },
            UpdateExpression: `SET ${set.join(", ")}${remove}`,
            ConditionExpression: condition,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ReturnValues: "ALL_NEW",
        }));
        return result.Attributes ?? null;
    } catch (e) {
        if (isConditionFailure(e)) return null;
        throw e;
    }
}

/** The card fields `buildCatProdItem` projects, from the stored item (the same mapping as glam-pricelist.ts `cardOf`). */
function cardOf(item: Record<string, any>): Parameters<typeof writeCatProductItems>[1] {
    return {
        id: item.id, title: item.title, slug: item.slug, sku: item.sku, price: item.price, currency: item.currency,
        salePrice: item.salePrice, imageLink: item.imageLink, availability: item.availability, status: item.status,
        sortOrder: item.sortOrder || 0, tags: item.tags || [], volumePricing: item.volumePricing || [],
        categoryIds: item.categoryIds || [], availableFrom: item.availableFrom, availableUntil: item.availableUntil,
    };
}

function countKinds(results: readonly SourceResult[]) {
    const counts = { ingested: 0, cached: 0, refused: 0, failed: 0 };
    for (const r of results) counts[r.kind]++;
    return counts;
}
