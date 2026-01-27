import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "SIGNAL#",
            },
            ProjectionExpression: "id, tenantId, #src, #u, title, author, painScore, walletSignal, #st, analysis, createdAt, updatedAt",
            ExpressionAttributeNames: {
                "#src": "source",
                "#u": "url",
                "#st": "status",
            },
        }));

        const items = (result.Items || []);

        // Sort by painScore descending, then createdAt descending
        items.sort((a, b) => {
            const scoreDiff = (b.painScore ?? 0) - (a.painScore ?? 0);
            if (scoreDiff !== 0) return scoreDiff;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        return { statusCode: 200, body: JSON.stringify({ items }) };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Internal error";
        return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
};
