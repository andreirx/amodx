import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ContentItemSchema } from "@amodx/shared";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = "DEMO";
        const nodeId = event.pathParameters?.id;

        if (!nodeId || !event.body) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing ID or Body" }) };
        }

        const body = JSON.parse(event.body);

        // Validate input (Partial update allowed)
        // We expect { title, blocks, status }
        const input = ContentItemSchema.pick({
            title: true,
            blocks: true,
            status: true
        }).partial().parse(body);

        // Dynamic Update Expression builder
        let updateExp = "SET updatedAt = :now";
        const expValues: any = { ":now": new Date().toISOString() };
        const expNames: any = {};

        if (input.title) {
            updateExp += ", title = :t";
            expValues[":t"] = input.title;
        }
        if (input.blocks) {
            updateExp += ", blocks = :b";
            expValues[":b"] = input.blocks;
        }
        if (input.status) {
            updateExp += ", #s = :s"; // 'status' is reserved keyword in DynamoDB
            expValues[":s"] = input.status;
            expNames["#s"] = "status";
        }

        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `SITE#${tenantId}`,
                SK: `CONTENT#${nodeId}#LATEST`,
            },
            UpdateExpression: updateExp,
            ExpressionAttributeValues: expValues,
            ExpressionAttributeNames: Object.keys(expNames).length > 0 ? expNames : undefined,
        }));

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Updated successfully" }),
        };

    } catch (error: any) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
