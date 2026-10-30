import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { QueryCommand, UpdateCommand, type QueryCommandOutput } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "../lib/db.js";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { writeCatProductItems, deleteCatProductItems } from "../lib/catprod.js";
import { readTenantMode, withDerivedGallery } from "../lib/catalog-product.js";
import { copyImageToTenantMedia } from "../lib/image-upload.js";
import { loadMediaMap, writeMediaMapEntry } from "../lib/media-map.js";
import { publishAudit } from "../lib/events.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { checkUpload } from "./glam/map.js";
import {
    collectSources, resolveSources, rewriteProduct, remainingWork,
    type DeriveGallery, type IngestOption, type IngestProduct, type SourceResult,
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
 * Report rule (review-0 CIM-F2): a source is reported with the holders whose product write COMMITTED in this request,
 * and only then. A resolved source whose products were deferred by the update budget is not reported: it is resolved
 * again by a later request (from `MEDIAMAP#` when it was copied) and reported there with those holders. So each
 * (product, option) holding is reported by each request that rewrites it — normally once; again when an overlapping
 * stale write restored its producer URL (slice § 9) and a later request rewrote it. The admin page keeps the latest
 * outcome per holding (`mergeSources`).
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
/** The `uploadedBy` of the `ASSET#` items this route writes. */
const UPLOADED_BY = "glam-pricelist-images";

const json = (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) });

/** The § 3.4 derivation rule for the core: the one implementation, `withDerivedGallery`, over the options alone. */
const deriveGallery: DeriveGallery = (options) => withDerivedGallery({}, options) as ReturnType<DeriveGallery>;

const isConditionFailure = (e: unknown) => e instanceof Error && e.name === "ConditionalCheckFailedException";

/** A stored product as the images route reads it. */
interface StoredProduct {
    id: string;
    slug: string;
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
        const written = new Map<string, readonly IngestOption[]>();
        const replaced: { productId: string; slug: string }[] = [];
        let attempted = 0;
        for (let i = 0; i < set.length; i++) {
            const rewrite = rewriteProduct(set[i], results, deriveGallery);
            if (rewrite.kind === "unchanged") continue;
            if (attempted > 0 && elapsed() >= UPDATE_START_BUDGET_MS) break;
            attempted++;
            const product = stored[i];
            const newItem = await updateProductImages(tenantId, product, rewrite);
            if (newItem === null) {
                // Replaced by an import since the read: nothing written, no CATPROD# write; its ingest stops here.
                replaced.push({ productId: product.id, slug: product.slug });
                continue;
            }
            written.set(product.id, rewrite.options);
            await deleteCatProductItems(tenantId, product.id, product.categoryIds ?? []);
            await writeCatProductItems(tenantId, cardOf(newItem));
        }

        const live = set.filter((p) => !replaced.some((r) => r.productId === p.id));
        const remaining = remainingWork(live, written, cdnUrl);
        // Only committed holders: a holder's option was rewritten exactly when its product's write committed.
        const sourceResults = sources
            .filter((s) => results.has(s.url))
            .map((s) => ({ ...results.get(s.url)!, holders: s.holders.filter((h) => written.has(h.productId)) }))
            .filter((s) => s.holders.length > 0);
        const counts = countKinds(sourceResults);
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
                    ...counts, productsUpdated: written.size, productsReplaced: replaced.length,
                    remainingOptions: remaining.options, remainingSources: remaining.sources,
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
            products: { updated: written.size, replaced },
            progress: {
                sourcesAtStart: sources.length,
                resolved: results.size,
                remainingOptions: remaining.options,
                remainingSources: remaining.sources,
            },
            complete: remaining.options === 0,
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

export const imagesHandler = withInvalidation(_handler);

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
            ProjectionExpression: "id, slug, categoryIds, importSource, variants",
            ConsistentRead: true,
            ExclusiveStartKey: startKey,
        }));
        for (const item of page.Items ?? []) products.push(item as StoredProduct);
        startKey = page.LastEvaluatedKey;
    } while (startKey);
    return products;
}

/**
 * One product's image write: the options of its variant group and the two derived fields; `imageLink` REMOVED when
 * the product has no image left (CM-D7). `attribute_exists(PK)`: a product deleted since the read is never re-created
 * (an unconditional update upserts). Returns the stored item, or `null` when the condition cancelled the write.
 */
async function updateProductImages(
    tenantId: string,
    product: StoredProduct,
    rewrite: Extract<ReturnType<typeof rewriteProduct>, { kind: "rewritten" }>,
): Promise<Record<string, any> | null> {
    const variants = [{ ...(product.variants?.[0] ?? {}), options: rewrite.options }, ...(product.variants ?? []).slice(1)];
    const values: Record<string, unknown> = {
        ":variants": variants,
        ":additional": rewrite.additionalImageLinks,
        ":now": new Date().toISOString(),
    };
    let expression = "SET #variants = :variants, #additional = :additional, #updatedAt = :now";
    if (rewrite.imageLink !== undefined) {
        values[":imageLink"] = rewrite.imageLink;
        expression += ", #imageLink = :imageLink";
    } else {
        expression += " REMOVE #imageLink";
    }
    try {
        const result = await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${product.id}` },
            UpdateExpression: expression,
            ConditionExpression: "attribute_exists(PK)",
            ExpressionAttributeNames: {
                "#variants": "variants", "#additional": "additionalImageLinks", "#updatedAt": "updatedAt", "#imageLink": "imageLink",
            },
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
