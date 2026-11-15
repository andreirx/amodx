import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { QueryCommandOutput } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // CATEGORY-CONTENT-1 (rule 5): the projection leaves `blocks` out of the answer, but DynamoDB counts its 1 MB page
        // limit on the stored item, before the filter and the projection — so every page is followed, or large page
        // content would cut the list short without an error.
        const items: Record<string, any>[] = [];
        let startKey: Record<string, any> | undefined;
        do {
            const page: QueryCommandOutput = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                FilterExpression: "#s = :active",
                ExpressionAttributeValues: {
                    ":pk": `TENANT#${tenantId}`,
                    ":sk": "CATEGORY#",
                    ":active": "active"
                },
                ExpressionAttributeNames: { "#s": "status", "#n": "name" },
                ProjectionExpression: "id, #n, slug, parentId, sortOrder, productCount, imageLink, seoTitle, seoDescription",
                ExclusiveStartKey: startKey,
            }));
            items.push(...(page.Items || []));
            startKey = page.LastEvaluatedKey;
        } while (startKey);

        return {
            statusCode: 200,
            headers: { "Cache-Control": "public, max-age=60" },
            body: JSON.stringify({ items })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
