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
 * This is the exact shape that defeated the mitigation-d `.php` shield (review-1): a scanner
 * probe `/<SCANNER_TENANT_ID><SCANNER_SLUG>` = `/wk/index.php` is NOT a garbage path — it binds
 * the catch-all `[siteId]=wk`, `getTenantConfig("wk")` resolves this tenant via the
 * `SYSTEM / TENANT#wk` fallback, and `/index.php` resolves this route. So it renders a
 * legitimate 200, which a `.php` shield would have 404'd. Row `(h1)` pins that it renders.
 *
 * Tenant IDs are arbitrary strings (`backend/src/tenant/create.ts`, `@amodx/shared`) and
 * `content/update.ts` persists an unsanitised slug (only prepends `/`), so both halves of this
 * fixture are reachable through the real write paths — this is a real content shape, not a
 * contrived one.
 */
export const SCANNER_TENANT_ID = "wk";
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

// cache-8 counterexample tenant `wk` (see SCANNER_TENANT_ID above). Its ID is resolved only
// via the `SYSTEM / TENANT#wk` PK fallback in getTenantConfig — its Domain is a distinct host
// that no probe carries, so the domain GSI never claims the bare string `wk`.
const scannerTenant = {
    PK: "SYSTEM",
    SK: `TENANT#${SCANNER_TENANT_ID}`,
    id: SCANNER_TENANT_ID,
    Domain: "wk-tenant.serving-contract.test",
    domain: "wk-tenant.serving-contract.test",
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
];
