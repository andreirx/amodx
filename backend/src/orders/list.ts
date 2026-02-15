import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        const statusFilter = event.queryStringParameters?.status;
        const dateFrom = event.queryStringParameters?.dateFrom;
        const dateTo = event.queryStringParameters?.dateTo;
        const search = event.queryStringParameters?.search?.toLowerCase();

        const filterParts: string[] = [];
        const exprValues: Record<string, any> = {
            ":pk": `TENANT#${tenantId}`,
            ":sk": "ORDER#"
        };
        const exprNames: Record<string, string> = { "#s": "status" };

        if (statusFilter) {
            filterParts.push("#s = :statusVal");
            exprValues[":statusVal"] = statusFilter;
        }

        if (dateFrom) {
            filterParts.push("createdAt >= :dateFrom");
            exprValues[":dateFrom"] = dateFrom;
        }

        if (dateTo) {
            filterParts.push("createdAt <= :dateTo");
            exprValues[":dateTo"] = dateTo;
        }

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ...(filterParts.length > 0 ? { FilterExpression: filterParts.join(" AND ") } : {}),
            ExpressionAttributeValues: exprValues,
            ExpressionAttributeNames: exprNames,
            ProjectionExpression: "id, orderNumber, customerEmail, customerName, #s, paymentMethod, paymentStatus, total, currency, createdAt"
        }));

        let items = result.Items || [];

        // In-memory search filter
        if (search) {
            items = items.filter((item: any) =>
                item.customerName?.toLowerCase().includes(search) ||
                item.customerEmail?.toLowerCase().includes(search) ||
                item.orderNumber?.toLowerCase().includes(search)
            );
        }

        // Sort by createdAt descending
        items.sort((a: any, b: any) => {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        return { statusCode: 200, body: JSON.stringify({ items }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
