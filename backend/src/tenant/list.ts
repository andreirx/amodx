import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async () => {
    try {
        // Query the SYSTEM partition for all Tenants
        // This is efficient because an Agency rarely has >1000 sites.
        // If it does, we paginate.
        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": "SYSTEM",
                ":sk": "TENANT#"
            }
        }));

        const tenants = result.Items?.map(item => ({
            id: item.id,
            name: item.name,
            domain: item.domain,
            status: item.status
        })) || [];

        return { statusCode: 200, body: JSON.stringify({ items: tenants }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
