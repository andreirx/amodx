import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const docClient = DynamoDBDocumentClient.from(client);

export type TenantConfig = {
    id: string;
    name: string;
    domain: string;
    theme: any;
};

export type ContentItem = {
    title: string;
    blocks: any[];
    redirect?: string;
};

// 1. Resolve Tenant (Domain OR ID)
export async function getTenantConfig(identifier: string): Promise<TenantConfig | null> {
    if (!process.env.TABLE_NAME) return null;

    try {
        console.log(`[Dynamo] Lookup config for: ${identifier}`);

        // STRATEGY 1: Try GSI (Domain Lookup) - Most common for public access
        const gsiRes = await docClient.send(new QueryCommand({
            TableName: process.env.TABLE_NAME,
            IndexName: "GSI_Domain",
            KeyConditionExpression: "#d = :d",
            FilterExpression: "begins_with(SK, :tenant)",
            ExpressionAttributeNames: { "#d": "Domain" },
            ExpressionAttributeValues: { ":d": identifier, ":tenant": "TENANT#" },
        }));

        if (gsiRes.Items && gsiRes.Items.length > 0) {
            return mapTenant(gsiRes.Items[0]);
        }

        // STRATEGY 2: Try Primary Key (ID Lookup) - For Preview Mode /_site/[ID]
        // We assume 'identifier' might be a Tenant ID
        const pkRes = await docClient.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: {
                PK: "SYSTEM",
                SK: `TENANT#${identifier}`
            }
        }));

        if (pkRes.Item) {
            return mapTenant(pkRes.Item);
        }

        console.warn(`[Dynamo] Tenant not found for: ${identifier}`);
        return null;

    } catch (error) {
        console.error("DynamoDB Tenant Error:", error);
        return null;
    }
}

function mapTenant(item: any): TenantConfig {
    let theme = item.theme;
    if (typeof theme === 'string') {
        try { theme = JSON.parse(theme); } catch (e) { theme = {}; }
    }
    return {
        id: item.id,
        name: item.name || "Untitled Site",
        domain: item.Domain || item.domain, // Handle case sensitivity
        theme: theme || { primaryColor: "#000000" }
    };
}

// 2. Fetch Content (Same as before, simplified for brevity)
export async function getContentBySlug(tenantId: string, slug: string): Promise<ContentItem | null> {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    try {
        // Find Route
        const routeRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: `ROUTE#${slug}` }
        }));

        if (!routeRes.Item) return null;

        if (routeRes.Item.IsRedirect) {
            return { title: "", blocks: [], redirect: routeRes.Item.RedirectTo };
        }

        // Find Content
        const nodeId = routeRes.Item.TargetNode;
        const contentRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId.replace("NODE#", "")}#LATEST` }
        }));

        if (!contentRes.Item) return null;

        return {
            title: contentRes.Item.title,
            blocks: contentRes.Item.blocks || []
        };
    } catch (error) {
        console.error("DynamoDB Content Error:", error);
        return null;
    }
}
