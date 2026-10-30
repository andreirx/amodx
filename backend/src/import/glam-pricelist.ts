import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { randomUUID } from "crypto";
import {
    BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand,
    type BatchGetCommandOutput, type QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "../lib/db.js";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import {
    writeCatProductItems, deleteCatProductItems, listCatProductIds, writeCategoryProjections,
} from "../lib/catprod.js";
import { readTenantMode, checkProductWrite } from "../lib/catalog-product.js";
import { publishAudit } from "../lib/events.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { parseGlamCsv } from "./glam/parse.js";
import { checkUpload, planGlamImport, type GlamImportPlan, type GlamStyleDraft, type GlamUpload } from "./glam/map.js";
import { imagesHandler } from "./glam-images.js";

/**
 * CAT-IMPORT-1 — `POST /import/glam-pricelist[?dryRun=1]`: one glam enriched pricelist CSV → one storefront product
 * per style, REPLACING the sheet's previous product set, for one catalog tenant.
 * Spec: docs/slices/catalog-mode-1.md § 3.4; slice docs/slices/cat-import-1.md § 2 and § 9 (amendment CI1-A2).
 *
 * Body (a JSON object): `{ csvContent, producer, sheet, variantName? }`. Order of execution:
 *   role + tenant binding → body, upload fields, CSV (400) → tenant read, ConsistentRead (404 / 403)
 *   → no style in the file (400, execution only)
 *   → dry run: category lookup + previous set (reads), report incl. `categoryConflicts`, nothing written (not even
 *   the CDN marker)
 *   → lock (409) → category lookup, an occupied category key (409) → previous set (consistent query) → delete it →
 *   create absent categories → create products → reconcile touched categories (503 `incompleteCategories` when the retry bound is
 *   exhausted) → 200 report. Any failure → 500 naming the step; the lock is released in `finally` only if acquired.
 * The pure core (`./glam/`) decides what to write; this file only reads and writes. The same function also serves
 * `POST /import/glam-pricelist/images` (CAT-IMAGES-1, `./glam-images.ts`): `handler` dispatches on `routeKey`.
 */

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/** The lock lives as long as the import function may run (its timeout is ≤ this, infra/lib/api-catalog.ts). */
export const LOCK_DURATION_MS = 15 * 60 * 1000;
const LOCK_SK = "IMPORTLOCK#glam";

/** The retry bound of the reconciliation's BatchGet: at most 5 resends, full-jitter waits from 100 ms doubling. */
const MAX_RESENDS = 5;
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, Math.random() * 100 * 2 ** attempt));

/** The product attributes the previous-set query reads (spec § 3.4 "Finding the previous set"). */
interface StoredProductRef {
    id: string;
    title?: string;
    categoryIds?: string[];
    importSource?: string;
}

interface IncompleteCategory {
    categoryId: string;
    unreadProducts: number;
    unwrittenProjections: number;
}

const json = (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) });
const isDryRun = (event: Parameters<Handler>[0]) => event.queryStringParameters?.dryRun === "1";

