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
    redirect?: string;
};

// 1. Resolve Domain -> Tenant Config
export async function getTenantConfig(domain: string): Promise<TenantConfig | null> {
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
            FilterExpression: "begins_with(SK, :tenant)",
            ExpressionAttributeNames: { "#d": "Domain" },
            ExpressionAttributeValues: {
                ":d": domain,
                ":tenant": "TENANT#"
            },
        });

        const response = await docClient.send(command);
        console.log("DYNAMO RAW RESPONSE:", JSON.stringify(response.Items, null, 2));
        if (!response.Items || response.Items.length === 0) return null;

        const item = response.Items[0];

        // SAFETY CHECK: Ensure theme is an object
        let theme = item.theme;
        if (typeof theme === 'string') {
            try { theme = JSON.parse(theme); } catch (e) { theme = {}; }
        }

        // Extract tenant ID from the 'id' field, fallback to SK parsing
        const tenantId = item.id || item.SK?.replace("TENANT#", "") || "";

        return {
            id: tenantId,
            name: item.name || "Untitled Site",
            domain: item.Domain,
            theme: theme || { primaryColor: "#000000" }
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

    console.log(` [Content] Looking up Route: TENANT#${tenantId} / ROUTE#${slug}`);

    try {
        // Step A: Find the Route (Slug -> NodeID)
        const routeRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `ROUTE#${slug}`
            }
        }));

        if (!routeRes.Item) {
            console.warn(` [Content] Route not found for slug: ${slug}`);
            return null;
        }

        // --- Handle Redirects ---
        if (routeRes.Item.IsRedirect && routeRes.Item.RedirectTo) {
            console.log(` [Content] Redirect found: ${slug} -> ${routeRes.Item.RedirectTo}`);
            return {
                title: "",
                blocks: [],
                redirect: routeRes.Item.RedirectTo // Return the destination
            };
        }

        const nodeId = routeRes.Item.TargetNode; // e.g. "NODE#123"
        console.log(` [Content] Found Node: ${nodeId}. Fetching Content...`);

        // Step B: Find the Content (NodeID -> Blocks)
        const contentRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: {
                PK: `TENANT#${tenantId}`,
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
