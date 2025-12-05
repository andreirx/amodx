import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});

// The DocumentClient automatically marshalls JSON to DynamoDB format
export const db = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
        removeUndefinedValues: true, // Clean up JSON before saving
    },
});

export const TABLE_NAME = process.env.TABLE_NAME || "";