const _handler: Handler = async (event) => {
    const tenantId = event.headers["x-tenant-id"];
    if (!tenantId) return json(400, { error: "Missing x-tenant-id header" });

    // IMPORT-POLICY-1 D1 rule: the caller is bound to the header's tenant (GLOBAL_ADMIN passes); a service key passes
    // only with `catalog:write` for its own tenant (SERVICE_ROUTE_SCOPES, backend/src/auth/policy.ts).
    const auth = event.requestContext.authorizer.lambda;
    try {
        requireRole(auth, ["TENANT_ADMIN", "EDITOR"], tenantId, "catalog:write");
    } catch (e: unknown) {
        return json(403, { error: e instanceof Error ? e.message : "Forbidden" });
    }

    let parsedBody: unknown;
    try {
        parsedBody = JSON.parse(event.body || "{}");
    } catch {
        return json(400, { error: "The request body is not valid JSON." });
    }
    if (parsedBody === null || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
        return json(400, { error: "The request body must be a JSON object." });
    }
    const body = parsedBody as Record<string, unknown>;
    if (typeof body.csvContent !== "string" || body.csvContent === "") {
        return json(400, { error: "csvContent is required." });
    }
    const upload = checkUpload(body);
    if (upload.kind === "refused") return json(400, { error: upload.error });
    const parsed = parseGlamCsv(body.csvContent);
    if (parsed.kind === "refused") return json(400, { error: parsed.error });
    const plan = planGlamImport(parsed.rows, upload.upload);

    // Every asynchronous step below runs under `step`, so a failure answers 500 naming it. The lock is released in
    // `finally` only when this job acquired it (`lockOwner`); a step before that holds no lock.
    let step = "tenant-read";
    let lockOwner: string | null = null;
    // The mutation-phase boundary: set just BEFORE the first command that can change a product or category (the delete
    // loop, even when the previous set is empty). Before it, a failure has certainly changed no product or category;
    // after it, data MAY have changed (a failed write's outcome can be unknown), so the recovery is the full re-import.
    let mutationPhaseEntered = false;
    try {
        // Start-of-job tenant checks, strongly consistent, BEFORE the lock (CM-D11): a refused import writes nothing.
        const mode = await readTenantMode(tenantId);
        if (!mode) return json(404, { error: "Site not found" });
        if (!mode.catalogMode) {
            return json(403, { error: "The pricelist import is available only on catalog sites (sites that show products without prices)." });
        }

        // Nothing in the file to import: refused, so a wrong file cannot delete a sheet and create nothing (B-2, § 9).
        if (!isDryRun(event) && plan.counts.products === 0) {
            return json(400, {
                error: "The file has no product rows to import; nothing was changed. Run a dry run to see why each row was skipped.",
                ...report(plan, false, [], 0, new Map(), []),
            });
        }

        // Dry run: no lock, reads only — the category lookup, then the previous set.
        if (isDryRun(event)) {
            step = "categories-lookup";
            const categories = await lookupCategories(tenantId, plan);
            step = "previous-set";
            const products = await readTenantProducts(tenantId);
            const previous = products.filter((p) => p.importSource === plan.upload.importSource);
            return json(200, report(plan, true, previous, categories.toCreate.length, new Map(), categories.conflicts));
        }

        step = "lock";
        const owner = randomUUID();
        if (!(await acquireLock(tenantId, owner))) {
            return json(409, { error: "An import is running on this site. Try again when it has finished." });
        }
        lockOwner = owner;

        // Rule (review-1 R1): every read that decides an execution write is made while this job holds the lock — a
        // decision read before the lock may describe a store another import has changed since. Only the tenant
        // mode is read before the lock (spec § 3.4 / CM-D11: a refused import writes nothing, not even a lock).
        // Category lookup: an occupied `CATEGORY#<slug>` refuses (409) before any deletion (§ 9).
        step = "categories-lookup";
        const categories = await lookupCategories(tenantId, plan);
        if (categories.conflicts.length > 0) {
            return json(409, {
                error: `A category key this import needs is held by a category that was renamed: ${categories.conflicts.map((c) => `"${c.slug}" (now "${c.storedSlug}")`).join(", ")}. Nothing was changed. Rename it back or give the producer/collection another name.`,
                categoryConflicts: categories.conflicts,
            });
        }

        // (3) the previous set: the tenant's products, read completely and strongly consistently; selected in code.
        step = "previous-set";
        const products = await readTenantProducts(tenantId);
        const previous = products.filter((p) => p.importSource === plan.upload.importSource);

        step = "delete";
        mutationPhaseEntered = true;
        const deletedIds = new Set<string>();
        for (const product of previous) {
            await db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${product.id}` } }));
            await deleteCatProductItems(tenantId, product.id, product.categoryIds ?? []);
            deletedIds.add(product.id);
        }

        step = "categories";
        await createCategories(tenantId, categories);

        // (4) the new set, each product with its CATPROD# items.
        step = "create";
        const now = new Date().toISOString();
        const createdIds = new Map<string, string>(); // slug → productId
        const created: { id: string; categoryIds: string[] }[] = [];
        for (const { draft } of plan.styles) {
            const id = randomUUID();
            const categoryIds = draft.categoryKeys.map((slug) => categories.idBySlug.get(slug)!);
            const item = productItem(tenantId, id, draft, categoryIds, now);
            await db.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
            await writeCatProductItems(tenantId, cardOf(item));
            createdIds.set(draft.slug, id);
            created.push({ id, categoryIds });
        }

        // (5) the end-of-import reconciliation of every touched category.
        step = "reconcile";
        const touched = new Set<string>();
        for (const p of previous) for (const c of p.categoryIds ?? []) touched.add(c);
        for (const p of created) for (const c of p.categoryIds) touched.add(c);
        const incomplete: IncompleteCategory[] = [];
        for (const categoryId of touched) {
            const result = await reconcileCategory(tenantId, categoryId, products, deletedIds, created);
            if (result) incomplete.push(result);
        }

        step = "audit";
        const result = report(plan, false, previous, categories.toCreate.length, createdIds, []);
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "GLAM_PRICELIST_IMPORT",
            target: { title: `Listă de prețuri ${plan.upload.producer} / ${plan.upload.sheet}`, id: plan.upload.importSource },
            details: { ...result.counts, categoriesCreated: categories.toCreate.length, incompleteCategories: incomplete.length },
            ip: event.requestContext.http.sourceIp,
        });
        if (incomplete.length > 0) {
            return json(503, {
                error: `The products were written, but the product lists of ${incomplete.length} categor${incomplete.length === 1 ? "y are" : "ies are"} not complete. Import the same file again.`,
                ...result,
                incompleteCategories: incomplete,
            });
        }
        return json(200, result);
    } catch (e: unknown) {
        console.error(`[glam-pricelist] import failed at step ${step}:`, e);
        return json(500, {
            error: e instanceof Error ? e.message : "Import failed",
            failedStep: step,
            recovery: mutationPhaseEntered
                ? "Import the same file again: it replaces the sheet's products in full."
                : "No product or category was changed. Try again.",
        });
    } finally {
        if (lockOwner) await releaseLock(tenantId, lockOwner);
    }
};

// Dry runs write nothing — not even the CDN marker that `withInvalidation` writes after a 2xx answer.
const invalidating = withInvalidation(_handler);

/** The routes this function serves (infra/lib/api.ts): the import, and the image copy of CAT-IMAGES-1 (glam-images.ts). */
const IMPORT_ROUTE = "POST /import/glam-pricelist";
const IMAGES_ROUTE = "POST /import/glam-pricelist/images";
type GlamRoute = typeof IMPORT_ROUTE | typeof IMAGES_ROUTE;
const isGlamRoute = (routeKey: string): routeKey is GlamRoute => routeKey === IMPORT_ROUTE || routeKey === IMAGES_ROUTE;

export const handler: Handler = (event, context, callback) => {
    const route = event.routeKey;
    if (!isGlamRoute(route)) return Promise.resolve(json(404, { error: `This function does not serve ${route}.` }));
    switch (route) {
        case IMPORT_ROUTE:
            return isDryRun(event) ? _handler(event, context, callback) : invalidating(event, context, callback);
        case IMAGES_ROUTE:
            return imagesHandler(event, context, callback);
        default: {
            // Exhaustiveness: a new GlamRoute member makes `route` not `never` here → compile error.
            const unhandled: never = route;
            throw new Error(`Unhandled route ${String(unhandled)}`);
        }
    }
};

// ── The lock (spec § 3.4 "Lock"; conditional-write pattern of backend/src/lib/service-keys.ts) ─────────────────────

const lockKey = (tenantId: string) => ({ PK: `TENANT#${tenantId}`, SK: LOCK_SK });

const isConditionFailure = (e: unknown) => e instanceof Error && e.name === "ConditionalCheckFailedException";

/**
 * Take the per-tenant import lock. `true` = this job owns it. A free lock is taken with `attribute_not_exists(SK)`; a
 * lock past its `expiresAt` is taken over with a condition on the observed `expiresAt`, so two jobs cannot both take
 * it over. A contender that cannot take it gets `false` and has written nothing.
 */
export async function acquireLock(tenantId: string, owner: string): Promise<boolean> {
    const now = Date.now();
    const item = { ...lockKey(tenantId), Type: "ImportLock", owner, expiresAt: now + LOCK_DURATION_MS, createdAt: new Date(now).toISOString() };
    try {
        await db.send(new PutCommand({ TableName: TABLE_NAME, Item: item, ConditionExpression: "attribute_not_exists(SK)" }));
        return true;
    } catch (e) {
        if (!isConditionFailure(e)) throw e;
    }
    const held = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: lockKey(tenantId), ConsistentRead: true }));
    const observed = held.Item?.expiresAt;
    if (typeof observed !== "number" || observed > now) return false;
    try {
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: item,
            ConditionExpression: "expiresAt = :observed",
            ExpressionAttributeValues: { ":observed": observed },
        }));
        return true;
    } catch (e) {
        if (isConditionFailure(e)) return false;
        throw e;
    }
}

