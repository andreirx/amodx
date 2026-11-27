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
import { TenantConfig, ContentItem, Product, Category, urlPrefixesOf, normalizeEmail, catalogListing, isProductAvailable as isAvailableOn, utcDay, normalizeLocale, resolveLocaleStrings, readLanguageSettings, pageLanguageOf, languageTagOf, localeLanguageSubtag } from "@amodx/shared";

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

/** Check if a product is within its availability date window today (UTC day). The rule is `@amodx/shared`'s
 *  `isProductAvailable` (CAT-IMPORT-PROFILE-1B moved it there for the admin preview); this binds it to the clock. */
function isProductAvailable(p: { availableFrom?: string; availableUntil?: string }): boolean {
    return isAvailableOn(p, utcDay(new Date()));
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


/** § 9.1: the stored `recaptcha` holds a non-empty site key AND a non-empty secret key (the backend's branch-1 test). */
function hasOwnRecaptchaPair(recaptcha: unknown): recaptcha is { siteKey: string; secretKey: string } {
    if (recaptcha === null || typeof recaptcha !== "object") return false;
    const r = recaptcha as { siteKey?: unknown; secretKey?: unknown };
    return typeof r.siteKey === "string" && r.siteKey !== "" && typeof r.secretKey === "string" && r.secretKey !== "";
}

/** The stored `integrations` without `mailerlite` (NEWSLETTER-1); absent → `{}` as before. */
function withoutMailerLite(integrations: any): any {
    if (!integrations || typeof integrations !== "object") return integrations || {};
    const { mailerlite: _secret, ...rest } = integrations;
    return rest;
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
        // LOCALE-1A: the fallback name is the site part's `untitledSiteName` in the tenant's language (§ 6.1).
        name: item.name || resolveLocaleStrings(item).strings.site.untitledSiteName,
        domain: item.Domain || item.domain,
        description: item.description || undefined,
        status: item.status || "LIVE",
        plan: item.plan || "Pro",

        logo: item.logo || undefined,
        icon: item.icon || undefined,
        header: header,
        // CAT-THEME-1: the footer's own width (`footer.contentMaxWidth`); absent stays absent (→ the header's width).
        footer: item.footer || undefined,
        navLinks: item.navLinks || [],
        footerLinks: item.footerLinks || [],

        commerceEnabled: item.commerceEnabled ?? false,
        // CATALOG-MODE-1: mapTenant is a whitelist, not a pass-through — without this line no render site sees the mode.
        catalogMode: item.catalogMode ?? false,
        commerceBar: item.commerceBar || undefined,
        searchBar: item.searchBar || undefined,
        commerceStrings: item.commerceStrings || undefined,
        // LOCALE-1A (docs/slices/locale-1.md § 3.2 item 4): the other two parts of the locale table and the language.
        // `locale` is NORMALISED here (§ 3.3), so every reader of `config.locale` — including the commerce readers that
        // this slice does not touch (`SitePage.tsx` checkout, confirmation, tracking, review dates) — receives a value
        // no formatter throws on; an absent or malformed value is "en-US", which those readers already used.
        catalogStrings: item.catalogStrings || undefined,
        siteStrings: item.siteStrings || undefined,
        locale: normalizeLocale(item.locale),
        // CMRC-COUNTIES-1: the tenant's country (country facts only — the checkout region list; texts are selected by
        // `locale`, never by country). Absent stays absent; readers apply `|| "EN"`.
        countryCode: item.countryCode || undefined,
        currency: item.currency || undefined,
        askBirthdayOnAccount: item.askBirthdayOnAccount ?? true,
        askBirthdayOnCheckout: item.askBirthdayOnCheckout ?? true,
        companyDetails: item.companyDetails || undefined,
        gdpr: item.gdpr || undefined,
        hideSocialSharing: item.hideSocialSharing ?? false,
        homePageSlug: item.homePageSlug || undefined,
        legalLinks: item.legalLinks || undefined,
        theme: theme || {},
        // NEWSLETTER-1 (ruling 7): the MailerLite connection holds a secret token and no renderer code reads it (the push
        // runs in the backend), so it is never mapped: not in the settings the renderer reads, not in any page payload.
        integrations: withoutMailerLite(item.integrations),
        // SCHED-1G2 (docs/slices/sched-1.md § 9.1, finding G8): the tenant's reCAPTCHA SITE key, ONLY when the stored
        // record has both keys — the condition under which the backend verifies with the tenant's secret
        // (`resolveRecaptchaConfig` branch 1, backend/src/lib/recaptcha.ts). Otherwise absent, and every page uses the
        // deployment key, which pairs with the deployment secret. The secret and the threshold are never mapped.
        ...(hasOwnRecaptchaPair(item.recaptcha) ? { recaptcha: { siteKey: item.recaptcha.siteKey } } : {}),
        // SCHED-1G3: the scheduling switch, read by the booking pages and the feed (`lib/booking-tenant.ts`). Mapped ONLY
        // when it is exactly `true`; absent or any other value stays absent (= off, § 4.1), so the mapped record of a
        // tenant without scheduling is unchanged. The other scheduling attributes are not mapped.
        ...(item.schedulingEnabled === true ? { schedulingEnabled: true } : {}),
        // SCHED-LABELS-1: the site's own booking-page texts, read only by `bookingTexts` (lib/booking-text.ts), which
        // ignores anything that is not an object of texts. Mapped only when present, so the mapped record of a tenant
        // without the attribute is unchanged.
        ...(item.bookingStrings ? { bookingStrings: item.bookingStrings } : {}),
        urlPrefixes: urlPrefixesOf(item.urlPrefixes),   // CDL-2 (§ 7.1): per key, the saved path, else the English default
        // LANG-1B (docs/slices/lang-1.md § 5.1, § 7.2): the extra languages and the menus per language, through the ONE
        // read rule the middleware's gate also applies (`readLanguageSettings`): invalid values dropped, never thrown. A
        // tenant without the fields gets `languages: []` and empty maps; legacy `navLinks` / `footerLinks` stay above.
        ...readLanguageSettings(item),
        quickContact: item.quickContact || undefined,
        // CAT-QUOTE-1 (CQ-IMPL-MAPTENANT = A): the visitor contact channels — the quote dialog and the bar fallbacks.
        contactChannels: item.contactChannels || undefined,
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

/**
 * FINDINGS-1 Part 3 (docs/slices/findings-1.md): a product item as the renderer's server components receive it —
 * without `resourceId`, which names the product's private file. No renderer code reads it; dropping it here means
 * a later `product={product}` on a client component cannot serialise it into the page.
 */
function withoutPrivateFile(item: Record<string, any>): Product {
    const { resourceId: _privateFile, ...rest } = item;
    return rest as Product;
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

    return withoutPrivateFile(result.Item);
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

    // FINDINGS-1 Part 3: only this tenant's product item, the check of `backend/src/products/public-get.ts`
    // (SETTINGS-KEYS-1B). Index key attributes are data, not proof of ownership.
    const product = result.Items?.find((item: any) => item.PK === `TENANT#${tenantId}` && item.SK?.startsWith("PRODUCT#"));
    if (!product) return null;
    if (!isProductAvailable(product as any)) return null;
    return withoutPrivateFile(product);
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

/** One category as `getActiveCategoriesByIds` returns it: the projected display fields, without `status`. */
type CategoryById = Pick<Category, "id" | "name" | "slug" | "description" | "imageLink">;

/**
 * 7b. SHOP-LOOK-1A (docs/slices/shop-look-1.md § 6.4; ruling SHOPLOOK-CATBAR = C) — the categories an owner picked by id,
 * in the order of `ids`. One `GetCommand` per id on `TENANT#<tenantId>` / `CATEGORY#<id>` (the key of
 * `backend/src/categories/create.ts`), so the cost is bounded: at most one request per id, no pagination. A category whose
 * `status` is not `active` is skipped (the "not listed" meaning of `hidden`, as `getAllCategories`); a missing one is
 * skipped. No ids → no request. Not `getAllCategories`: that one paginates over every category of the tenant and does not
 * project `description`. Users: the header's category bar (`app/[siteId]/layout.tsx`); the `categoryGrid` block of
 * `shop-look-1c` is the second, ratified user.
 */
export async function getActiveCategoriesByIds(tenantId: string, ids: string[]): Promise<CategoryById[]> {
    const tableName = requireTableName();
    const results = await Promise.all(ids.map((id) => docClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `TENANT#${tenantId}`, SK: `CATEGORY#${id}` },
        ProjectionExpression: "id, #n, slug, description, imageLink, #s",
        ExpressionAttributeNames: { "#n": "name", "#s": "status" },
    }))));
    return results.flatMap(({ Item }) => {
        if (!Item || Item.status !== "active") return [];
        const { status: _status, ...category } = Item;
        return [category as CategoryById];
    });
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

