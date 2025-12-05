import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        // For MVP: Tenant is "DEMO". Later: event.requestContext.authorizer.jwt.claims.tenant_id
        const tenantId = "DEMO";

        // We want to list "Pages".
        // Since our Single Table stores everything, we rely on the GSI_Type
        // PK = Type ("Page"), SK = CreatedAt (for sorting)
        // Wait, our GSI definition in infra was:
        // PartitionKey: Type, SortKey: CreatedAt
        // BUT we need to filter by Tenant!

        // Correction: We cannot query *Just* Type='Page' globally, that would show EVERY client's pages.
        // We must Query by PK (Site) and Filter by Type, OR use a composite GSI.

        // OPTIMIZED QUERY STRATEGY:
        // Query the Main Table.
        // PK = SITE#DEMO
        // SK begins_with "CONTENT#"
        // This retrieves all content for this site. Efficient.

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `SITE#${tenantId}`,
                ":sk": "CONTENT#"
            }
        }));

        // Filter for only the "LATEST" versions to avoid showing history duplicates
        const items = result.Items?.filter(item => item.SK.includes("#LATEST")) || [];

        return {
            statusCode: 200,
            body: JSON.stringify({ items }),
        };

    } catch (error: any) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