/** Release the lock only if this job still owns it (`owner = :me`); a successor's lock is never deleted. */
export async function releaseLock(tenantId: string, owner: string): Promise<void> {
    try {
        await db.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: lockKey(tenantId),
            ConditionExpression: "#owner = :me",
            ExpressionAttributeNames: { "#owner": "owner" },
            ExpressionAttributeValues: { ":me": owner },
        }));
    } catch (e) {
        // Taken over after expiry: the lock is the successor's. Any other failure leaves the lock to expire.
        if (!isConditionFailure(e)) console.error("[glam-pricelist] lock release failed; it expires by itself:", e);
    }
}

// ── Reads and writes ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every product of the tenant: `PRODUCT#` query, strongly consistent, following `LastEvaluatedKey`; no
 * `FilterExpression` — the previous set is selected in code, and the same pages give every product's `categoryIds`
 * for the reconciliation (spec § 3.4, cycle 13).
 */
async function readTenantProducts(tenantId: string): Promise<StoredProductRef[]> {
    const products: StoredProductRef[] = [];
    let startKey: Record<string, any> | undefined;
    do {
        const page: QueryCommandOutput = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "PRODUCT#" },
            ProjectionExpression: "id, title, categoryIds, importSource",
            ConsistentRead: true,
            ExclusiveStartKey: startKey,
        }));
        for (const item of page.Items ?? []) products.push(item as StoredProductRef);
        startKey = page.LastEvaluatedKey;
    } while (startKey);
    return products;
}

