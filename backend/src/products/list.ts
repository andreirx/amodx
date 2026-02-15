import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { queryCatProducts } from "../lib/catprod.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const auth = event.requestContext.authorizer.lambda;
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const statusFilter = event.queryStringParameters?.status;
        const categoryFilter = event.queryStringParameters?.category;

        let items: any[];

        if (categoryFilter) {
            // Use CATPROD# adjacency items for category filter
            items = await queryCatProducts(tenantId, categoryFilter);

            // Apply status filter on the smaller set
            if (statusFilter) {
                items = items.filter((p: any) => p.status === statusFilter);
            }
        } else {
            // No category filter — query all products
            const filterParts: string[] = [];
            const exprValues: Record<string, any> = {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "PRODUCT#"
            };

            if (statusFilter) {
                filterParts.push("#s = :statusVal");
                exprValues[":statusVal"] = statusFilter;
            }

            const result = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ...(filterParts.length > 0 ? { FilterExpression: filterParts.join(" AND ") } : {}),
                ExpressionAttributeValues: exprValues,
                ExpressionAttributeNames: { "#s": "status" },
                ProjectionExpression: "id, title, slug, price, currency, salePrice, #s, availability, inventoryQuantity, imageLink, categoryIds, tags, brand, sortOrder, createdAt, updatedAt",
            }));

            items = result.Items || [];
        }

        return { statusCode: 200, body: JSON.stringify({ items }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
