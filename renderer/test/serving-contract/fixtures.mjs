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

/** Every item the stub can serve. Order is irrelevant; lookups are by key. */
export const ITEMS = [
    tenant,
    routeItem("/", "home"),
    contentItem("home", "/", "Fixture Home", "Published"),
    routeItem(PUBLISHED_SLUG, "published"),
    contentItem("published", PUBLISHED_SLUG, "Published Fixture Page", "Published"),
    routeItem(D4_SLUG, "d4"),
    contentItem("d4", D4_SLUG, "D4 Fixture Page", "Published"),
];