/** What `CATEGORY#<slug>` / the slug index say about one slug the import needs. */
type CategoryLookup =
    | { kind: "found"; id: string }
    | { kind: "absent" }
    /** `CATEGORY#<slug>` exists but its stored `slug` is another one (an admin renamed it, categories/update.ts). */
    | { kind: "occupied"; storedSlug: string };

/**
 * Match one slug against the tenant's categories. Two stores of a category exist: importer-created categories are
 * `CATEGORY#<slug>` (read first, strongly consistent); admin-created ones are `CATEGORY#<uuid>`
 * (`categories/create.ts`) and are found on `GSI_Slug` (`TenantSlug = <tenantId>#<slug>`, rewritten on a rename,
 * `categories/update.ts:46-48`), every page followed, keeping only a `CATEGORY#` item whose stored `slug` equals the
 * requested one — a product may share the index key. A direct hit is a match only when its stored `slug` is the
 * requested one; otherwise the key is occupied (the import is refused: creating there would overwrite it).
 */
async function lookupCategory(tenantId: string, slug: string): Promise<CategoryLookup> {
    const direct = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `TENANT#${tenantId}`, SK: `CATEGORY#${slug}` },
        ConsistentRead: true,
        ProjectionExpression: "id, slug",
    }));
    if (direct.Item) {
        return direct.Item.slug === slug
            ? { kind: "found", id: direct.Item.id || slug }
            : { kind: "occupied", storedSlug: String(direct.Item.slug ?? "") };
    }
    let startKey: Record<string, any> | undefined;
    do {
        const page: QueryCommandOutput = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: "GSI_Slug",
            KeyConditionExpression: "TenantSlug = :ts",
            ExpressionAttributeValues: { ":ts": `${tenantId}#${slug}` },
            ProjectionExpression: "SK, id, slug",
            ExclusiveStartKey: startKey,
        }));
        const category = (page.Items ?? []).find((item) => String(item.SK ?? "").startsWith("CATEGORY#") && item.slug === slug);
        if (category) return { kind: "found", id: category.id };
        startKey = page.LastEvaluatedKey;
    } while (startKey);
    return { kind: "absent" };
}

