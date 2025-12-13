import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { TenantConfig, ContentItem } from "@amodx/shared";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const docClient = DynamoDBDocumentClient.from(client);

// Define a Result Type that handles both cases
export type ContentResult = ContentItem | { redirect: string };

// 1. Resolve Tenant
export async function getTenantConfig(identifier: string): Promise<TenantConfig | null> {
    if (!process.env.TABLE_NAME) return null;

    try {
        console.log(`[Dynamo] Lookup config for: ${identifier}`);

        // Try GSI (Domain)
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

        // Try PK (ID)
        const pkRes = await docClient.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${identifier}` }
        }));

        if (pkRes.Item) {
            return mapTenant(pkRes.Item);
        }

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

    // Parse links if stored as JSON string, or use as-is if object
    // DynamoDB might store arrays as Lists ("L"), which the DocumentClient unmarshalls to Arrays.
    // If they were saved as JSON strings (unlikely with DocumentClient but possible), parse them.
    // Based on your CSV, "navLinks" is a List of Maps: [{"M":{...}}].
    // DocumentClient handles this automatically.

    // Ensure header config defaults exist
    const header = item.header || { showLogo: true, showTitle: true };

    return {
        id: item.id,
        name: item.name || "Untitled Site",
        domain: item.Domain || item.domain,
        description: item.description || undefined,
        status: item.status || "LIVE",
        plan: item.plan || "Pro",

        logo: item.logo || undefined,
        icon: item.icon || undefined,
        header: header,
        navLinks: item.navLinks || [],
        footerLinks: item.footerLinks || [],

        theme: theme || {},
        integrations: item.integrations || {},
        createdAt: item.createdAt || new Date().toISOString()
    } as TenantConfig;
}

// 2. Fetch Content (Returns Union Type)
export async function getContentBySlug(tenantId: string, slug: string): Promise<ContentResult | null> {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    try {
        const routeRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: `ROUTE#${slug}` }
        }));

        if (!routeRes.Item) return null;

        // Handle Redirects
        if (routeRes.Item.IsRedirect) {
            return { redirect: routeRes.Item.RedirectTo };
        }

        const nodeId = routeRes.Item.TargetNode;
        const contentRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId.replace("NODE#", "")}#LATEST` }
        }));

        if (!contentRes.Item) return null;

        return contentRes.Item as ContentItem;
    } catch (error) {
        console.error("DynamoDB Content Error:", error);
        return null;
    }
}
