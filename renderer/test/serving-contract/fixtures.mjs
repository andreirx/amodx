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
