// Renderer read layer. Every function here is reachable from a render.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// FAILED READS MUST THROW (slice cache-1, human decision CACHE-1-D4, 2026-07-26)
// ─────────────────────────────────────────────────────────────────────────────────────
//
// Not one function in this file may catch an AWS/SDK error and return `null`, `[]`, or a
// zero-filled aggregate. A `null` / empty result means ONE thing: the record genuinely is
// not there.
//
// WHY, precisely: `cache-1` put the public routes into Next's ISR mode, where a successful
// render is stored — by OpenNext in S3 and by CloudFront — with `s-maxage=31536000`. In
// that mode a thrown render error is the *only* outcome that is never stored (measured;
// docs/caching-architecture.md § "Which render outcomes are cacheable"). So a swallowed
// DynamoDB error does not degrade one request: it renders a *plausible* page — a catalogue
// with no products, an article page with no reviews, a blog index with no posts, a sitemap
// listing nothing — and that page is then pinned at the edge for a year. A transient AWS
// blip becomes durable wrong content that only a manual invalidation clears. Letting the
// error propagate turns the same blip back into what it is: a transient 500 that stores
// nothing and self-heals on the next request.
//
// ACCEPTED CONSEQUENCE (ratified): during an AWS failure the dynamic twin and the /api
// routes answer HTTP 500 instead of rendering a silently-empty section. That is the
// intended trade — an honest 500 over durable incorrect HTML.
//
// A MISSING `TABLE_NAME` IS A READ FAILURE TOO (review-1, 2026-07-26). It used to return
// `null` / `[]` from every helper: a *configuration* predicate, evaluated before any I/O —
// but the artefact it produces is indistinguishable from the one above, and worse, because
// the cause is not transient. An unset TABLE_NAME on a deployed renderer would render, and
// then pin for a year, a not-found shell for the entire estate. So it throws, from one
// place: `requireTableName()`. CDK always sets it (infra/lib/renderer-hosting.ts); local
// `next dev` without it now fails loudly on the first page instead of silently serving an
// empty site.
//
// The rule reaches `app/api/posts/route.ts` too — it is a read path, so a failure there is
// a 500 and `{items: []}` means the query matched nothing. Two read paths keep different
// internals on purpose:
//   - `lib/tenant-directory.ts` (middleware host gate) fails OPEN by design — it runs
//     before the render and a blip there must degrade to "render it", not to "404 every
//     tenant at once". The render then repeats the lookup and throws, so the failure is
//     still surfaced, just one layer later.
//   - `lib/api-client.ts` (Secrets Manager key fetch) returns "" on failure; its callers
//     forward the empty key, the backend rejects it, and the route returns that non-2xx
//     status — so no 200-with-empty-data is produced either way. Reached only from `/api/*`
//     handlers; verified by grep over `renderer/src`: `getRendererKey`/`getMasterKey` have
//     no callers under `app/[siteId]/` or `components/`.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { TenantConfig, ContentItem, Product, Category, URL_PREFIX_DEFAULTS, normalizeEmail } from "@amodx/shared";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const docClient = DynamoDBDocumentClient.from(client);

/**
 * The DynamoDB table every helper in this file reads, or an error.
 *
 * Not configurable, not defaulted, never absent-shaped: a renderer with no `TABLE_NAME`
 * cannot answer "does this record exist?", so it must not answer "no". See the file header.
 * Call this BEFORE any legitimate empty-input short-circuit (e.g. a blank search query), so
 * a misconfigured deployment can never hide behind an empty-looking result.
 */
function requireTableName(): string {
    const table = process.env.TABLE_NAME;
    if (!table) {
        throw new Error(
            "TABLE_NAME is not set: the renderer cannot read tenant data. This is a deployment " +
            "misconfiguration, not an empty result — failing the render so nothing is cached.",
        );
    }
    return table;
}

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
// Failed reads throw — see the file header. Here `null` means "no such tenant", which every
// caller turns into a not-found; a caught error returning `null` would pin "Site Not Found"
// at the edge for a live tenant on one transient blip.
export async function getTenantConfig(identifier: string): Promise<TenantConfig | null> {
    const tableName = requireTableName();

    console.log(`[Dynamo] Lookup config for: ${identifier}`);

    // Try GSI (Domain)
    const gsiRes = await docClient.send(new QueryCommand({
        TableName: tableName,
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
        TableName: tableName,
        Key: { PK: "SYSTEM", SK: `TENANT#${identifier}` }
    }));

    if (pkRes.Item) {
        return mapTenant(pkRes.Item);
    }

    return null;
}


