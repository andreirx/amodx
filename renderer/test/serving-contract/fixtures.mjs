// Fixture dataset for the serving-contract suite (slice test-2).
//
// These are DynamoDB *items* as `renderer/src/lib/dynamo.ts` expects to read them back —
// same PK/SK shapes, same attribute names. They are served by `ddb-stub.mjs`; nothing here
// ever reaches AWS.
//
// Hosts use the `.test` TLD, which RFC 6761 §6.2 reserves as permanently non-resolvable.
// A misconfigured run therefore cannot accidentally address a real domain.

/** Host that resolves to a tenant record. Middleware rewrites `/x` → `/<this>/x`. */
export const FIXTURE_HOST = "fixture.serving-contract.test";

/** Host with NO tenant record — exercises the middleware unknown-host gate. */
export const UNKNOWN_HOST = "unknown.serving-contract.test";

export const TENANT_ID = "fixture-tenant";

/** Slug of the page that must serve cacheable HTML. */
export const PUBLISHED_SLUG = "/published";

/** Slug with no ROUTE# item — exercises the `?nf=1` handoff. */
export const MISSING_SLUG = "/no-such-page";

/**
 * A published page reserved for the CACHE-1-D4 fault-injection rows, so the
 * failure-then-recovery sequence runs on a path no other test has warmed. Named after the
 * probe page in docs/caching-architecture.md § "Failed reads throw".
 */
export const D4_SLUG = "/d4-page";

/**
 * cache-8 COUNTEREXAMPLE fixture. A SECOND tenant whose ID is a bare, scanner-shaped string
 * (`wk`), carrying a persisted route whose slug is a scanner-shaped `.php` path (`/index.php`).
 *
 * This is the shape that defeated the mitigation-d `.php` shield (review-1): `GET /index.php`
 * on this tenant's own host (`SCANNER_TENANT_HOST`) resolves this route and renders a
 * legitimate 200, which a `.php` shield would have 404'd. Row `(h1)` pins that it renders.
 * Rows `(h1b)` / `(h1c)` pin that the same page is NOT reachable from the fixture host by
 * naming this tenant's id or host in the path (slice SITEID-BINDING-1).
 *
 * Tenant IDs are arbitrary strings (`backend/src/tenant/create.ts`, `@amodx/shared`) and
 * `content/update.ts` persists an unsanitised slug (only prepends `/`), so both halves of this
 * fixture are reachable through the real write paths — this is a real content shape, not a
 * contrived one.
 */
export const SCANNER_TENANT_ID = "wk";
/** The `wk` tenant's own domain. Only row `(h1)` sends it as `Host`. */
export const SCANNER_TENANT_HOST = "wk-tenant.serving-contract.test";
export const SCANNER_SLUG = "/index.php";
export const SCANNER_PAGE_TITLE = "WK Legit Index (scanner-shaped, real content)";

/**
 * The DynamoDB table name the suite pins into the renderer's environment.
 *
 * Deliberately not a real table name: if `AWS_ENDPOINT_URL_DYNAMODB` were ever dropped
 * from the harness env, the SDK would address this name in the real account and fail
 * loudly rather than reading production data.
 */
export const TABLE_NAME = "serving-contract-fixture";

const tenant = {
    PK: "SYSTEM",
    SK: `TENANT#${TENANT_ID}`,
    id: TENANT_ID,
    Domain: FIXTURE_HOST,
    domain: FIXTURE_HOST,
    name: "Serving Contract Fixture",
    description: "Fixture tenant for the renderer serving-contract suite.",
    status: "LIVE",
    plan: "Pro",
    // commerce off: keeps `matchCommercePrefix` from claiming the probe slugs and keeps
    // the render on the plain content path that the contract rows describe.
    commerceEnabled: false,
    countryCode: "EN",
    currency: "USD",
    header: { showLogo: true, showTitle: true },
    navLinks: [],
    footerLinks: [],
    theme: {},
    integrations: {},
    createdAt: "2026-01-01T00:00:00.000Z",
};

/** A published page: `blocks: []` keeps the render off every plugin prefetch path. */
function contentItem(nodeId, slug, title, status) {
    return {
        PK: `TENANT#${TENANT_ID}`,
        SK: `CONTENT#${nodeId}#LATEST`,
        id: nodeId,
        slug,
        title,
        status,
        accessPolicy: { type: "Public", currency: "USD" },
        commentsMode: "Hidden",
        blocks: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    };
}

function routeItem(slug, nodeId) {
    return {
        PK: `TENANT#${TENANT_ID}`,
        SK: `ROUTE#${slug}`,
        TargetNode: `NODE#${nodeId}`,
    };
}

