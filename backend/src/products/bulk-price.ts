import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand, GetCommand, PutCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";
import { writeCatProductItems, deleteCatProductItems } from "../lib/catprod.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

function roundPrice(price: number, roundTo: number): number {
    if (roundTo === 0) return Math.round(price * 100) / 100;

    if (roundTo === 5) {
        return Math.ceil(price / 5) * 5;
    }

    if (roundTo === 9) {
        const base = Math.floor(price / 10) * 10 + 9;
        return base >= price ? base : base + 10;
    }

    if (roundTo === 0.99) {
        const floored = Math.floor(price);
        const candidate = floored + 0.99;
        return candidate >= price ? candidate : candidate + 1;
    }

    return Math.round(price * 100) / 100;
}

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId || !event.body) return { statusCode: 400, body: "Missing data" };

        const body = JSON.parse(event.body);
        const { categoryId, percent, roundTo = 0, applyToSalePrice = false, dryRun = true } = body;

        if (typeof percent !== "number" || percent === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: "percent must be a non-zero number" }) };
        }

        // 1. Get product IDs (all or by category)
        let products: any[] = [];

        if (categoryId) {
            // Query CATPROD# for product IDs in this category
            const catResult = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues: {
                    ":pk": `TENANT#${tenantId}`,
                    ":sk": `CATPROD#${categoryId}#`,
                },
                ProjectionExpression: "SK",
            }));

            const productIds = (catResult.Items || []).map((item: any) => {
                const parts = item.SK.split("#");
                return parts[parts.length - 1];
            });

            if (productIds.length === 0) {
                return { statusCode: 200, body: JSON.stringify({ preview: [], count: 0 }) };
            }

            // Batch get full products
            const keys = productIds.map((pid: string) => ({
                PK: `TENANT#${tenantId}`,
                SK: `PRODUCT#${pid}`,
            }));

            // BatchGetCommand supports max 100 keys at once
            for (let i = 0; i < keys.length; i += 100) {
                const batch = keys.slice(i, i + 100);
                const batchResult = await db.send(new BatchGetCommand({
                    RequestItems: {
                        [TABLE_NAME]: { Keys: batch }
                    }
                }));
                products.push(...(batchResult.Responses?.[TABLE_NAME] || []));
            }
        } else {
            // All products
            const result = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues: {
                    ":pk": `TENANT#${tenantId}`,
                    ":sk": "PRODUCT#",
                },
            }));
            products = result.Items || [];
        }

        // 2. Calculate new prices
        const multiplier = 1 + percent / 100;
        const preview: any[] = [];

        for (const product of products) {
            const oldPrice = parseFloat(product.price);
            if (isNaN(oldPrice) || oldPrice <= 0) continue;

            const rawNewPrice = oldPrice * multiplier;
            const newPrice = roundPrice(rawNewPrice, roundTo);

            const entry: any = {
                id: product.id,
                title: product.title,
                oldPrice: product.price,
                newPrice: newPrice.toFixed(2),
                currency: product.currency,
            };

            if (applyToSalePrice && product.salePrice) {
                const oldSale = parseFloat(product.salePrice);
                if (!isNaN(oldSale) && oldSale > 0) {
                    const rawNewSale = oldSale * multiplier;
                    entry.oldSalePrice = product.salePrice;
                    entry.newSalePrice = roundPrice(rawNewSale, roundTo).toFixed(2);
                }
            }

            preview.push(entry);
        }

        // 3. Dry run → return preview
        if (dryRun) {
            return {
                statusCode: 200,
                body: JSON.stringify({ preview, count: preview.length }),
            };
        }

        // 4. Apply changes
        let updated = 0;
        for (const entry of preview) {
            const product = products.find((p: any) => p.id === entry.id);
            if (!product) continue;

            const merged = {
                ...product,
                price: entry.newPrice,
                updatedAt: new Date().toISOString(),
            };

            if (entry.newSalePrice) {
                merged.salePrice = entry.newSalePrice;
            }

            await db.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: merged,
            }));

            // Update CATPROD# adjacency items with new price
            const categoryIds: string[] = product.categoryIds || [];
            if (categoryIds.length > 0) {
                await deleteCatProductItems(tenantId!, product.id, categoryIds);
                await writeCatProductItems(tenantId!, {
                    id: product.id, title: merged.title, slug: merged.slug, sku: merged.sku,
                    price: merged.price, currency: merged.currency, salePrice: merged.salePrice,
                    imageLink: merged.imageLink, availability: merged.availability,
                    sortOrder: merged.sortOrder || 0, tags: merged.tags || [],
                    volumePricing: merged.volumePricing || [],
                    categoryIds,
                    availableFrom: merged.availableFrom,
                    availableUntil: merged.availableUntil,
                });
            }

            updated++;
        }

        // 5. Audit
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "BULK_PRICE_UPDATE",
            target: { title: `${updated} products`, id: categoryId || "all" },
            details: { percent, roundTo, applyToSalePrice, productCount: updated },
            ip: event.requestContext.http.sourceIp,
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ count: updated, message: `Updated ${updated} product prices` }),
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
