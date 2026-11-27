import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { isProductAvailable } from "../lib/availability.js";

/**
 * FINDINGS-1 Part 1 (docs/slices/findings-1.md § Part 1 has the reason for each field): the only product fields this
 * public route answers. The union of the fields `public-list.ts` answers and the `ProductSchema` fields the renderer's
 * product pages, their JSON-LD and the product feed show to a visitor. A field not named here is never answered.
 */
const PUBLIC_PRODUCT_FIELDS = [
    "id", "status", "title", "slug", "sku", "description", "longDescription",
    "price", "currency", "salePrice", "volumePricing", "availability", "availableFrom", "availableUntil",
    "brand", "condition", "categoryIds", "tags", "attributes", "personalizations", "variants",
    "ingredients", "nutritionalValues", "imageLink", "additionalImageLinks", "paymentLinkId",
    "seoTitle", "seoDescription", "sortOrder",
] as const;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const slug = event.pathParameters?.slug;

        if (!tenantId || !slug) return { statusCode: 400, body: JSON.stringify({ error: "Missing parameters" }) };

        // Look up product by TenantSlug GSI
        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: "GSI_Slug",
            KeyConditionExpression: "TenantSlug = :ts",
            FilterExpression: "#t = :type",
            ExpressionAttributeNames: { "#t": "Type" },
            ExpressionAttributeValues: {
                ":ts": `${tenantId}#${slug}`,
                ":type": "Product"
            }
        }));

        // SETTINGS-KEYS-1B — accept only this tenant's product item. Index key attributes are data, not proof of
        // ownership: an item from another partition (e.g. a tenant record that carried TenantSlug/Type) is not found.
        const product = result.Items?.find(
            (item) => item.PK === `TENANT#${tenantId}` && item.SK?.startsWith("PRODUCT#")
        );
        if (!product) {
            return { statusCode: 404, body: JSON.stringify({ error: "Product not found" }) };
        }

        // Don't expose draft or unavailable products publicly
        if (product.status !== "active" || !isProductAvailable(product)) {
            return { statusCode: 404, body: JSON.stringify({ error: "Product not found" }) };
        }

        // FINDINGS-1 Part 1: the answer holds only the named public fields that the item has; every other stored
        // attribute (resourceId, storage keys, importer bookkeeping, anything a later write adds) stays private.
        const publicProduct: Record<string, unknown> = {};
        for (const field of PUBLIC_PRODUCT_FIELDS) {
            if (Object.hasOwn(product, field)) publicProduct[field] = product[field];
        }

        return {
            statusCode: 200,
            headers: { "Cache-Control": "public, max-age=60" },
            body: JSON.stringify(publicProduct)
        };
    } catch (e: any) {
        console.error("[products/public-get] Error:", e);
        return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
    }
};
