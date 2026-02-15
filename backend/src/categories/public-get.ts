import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const slug = event.pathParameters?.slug;

        if (!tenantId || !slug) return { statusCode: 400, body: JSON.stringify({ error: "Missing parameters" }) };

        // Look up category by TenantSlug GSI
        const catResult = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: "GSI_Slug",
            KeyConditionExpression: "TenantSlug = :ts",
            FilterExpression: "#t = :type",
            ExpressionAttributeNames: { "#t": "Type" },
            ExpressionAttributeValues: {
                ":ts": `${tenantId}#${slug}`,
                ":type": "Category"
            }
        }));

        if (!catResult.Items || catResult.Items.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ error: "Category not found" }) };
        }

        const category = catResult.Items[0];

        // Fetch products in this category (paginated)
        const page = parseInt(event.queryStringParameters?.page || "1");
        const limit = Math.min(parseInt(event.queryStringParameters?.limit || "24"), 100);

        const productsResult = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "contains(categoryIds, :catId) AND #s = :active",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "PRODUCT#",
                ":catId": category.id,
                ":active": "active"
            },
            ExpressionAttributeNames: { "#s": "status" },
            ProjectionExpression: "id, title, slug, price, currency, salePrice, availability, imageLink, tags, sortOrder"
        }));

        // Client-side pagination (DynamoDB FilterExpression doesn't support server-side paging with filters)
        const allProducts = (productsResult.Items || []).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
        const start = (page - 1) * limit;
        const products = allProducts.slice(start, start + limit);

        return {
            statusCode: 200,
            headers: { "Cache-Control": "public, max-age=60" },
            body: JSON.stringify({
                category,
                products,
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
