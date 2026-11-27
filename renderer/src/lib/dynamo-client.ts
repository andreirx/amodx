import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
export const docClient = DynamoDBDocumentClient.from(client);

/**
 * The DynamoDB table every helper in this file reads, or an error.
 *
 * Not configurable, not defaulted, never absent-shaped: a renderer with no `TABLE_NAME`
 * cannot answer "does this record exist?", so it must not answer "no". See the file header.
 * Call this BEFORE any legitimate empty-input short-circuit (e.g. a blank search query), so
 * a misconfigured deployment can never hide behind an empty-looking result.
 */
export function requireTableName(): string {
    const table = process.env.TABLE_NAME;
    if (!table) {
        throw new Error(
            "TABLE_NAME is not set: the renderer cannot read tenant data. This is a deployment " +
            "misconfiguration, not an empty result — failing the render so nothing is cached.",
        );
    }
    return table;
}
