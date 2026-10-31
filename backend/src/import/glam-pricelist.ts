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
import { norm } from "./glam/group.js";
import {
    checkUpload, planGlamImport, type AppliedProfile, type GlamImportPlan, type GlamStyleDraft, type GlamUpload,
} from "./glam/map.js";
import {
    analyseSpecKeys, buildGuard, importStatus, parseProfileChoice, profileReport, profileSortKey, readStoredProfile, resolveProfile,
    DEFAULT_PROFILE, type ProfileChoice, type ProfileReport, type ProfileResolution, type StoredProfile,
} from "./glam/profile.js";
import type { GlamImportProfile } from "@amodx/shared";
import { imagesHandler } from "./glam-images.js";

/**
 * CAT-IMPORT-1 — `POST /import/glam-pricelist[?dryRun=1]`: one glam enriched pricelist CSV → one storefront product
 * per style, REPLACING the sheet's previous product set, for one catalog tenant.
 * Spec: docs/slices/catalog-mode-1.md § 3.4; slice docs/slices/cat-import-1.md § 2 and § 9 (amendment CI1-A2).
 *
 * Body (a JSON object): `{ csvContent, producer, sheet, variantName?, profileChoice? }`. Order of execution:
 *   role + tenant binding → body, upload fields, CSV, `profileChoice` (400) → tenant read, ConsistentRead (404 / 403)
 *   → the producer's stored import profile (CAT-IMPORT-PROFILE-1)
 *   → dry run: category lookup + previous set (reads), report incl. `categoryConflicts`, `profile`, `sheets`,
 *   `specKeys`, `drafts`, `siteProducts`; nothing written (not even the CDN marker)
 *   → execution: profile refusal (409) / no style in the file (400), nothing written
 *   → lock (409) → the stored profile again, deciding (409 / 400) → category lookup, an occupied category key (409)
 *   → previous set (consistent query) → profile item write when a new profile is saved (step `profile`) → delete the
 *   previous set → create absent categories → create products → reconcile touched categories (503
 *   `incompleteCategories` when the retry bound is exhausted) → 200 report. Any failure → 500 naming the step; the
 *   lock is released in `finally` only if acquired.
 * Without a stored profile and without a non-default `profileChoice`, every written item is what the import wrote
 * before CAT-IMPORT-PROFILE-1 (§ 2.8; the 1a golden, backend/test/unit/glam-profile-golden.test.ts) — except `status`:
 * CAT-IMAGE-GATE-1 writes every product `draft` unless the profile says `publishWithoutImages: true` (`importStatus`);
 * the image copy publishes a product when one of its images is copied (glam-images.ts). The dry run and the execution
 * report it in `publication` (`publicationOf`).
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
    /** CAT-IMPORT-PROFILE-1 § 3.4: the sheet discovery. */
    importProfileRevision?: number;
    /** The dry run reads more (DRY_RUN_PROJECTION): the `siteProducts` fields. */
    [field: string]: unknown;
}

/** The execution's previous-set projection: the previous set, the reconciliation and the sheet discovery. */
const EXECUTION_PROJECTION = { expression: "id, title, categoryIds, importSource, importProfileRevision" } as const;

/**
 * CAT-IMPORT-PROFILE-1 § 5.2 `siteProducts`: the fields the two site readers read — the facet function (`brand`,
 * `attributes`, `variants`, `facetModes`) and the catalog-listing rule (`id`, `status`, `categoryIds`,
 * `availableFrom`, `availableUntil`, `sortOrder`).
 */
