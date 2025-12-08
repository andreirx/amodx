import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

// Initialize the client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || "eu-central-1"
});
const docClient = DynamoDBDocumentClient.from(client);

// DEBUGGING: Log to see if env is loaded
console.log(" [DynamoDB] Table Name:", process.env.TABLE_NAME);

export type TenantConfig = {
    id: string;
    name: string;
    domain: string;
    theme: {
        primaryColor: string;
        fontHeading: string;
        fontBody: string;
    };
};

export type ContentItem = {
    title: string;
    blocks: any[];
};

// 1. Resolve Domain -> Tenant Config
export async function getTenantConfig(domain: string): Promise<TenantConfig | null> {
    // Mock for localhost development
    if (domain.includes("localhost")) {
        console.log(" [Router] Localhost detected, forcing DEMO tenant.");
        return {
            id: "DEMO", // <--- MUST MATCH BACKEND 'create.ts'
            name: "Local Dev Site",
            domain: "localhost",
            theme: { primaryColor: "#000000", fontHeading: "Inter", fontBody: "Inter" }
        };
    }

    // Real Production Lookup
    if (!process.env.TABLE_NAME) {
        console.error(" [CRITICAL] TABLE_NAME env var is missing!");
        return null;
    }

    try {
        const command = new QueryCommand({
            TableName: process.env.TABLE_NAME,
            IndexName: "GSI_Domain",
            KeyConditionExpression: "#d = :d",
            ExpressionAttributeNames: { "#d": "Domain" },
            ExpressionAttributeValues: { ":d": domain },
        });

        const response = await docClient.send(command);
        if (!response.Items || response.Items.length === 0) return null;

        const item = response.Items[0];
        return {
            id: item.PK.replace("SYSTEM", "").replace("SITE#", ""),
            name: item.name || "Untitled Site",
            domain: item.Domain,
            theme: item.theme || { primaryColor: "#000000" }
        };
    } catch (error) {
        console.error("DynamoDB Tenant Error:", error);
        return null;
    }
}

// 2. Fetch Content
export async function getContentBySlug(tenantId: string, slug: string): Promise<ContentItem | null> {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    console.log(` [Content] Looking up Route: SITE#${tenantId} / ROUTE#${slug}`);

    try {
        // Step A: Find the Route (Slug -> NodeID)
        const routeRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: {
                PK: `SITE#${tenantId}`, // <--- ALIGNED WITH BACKEND
                SK: `ROUTE#${slug}`
            }
        }));

        if (!routeRes.Item) {
            console.warn(` [Content] Route not found for slug: ${slug}`);
            return null;
        }

        const nodeId = routeRes.Item.TargetNode; // e.g. "NODE#123"
        console.log(` [Content] Found Node: ${nodeId}. Fetching Content...`);

        // Step B: Find the Content (NodeID -> Blocks)
        const contentRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: {
                PK: `SITE#${tenantId}`, // <--- ALIGNED WITH BACKEND
                SK: `CONTENT#${nodeId.replace("NODE#", "")}#LATEST`
            }
        }));

        if (!contentRes.Item) {
            console.warn(` [Content] Content item missing for node: ${nodeId}`);
            return null;
        }

        return {
            title: contentRes.Item.title,
            blocks: contentRes.Item.blocks || []
        };

    } catch (error) {
        console.error("DynamoDB Content Error:", error);
        return null;
    }
}
