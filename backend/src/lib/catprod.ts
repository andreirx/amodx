import { db, TABLE_NAME } from "./db.js";
import { BatchWriteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

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
    price: string;
    currency: string;
    salePrice?: string;
    imageLink?: string;
    availability: string;
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
        price: product.price,
        currency: product.currency,
        salePrice: product.salePrice,
        imageLink: product.imageLink,
        availability: product.availability,
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