interface CategoryResolution {
    /** Every slug of the plan → the category id it will use (found, or the slug for a category to create). */
    idBySlug: Map<string, string>;
    /** Absent categories, created after the deletes as `CATEGORY#<slug>` items. */
    toCreate: { slug: string; name: string; parentId: string | null }[];
    /** Occupied keys: the import is refused (409) before any deletion; a dry run reports them. */
    conflicts: { slug: string; storedSlug: string }[];
}

function assertNever(value: never): never {
    throw new Error(`Unhandled category lookup: ${JSON.stringify(value)}`);
}

/** Look up the producer's parent category and one child per collection. Reads only. */
async function lookupCategories(tenantId: string, plan: GlamImportPlan): Promise<CategoryResolution> {
    const resolution: CategoryResolution = { idBySlug: new Map(), toCreate: [], conflicts: [] };
    for (const category of plan.categories) {
        const found = await lookupCategory(tenantId, category.slug);
        switch (found.kind) {
            case "found":
                resolution.idBySlug.set(category.slug, found.id);
                break;
            case "occupied":
                resolution.conflicts.push({ slug: category.slug, storedSlug: found.storedSlug });
                break;
            case "absent": {
                resolution.idBySlug.set(category.slug, category.slug);
                // plan.categories lists a parent before its children, so the parent's id is known here.
                const parentId = category.parentSlug === null ? null : resolution.idBySlug.get(category.parentSlug) ?? category.parentSlug;
                resolution.toCreate.push({ slug: category.slug, name: category.name, parentId });
                break;
            }
            default:
                // Exhaustiveness: a new CategoryLookup variant makes `found` not `never` here → compile error.
                return assertNever(found);
        }
    }
    return resolution;
}

/**
 * Create the absent categories as `CATEGORY#<slug>` items — as `import/woocommerce.ts` writes categories — and never
 * delete one. `attribute_not_exists(SK)`: a key that became occupied since the lookup is never overwritten; the
 * import then fails at step `categories` and the recovery is to import again.
 */
async function createCategories(tenantId: string, resolution: CategoryResolution): Promise<void> {
    for (const category of resolution.toCreate) {
        const now = new Date().toISOString();
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `CATEGORY#${category.slug}`,
                TenantSlug: `${tenantId}#${category.slug}`,
                Type: "Category",
                id: category.slug,
                tenantId,
                name: category.name,
                slug: category.slug,
                parentId: category.parentId,
                sortOrder: 0,
                status: "active",
                productCount: 0,
                createdAt: now,
                updatedAt: now,
            },
            ConditionExpression: "attribute_not_exists(SK)",
        }));
    }
}