// cache-8 counterexample tenant `wk` (see SCANNER_TENANT_ID above). Row `(h1)` reaches it by
// its Domain through the domain GSI (the host gate's COUNT query and getTenantConfig). The
// bare string `wk` is never a Domain, so the GSI never claims it.
const scannerTenant = {
    PK: "SYSTEM",
    SK: `TENANT#${SCANNER_TENANT_ID}`,
    id: SCANNER_TENANT_ID,
    Domain: SCANNER_TENANT_HOST,
    domain: SCANNER_TENANT_HOST,
    name: "Scanner-Shaped Counterexample Tenant",
    description: "Tenant whose ID and route are scanner-shaped yet legitimate (cache-8 row h1).",
    status: "LIVE",
    plan: "Pro",
    commerceEnabled: false,
    countryCode: "EN",
    currency: "USD",
    header: { showLogo: true, showTitle: true },
    navLinks: [],
    footerLinks: [],
    theme: {},
    integrations: {},
    createdAt: "2026-01-01T00:00:00.000Z",
};

function scannerRouteItem(slug, nodeId) {
    return {
        PK: `TENANT#${SCANNER_TENANT_ID}`,
        SK: `ROUTE#${slug}`,
        TargetNode: `NODE#${nodeId}`,
    };
}

function scannerContentItem(nodeId, slug, title) {
    return {
        PK: `TENANT#${SCANNER_TENANT_ID}`,
        SK: `CONTENT#${nodeId}#LATEST`,
        id: nodeId,
        slug,
        title,
        status: "Published",
        accessPolicy: { type: "Public", currency: "USD" },
        commentsMode: "Hidden",
        blocks: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    };
}

// ── Two isolation tenants (slice opennext-1a increment 2; bundle rows only) ─────────────────
// Rows B-ISO (two tenants, same slug, different text — spec § 8.1), B-REFLECT (host A, path naming
// host B), B-TAG (edit A's `/about`) and B-LISTING (A's home lists A's posts through a `postGrid`
// block; edit one post's title). Same item shapes as the fixture tenant above. No `next`-target
// row requests these hosts.
export const ISO_HOST_A = "a.serving-contract.test";
export const ISO_HOST_B = "b.serving-contract.test";
export const ISO_TENANT_A = "iso-a";
export const ISO_TENANT_B = "iso-b";
export const ABOUT_SLUG = "/about";
export const ISO_ABOUT_TITLE_A = "Isolation Tenant A About Page";
export const ISO_ABOUT_TITLE_B = "Isolation Tenant B About Page";
/** Post P of spec § 8.1 B-LISTING: a page of tenant A that A's home lists by title. */
export const LISTED_POST_SLUG = "/listed-post";
export const LISTED_POST_TITLE = "Listed Post Original Title";

function siteTenant(id, host, name) {
    return { ...tenant, SK: `TENANT#${id}`, id, Domain: host, domain: host, name, description: `${name} (opennext-1a).` };
}

function siteRouteItem(tenantId, slug, nodeId) {
    return { PK: `TENANT#${tenantId}`, SK: `ROUTE#${slug}`, TargetNode: `NODE#${nodeId}` };
}

/** `blocks`: `[]` keeps the render off plugin paths; A's home carries one `postGrid` (no
 *  filterTag → `getPosts` emits the PK + `begins_with(SK)` query with `status = :pub`, a shape
 *  ddb-stub.mjs implements). `createdAt` orders `getPosts` output (newest first). */
function siteContentItem(tenantId, nodeId, slug, title, { blocks = [], createdAt = "2026-01-01T00:00:00.000Z" } = {}) {
    return {
        PK: `TENANT#${tenantId}`,
        SK: `CONTENT#${nodeId}#LATEST`,
        id: nodeId,
        slug,
        title,
        status: "Published",
        accessPolicy: { type: "Public", currency: "USD" },
        commentsMode: "Hidden",
        blocks,
        createdAt,
    };
}

