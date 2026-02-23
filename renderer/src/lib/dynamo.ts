import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { TenantConfig, ContentItem, Product, Category, URL_PREFIX_DEFAULTS } from "@amodx/shared";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const docClient = DynamoDBDocumentClient.from(client);

/** Check if a product is within its availability date window */
function isProductAvailable(p: { availableFrom?: string; availableUntil?: string }): boolean {
    if (!p.availableFrom && !p.availableUntil) return true;
    const now = new Date().toISOString().split("T")[0];
    if (p.availableFrom && now < p.availableFrom) return false;
    if (p.availableUntil && now > p.availableUntil) return false;
    return true;
}

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

        commerceEnabled: item.commerceEnabled ?? false,
        commerceBar: item.commerceBar || undefined,
        searchBar: item.searchBar || undefined,
        commerceStrings: item.commerceStrings || undefined,
        currency: item.currency || undefined,
        askBirthdayOnAccount: item.askBirthdayOnAccount ?? true,
        askBirthdayOnCheckout: item.askBirthdayOnCheckout ?? true,
        companyDetails: item.companyDetails || undefined,
        gdpr: item.gdpr || undefined,
        hideSocialSharing: item.hideSocialSharing ?? false,
        homePageSlug: item.homePageSlug || undefined,
        legalLinks: item.legalLinks || undefined,
        theme: theme || {},
        integrations: item.integrations || {},
        urlPrefixes: item.urlPrefixes || URL_PREFIX_DEFAULTS,
        quickContact: item.quickContact || undefined,
        topBar: item.topBar || undefined,
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

// 4. Fetch Product by Slug (via GSI_Slug)
export async function getProductBySlug(tenantId: string, slug: string): Promise<Product | null> {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            IndexName: "GSI_Slug",
            KeyConditionExpression: "TenantSlug = :ts",
            ExpressionAttributeValues: { ":ts": `${tenantId}#${slug}` },
        }));

        const product = result.Items?.find((item: any) => item.SK?.startsWith("PRODUCT#"));
        if (!product) return null;
        if (!isProductAvailable(product as any)) return null;
        return product as Product;
    } catch (error) {
        console.error("DynamoDB Product Slug Error:", error);
        return null;
    }
}

// 5. Fetch Category by Slug (via GSI_Slug)
export async function getCategoryBySlug(tenantId: string, slug: string): Promise<Category | null> {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            IndexName: "GSI_Slug",
            KeyConditionExpression: "TenantSlug = :ts",
            ExpressionAttributeValues: { ":ts": `${tenantId}#${slug}` },
        }));

        const category = result.Items?.find((item: any) => item.SK?.startsWith("CATEGORY#"));
        if (!category) return null;
        return category as Category;
    } catch (error) {
        console.error("DynamoDB Category Slug Error:", error);
        return null;
    }
}

// 6. Fetch Products by Category via CATPROD# adjacency items (O(n) where n = products in category)
export async function getProductsByCategory(tenantId: string, categoryId: string, page: number = 1, limit: number = 24) {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return { items: [], total: 0 };

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `CATPROD#${categoryId}#`,
            },
        }));

        const allProducts = (result.Items || [])
            // Filter out non-active products (draft, etc.) - only show active or items without status (legacy)
            .filter((p: any) => !p.status || p.status === "active")
            .filter((p: any) => isProductAvailable(p))
            .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
        const start = (page - 1) * limit;
        const items = allProducts.slice(start, start + limit);

        return { items, total: allProducts.length };
    } catch (error) {
        console.error("DynamoDB Products by Category Error:", error);
        return { items: [], total: 0 };
    }
}

// 7. Fetch All Categories (for navigation)
export async function getAllCategories(tenantId: string): Promise<Category[]> {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return [];

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "#s = :active",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "CATEGORY#",
                ":active": "active"
            },
            ExpressionAttributeNames: { "#s": "status", "#n": "name" },
            ProjectionExpression: "id, #n, slug, parentId, sortOrder, productCount, imageLink, seoTitle, seoDescription",
        }));

        return (result.Items || []).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)) as Category[];
    } catch (error) {
        console.error("DynamoDB Categories Error:", error);
        return [];
    }
}

// 8. Fetch All Active Products (for shop page)
export async function getActiveProducts(tenantId: string, page: number = 1, limit: number = 24, availability?: string) {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return { items: [], total: 0 };

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "#s = :active",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "PRODUCT#",
                ":active": "active"
            },
            ExpressionAttributeNames: { "#s": "status" },
            ProjectionExpression: "id, title, slug, price, currency, salePrice, availability, imageLink, tags, categoryIds, sortOrder, volumePricing, availableFrom, availableUntil"
        }));

        let allProducts = (result.Items || [])
            .filter((p: any) => isProductAvailable(p))
            .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));

        // Filter by availability if specified (e.g., "in_stock")
        if (availability) {
            allProducts = allProducts.filter((p: any) => p.availability === availability);
        }

        const start = (page - 1) * limit;
        const items = allProducts.slice(start, start + limit);

        return { items, total: allProducts.length };
    } catch (error) {
        console.error("DynamoDB Active Products Error:", error);
        return { items: [], total: 0 };
    }
}