/**
 * CAT-FACETS-1 (spec docs/slices/cat-facets-1.md § 3.3 B, ruling CF1-DATA-PATH = B): the whole, unpaginated listing
 * of a CATALOG site's shop (`categoryId` absent) or category page, read from the tenant's `PRODUCT#` items so the
 * facet values and the card come from the same committed item. Called only under `isCatalogMode`; the non-catalog
 * shop and category pages keep `getActiveProducts` / `getProductsByCategory` (spec § 7).
 *
 * The membership, date and order rule below is `catalogListing` in `@amodx/shared` (CAT-IMPORT-PROFILE-1B moved it there,
 * unchanged — golden `packages/shared/test/fixtures/cat-import-profile-1b-baseline.json`); this function keeps the read.
 * Membership is what the two existing reads give (the two preservation obligations of § 3.3 B):
 *   - shop: `status === "active"` — the in-memory form of `getActiveProducts`' `FilterExpression #s = :active`
 *     (both are true exactly when the attribute exists and is the string "active");
 *   - category: `!status || status === "active"` (`getProductsByCategory`'s rule; a status-less legacy product is
 *     listed — its `CATPROD#` card carries `status || "active"`, `lib/catprod.ts`), and `categoryIds` contains the
 *     category id — the field the `CATPROD#<categoryId>#<id>` items are derived from;
 *   - both: `isProductAvailable`, then the `sortOrder` sort. Ties are broken by `id`: DynamoDB returns both item
 *     families in SK order, and both SKs end with the product id (`PRODUCT#<id>`, `CATPROD#<cat>#<id>`), so for
 *     ASCII ids this is the order the stable `sortOrder` sort already gives — stated explicitly so the order does
 *     not depend on the store's page order (serving-contract row `cf1-order`).
 * The projection is `getActiveProducts`' card fields plus `status` (the in-memory rule needs it) and the three facet
 * sources `brand`, `attributes`, `variants`, plus `facetModes` (CAT-IMPORT-PROFILE-1B: the importer-owned filter modes
 * the facet rules apply, design § 2.6). No monetary field is read by the facets (CM-D8); the card suppresses
 * price on a catalog site. Cost (§ 3.2): the whole tenant per uncached render — what the shop page already reads.
 */
