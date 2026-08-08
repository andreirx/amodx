import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { Review } from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const _handler: Handler = async (event) => {
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

        // Type the untrusted body against the shared review contract (rev-1): `productId` and
        // the mutable allow-list below now bind to `ReviewSchema` field names, so a schema
        // rename breaks this compile. Annotation only — no runtime validation added (that would
        // be a behavior change, deferred to rev-2).
        const body = JSON.parse(event.body) as Partial<Review>;
        const { productId } = body;

        if (!productId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing productId (needed to construct key)" }) };
        }

        const now = new Date().toISOString();

        // Build dynamic update expression from allowed fields. Keys are constrained to `keyof
        // Review`, so the moderation mutable-field allow-list stays tied to the schema — if one
        // of these field names drifts out of `ReviewSchema`, this object fails to compile.
        const allowedFields = {
            status: "status",
            content: "content",
            authorName: "authorName",
            rating: "rating",
        } satisfies Partial<Record<keyof Review, string>>;

        const expressionParts: string[] = ["#updatedAt = :updatedAt"];
        const expressionNames: Record<string, string> = { "#updatedAt": "updatedAt" };
        const expressionValues: Record<string, unknown> = { ":updatedAt": now };

        const bodyByKey = body as Record<string, unknown>; // string-indexed view for the dynamic loop
        for (const [inputKey, dbKey] of Object.entries(allowedFields)) {
            const value = bodyByKey[inputKey];
            if (value !== undefined) {
                const placeholder = `:${inputKey}`;
                const nameToken = `#${inputKey}`;
                expressionParts.push(`${nameToken} = ${placeholder}`);
                expressionNames[nameToken] = dbKey;
                expressionValues[placeholder] = value;
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

export const handler = withInvalidation(_handler);