// Search products by text query (title, description, sku, tags)
export async function searchProducts(tenantId: string, query: string, page: number = 1, limit: number = 24) {
    const tableName = process.env.TABLE_NAME;
    if (!tableName || !query.trim()) return { items: [], total: 0 };

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "#s = :active",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "PRODUCT#",
                ":active": "active"
            },
            ExpressionAttributeNames: { "#s": "status" },
            ProjectionExpression: "id, title, slug, price, currency, salePrice, availability, imageLink, tags, categoryIds, sortOrder, volumePricing, availableFrom, availableUntil, description, sku"
        }));

        const searchLower = query.toLowerCase();
        const allProducts = (result.Items || [])
            .filter((p: any) => isProductAvailable(p))
            .filter((p: any) => {
                const title = (p.title || "").toLowerCase();
                const desc = (p.description || "").toLowerCase();
                const sku = (p.sku || "").toLowerCase();
                const tags = (p.tags || []).join(" ").toLowerCase();
                return title.includes(searchLower) || desc.includes(searchLower) ||
                       sku.includes(searchLower) || tags.includes(searchLower);
            })
            .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));

        const start = (page - 1) * limit;
        const items = allProducts.slice(start, start + limit);

        return { items, total: allProducts.length };
    } catch (error) {
        console.error("DynamoDB Search Error:", error);
        return { items: [], total: 0 };
    }
}

// 9. Fetch Delivery Config
export async function getDeliveryConfig(tenantId: string) {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    try {
        const result = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: "DELIVERYCONFIG#default" }
        }));
        return result.Item || null;
    } catch (error) {
        console.error("DynamoDB DeliveryConfig Error:", error);
        return null;
    }
}

// 10. Fetch Order for Customer (public - requires email match)
export async function getOrderForCustomer(tenantId: string, orderId: string, email: string) {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    try {
        const result = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: `ORDER#${orderId}` }
        }));

        if (!result.Item) return null;
        if (result.Item.customerEmail !== email) return null;

        const { internalNotes, ...order } = result.Item;
        return order;
    } catch (error) {
        console.error("DynamoDB Order Error:", error);
        return null;
    }
}

// 11. Fetch approved reviews for a product
export async function getProductReviews(tenantId: string, productId: string) {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return { items: [], averageRating: 0, totalReviews: 0 };

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "#s = :approved",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `REVIEW#${productId}#`,
                ":approved": "approved",
            },
            ExpressionAttributeNames: { "#s": "status" },
            ProjectionExpression: "id, authorName, rating, content, source, createdAt",
        }));

        const items = (result.Items || []).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const totalReviews = items.length;
        const averageRating = totalReviews > 0 ? Math.round((items.reduce((s: number, r: any) => s + r.rating, 0) / totalReviews) * 10) / 10 : 0;

        return { items, averageRating, totalReviews };
    } catch (error) {
        console.error("DynamoDB Reviews Error:", error);
        return { items: [], averageRating: 0, totalReviews: 0 };
    }
}

// 12. Fetch customer orders by email (CUSTORDER# adjacency)
export async function getCustomerOrders(tenantId: string, email: string) {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return [];

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `CUSTORDER#${email.toLowerCase()}#`,
            },
            ProjectionExpression: "orderNumber, total, #s, createdAt, SK",
            ExpressionAttributeNames: { "#s": "status" },
        }));

        return (result.Items || [])
            .map((item: any) => ({
                orderNumber: item.orderNumber,
                total: item.total,
                status: item.status,
                createdAt: item.createdAt,
                orderId: item.SK.split("#").pop(),
            }))
            .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (error) {
        console.error("DynamoDB Customer Orders Error:", error);
        return [];
    }
}

// 13. Fetch customer profile by email
export async function getCustomerProfile(tenantId: string, email: string) {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    try {
        const result = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: `CUSTOMER#${email.toLowerCase()}` },
            ProjectionExpression: "email, #n, phone, defaultAddress",
            ExpressionAttributeNames: { "#n": "name" },
        }));
        return result.Item || null;
    } catch (error) {
        console.error("DynamoDB Customer Profile Error:", error);
        return null;
    }
}

export async function getPosts(tenantId: string, tag?: string, limit: number = 6) {
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

        if (tag && tag.trim() !== "") {
            params.FilterExpression += " AND contains(tags, :tag)";
            params.ExpressionAttributeValues[":tag"] = tag.trim();
        }

        const result = await docClient.send(new QueryCommand(params));
        let items = result.Items || [];

        // Filter LATEST
        items = items.filter((item: any) => item.SK.endsWith("#LATEST"));

        // Sort Date Desc
        items.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Limit
        if (limit > 0) {
            items = items.slice(0, limit);
        }

        return items.map((p: any) => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            featuredImage: p.featuredImage,
            seoDescription: p.seoDescription,
            tags: p.tags,
            createdAt: p.createdAt
        }));

    } catch (e) {
        console.error("DynamoDB Posts Error:", e);
        return [];
    }
}

// 12. Fetch Form Definition by Slug
export async function getFormBySlug(tenantId: string, slug: string) {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) return null;

    try {
        // Lookup form ID via FORMSLUG#
        const slugRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: `FORMSLUG#${slug}` }
        }));

        if (!slugRes.Item?.formId) return null;

        // Fetch full form definition
        const formRes = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { PK: `TENANT#${tenantId}`, SK: `FORM#${slugRes.Item.formId}` }
        }));

        if (!formRes.Item || formRes.Item.status !== "active") return null;
        return formRes.Item;
    } catch (error) {
        console.error("DynamoDB Form Error:", error);
        return null;
    }
}

// Check if tenant has any active popups (lightweight, Limit 1)
export async function hasActivePopups(tenantId: string): Promise<boolean> {
    const tableName = process.env.TABLE_NAME || process.env.NEXT_PUBLIC_TABLE_NAME || "amodx-table";
    try {
        const res = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "#s = :active",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "POPUP#",
                ":active": "active",
            },
            Limit: 1,
            ProjectionExpression: "id",
        }));
        return (res.Items?.length ?? 0) > 0;
    } catch {
        return false;
    }
}
