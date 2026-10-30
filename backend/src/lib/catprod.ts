import { db, TABLE_NAME } from "./db.js";
import { BatchWriteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { QueryCommandOutput, BatchWriteCommandOutput } from "@aws-sdk/lib-dynamodb";

/**
 * CATPROD# adjacency list items for O(1) category-product lookups.
 *
 * Pattern: PK: TENANT#<tid>  SK: CATPROD#<categoryId>#<productId>
 * Contains projected fields for product card rendering without a second query.
 */

interface ProductCardProjection {
    id: string;
    title: string;
    slug: string;
    sku?: string;
    price?: string;              // CATALOG-MODE-1: absent on every catalog-tenant product (never "", never "0")
    currency: string;
    salePrice?: string;
    imageLink?: string;
    availability: string;
    status?: string;
    sortOrder: number;
    tags: string[];
    volumePricing: any[];
    categoryIds: string[];
    availableFrom?: string;
    availableUntil?: string;
}

function buildCatProdItem(tenantId: string, categoryId: string, product: ProductCardProjection) {
    return {
        PK: `TENANT#${tenantId}`,
        SK: `CATPROD#${categoryId}#${product.id}`,
        id: product.id,
        title: product.title,
        slug: product.slug,
        sku: product.sku,
        price: product.price,
        currency: product.currency,
        salePrice: product.salePrice,
        imageLink: product.imageLink,
        availability: product.availability,
        status: product.status || "active",
        sortOrder: product.sortOrder || 0,
        tags: product.tags || [],
        volumePricing: product.volumePricing || [],
        categoryIds: product.categoryIds || [],
        availableFrom: product.availableFrom,
        availableUntil: product.availableUntil,
    };
}

/**
 * Write CATPROD# items for each of a product's categories.
 * Uses BatchWrite (25 items per batch) for efficiency.
 */
export async function writeCatProductItems(tenantId: string, product: ProductCardProjection) {
    const categoryIds = product.categoryIds || [];
    if (categoryIds.length === 0) return;

    const items = categoryIds.map(catId => buildCatProdItem(tenantId, catId, product));

    // BatchWrite supports max 25 items per request
    for (let i = 0; i < items.length; i += 25) {
        const batch = items.slice(i, i + 25);
        await db.send(new BatchWriteCommand({
            RequestItems: {
                [TABLE_NAME]: batch.map(item => ({
                    PutRequest: { Item: item }
                }))
            }
        }));
    }
}

/**
 * Delete CATPROD# items for a product from specific categories.
 * Called when categoryIds change or product is deleted.
 */
export async function deleteCatProductItems(tenantId: string, productId: string, categoryIds: string[]) {
    if (!categoryIds || categoryIds.length === 0) return;

    const keys = categoryIds.map(catId => ({
        PK: `TENANT#${tenantId}`,
        SK: `CATPROD#${catId}#${productId}`,
    }));

    for (let i = 0; i < keys.length; i += 25) {
        const batch = keys.slice(i, i + 25);
        await db.send(new BatchWriteCommand({
            RequestItems: {
                [TABLE_NAME]: batch.map(key => ({
                    DeleteRequest: { Key: key }
                }))
            }
        }));
    }
}

/**
 * Query CATPROD# items for a category. Returns product card projections
 * already sorted by sortOrder. No FilterExpression needed.
 */
export async function queryCatProducts(tenantId: string, categoryId: string) {
    const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
            ":pk": `TENANT#${tenantId}`,
            ":sk": `CATPROD#${categoryId}#`,
        },
    }));

    return (result.Items || []).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

// ── CAT-IMPORT-1 — the end-of-import reconciliation (spec docs/slices/catalog-mode-1.md § 3.4, cycle 13) ──────────
// Two functions added beside the three above, which are unchanged (as are their callers): the reconciliation needs a
// COMPLETE, strongly consistent read and ACKNOWLEDGED writes, which `queryCatProducts` (one page, eventually
// consistent) and the two writers (BatchWrite responses discarded) do not give. Kept in this module because it owns
// the `CATPROD#<categoryId>#<productId>` key layout and the projection shape (`buildCatProdItem`).

/** The retry bound of the reconciliation: at most 5 resends per request. */
const MAX_RESENDS = 5;

/** Full-jitter wait before resend `attempt` (0-based): uniform in [0, 100·2^attempt) ms — at most 3.1 s per request. */
function backoff(attempt: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.random() * 100 * 2 ** attempt));
}

/**
 * Every product id that has a projection in `categoryId`: `begins_with(SK, "CATPROD#<categoryId>#")`, strongly
 * consistent, projection `id`, following `LastEvaluatedKey` to the end. One caller: the glam importer's reconciliation.
 */
export async function listCatProductIds(tenantId: string, categoryId: string): Promise<string[]> {
    const ids: string[] = [];
    let startKey: Record<string, any> | undefined;
    do {
        const page: QueryCommandOutput = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": `CATPROD#${categoryId}#` },
            ProjectionExpression: "id",
            ConsistentRead: true,
            ExclusiveStartKey: startKey,
        }));
        for (const item of page.Items ?? []) ids.push(item.id);
        startKey = page.LastEvaluatedKey;
    } while (startKey);
    return ids;
}

/**
 * Write the projections of ONE category: delete `CATPROD#<categoryId>#<id>` of each orphan, put the projection of each
 * member for this category only (built by `buildCatProdItem`, the shape every writer produces). Batches of 25; each
 * response's `UnprocessedItems` are resent at most 5 times with full-jitter waits (100 ms doubling). Returns the
 * number of requests still unprocessed after the bound — 0 means every write was acknowledged.
 * One caller: the glam importer's reconciliation. A product id must not be both a member and an orphan.
 */
export async function writeCategoryProjections(
    tenantId: string,
    categoryId: string,
    members: ProductCardProjection[],
    orphanIds: string[],
): Promise<{ unprocessed: number }> {
    const requests: any[] = [
        ...orphanIds.map((id) => ({ DeleteRequest: { Key: { PK: `TENANT#${tenantId}`, SK: `CATPROD#${categoryId}#${id}` } } })),
        ...members.map((member) => ({ PutRequest: { Item: buildCatProdItem(tenantId, categoryId, member) } })),
    ];
    let unprocessed = 0;
    for (let i = 0; i < requests.length; i += 25) {
        let pending: any[] = requests.slice(i, i + 25);
        for (let attempt = 0; ; attempt++) {
            const result: BatchWriteCommandOutput = await db.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: pending } }));
            pending = result.UnprocessedItems?.[TABLE_NAME] ?? [];
            if (pending.length === 0 || attempt === MAX_RESENDS) break;
            await backoff(attempt);
        }
        unprocessed += pending.length;
    }
    return { unprocessed };
}