const SITE_PRODUCT_FIELDS = [
    "id", "status", "categoryIds", "availableFrom", "availableUntil", "sortOrder", "brand", "attributes", "variants", "facetModes",
] as const;
/** The dry run's projection: the execution's fields plus `SITE_PRODUCT_FIELDS`, every name through `#n` placeholders. */
const DRY_RUN_FIELDS = [...new Set(["title", "importSource", "importProfileRevision", ...SITE_PRODUCT_FIELDS])];
const DRY_RUN_PROJECTION = {
    expression: DRY_RUN_FIELDS.map((_, i) => `#f${i}`).join(", "),
    names: Object.fromEntries(DRY_RUN_FIELDS.map((f, i) => [`#f${i}`, f])),
} as const;

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
    // CAT-IMPORT-PROFILE-1 § 3.5: the optional explicit profile, checked before any read (400).
    const choiceParse = parseProfileChoice(body.profileChoice);
    let choice: ProfileChoice | null;
    switch (choiceParse.kind) {
        case "absent": choice = null; break;
        case "accepted": choice = choiceParse.choice; break;
        case "refused": return json(400, { error: choiceParse.error });
        default: {
            const unhandled: never = choiceParse;
            throw new Error(`Unhandled profileChoice parse ${JSON.stringify(unhandled)}`);
        }
    }
    const { rows, codeCells } = parsed;
    const up = upload.upload;
    /** The plan for a resolution: profiled only for `stored` / `save` (an unsupported profile is never applied). */
    const planFor = (resolution: ProfileResolution) => planGlamImport(rows, up, appliedOf(resolution, codeCells));

    // Every asynchronous step below runs under `step`, so a failure answers 500 naming it. The lock is released in
    // `finally` only when this job acquired it (`lockOwner`); a step before that holds no lock.
    let step = "tenant-read";
    let lockOwner: string | null = null;
    // The mutation-phase boundary: set just BEFORE the first command that can change a product or category (the delete
    // loop, even when the previous set is empty). Before it, a failure has certainly changed no product or category;
    // after it, data MAY have changed (a failed write's outcome can be unknown), so the recovery is the full re-import.
    let mutationPhaseEntered = false;
    // CAT-IMPORT-PROFILE-1 § 6.6: set just before the profile item write; a failure after it MAY have saved the profile.
    let profileWriteAttempted = false;
    try {
        // Start-of-job tenant checks, strongly consistent, BEFORE the lock (CM-D11): a refused import writes nothing.
        const mode = await readTenantMode(tenantId);
        if (!mode) return json(404, { error: "Site not found" });
        if (!mode.catalogMode) {
            return json(403, { error: "The pricelist import is available only on catalog sites (sites that show products without prices)." });
        }

        // The stored profile, read before the lock too: a dry run uses this read; an execution uses it only to refuse
        // early (409 / 400, nothing written) and decides on the read it repeats under the lock.
        step = "profile-read";
        const storedEarly = readStoredProfile(await readProfileItem(tenantId, up.producer));
        const early = resolveProfile(choice, storedEarly, isDryRun(event) ? "dry-run" : "execution");

        // Dry run: no lock, reads only — the category lookup, then the previous set.
        if (isDryRun(event)) {
            const { reported, analysed } = dryRunProfile(early);
            const plan = planFor(reported);
            const status = importStatus(analysed);
            step = "categories-lookup";
            const categories = await lookupCategories(tenantId, plan);
            step = "previous-set";
            const products = await readTenantProducts(tenantId, DRY_RUN_PROJECTION);
            const previous = products.filter((p) => p.importSource === plan.upload.importSource);
            return json(200, {
                ...report(plan, true, previous, categories.toCreate.length, new Map(), categories.conflicts),
                ...profileMembers(plan, profileReport(reported, storedEarly), sheetStates(products, up.producer, storedRevisionOf(storedEarly))),
                specKeys: analyseSpecKeys(rows, plan.styles.map((s) => s.draft.rowIndexes), analysed, buildGuard(codeCells)),
                drafts: previewDrafts(tenantId, plan, categories, status),
                siteProducts: products.filter((p) => p.importSource !== plan.upload.importSource).map(siteProductOf),
                publication: publicationOf(plan, status),
            });
        }

        if (!isUsable(early)) return json(409, profileRefusal(early, up.producer));
        const earlyPlan = planFor(early);
        // Nothing in the file to import: refused, so a wrong file cannot delete a sheet and create nothing (B-2, § 9).
        if (earlyPlan.counts.products === 0) return json(400, noProductBody(earlyPlan, early, storedEarly));

        step = "lock";
        const owner = randomUUID();
        if (!(await acquireLock(tenantId, owner))) {
            return json(409, { error: "An import is running on this site. Try again when it has finished." });
        }
        lockOwner = owner;

        // Rule (review-1 R1): every read that decides an execution write is made while this job holds the lock — a
        // decision read before the lock may describe a store another import has changed since. Only the tenant
        // mode is read before the lock (spec § 3.4 / CM-D11: a refused import writes nothing, not even a lock); the
        // early profile read above only refuses.
        step = "profile-read";
        const stored = readStoredProfile(await readProfileItem(tenantId, up.producer));
        const used = resolveProfile(choice, stored, "execution");
        if (!isUsable(used)) return json(409, profileRefusal(used, up.producer));
        const plan = planFor(used);
        if (plan.counts.products === 0) return json(400, noProductBody(plan, used, stored));
        const status = importStatus(used.profile);

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
        const products = await readTenantProducts(tenantId, EXECUTION_PROJECTION);
        const previous = products.filter((p) => p.importSource === plan.upload.importSource);

        // CAT-IMPORT-PROFILE-1 § 6.6 step 4: the profile snapshot is stored BEFORE any product claims its revision.
        switch (used.kind) {
            case "save":
                step = "profile";
                profileWriteAttempted = true;
                await writeProfile(tenantId, up.producer, used, auth.email);
                break;
            case "unprofiled":
            case "stored":
                break; // nothing to save
            default: {
                const unhandled: never = used;
                throw new Error(`Unhandled profile resolution ${JSON.stringify(unhandled)}`);
            }
        }

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
            const item = productItem(tenantId, id, draft, categoryIds, now, status);
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
            details: {
                ...result.counts, categoriesCreated: categories.toCreate.length, incompleteCategories: incomplete.length,
                ...auditProfileDetails(used),
            },
            ip: event.requestContext.http.sourceIp,
        });
        // The producer's sheets AFTER this import: this sheet's products are the created ones, stamped as the plan says.
        const after = [
            ...products.filter((p) => p.importSource !== plan.upload.importSource),
            ...created.map(() => ({ importSource: plan.upload.importSource, importProfileRevision: plan.profile?.revision })),
        ];
        const profiled = {
            ...result,
            ...profileMembers(plan, profileReport(used, stored), sheetStates(after, up.producer, plan.profile?.revision ?? null)),
            publication: publicationOf(plan, status),
        };
        if (incomplete.length > 0) {
            return json(503, {
                error: `The products were written, but the product lists of ${incomplete.length} categor${incomplete.length === 1 ? "y are" : "ies are"} not complete. Import the same file again.`,
                ...profiled,
                incompleteCategories: incomplete,
            });
        }
        return json(200, profiled);
    } catch (e: unknown) {
        console.error(`[glam-pricelist] import failed at step ${step}:`, e);
        return json(500, {
            error: e instanceof Error ? e.message : "Import failed",
            failedStep: step,
            recovery: mutationPhaseEntered
                ? "Import the same file again: it replaces the sheet's products in full."
                : profileWriteAttempted
                    ? "No product or category was changed; the profile may have been saved. Import the same file again with the same profile."
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
async function readTenantProducts(
    tenantId: string,
    projection: { readonly expression: string; readonly names?: Record<string, string> },
): Promise<StoredProductRef[]> {
    const products: StoredProductRef[] = [];
    let startKey: Record<string, any> | undefined;
    do {
        const page: QueryCommandOutput = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "PRODUCT#" },
            ProjectionExpression: projection.expression,
            ...(projection.names ? { ExpressionAttributeNames: projection.names } : {}),
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
function productItem(tenantId: string, id: string, draft: GlamStyleDraft, categoryIds: string[], now: string, status: "active" | "draft") {
    const product: Record<string, any> = {
        PK: `TENANT#${tenantId}`,
        SK: `PRODUCT#${id}`,
        TenantSlug: `${tenantId}#${draft.slug}`,
        Type: "Product",
        id,
        tenantId,
        // CAT-IMAGE-GATE-1: `importStatus(profile)` — `draft` unless the profile publishes products without images.
        status,
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
        // CAT-IMPORT-PROFILE-1 § 3.4: the stamps of a profiled import (absent without a profile: byte identity).
        ...(draft.facetModes !== undefined ? { facetModes: draft.facetModes } : {}),
        ...(draft.importProfileRevision !== undefined ? { importProfileRevision: draft.importProfileRevision } : {}),
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

// ── The import profile (CAT-IMPORT-PROFILE-1, docs/slices/cat-import-profile-1.md § 3, § 6.6) ─────────────────────

/** The producer's profile item (`TENANT#<t>` / `IMPORTPROFILE#glam#<norm(producer)>`), strongly consistent. */
async function readProfileItem(tenantId: string, producer: string): Promise<Record<string, unknown> | undefined> {
    const result = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `TENANT#${tenantId}`, SK: profileSortKey(producer) },
        ConsistentRead: true,
    }));
    return result.Item;
}

/**
 * Store the profile as `revision`, conditioned on the revision observed under the lock (`attribute_not_exists(SK)`
 * when none was stored). One import per tenant runs at a time, so the condition fails only if the lock was lost:
 * the import then fails at step `profile` (500) before any product is changed.
 */
async function writeProfile(
    tenantId: string,
    producer: string,
    save: Extract<ProfileResolution, { kind: "save" }>,
    email: string | undefined,
): Promise<void> {
    await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: `TENANT#${tenantId}`,
            SK: profileSortKey(producer),
            Type: "ImportProfile",
            producer,
            profile: save.profile,
            revision: save.revision,
            updatedAt: new Date().toISOString(),
            ...(email ? { updatedBy: email } : {}),
        },
        ...(save.observedRevision === null
            ? { ConditionExpression: "attribute_not_exists(SK)" }
            : {
                ConditionExpression: "#revision = :observed",
                ExpressionAttributeNames: { "#revision": "revision" },
                ExpressionAttributeValues: { ":observed": save.observedRevision },
            }),
    }));
}