export async function getCatalogListing(tenantId: string, categoryId?: string): Promise<any[]> {
    const tableName = requireTableName();

    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "PRODUCT#",
            },
            ExpressionAttributeNames: { "#s": "status", "#b": "brand", "#a": "attributes", "#v": "variants" },
            ProjectionExpression: "id, title, slug, price, currency, salePrice, availability, imageLink, tags, categoryIds, sortOrder, volumePricing, availableFrom, availableUntil, #s, #b, #a, #v, facetModes",
            ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Membership, date window and order: the shared rule, so the admin's import preview lists what the site lists.
    return catalogListing(allItems, categoryId, utcDay(new Date()));
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
    if (result.Item.customerEmail !== normalizeEmail(email)) return null; // stored normalized (orders/create.ts); order-email-1

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
            // `#src` aliases the DynamoDB RESERVED keyword `source` — KEEP IT (prod hotfix fed5924:
            // an un-aliased `source` makes the whole projection invalid, 500-ing every product page).
            // `images` (rev-4) carries the per-photo metadata array; the render resolves approved
            // photos to raw asset URLs via `toPublicReviewPhotos` (lib/review-images.ts). "images"
            // is not a reserved word, so it needs no alias.
            ExpressionAttributeNames: { "#s": "status", "#src": "source" },
            ProjectionExpression: "id, authorName, rating, content, #src, createdAt, images",
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