// ── CM1-BYTE-IDENTITY fixtures (slice cat-mode-1; spec docs/slices/catalog-mode-1.md § 3.6) ─────────────
// Three tenants, in the item shapes the backend writes (`products/create.ts`, `categories`, `lib/catprod.ts`).
//  - commerce (`commerceEnabled: true`, NO `catalogMode` key): products covering every branch of the § 3.2 surface
//    table — sale price + volume tiers, variants with priceOverride/availability + personalizations + preorder,
//    out_of_stock, a Paddle `paymentLinkId` — a `categoryShowcase` block on its home page and the search bar on.
//  - content (`commerceEnabled: false`, NO `catalogMode` key): one product, one category.
//  - catalog (`catalogMode: true`): products as the catalog write boundary stores them (no monetary key; the
//    schema defaults `currency`/`availability` are stored — F-6), one imported product with a 3-option variant
//    group and attributes, one imageless product whose stored availability is `out_of_stock`, and one LEGACY product
//    that holds price, salePrice, volume tiers, a Paddle `paymentLinkId` and `preorder` (data written before the
//    write boundary existed) — suppression must hold whatever the data says (cycle 2, CM1-COVERAGE).
//  - `/stale-showcase` on the commerce and catalog tenants: a `categoryShowcase` whose category slug the stub does
//    not know (the server lookup misses) and whose authored `prefetchedProducts` holds a priced, out-of-stock item
//    (cycle 2, CM1-SHOWCASE-CLOSURE). Commerce = the positive control (price and "Out of Stock" render).
// The commerce and content tenants are the byte-identity subjects (rows `cm1-*` in contract.test.mjs); their
// baseline captures are committed under `cm1-byte-identity/baseline/`.
export const CM1 = {
    commerce: { id: "cm1-commerce", host: "cm1-commerce.serving-contract.test" },
    content: { id: "cm1-content", host: "cm1-content.serving-contract.test" },
    catalog: { id: "cm1-catalog", host: "cm1-catalog.serving-contract.test" },
};
const CM1_AT = "2026-10-01T00:00:00.000Z";
const IMG = (name) => `https://img.serving-contract.test/${name}.jpg`;

function cm1Tenant({ id, host }, name, flags) {
    return {
        ...tenant, SK: `TENANT#${id}`, id, Domain: host, domain: host, name,
        description: `${name} (CM1-BYTE-IDENTITY fixture).`,
        ...flags,
    };
}

function cm1Product(tenantId, product) {
    return {
        PK: `TENANT#${tenantId}`, SK: `PRODUCT#${product.id}`, TenantSlug: `${tenantId}#${product.slug}`, Type: "Product",
        tenantId, status: "active", description: `${product.title} description.`, currency: "USD",
        availability: "in_stock", condition: "new", tags: [], categoryIds: [], attributes: [], personalizations: [],
        variants: [], volumePricing: [], nutritionalValues: [], additionalImageLinks: [], productType: "physical",
        sortOrder: 0, createdAt: CM1_AT, updatedAt: CM1_AT,
        ...product,
    };
}

function cm1Category(tenantId, id, slug, name) {
    return {
        PK: `TENANT#${tenantId}`, SK: `CATEGORY#${id}`, TenantSlug: `${tenantId}#${slug}`, Type: "Category",
        id, tenantId, slug, name, status: "active", sortOrder: 0, productCount: 0, createdAt: CM1_AT, updatedAt: CM1_AT,
    };
}

/** The CATPROD# projection `lib/catprod.ts` writes for one product in one category. */
function cm1CatProd(tenantId, categoryId, p) {
    const item = {
        PK: `TENANT#${tenantId}`, SK: `CATPROD#${categoryId}#${p.id}`, id: p.id, title: p.title, slug: p.slug,
        currency: p.currency, imageLink: p.imageLink, availability: p.availability, status: p.status,
        sortOrder: p.sortOrder, tags: p.tags, volumePricing: p.volumePricing, categoryIds: p.categoryIds,
    };
    if (p.price !== undefined) item.price = p.price;
    if (p.salePrice !== undefined) item.salePrice = p.salePrice;
    if (p.imageLink === undefined) delete item.imageLink;
    return item;
}

function cm1Pages(tenantId, homeBlocks, { staleShowcase = false } = {}) {
    const pages = [
        siteRouteItem(tenantId, "/", `${tenantId}-home`),
        siteContentItem(tenantId, `${tenantId}-home`, "/", `${tenantId} home`, { blocks: homeBlocks, createdAt: CM1_AT }),
        siteRouteItem(tenantId, ABOUT_SLUG, `${tenantId}-about`),
        siteContentItem(tenantId, `${tenantId}-about`, ABOUT_SLUG, `${tenantId} about`, { createdAt: CM1_AT }),
    ];
    if (staleShowcase) {
        pages.push(
            siteRouteItem(tenantId, CM1_STALE_SLUG, `${tenantId}-stale`),
            siteContentItem(tenantId, `${tenantId}-stale`, CM1_STALE_SLUG, `${tenantId} stale showcase`, { blocks: [staleShowcaseBlock], createdAt: CM1_AT }),
        );
    }
    return pages;
}

/** The stale-showcase page (file header): a lookup miss with stale authored data (the renderer keeps it for a
 *  non-catalog tenant and reduces it to display fields for a catalog tenant). */