/**
 * The stored product of one draft. No monetary key at all (no `price`, `salePrice`, `volumePricing`,
 * `personalizations`, option `priceOverride`) and no `sku`; then the catalog write boundary of every product writer
 * (`checkProductWrite`) is applied, which re-derives `imageLink` / `additionalImageLinks` from the options. A refusal
 * here means the pure core broke an invariant — not an expected failure — so it throws.
 */
function productItem(tenantId: string, id: string, draft: GlamStyleDraft, categoryIds: string[], now: string) {
    const product: Record<string, any> = {
        PK: `TENANT#${tenantId}`,
        SK: `PRODUCT#${id}`,
        TenantSlug: `${tenantId}#${draft.slug}`,
        Type: "Product",
        id,
        tenantId,
        status: "active",
        title: draft.title,
        slug: draft.slug,
        description: draft.description,
        ...(draft.longDescription !== undefined ? { longDescription: draft.longDescription } : {}),
        availability: "in_stock",
        brand: draft.brand,
        categoryIds,
        condition: "new",
        tags: [],
        attributes: draft.attributes.map((a) => ({ key: a.key, value: a.value })),
        variants: [{
            id: randomUUID(),
            name: draft.variants[0].name,
            options: draft.variants[0].options.map((o) => (o.imageLink !== undefined ? { value: o.value, imageLink: o.imageLink } : { value: o.value })),
        }],
        nutritionalValues: [],
        ...(draft.imageLink !== undefined ? { imageLink: draft.imageLink } : {}),
        additionalImageLinks: [...draft.additionalImageLinks],
        productType: "physical",
        sortOrder: 0,
        importSource: draft.importSource,
        createdAt: now,
        updatedAt: now,
    };
    const check = checkProductWrite(product, true);
    if (check.kind === "refused") throw new Error(`Internal: an imported product broke the write rule: ${check.error}`);
    return check.item;
}

/** The card fields `buildCatProdItem` projects, from a stored product item. */
function cardOf(item: Record<string, any>): Parameters<typeof writeCatProductItems>[1] {
    return {
        id: item.id, title: item.title, slug: item.slug, sku: item.sku, price: item.price, currency: item.currency,
        salePrice: item.salePrice, imageLink: item.imageLink, availability: item.availability, status: item.status,
        sortOrder: item.sortOrder || 0, tags: item.tags || [], volumePricing: item.volumePricing || [],
        categoryIds: item.categoryIds || [], availableFrom: item.availableFrom, availableUntil: item.availableUntil,
    };
}

/** The card fields of `buildCatProdItem` plus `categoryIds` (the BatchGet projection of the reconciliation). */
const CARD_PROJECTION = "id, title, slug, sku, price, currency, salePrice, imageLink, availability, #s, sortOrder, tags, volumePricing, categoryIds, availableFrom, availableUntil";

/**
 * Spec § 3.4 "End-of-import reconciliation", for one touched category C:
 *  1. candidates = every id with a `CATPROD#<C>#` item (complete, consistent read) ∪ every product of the
 *     previous-set read in C that the import did not delete (any origin) ∪ every created product in C;
 *  2. their `PRODUCT#` items read by consistent `BatchGet` (≤ 100 keys, `UnprocessedKeys` resent under the bound):
 *     a member exists and lists C; every other read candidate is an orphan; an unread candidate is not decided;
 *  3. writes of C only (`writeCategoryProjections`).
 * Returns the incomplete-category entry, or `null` when C is complete.
 */
