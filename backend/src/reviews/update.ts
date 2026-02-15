import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;
        const id = event.pathParameters?.id;

        // SECURITY: Editors and Tenant Admins allowed
        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: "Missing review ID" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const body = JSON.parse(event.body);
        const { productId } = body;

        if (!productId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing productId (needed to construct key)" }) };
        }

        const now = new Date().toISOString();

        // Build dynamic update expression from allowed fields
        const allowedFields: Record<string, string> = {
            status: "status",
            content: "content",
            authorName: "authorName",
            rating: "rating",
        };

        const expressionParts: string[] = ["#updatedAt = :updatedAt"];
        const expressionNames: Record<string, string> = { "#updatedAt": "updatedAt" };
        const expressionValues: Record<string, unknown> = { ":updatedAt": now };

        for (const [inputKey, dbKey] of Object.entries(allowedFields)) {
            if (body[inputKey] !== undefined) {
                const placeholder = `:${inputKey}`;
                const nameToken = `#${inputKey}`;
                expressionParts.push(`${nameToken} = ${placeholder}`);
                expressionNames[nameToken] = dbKey;
                expressionValues[placeholder] = body[inputKey];
            }
        }

        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `REVIEW#${productId}#${id}`,
            },
            UpdateExpression: `SET ${expressionParts.join(", ")}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            ConditionExpression: "attribute_exists(SK)",
        }));

        return { statusCode: 200, body: JSON.stringify({ message: "Review updated" }) };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Internal error";
        if (e instanceof Error && e.name === "ConditionalCheckFailedException") {
            return { statusCode: 404, body: JSON.stringify({ error: "Review not found" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
};