export const CM1_STALE_SLUG = "/stale-showcase";
const staleShowcaseBlock = {
    type: "categoryShowcase",
    attrs: {
        categorySlug: "cm1-no-such-category", categoryName: "Stale", limit: 4, columns: "4", showPrice: true, ctaText: "",
        prefetchedProducts: [{
            id: "stale-1", title: "Stale Item", slug: "stale-item", price: "12.00", currency: "USD",
            availability: "out_of_stock", imageLink: IMG("stale"), volumePricing: [],
        }],
    },
};

const showcase = (slug) => ({ type: "categoryShowcase", attrs: { categorySlug: slug, categoryName: "Featured", limit: 4, columns: "4", showPrice: true, ctaText: "See all" } });
const searchBar = { enabled: true, placeholder: "Search products..." };

const cm1CommerceProducts = [
    cm1Product(CM1.commerce.id, {
        id: "c0000000-0000-4000-8000-000000000001", title: "Sale Rug", slug: "sale-rug", sku: "SR-1",
        price: "100.00", salePrice: "80.00", volumePricing: [{ minQuantity: 5, price: "75.00" }],
        imageLink: IMG("sale"), additionalImageLinks: [IMG("sale-2")], categoryIds: ["rugs"], tags: ["wool"],
        attributes: [{ key: "Material", value: "Wool" }], longDescription: "<p>Long text.</p>",
    }),
    cm1Product(CM1.commerce.id, {
        id: "c0000000-0000-4000-8000-000000000002", title: "Variant Rug", slug: "variant-rug", price: "50.00",
        availability: "preorder", imageLink: IMG("variant"), categoryIds: ["rugs"],
        variants: [{ id: "size", name: "Size", options: [
            { value: "S", priceOverride: "45.00", imageLink: IMG("variant-s"), availability: "in_stock" },
            { value: "M" },
            { value: "L", availability: "out_of_stock" },
        ] }],
        personalizations: [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5" }],
    }),
    cm1Product(CM1.commerce.id, {
        id: "c0000000-0000-4000-8000-000000000003", title: "Sold Out Rug", slug: "sold-out-rug", price: "30.00",
        availability: "out_of_stock", imageLink: IMG("sold-out"), categoryIds: ["rugs"],
    }),
    cm1Product(CM1.commerce.id, {
        id: "c0000000-0000-4000-8000-000000000004", title: "Rug Care Guide", slug: "rug-care-guide", price: "20.00",
        imageLink: IMG("guide"), paymentLinkId: "pri_cm1", productType: "digital",
    }),
];
const cm1ContentProducts = [
    cm1Product(CM1.content.id, {
        id: "d0000000-0000-4000-8000-000000000001", title: "Plain Rug", slug: "plain-rug", price: "10.00",
        imageLink: IMG("plain"), categoryIds: ["mats"],
    }),
];
const cm1CatalogProducts = [
    cm1Product(CM1.catalog.id, {
        id: "e0000000-0000-4000-8000-000000000001", title: "Oak Plank", slug: "oak-plank", importSource: "glam:boen/pl",
        imageLink: IMG("oak-1"), additionalImageLinks: [IMG("oak-2"), IMG("oak-3")], categoryIds: ["floors"],
        variants: [{ id: "format", name: "Format", options: [
            { value: "120x20", imageLink: IMG("oak-1") },
            { value: "140x20", imageLink: IMG("oak-2") },
            { value: "180x20", imageLink: IMG("oak-3") },
        ] }],
        attributes: [
            { key: "unitate", value: "mp" },
            { key: "împachetare", value: "2,2 mp/cutie" },
            { key: "comandă minimă", value: "10 mp" },
        ],
    }),
    cm1Product(CM1.catalog.id, {
        id: "e0000000-0000-4000-8000-000000000002", title: "Ash Plank", slug: "ash-plank",
        availability: "out_of_stock", categoryIds: ["floors"],
    }),
    // Legacy data (file header): every monetary field the write boundary now refuses, plus a Paddle link.
    cm1Product(CM1.catalog.id, {
        id: "e0000000-0000-4000-8000-000000000003", title: "Legacy Plank", slug: "legacy-plank",
        price: "99.00", salePrice: "79.00", volumePricing: [{ minQuantity: 10, price: "69.00" }],
        paymentLinkId: "pri_cm1_legacy", availability: "preorder", imageLink: IMG("legacy"), categoryIds: ["floors"],
    }),
];
// The catalog products carry no `imageLink` key when they have none (CM-D7): drop the helper's absent value.
for (const p of cm1CatalogProducts) if (p.imageLink === undefined) delete p.imageLink;

const CM1_ITEMS = [
    cm1Tenant(CM1.commerce, "CM1 Commerce", { commerceEnabled: true, searchBar }),
    ...cm1Pages(CM1.commerce.id, [showcase("rugs")], { staleShowcase: true }),
    cm1Category(CM1.commerce.id, "rugs", "rugs", "Rugs"),
    ...cm1CommerceProducts,
    ...cm1CommerceProducts.filter((p) => p.categoryIds.includes("rugs")).map((p) => cm1CatProd(CM1.commerce.id, "rugs", p)),

    cm1Tenant(CM1.content, "CM1 Content", { commerceEnabled: false }),
    ...cm1Pages(CM1.content.id, []),
    cm1Category(CM1.content.id, "mats", "mats", "Mats"),
    ...cm1ContentProducts,
    ...cm1ContentProducts.map((p) => cm1CatProd(CM1.content.id, "mats", p)),

    cm1Tenant(CM1.catalog, "CM1 Catalog", { commerceEnabled: false, catalogMode: true, searchBar }),
    ...cm1Pages(CM1.catalog.id, [showcase("floors")], { staleShowcase: true }),
    cm1Category(CM1.catalog.id, "floors", "floors", "Floors"),
    ...cm1CatalogProducts,
    ...cm1CatalogProducts.map((p) => cm1CatProd(CM1.catalog.id, "floors", p)),
];

/** Every item the stub can serve. Order is irrelevant; lookups are by key. */
export const ITEMS = [
    tenant,
    routeItem("/", "home"),
    contentItem("home", "/", "Fixture Home", "Published"),
    routeItem(PUBLISHED_SLUG, "published"),
    contentItem("published", PUBLISHED_SLUG, "Published Fixture Page", "Published"),
    routeItem(D4_SLUG, "d4"),
    contentItem("d4", D4_SLUG, "D4 Fixture Page", "Published"),
    // cache-8 counterexample: tenant `wk` with a persisted `.php` route.
    scannerTenant,
    scannerRouteItem(SCANNER_SLUG, "wk-index"),
    scannerContentItem("wk-index", SCANNER_SLUG, SCANNER_PAGE_TITLE),
    // opennext-1a increment 2: isolation tenants A and B.
    siteTenant(ISO_TENANT_A, ISO_HOST_A, "Isolation Tenant A"),
    siteRouteItem(ISO_TENANT_A, "/", "a-home"),
    siteContentItem(ISO_TENANT_A, "a-home", "/", "Isolation Tenant A Home", { blocks: [{ type: "postGrid", attrs: {} }] }),
    siteRouteItem(ISO_TENANT_A, ABOUT_SLUG, "a-about"),
    siteContentItem(ISO_TENANT_A, "a-about", ABOUT_SLUG, ISO_ABOUT_TITLE_A),
    siteRouteItem(ISO_TENANT_A, LISTED_POST_SLUG, "a-post"),
    siteContentItem(ISO_TENANT_A, "a-post", LISTED_POST_SLUG, LISTED_POST_TITLE, { createdAt: "2026-02-01T00:00:00.000Z" }),
    siteTenant(ISO_TENANT_B, ISO_HOST_B, "Isolation Tenant B"),
    siteRouteItem(ISO_TENANT_B, ABOUT_SLUG, "b-about"),
    siteContentItem(ISO_TENANT_B, "b-about", ABOUT_SLUG, ISO_ABOUT_TITLE_B),
    // cat-mode-1: CM1-BYTE-IDENTITY tenants (above).
    ...CM1_ITEMS,
];

/**
 * Ruling OPENNEXT1A-SEED-REVAL (operator, 2026-10-15): B-REVAL's FALLBACK message source. Used
 * only when B-STALE's expectation for the built adapter is "0 SQS messages" (the 4.x `4-seed`
 * entry), so B-REVAL still drives the revalidation function on that branch. The body is copied
 * VERBATIM from the SendMessage the SQS stub journaled on open-next 3.1.3 (B-STALE, gate-2 run
 * 2026-10-15); `host` / `url` point at the fixture tenant's published page (the rewritten path
 * 3.1.3 queues). `groupId` as journaled; the deduplication id is per-message and not reproduced
 * (the SQS converter reads only `body` and `messageId`, 3.1.3 `converters/sqs-revalidate.js`).
 */
export const REVALIDATION_MESSAGE_3_1_3 = {
    body: '{"host":"fixture.serving-contract.test","url":"/fixture.serving-contract.test/published"}',
    groupId: "revalidate-0",
};