function mapTenant(item: any): TenantConfig {
    let theme = item.theme;
    if (typeof theme === 'string') {
        // Not a read failure: the record was already retrieved successfully. This tolerates a
        // legacy shape (theme persisted as a JSON string), so it stays a catch.
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
        pageEffect: item.pageEffect || undefined,
        celebrationEnabled: item.celebrationEnabled ?? false,
        createdAt: item.createdAt || new Date().toISOString()
    } as TenantConfig;
}

// 2. Fetch Content (Updated for new Schema)
export async function getContentBySlug(tenantId: string, slug: string): Promise<ContentResult | null> {
    const tableName = requireTableName();

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
}

// 3. Fetch Product
export async function getProductById(tenantId: string, productId: string): Promise<Product | null> {
    const tableName = requireTableName();

    const result = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: {
            PK: `TENANT#${tenantId}`,
            SK: `PRODUCT#${productId}`
        }
    }));

    if (!result.Item) return null;

    return result.Item as Product;
}

// 4. Fetch Product by Slug (via GSI_Slug)
export async function getProductBySlug(tenantId: string, slug: string): Promise<Product | null> {
    const tableName = requireTableName();

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
}

// 5. Fetch Category by Slug (via GSI_Slug)
export async function getCategoryBySlug(tenantId: string, slug: string): Promise<Category | null> {
    const tableName = requireTableName();

    const result = await docClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: "GSI_Slug",
        KeyConditionExpression: "TenantSlug = :ts",
        ExpressionAttributeValues: { ":ts": `${tenantId}#${slug}` },
    }));

    const category = result.Items?.find((item: any) => item.SK?.startsWith("CATEGORY#"));
    if (!category) return null;
    return category as Category;
}

// 6. Fetch Products by Category via CATPROD# adjacency items (O(n) where n = products in category)
export async function getProductsByCategory(tenantId: string, categoryId: string, page: number = 1, limit: number = 24) {
    const tableName = requireTableName();

    // Paginate through all results
    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `CATPROD#${categoryId}#`,
            },
            ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const allProducts = allItems
        // Filter out non-active products (draft, etc.) - only show active or items without status (legacy)
        .filter((p: any) => !p.status || p.status === "active")
        .filter((p: any) => isProductAvailable(p))
        .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const start = (page - 1) * limit;
    const items = allProducts.slice(start, start + limit);

    return { items, total: allProducts.length };
}

// 7. Fetch All Categories (for navigation)
export async function getAllCategories(tenantId: string): Promise<Category[]> {
    const tableName = requireTableName();

    // Paginate through all results
    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
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
            ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allItems.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)) as Category[];
}

// 8. Fetch All Active Products (for shop page)
export async function getActiveProducts(tenantId: string, page: number = 1, limit: number = 24, availability?: string) {
    const tableName = requireTableName();

    // Paginate through all results
    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
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
            ProjectionExpression: "id, title, slug, price, currency, salePrice, availability, imageLink, tags, categoryIds, sortOrder, volumePricing, availableFrom, availableUntil",
            ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    let allProducts = allItems
        .filter((p: any) => isProductAvailable(p))
        .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));

    // Filter by availability if specified (e.g., "in_stock")
    if (availability) {
        allProducts = allProducts.filter((p: any) => p.availability === availability);
    }

    const start = (page - 1) * limit;
    const items = allProducts.slice(start, start + limit);

    return { items, total: allProducts.length };
}

// Search products by text query (title, description, sku, tags)
export async function searchProducts(tenantId: string, query: string, page: number = 1, limit: number = 24) {
    // Configuration first, then the legitimate empty input: a blank query genuinely has no
    // matches, a missing table cannot know that.
    const tableName = requireTableName();
    if (!query.trim()) return { items: [], total: 0 };

    // Paginate through all results
    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
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
            ProjectionExpression: "id, title, slug, price, currency, salePrice, availability, imageLink, tags, categoryIds, sortOrder, volumePricing, availableFrom, availableUntil, description, sku",
            ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const searchLower = query.toLowerCase();
    const allProducts = allItems
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
}

// 9. Fetch Delivery Config
export async function getDeliveryConfig(tenantId: string) {
    const tableName = requireTableName();

    const result = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `TENANT#${tenantId}`, SK: "DELIVERYCONFIG#default" }
    }));
    return result.Item || null;
}

// 10. Fetch Order for Customer (public - requires email match)
export async function getOrderForCustomer(tenantId: string, orderId: string, email: string) {
    const tableName = requireTableName();

    const result = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `TENANT#${tenantId}`, SK: `ORDER#${orderId}` }
    }));

    if (!result.Item) return null;
    if (result.Item.customerEmail !== email) return null;

    const { internalNotes, ...order } = result.Item;
    return order;
}

