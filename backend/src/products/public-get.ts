import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

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

        if (!result.Items || result.Items.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ error: "Product not found" }) };
        }

        const product = result.Items[0];

        // Don't expose draft products publicly
        if (product.status !== "active") {
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