// 11b. Fetch approved SITE-scope reviews (rev-4).
//
// Business-level reviews (imported Google/FB reviews about the tenant, not one SKU) live under the
// DISJOINT `SITEREVIEW#<id>` sort-key namespace (rev-1 D-REV-5), chosen so it shares NO prefix with
// `REVIEW#<productId>#` and provably cannot alias. The renderer reads them directly — the site-
// reviews carousel is fed by SERVER PREFETCH (SitePage), the same cacheable-route DB-read pattern as
// getPosts/getProductsByCategory; NO dynamic API is introduced. Approved-only, like the product read.
//
// Failed reads THROW (file header): a swallowed error here would pin a "no reviews" page for a year.
export async function getSiteReviews(tenantId: string) {
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
                ":sk": "SITEREVIEW#",
                ":approved": "approved",
            },
            // `#src` aliases the reserved keyword `source` (see getProductReviews / fed5924).
            ExpressionAttributeNames: { "#s": "status", "#src": "source" },
            ProjectionExpression: "id, authorName, rating, content, #src, createdAt, images",
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
            // `total` and `status` are DynamoDB reserved words: each needs an alias (PROJECTION-RESERVED-1).
            ProjectionExpression: "orderNumber, #total, #s, createdAt, SK",
            ExpressionAttributeNames: { "#s": "status", "#total": "total" },
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
            // LANG-1C (§ 6.2): `translationKey` for the sitemap's membership join. Same query, same pages, same count.
            ProjectionExpression: "SK, id, title, slug, seoDescription, createdAt, updatedAt, #s, translationKey",
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
        updatedAt: p.updatedAt,
        // LANG-1C (§ 6.2): the node id is the key text of `CONTENT#<nodeId>#LATEST` (the key the membership rule
        // names; `id` above is the CONTENT id, not the node id), and the raw stored set key. Readers that do not use
        // them (llms.txt, the sitemap of a one-language tenant) are unchanged: they read named fields only.
        nodeId: String(p.SK).slice("CONTENT#".length, -"#LATEST".length),
        translationKey: p.translationKey as unknown,
    }));
}

// ── LANG-1C translation sets, read side (docs/slices/lang-1.md § 6.2, § 8.4, § 8.5) ─────────────────────────────────
//
// THE MEMBERSHIP RULE (one rule; the head and the sitemap apply it). Page <n> is a MEMBER of set K when:
//   1. a membership item `TRANSLATION#K#<n>` exists;
//   2. `CONTENT#<n>#LATEST` exists, its `status` is `Published`, and its `slug` is a string;
//   3. that LATEST's current `translationKey` equals K.
// A member's language is `pageLanguageOf(slug, languages)`; its `hreflang` value is `languageTagOf(…)`. Members whose
// `hreflang` value is held by two or more members are all left out (§ 5.3); the rest are LISTED. Fewer than two listed
// → no alternates at all. What the rule does with the two kinds of stale item (§ 6.1, § 15; docs/TECH-DEBT.md): an
// item whose page is Draft, Archived or missing fails condition 2, and an orphan item whose page now holds another key
// or none fails condition 3 — such an item is skipped, nothing is written, and it costs one GetItem per head read of
// its set; in the sitemap it increases membership-query volume but causes no per-item GetItem (the join runs in memory).
//
// Reads (no scan): the head reads one set — a paginated Query `begins_with(SK, "TRANSLATION#<K>#")` + one GetItem per
// item; the sitemap reads the tenant's items — one paginated Query `begins_with(SK, "TRANSLATION#")` — and joins them
// with `getPublishedContent` in memory. Both are called only when `config.languages` is not empty.