// 11. Fetch approved reviews for a product
export async function getProductReviews(tenantId: string, productId: string) {
    const tableName = requireTableName();

    // Paginate through all results
    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "#s = :approved",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `REVIEW#${productId}#`,
                ":approved": "approved",
            },
            ExpressionAttributeNames: { "#s": "status", "#src": "source" },
            ProjectionExpression: "id, authorName, rating, content, #src, createdAt",
            ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const items = allItems.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const totalReviews = items.length;
    const averageRating = totalReviews > 0 ? Math.round((items.reduce((s: number, r: any) => s + r.rating, 0) / totalReviews) * 10) / 10 : 0;

    return { items, averageRating, totalReviews };
}

// 12. Fetch customer orders by email (CUSTORDER# adjacency)
export async function getCustomerOrders(tenantId: string, email: string) {
    const tableName = requireTableName();

    // Paginate through all results
    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `CUSTORDER#${normalizeEmail(email)}#`,
            },
            ProjectionExpression: "orderNumber, total, #s, createdAt, SK",
            ExpressionAttributeNames: { "#s": "status" },
            ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allItems
        .map((item: any) => ({
            orderNumber: item.orderNumber,
            total: item.total,
            status: item.status,
            createdAt: item.createdAt,
            orderId: item.SK.split("#").pop(),
        }))
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// 13. Fetch customer profile by email
export async function getCustomerProfile(tenantId: string, email: string) {
    const tableName = requireTableName();

    const result = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `TENANT#${tenantId}`, SK: `CUSTOMER#${normalizeEmail(email)}` },
        ProjectionExpression: "email, #n, phone, birthday, defaultAddress",
        ExpressionAttributeNames: { "#n": "name" },
    }));
    return result.Item || null;
}

export async function getPosts(tenantId: string, tag?: string, limit: number = 6) {
    const tableName = requireTableName();

    // Query CONTENT items for this tenant
    // Optimization: In V2, add a GSI for "Tags" to avoid Scan/Filter overhead
    // For V1 (Small sites), we query all content and filter in memory or via FilterExpression

    const params: any = {
        TableName: tableName,
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

    // Paginate through all results (DynamoDB returns max 1MB per query)
    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
        const result = await docClient.send(new QueryCommand({
            ...params,
            ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Filter LATEST
    let items = allItems.filter((item: any) => item.SK.endsWith("#LATEST"));

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
}

// 12. Fetch all published content for SEO routes (sitemap, llms.txt)
export async function getPublishedContent(tenantId: string) {
    const tableName = requireTableName();

    const allItems: any[] = [];
    let lastKey: any = undefined;

    // Paginate through all results (DynamoDB returns max 1MB per query)
    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "CONTENT#",
                ":pub": "Published"
            },
            FilterExpression: "#s = :pub",
            ExpressionAttributeNames: { "#s": "status" },
            ProjectionExpression: "SK, id, title, slug, seoDescription, createdAt, updatedAt, #s",
            ExclusiveStartKey: lastKey,
        }));

        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Filter only LATEST versions
    const items = allItems.filter((item: any) => item.SK?.endsWith("#LATEST"));

    return items.map((p: any) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        seoDescription: p.seoDescription,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
    }));
}

// 13. Fetch all active products for SEO feed (openai-feed)
export async function getProductsForFeed(tenantId: string) {
    const tableName = requireTableName();

    // Paginate through all results
    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "#s = :active",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "PRODUCT#",
                ":active": "active"
            },
            ExpressionAttributeNames: { "#s": "status", "#c": "condition" },
            // All fields needed for product feed
            ProjectionExpression: "id, title, description, slug, price, currency, salePrice, availability, imageLink, additionalImageLinks, brand, #c, availableFrom, availableUntil",
            ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allItems
        .filter((p: any) => isProductAvailable(p))
        .map((p: any) => ({
            id: p.id,
            title: p.title,
            description: p.description,
            slug: p.slug,
            price: p.price,
            currency: p.currency,
            salePrice: p.salePrice,
            availability: p.availability,
            imageLink: p.imageLink,
            additionalImageLinks: p.additionalImageLinks,
            brand: p.brand,
            condition: p.condition
        }));
}

// 14. Fetch Form Definition by Slug
export async function getFormBySlug(tenantId: string, slug: string) {
    const tableName = requireTableName();

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
}

// Check if tenant has any active popups (lightweight, Limit 1).
// Called from `[siteId]/layout.tsx`, i.e. on the cacheable path: a swallowed error here
// pinned a year-long render with the tenant's popups silently switched off.
export async function hasActivePopups(tenantId: string): Promise<boolean> {
    // No `NEXT_PUBLIC_TABLE_NAME`/`"amodx-table"` fallback: guessing a table name is worse
    // than failing — it either reads the wrong tenant estate or reports "no popups" from a
    // table that does not exist, and that answer would be cached (review-1, 2026-07-26).
    const tableName = requireTableName();
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
}