/** The profile a plan applies: only a `stored` or a `save` resolution is profiled (§ 2.8). */
function appliedOf(resolution: ProfileResolution, codeCells: ReadonlySet<string>): AppliedProfile | undefined {
    switch (resolution.kind) {
        case "stored":
        case "save":
            return { profile: resolution.profile, revision: resolution.revision, codeCells };
        case "unprofiled":
        case "unsupported":
        case "changed":
            return undefined;
        default: {
            const unhandled: never = resolution;
            throw new Error(`Unhandled profile resolution ${JSON.stringify(unhandled)}`);
        }
    }
}

/** A resolution an execution can import with; the other two are refused (409). */
type UsableResolution = Exclude<ProfileResolution, { kind: "changed" | "unsupported" }>;
type RefusedResolution = Extract<ProfileResolution, { kind: "changed" | "unsupported" }>;

function isUsable(resolution: ProfileResolution): resolution is UsableResolution {
    switch (resolution.kind) {
        case "unprofiled":
        case "stored":
        case "save":
            return true;
        case "unsupported":
        case "changed":
            return false;
        default: {
            const unhandled: never = resolution;
            throw new Error(`Unhandled profile resolution ${JSON.stringify(unhandled)}`);
        }
    }
}

/** The 409 body of an execution the profile refuses (§ 3.3 item 4, § 3.5). Nothing is written. */
function profileRefusal(resolution: RefusedResolution, producer: string): Record<string, unknown> {
    switch (resolution.kind) {
        case "unsupported":
            return {
                error: `The stored import profile of ${producer} (revision ${resolution.revision}) uses settings this importer cannot apply: ${resolution.reason}. Nothing was changed. To replace it, import with a profile this importer supports and baseRevision ${resolution.revision}.`,
                profile: { source: "unsupported", revision: resolution.revision, reason: resolution.reason },
            };
        case "changed":
            return {
                error: `The import profile of ${producer} was changed by another import since you loaded it (stored revision ${resolution.storedRevision ?? "none"}, loaded ${resolution.baseRevision ?? "none"}). Nothing was changed. Load the stored profile, preview again and import.`,
                storedRevision: resolution.storedRevision,
                baseRevision: resolution.baseRevision,
            };
        default: {
            const unhandled: never = resolution;
            throw new Error(`Unhandled profile resolution ${JSON.stringify(unhandled)}`);
        }
    }
}