/** A page that passes the membership rule: its node id and its address (the stored slug). A DTO. */
export type TranslationMember = { nodeId: string; slug: string };

/** One alternate of a set: the `hreflang` value, the member, and its public address (a path, "/" or the slug). */
export type TranslationAlternate = { hreflang: string; nodeId: string; path: string };

/**
 * The listed members of a set as alternates (§ 8.4, § 8.5): `links` in the order default language, then `languages`
 * in the tenant's order; `xDefault` = the path of the listed default-language member, when there is one.
 */
export type TranslationAlternates = { links: TranslationAlternate[]; xDefault?: string };

/** The tenant settings the alternates depend on (a subset of `TenantConfig`). */
export type AlternatesSite = { languages: readonly string[]; locale?: string; homePageSlug?: string };

const TRANSLATION_PREFIX = "TRANSLATION#";

/**
 * A stored set key a reader trusts: a non-empty string. A stored non-string or `""` (only a table edit makes it) is
 * treated as no key (row `lang1c-key-malformed`).
 */
export function isTranslationKey(value: unknown): value is string {
    return typeof value === "string" && value !== "";
}

/**
 * Conditions 2 and 3 of the membership rule on a LATEST item as read (`undefined` = missing): Published, a string
 * slug, and the current key equal to `setKey`. Condition 1 (the item exists) is the caller's: it starts from the items.
 */
export function passesMembership(setKey: string, latest: Record<string, unknown> | undefined): latest is Record<string, unknown> & { slug: string } {
    return latest !== undefined && latest.status === "Published" && typeof latest.slug === "string" && latest.translationKey === setKey;
}

/**
 * The membership item SK `TRANSLATION#<key>#<nodeId>` read: the key (up to the first `#` after the prefix) and the
 * node id (the rest). `null` for an SK without a key or without a node id — skipped by every reader (§ 6.2).
 */
export function parseTranslationSk(sk: unknown): { setKey: string; nodeId: string } | null {
    if (typeof sk !== "string" || !sk.startsWith(TRANSLATION_PREFIX)) return null;
    const rest = sk.slice(TRANSLATION_PREFIX.length);
    const at = rest.indexOf("#");
    if (at <= 0 || at === rest.length - 1) return null;
    return { setKey: rest.slice(0, at), nodeId: rest.slice(at + 1) };
}

/**
 * The LISTED alternates of one set from its members (§ 5.3, § 8.4, § 8.5). Pure. Each member's `hreflang` value is its
 * derived language tag; a value held by two or more members leaves all of them out (and when that value is the
 * default language's, there is no `x-default`). A member's path is "/" only when its slug equals `homePageSlug` AND it
 * derives the default language (the read-side guard of V6); else its slug. Fewer than two listed → `null`: the caller
 * writes exactly today's output.
 */
export function listedAlternates(members: readonly TranslationMember[], site: AlternatesSite): TranslationAlternates | null {
    const defaultTag = localeLanguageSubtag(site.locale);
    const tagged = members.map((m) => {
        const language = pageLanguageOf(m.slug, site.languages);
        return { member: m, language, hreflang: languageTagOf(language, defaultTag) };
    });
    const count = new Map<string, number>();
    for (const t of tagged) count.set(t.hreflang, (count.get(t.hreflang) ?? 0) + 1);
    const listed = tagged.filter((t) => count.get(t.hreflang) === 1);
    if (listed.length < 2) return null;
    const rank = (tag: string) => (tag === defaultTag ? 0 : site.languages.indexOf(tag) + 1);
    listed.sort((a, b) => rank(a.hreflang) - rank(b.hreflang));
    const pathOf = (t: (typeof tagged)[number]): string => {
        switch (t.language.kind) {
            case "default": return t.member.slug === site.homePageSlug ? "/" : t.member.slug;
            case "extra": return t.member.slug;
        }
    };
    const links = listed.map((t) => ({ hreflang: t.hreflang, nodeId: t.member.nodeId, path: pathOf(t) }));
    const home = listed.find((t) => t.language.kind === "default");
    return home ? { links, xDefault: pathOf(home) } : { links };
}

