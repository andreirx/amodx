import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        // SECURITY: Editors and Tenant Admins allowed
        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };
        if (!event.body) return { statusCode: 400, body: "Missing Body" };

        const body = JSON.parse(event.body);

        const { productId, source, authorName, rating, content, googleReviewId, status } = body;

        if (!productId || !authorName || rating === undefined) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields: productId, authorName, rating" }) };
        }

        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `REVIEW#${productId}#${id}`,
                id,
                tenantId,
                productId,
                source: source || "manual",
                authorName,
                rating,
                content: content || "",
                googleReviewId: googleReviewId || null,
                status: status || "pending",
                createdAt,
                Type: "Review"
            }
        }));

        return { statusCode: 201, body: JSON.stringify({ id, message: "Review created" }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
