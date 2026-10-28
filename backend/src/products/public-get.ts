import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { isProductAvailable } from "../lib/availability.js";

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

        return {
            statusCode: 200,
            headers: { "Cache-Control": "public, max-age=60" },
            body: JSON.stringify(product)
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
