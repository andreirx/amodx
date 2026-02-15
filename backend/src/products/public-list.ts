import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const categorySlug = event.queryStringParameters?.category;
        const tag = event.queryStringParameters?.tag;
        const page = parseInt(event.queryStringParameters?.page || "1");
        const limit = Math.min(parseInt(event.queryStringParameters?.limit || "24"), 100);

        // Build filter for active products only
        const filterParts: string[] = ["#s = :active"];
        const exprValues: Record<string, any> = {
            ":pk": `TENANT#${tenantId}`,
            ":sk": "PRODUCT#",
            ":active": "active"
        };

        if (categorySlug) {
            filterParts.push("contains(categoryIds, :catId)");
            exprValues[":catId"] = categorySlug; // Note: this is category ID, not slug
        }

        if (tag) {
            filterParts.push("contains(tags, :tag)");
            exprValues[":tag"] = tag;
        }

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: filterParts.join(" AND "),
            ExpressionAttributeValues: exprValues,
            ExpressionAttributeNames: { "#s": "status" },
            ProjectionExpression: "id, title, slug, price, currency, salePrice, availability, imageLink, tags, categoryIds, sortOrder, volumePricing"
        }));

        // Sort and paginate client-side
        const allProducts = (result.Items || []).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
        const start = (page - 1) * limit;
        const products = allProducts.slice(start, start + limit);

        return {
            statusCode: 200,
            headers: { "Cache-Control": "public, max-age=60" },
            body: JSON.stringify({
                items: products,
                pagination: {
                    page,
                    limit,
                    total: allProducts.length,
                    totalPages: Math.ceil(allProducts.length / limit)
                }
            })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