function storedRevisionOf(stored: StoredProfile): number | null {
    switch (stored.kind) {
        case "none": return null;
        case "supported":
        case "unsupported":
            return stored.revision;
        default: {
            const unhandled: never = stored;
            throw new Error(`Unhandled stored profile ${JSON.stringify(unhandled)}`);
        }
    }
}

/**
 * The dry run's view of a resolution: the one it reports and plans with, and the profile its `specKeys` analysis
 * uses. An unsupported stored profile is never applied: the plan is unprofiled and the analysis uses the default.
 */
function dryRunProfile(resolution: ProfileResolution): { reported: Exclude<ProfileResolution, { kind: "changed" }>; analysed: GlamImportProfile } {
    switch (resolution.kind) {
        case "unprofiled":
        case "stored":
        case "save":
            return { reported: resolution, analysed: resolution.profile };
        case "unsupported":
            return { reported: resolution, analysed: DEFAULT_PROFILE };
        case "changed":
            throw new Error("Internal: a dry run never applies the acceptance rule.");
        default: {
            const unhandled: never = resolution;
            throw new Error(`Unhandled profile resolution ${JSON.stringify(unhandled)}`);
        }
    }
}

/** § 6.6 step 6: the audit's profile details — only on a profiled import (an unprofiled one audits as before). */
function auditProfileDetails(used: UsableResolution): { profileRevision?: number; profileSource?: "stored" | "explicit" } {
    switch (used.kind) {
        case "unprofiled": return {};
        case "stored": return { profileRevision: used.revision, profileSource: used.source };
        case "save": return { profileRevision: used.revision, profileSource: "explicit" };
        default: {
            const unhandled: never = used;
            throw new Error(`Unhandled profile resolution ${JSON.stringify(unhandled)}`);
        }
    }
}

