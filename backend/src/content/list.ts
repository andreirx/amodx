import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    const start = Date.now();
    let itemCount = 0;

    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const type = event.queryStringParameters?.type || "Content";

        if (type === "Redirect") {
            const result = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "ROUTE#" }
            }));
            const redirects = result.Items?.filter(i => i.IsRedirect === true) || [];
            return { statusCode: 200, body: JSON.stringify({ items: redirects }) };
        }

        let items: Record<string, any>[] = [];
        let lastEvaluatedKey: Record<string, any> | undefined = undefined;
        let loopCount = 0;

        do {
            // FIX: Explicit Type
            const command: QueryCommand = new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues: {
                    ":pk": `TENANT#${tenantId}`,
                    ":sk": "CONTENT#"
                },
                ProjectionExpression: "SK, nodeId, id, title, slug, #s, commentsMode, accessPolicy, tags, featuredImage, createdAt, updatedAt, author, authorEmail, seoDescription",
                ExpressionAttributeNames: { "#s": "status" },
                ExclusiveStartKey: lastEvaluatedKey
            });

            const res = await db.send(command);

            if (res.Items) {
                items.push(...res.Items);
            }

            lastEvaluatedKey = res.LastEvaluatedKey;
            loopCount++;

            if (loopCount > 20) break;

        } while (lastEvaluatedKey);

        itemCount = items.length;
        const filtered = items.filter(item => item.SK.endsWith("#LATEST"));

        const duration = Date.now() - start;
        console.log(`[ListContent] Success. RawItems: ${itemCount}, Returned: ${filtered.length}, Time: ${duration}ms`);

        return { statusCode: 200, body: JSON.stringify({ items: filtered }) };

    } catch (error: any) {
        console.error("[ListContent] CRITICAL ERROR:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message,
                requestId: event.requestContext.requestId
            })
        };
    }
};
