import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

// Initialize the client
// Region is automatically picked up in AWS Lambda.
// Locally, it reads from your ~/.aws/credentials if you have the profile set up.
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || "AMODX-Table";

export type TenantConfig = {
    tenantId: string;
    name: string;
    theme: Record<string, string>;
    domain: string;
};

export type ContentItem = {
    id: string;
    title: string;
    slug: string;
    blocks: any[]; // We will define strict types later
    accessPolicy?: {
        type: "Public" | "Private";
        price?: number;
    };
};

/**
 * CACHE STRATEGY:
 * We use React's 'cache' function (request memoization) implicitly via Next.js
 * data fetching, but we wrap these database calls to be reusable.
 */

// 1. Resolve Domain -> Tenant Config
export async function getTenantConfig(domain: string): Promise<TenantConfig | null> {
    // In a real scenario, we query the GSI_Domain index
    // PK: TENANT#<id>  SK: CONFIG  (Attribute: domain)
    // For now, to validate the architecture, we mock this if env is missing,
    // or query if table exists.

    if (!process.env.TABLE_NAME) {
        console.warn("No TABLE_NAME env. Returning mock config.");
        return {
            tenantId: "mock-tenant",
            name: "Local Dev Site",
            domain: domain,
            theme: { primary: "#000000" }
        };
    }

    try {
        const command = new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: "GSI_Domain", // You must create this GSI in your Infra definition
            KeyConditionExpression: "#d = :d",
            ExpressionAttributeNames: { "#d": "domain" },
            ExpressionAttributeValues: { ":d": domain },
        });

        const response = await docClient.send(command);
        if (!response.Items || response.Items.length === 0) return null;

        return response.Items[0] as TenantConfig;
    } catch (error) {
        console.error("DynamoDB Error:", error);
        return null;
    }
}

// 2. Fetch Content
export async function getContentBySlug(tenantId: string, slug: string): Promise<ContentItem | null> {
    // PK: TENANT#<id>
    // SK: CONTENT#<slug>

    try {
        const command = new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `CONTENT#${slug}`,
            },
        });

        const response = await docClient.send(command);
        if (!response.Item) return null;

        return response.Item as ContentItem;
    } catch (error) {
        console.error("Error fetching content:", error);
        return null;
    }
}