/** The 400 "no product row" body: as before, plus the profile that planned it. */
function noProductBody(plan: GlamImportPlan, resolution: UsableResolution, stored: StoredProfile) {
    return {
        error: "The file has no product rows to import; nothing was changed. Run a dry run to see why each row was skipped.",
        ...report(plan, false, [], 0, new Map(), []),
        profile: profileReport(resolution, stored),
    };
}

/**
 * The response members of § 3.5 shared by the dry run and the execution: `profile`, `sheets`, and — on a profiled
 * plan only — `specLineRefusals` (every spec line the value guard refused, by key and row; the line is not echoed).
 */
function profileMembers(plan: GlamImportPlan, profile: ProfileReport, sheets: SheetReport[]) {
    return { profile, sheets, ...(plan.profile ? { specLineRefusals: plan.profile.refused } : {}) };
}

/** § 3.4 discovery. `no-profile`: no product stamped; `current` / `stale`: all stamped with one revision, equal / not equal to the stored one; `mixed`: otherwise. */
type SheetState = "no-profile" | "current" | "stale" | "mixed";
interface SheetReport {
    /** `glam:<norm(producer)>/<norm(sheet)>` — the sheet's display form is not stored on products. */
    importSource: string;
    products: number;
    state: SheetState;
    /** The distinct stamped revisions, ascending. */
    revisions: number[];
    /** Products without `importProfileRevision`. */
    unstamped: number;
}

