import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { QueryCommandOutput } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const auth = event.requestContext.authorizer.lambda;
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        // CATEGORY-CONTENT-1 (rule 5): the projection leaves `blocks` out of the answer, but DynamoDB counts its 1 MB page
        // limit on the stored item, before the projection — so every page is followed, or large page content would cut the
        // list short without an error.
        const items: Record<string, any>[] = [];
        let startKey: Record<string, any> | undefined;
        do {
            const page: QueryCommandOutput = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues: {
                    ":pk": `TENANT#${tenantId}`,
                    ":sk": "CATEGORY#"
                },
                ProjectionExpression: "id, #n, slug, parentId, sortOrder, #s, productCount, imageLink, seoTitle, seoDescription",
                ExpressionAttributeNames: { "#s": "status", "#n": "name" },
                ExclusiveStartKey: startKey,
            }));
            items.push(...(page.Items || []));
            startKey = page.LastEvaluatedKey;
        } while (startKey);

        return { statusCode: 200, body: JSON.stringify({ items }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