/**
 * The members of set `setKey` (§ 6.2, the head's read): one paginated Query of the set's membership items, then one
 * GetItem per item on `CONTENT#<nodeId>#LATEST` (projected `slug, status, translationKey`; in parallel, as
 * `getActiveCategoriesByIds`). Items without a node id are skipped; pages failing conditions 2 or 3 are skipped.
 * A failed read throws (file header).
 */
export async function getTranslationSetMembers(tenantId: string, setKey: string): Promise<TranslationMember[]> {
    const tableName = requireTableName();
    const nodeIds: string[] = [];
    let lastKey: any = undefined;
    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": `${TRANSLATION_PREFIX}${setKey}#` },
            ProjectionExpression: "SK",
            ExclusiveStartKey: lastKey,
        }));
        for (const item of result.Items || []) {
            const parsed = parseTranslationSk(item.SK);
            if (parsed !== null && parsed.setKey === setKey) nodeIds.push(parsed.nodeId);
        }
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    const pages = await Promise.all(nodeIds.map((nodeId) => docClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` },
        ProjectionExpression: "slug, #s, translationKey",
        ExpressionAttributeNames: { "#s": "status" },
    }))));
    return nodeIds.flatMap((nodeId, i) => {
        const latest = pages[i].Item;
        return passesMembership(setKey, latest) ? [{ nodeId, slug: latest.slug }] : [];
    });
}

/**
 * Every membership item of the tenant (§ 6.2, the sitemap's read): one paginated Query `begins_with(SK,
 * "TRANSLATION#")`, projected to the key. Items whose SK has no key or no node id are skipped.
 */
export async function getTranslationItems(tenantId: string): Promise<{ setKey: string; nodeId: string }[]> {
    const tableName = requireTableName();
    const out: { setKey: string; nodeId: string }[] = [];
    let lastKey: any = undefined;
    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": TRANSLATION_PREFIX },
            ProjectionExpression: "SK",
            ExclusiveStartKey: lastKey,
        }));
        for (const item of result.Items || []) {
            const parsed = parseTranslationSk(item.SK);
            if (parsed !== null) out.push(parsed);
        }
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return out;
}

/**
 * The sitemap join (§ 6.2, § 8.5). Pure. `pages` = the tenant's Published LATEST pages (`getPublishedContent`), `items`
 * = its membership items. Members of each set by the membership rule (an item whose node is not a Published page, or
 * whose page holds another key, is skipped), then `listedAlternates` per set. Result: the alternates of each LISTED
 * member, by node id; a page in no listed set is absent.
 */
export function sitemapAlternates(
    pages: readonly { nodeId: string; slug: unknown; status?: unknown; translationKey: unknown }[],
    items: readonly { setKey: string; nodeId: string }[],
    site: AlternatesSite,
): Map<string, TranslationAlternates> {
    const byNode = new Map(pages.map((p) => [p.nodeId, p]));
    const sets = new Map<string, TranslationMember[]>();
    for (const { setKey, nodeId } of items) {
        const page = byNode.get(nodeId);
        if (!passesMembership(setKey, page as Record<string, unknown> | undefined)) continue;
        const members = sets.get(setKey) ?? [];
        members.push({ nodeId, slug: page!.slug as string });
        sets.set(setKey, members);
    }
    const out = new Map<string, TranslationAlternates>();
    for (const members of sets.values()) {
        const alternates = listedAlternates(members, site);
        if (alternates === null) continue;
        for (const link of alternates.links) out.set(link.nodeId, alternates);
    }
    return out;
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