/** Per sheet of the producer (products whose `importSource` starts with `glam:<norm(producer)>/`), sorted by `importSource`. */
function sheetStates(
    products: readonly { importSource?: unknown; importProfileRevision?: unknown }[],
    producer: string,
    storedRevision: number | null,
): SheetReport[] {
    const prefix = `glam:${norm(producer)}/`;
    const bySheet = new Map<string, unknown[]>();
    for (const p of products) {
        if (typeof p.importSource !== "string" || !p.importSource.startsWith(prefix)) continue;
        const stamps = bySheet.get(p.importSource) ?? [];
        stamps.push(p.importProfileRevision);
        bySheet.set(p.importSource, stamps);
    }
    return [...bySheet].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([importSource, stamps]) => {
        const revisions = [...new Set(stamps.filter((s): s is number => typeof s === "number"))].sort((a, b) => a - b);
        const unstamped = stamps.filter((s) => typeof s !== "number").length;
        const state: SheetState = unstamped === stamps.length ? "no-profile"
            : unstamped > 0 || revisions.length > 1 ? "mixed"
            : revisions[0] === storedRevision ? "current" : "stale";
        return { importSource, products: stamps.length, state, revisions, unstamped };
    });
}

/**
 * § 5.2 `drafts[]`: the item the execution would write for each planned product, built by the same `productItem`,
 * without `PK`, `SK`, `TenantSlug`; `id` = `preview:<slug>`; category ids = the found id, `new:<slug>` for a category
 * the import would create, `occupied:<slug>` for a renamed category that blocks the import (`categoryConflicts`).
 */
function previewDrafts(tenantId: string, plan: GlamImportPlan, categories: CategoryResolution, status: "active" | "draft") {
    const now = new Date().toISOString();
    const toCreate = new Set(categories.toCreate.map((c) => c.slug));
    const occupied = new Set(categories.conflicts.map((c) => c.slug));
    return plan.styles.map(({ draft }) => {
        const categoryIds = draft.categoryKeys.map((slug) =>
            toCreate.has(slug) ? `new:${slug}` : occupied.has(slug) ? `occupied:${slug}` : categories.idBySlug.get(slug)!);
        const { PK: _pk, SK: _sk, TenantSlug: _tenantSlug, ...item } = productItem(tenantId, `preview:${draft.slug}`, draft, categoryIds, now, status);
        return item;
    });
}

/** § 5.2 `siteProducts[]`: one kept product with exactly the `SITE_PRODUCT_FIELDS` it has. */
function siteProductOf(product: StoredProductRef): Record<string, unknown> {
    return Object.fromEntries(SITE_PRODUCT_FIELDS.filter((f) => product[f] !== undefined).map((f) => [f, product[f]]));
}

/**
 * CAT-IMAGE-GATE-1 § 3 items 2, 4 — the response member `publication` (dry run and execution): the `status` every
 * product of this import is (or would be) written with, how many products start hidden (all of them with `draft`,
 * none with `active`), and the products whose rows hold no usable image address (an empty or invalid image cell):
 * with `draft` they stay hidden after the image copy unless an image is added to the file; with `active` they are
 * published without an image. A separate member, so the 1a golden's `counts` and `products[]` keep their shape.
 */
function publicationOf(plan: GlamImportPlan, status: "active" | "draft") {
    return {
        status,
        startHidden: status === "draft" ? plan.styles.length : 0,
        withoutImageAddress: plan.styles
            .filter(({ draft }) => !draft.variants[0].options.some((o) => o.imageLink !== undefined))
            .map(({ draft }) => ({ slug: draft.slug, title: draft.title, rowIndexes: draft.rowIndexes })),
    };
}
