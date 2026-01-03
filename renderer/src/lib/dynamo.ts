import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { TenantConfig, ContentItem, Product } from "@amodx/shared";

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

// 2. Fetch Content (Updated for new Schema)
export async function getContentBySlug(tenantId: string, slug: string): Promise<ContentResult | null> {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    try {
        const routeRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: `ROUTE#${slug}` }
        }));

        if (!routeRes.Item) return null;

        if (routeRes.Item.IsRedirect) {
            return { redirect: routeRes.Item.RedirectTo };
        }

        const nodeId = routeRes.Item.TargetNode;
        const contentRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId.replace("NODE#", "")}#LATEST` }
        }));

        if (!contentRes.Item) return null;

        const item = contentRes.Item;

        // Ensure Access Policy exists (Fallback to Public)
        const accessPolicy = item.accessPolicy || { type: 'Public', currency: 'USD' };

        return {
            ...item,
            accessPolicy,
            status: item.status || "Draft",
            commentsMode: item.commentsMode || "Hidden"
        } as ContentItem;

    } catch (error) {
        console.error("DynamoDB Content Error:", error);
        return null;
    }
}

// 3. Fetch Product
export async function getProductById(tenantId: string, productId: string): Promise<Product | null> {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    try {
        const result = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `PRODUCT#${productId}`
            }
        }));

        if (!result.Item) return null;

        return result.Item as Product;
    } catch (error) {
        console.error("DynamoDB Product Error:", error);
        return null;
    }
}

export async function getPostsByTag(tenantId: string, tag: string, limit = 6) {
    if (!process.env.TABLE_NAME) return [];

    try {
        // Query CONTENT items for this tenant
        // Optimization: In V2, add a GSI for "Tags" to avoid Scan/Filter overhead
        // For V1 (Small sites), we query all content and filter in memory or via FilterExpression

        const params: any = {
            TableName: process.env.TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "CONTENT#",
                ":pub": "Published"
            },
            FilterExpression: "#s = :pub",
            ExpressionAttributeNames: { "#s": "status" }
        };

        if (tag) {
            params.FilterExpression += " AND contains(tags, :tag)";
            params.ExpressionAttributeValues[":tag"] = tag;
        }

        const result = await docClient.send(new QueryCommand(params));
        const items = result.Items || [];

        // Sort: Newest First
        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return items.slice(0, limit);

    } catch (e) {
        console.error("Failed to fetch posts", e);
        return [];
    }
}