async function reconcileCategory(
    tenantId: string,
    categoryId: string,
    products: readonly StoredProductRef[],
    deletedIds: ReadonlySet<string>,
    created: readonly { id: string; categoryIds: string[] }[],
): Promise<IncompleteCategory | null> {
    const candidates = new Set<string>(await listCatProductIds(tenantId, categoryId));
    for (const p of products) if (!deletedIds.has(p.id) && (p.categoryIds ?? []).includes(categoryId)) candidates.add(p.id);
    for (const p of created) if (p.categoryIds.includes(categoryId)) candidates.add(p.id);

    const { items, unread } = await batchGetProducts(tenantId, [...candidates]);
    const unreadSet = new Set(unread);
    const members: ReturnType<typeof cardOf>[] = [];
    const orphanIds: string[] = [];
    for (const id of candidates) {
        if (unreadSet.has(id)) continue;
        const item = items.get(id);
        if (item && (item.categoryIds ?? []).includes(categoryId)) members.push(cardOf(item));
        else orphanIds.push(id);
    }
    const { unprocessed } = await writeCategoryProjections(tenantId, categoryId, members, orphanIds);
    if (unread.length === 0 && unprocessed === 0) return null;
    return { categoryId, unreadProducts: unread.length, unwrittenProjections: unprocessed };
}

/** Consistent `BatchGet` of product items, ≤ 100 keys per request, `UnprocessedKeys` resent at most 5 times. */
async function batchGetProducts(tenantId: string, ids: string[]): Promise<{ items: Map<string, Record<string, any>>; unread: string[] }> {
    const items = new Map<string, Record<string, any>>();
    const unread: string[] = [];
    for (let i = 0; i < ids.length; i += 100) {
        let keys: Record<string, any>[] = ids.slice(i, i + 100).map((id) => ({ PK: `TENANT#${tenantId}`, SK: `PRODUCT#${id}` }));
        for (let attempt = 0; ; attempt++) {
            const result: BatchGetCommandOutput = await db.send(new BatchGetCommand({
                RequestItems: {
                    [TABLE_NAME]: { Keys: keys, ConsistentRead: true, ProjectionExpression: CARD_PROJECTION, ExpressionAttributeNames: { "#s": "status" } },
                },
            }));
            for (const item of result.Responses?.[TABLE_NAME] ?? []) items.set(item.id, item);
            keys = result.UnprocessedKeys?.[TABLE_NAME]?.Keys ?? [];
            if (keys.length === 0 || attempt === MAX_RESENDS) break;
            await backoff(attempt);
        }
        for (const key of keys) unread.push(String(key.SK).slice("PRODUCT#".length));
    }
    return { items, unread };
}

// ── The report (spec § 3.4 "Report shape") ────────────────────────────────────────────────────────────────────────

function report(
    plan: GlamImportPlan,
    dryRun: boolean,
    previous: readonly StoredProductRef[],
    categoriesCreated: number,
    productIds: ReadonlyMap<string, string>,
    categoryConflicts: readonly { slug: string; storedSlug: string }[],
) {
    const upload: GlamUpload = plan.upload;
    return {
        dryRun,
        producer: upload.producer,
        sheet: upload.sheet,
        variantName: upload.variantName,
        importSource: upload.importSource,
        totalRows: plan.totalRows,
        counts: { deleted: previous.length, ...plan.counts },
        categoriesCreated,
        previousSet: { count: previous.length, firstTitles: previous.slice(0, 10).map((p) => p.title ?? "") },
        rows: plan.rows,
        products: plan.styles.map(({ draft, options, differing }) => ({
            ...(productIds.has(draft.slug) ? { productId: productIds.get(draft.slug) } : {}),
            slug: draft.slug,
            title: draft.title,
            rowIndexes: draft.rowIndexes,
            options: options.map((o) => ({ value: o.value, ...(o.imageLink !== undefined ? { imageLink: o.imageLink } : {}), rowIndexes: o.rowIndexes })),
            differing,
        })),
        relabelled: plan.relabelled,
        suffixedSlugs: plan.suffixedSlugs,
        categoryConflicts,
    };
}
