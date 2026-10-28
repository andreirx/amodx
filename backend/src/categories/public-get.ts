import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { queryCatProducts } from "../lib/catprod.js";
import { isProductAvailable } from "../lib/availability.js";

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

        // SETTINGS-KEYS-1B — accept only this tenant's category item. Index key attributes are data, not proof of
        // ownership: an item from another partition (e.g. a tenant record that carried TenantSlug/Type) is not found.
        const category = catResult.Items?.find(
            (item) => item.PK === `TENANT#${tenantId}` && item.SK?.startsWith("CATEGORY#")
        );
        if (!category) {
            return { statusCode: 404, body: JSON.stringify({ error: "Category not found" }) };
        }

        // Fetch products via CATPROD# adjacency items, filter by availability dates
        const allProducts = (await queryCatProducts(tenantId, category.id))
            .filter((p: any) => isProductAvailable(p));

        // Paginate
        const page = parseInt(event.queryStringParameters?.page || "1");
        const limit = Math.min(parseInt(event.queryStringParameters?.limit || "24"), 100);
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
