import { describe, it, expect } from "vitest";
import {
    ContentItemSchema,
    ContentStatus,
    IntegrationsSchema,
    OrderSchema,
    TenantConfigSchema,
    URL_PREFIX_DEFAULTS,
    UrlPrefixesSchema,
} from "../src/index.js";

/**
 * slice `test-3` — the shared Zod schemas are the ONE contract every workspace trusts.
 * Backend handlers, the admin SPA and the renderer all parse against these objects; a
 * silent change here is a silent change to all three at once, and nothing else in the
 * estate would fail first. These tests therefore pin what each schema ACCEPTS and what it
 * REJECTS, not merely that it parses.
 *
 * Imports `../src/index.js` — the TS source (the `.js` specifier is the NodeNext form the
 * package compiles with; vitest resolves it to `src/index.ts`). Deliberately NOT `dist/`:
 * a stale build must not be able to read as a passing contract.
 *
 * Pure by construction: `@amodx/shared` has no dependency but `zod`. No AWS, no network,
 * no environment read — see `docs/testing-strategy.md` §7.
 *
 * WHAT THIS FILE IS NOT: coverage of every field. Each block below names an invariant that
 * something outside this package depends on. Fields with no cross-workspace consequence are
 * deliberately unpinned so this suite does not become a change-detector.
 */

/** Minimum accepted tenant: everything else in TenantConfigSchema defaults or is optional. */
const MINIMAL_TENANT = {
    id: "client-bob",
    domain: "dental-pros.com",
    name: "Dental Pros",
    plan: "Free",
    createdAt: "2026-01-01T00:00:00.000Z",
} as const;

// ---------------------------------------------------------------------------------------

describe("TenantConfigSchema — required identity fields", () => {
    /**
     * INVARIANT: `id`, `domain`, `name`, `plan`, `createdAt` are the irreducible tenant
     * record. Everything else has a default, which is what makes adding a field to this
     * schema backward-compatible with tenants already persisted in DynamoDB (MEMORY:
     * "All new fields have `.default()` for backward compat").
     */
    it("accepts a tenant carrying only the five required fields", () => {
        expect(TenantConfigSchema.safeParse(MINIMAL_TENANT).success).toBe(true);
    });

    it.each(["id", "domain", "name", "plan", "createdAt"] as const)(
        "rejects a tenant missing %s",
        (field) => {
            const partial: Record<string, unknown> = { ...MINIMAL_TENANT };
            delete partial[field];
            expect(TenantConfigSchema.safeParse(partial).success).toBe(false);
        },
    );

    it("rejects a plan outside the three sold tiers", () => {
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, plan: "Enterprise" }).success)
            .toBe(false);
    });
});

describe("TenantConfigSchema — `domain` is SINGULAR", () => {
    /**
     * INVARIANT, and the one with the widest blast radius in this file: a tenant has
     * exactly ONE domain — `domain: z.string()`, not an array.
     *
     * `cache-2` keys every ISR purge by domain, and decision `CACHE-2-D1` retired its
     * multi-domain evidence item on exactly this ground: "the multi-domain evidence item
     * had no representable input — one domain per tenant" (`CURRENT_SLICE.md`). Widening
     * this field to an array would make `purgeTargets()` (backend/src/lib/revalidate-paths.ts)
     * silently purge one of N domains and leave the rest serving stale content, with no
     * type error anywhere — the value would just be an array where a string was read.
     *
     * If this test ever fails because the field became plural, that is a platform change,
     * not a test to relax: the purge path, `GSI_Domain` and middleware's host lookup all
     * assume the single-domain shape.
     */
    it("accepts one domain as a plain string", () => {
        expect(TenantConfigSchema.parse(MINIMAL_TENANT).domain).toBe("dental-pros.com");
    });

    it("rejects an array of domains", () => {
        expect(
            TenantConfigSchema.safeParse({
                ...MINIMAL_TENANT,
                domain: ["dental-pros.com", "dentalpros.ro"],
            }).success,
        ).toBe(false);
    });
});

describe("UrlPrefixesSchema / TenantConfig.urlPrefixes — English-first defaults", () => {
    /**
     * INVARIANT (CLAUDE.md-level rule, MEMORY "Hardcoded Defaults — English First"):
     * `URL_PREFIX_DEFAULTS` is the SINGLE source of truth for commerce URL prefixes, and
     * every default is English. Romanian tenants opt in; they are not the default.
     *
     * Consumers that read these values without re-deriving them: `matchCommercePrefix()`
     * in the renderer's catch-all route, the admin Settings page, and
     * `checkSlugCommerceConflict()` in backend/src/lib/slug-guard.ts — which BLOCKS content
     * slugs that collide with a commerce prefix. A drift here silently changes which slugs
     * a tenant is allowed to publish.
     */
    it("fills every prefix from URL_PREFIX_DEFAULTS when the tenant has none", () => {
        expect(TenantConfigSchema.parse(MINIMAL_TENANT).urlPrefixes).toEqual(URL_PREFIX_DEFAULTS);
    });

    it("pins the defaults as English, not Romanian", () => {
        expect(URL_PREFIX_DEFAULTS).toEqual({
            product: "/product",
            category: "/category",
            cart: "/cart",
            checkout: "/checkout",
            shop: "/shop",
            account: "/account",
            search: "/search",
        });
    });

    it("fills the untouched prefixes per-key when a tenant overrides only one", () => {
        // Partial override is the real admin-UI shape: the Settings form can persist one
        // field. Per-key (not all-or-nothing) defaulting is what keeps the other four
        // routes resolvable on such a tenant.
        const parsed = TenantConfigSchema.parse({
            ...MINIMAL_TENANT,
            urlPrefixes: { product: "/produs" },
        });
        expect(parsed.urlPrefixes).toEqual({ ...URL_PREFIX_DEFAULTS, product: "/produs" });
    });

    it("exposes the same defaulting on the standalone schema", () => {
        expect(UrlPrefixesSchema.parse({})).toEqual(URL_PREFIX_DEFAULTS);
    });
});

describe("TenantConfigSchema — commerce and locale defaults", () => {
    /**
     * INVARIANT 1 (VISION § "Slices default to disabled"): `commerceEnabled` is false for a
     * tenant that never asked for it. Live non-commerce tenants exist today; a default of
     * `true` would put a cart widget and checkout routes on all of them.
     *
     * INVARIANT 2 (CLAUDE.md / MEMORY): no country-specific value is ever a universal
     * default. USD / EN / en-US.
     */
    it("leaves commerce off by default", () => {
        expect(TenantConfigSchema.parse(MINIMAL_TENANT).commerceEnabled).toBe(false);
    });

    it("defaults currency, country and locale to the neutral English set", () => {
        const c = TenantConfigSchema.parse(MINIMAL_TENANT);
        expect({ currency: c.currency, countryCode: c.countryCode, locale: c.locale }).toEqual({
            currency: "USD",
            countryCode: "EN",
            locale: "en-US",
        });
    });

    it("accepts only the two implemented payment methods", () => {
        expect(TenantConfigSchema.parse(MINIMAL_TENANT).enabledPaymentMethods)
            .toEqual(["cash_on_delivery"]);
        expect(
            TenantConfigSchema.safeParse({
                ...MINIMAL_TENANT,
                enabledPaymentMethods: ["card"],
            }).success,
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------------------

describe("ContentStatus — the publish gate enum", () => {
    /**
     * INVARIANT: exactly three states, capitalised. The renderer's public read path filters
     * on the literal "Published"; any other spelling means a page that the admin shows as
     * live is invisible to visitors (or, in the reverse direction, a draft becomes public).
     * Case matters — this enum is compared by string equality, never case-insensitively.
     */
    it("accepts exactly Draft, Published, Archived", () => {
        expect(ContentStatus.options).toEqual(["Draft", "Published", "Archived"]);
    });

    it.each(["published", "PUBLISHED", "Live", "draft", ""])(
        "rejects the near-miss spelling %o",
        (bad) => {
            expect(ContentStatus.safeParse(bad).success).toBe(false);
        },
    );
});

describe("ContentItemSchema — safe-by-default page state", () => {
    /**
     * INVARIANT: a content item parsed without an explicit status is a DRAFT, and without
     * an explicit access policy is PUBLIC. Both defaults are load-bearing:
     *
     *  - status "Draft" means a partially-built item created by an import or a migration is
     *    never published by omission.
     *  - accessPolicy "Public" is the *pre-existing* behaviour for the ~all pages that have
     *    no gate; defaulting to a gated type would 403 the estate.
     *  - commentsMode "Hidden" — MEMORY: "comments default off".
     */
    const MINIMAL_ITEM = {
        id: "page-1",
        nodeId: "node-1",
        version: 1,
        title: "About",
        author: "andrei",
        createdAt: "2026-01-01T00:00:00.000Z",
    };

    it("defaults an item to Draft / Public / comments hidden / no blocks", () => {
        const item = ContentItemSchema.parse(MINIMAL_ITEM);
        expect(item.status).toBe("Draft");
        expect(item.accessPolicy).toEqual({ type: "Public", currency: "USD" });
        expect(item.commentsMode).toBe("Hidden");
        expect(item.blocks).toEqual([]);
        expect(item.tags).toEqual([]);
    });

    it("treats slug as optional — the home page and system pages have none", () => {
        expect(ContentItemSchema.parse(MINIMAL_ITEM).slug).toBeUndefined();
    });

    it("rejects an item with no title (the admin list and audit log both read it)", () => {
        const { title, ...noTitle } = MINIMAL_ITEM;
        expect(ContentItemSchema.safeParse(noTitle).success).toBe(false);
    });
});

// ---------------------------------------------------------------------------------------

describe("OrderSchema — the Phase-5 status machine", () => {
    const MINIMAL_ORDER = {
        id: "o1",
        tenantId: "client-bob",
        orderNumber: "PPB-0001",
        customerEmail: "buyer@example.com",
        customerName: "Buyer",
        shippingAddress: { street: "Str. 1", city: "Cluj", county: "Cluj" },
        items: [{
            productId: "p1",
            productTitle: "Ring",
            quantity: 1,
            unitPrice: "100",
            totalPrice: "100",
        }],
        subtotal: "100",
        total: "100",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };

    /**
     * INVARIANT: the seven Phase-5 states, and NOT the pre-Phase-5 "pending". Both
     * `orders/update-status.ts` (VALID_STATUSES) and `lib/order-email.ts` (STATUS_LABELS,
     * default templates) are keyed by these exact strings. A status that parses but has no
     * label renders a customer email with a blank status line; a status the email map knows
     * but the schema rejects makes the transition unsavable.
     */
    it("accepts exactly the seven workflow states", () => {
        expect(OrderSchema.shape.status.unwrap().options).toEqual([
            "placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled",
        ]);
    });

    it('rejects the retired pre-Phase-5 "pending" order status', () => {
        // "pending" survives only as a *payment* status. Keeping the two apart is the point.
        expect(OrderSchema.safeParse({ ...MINIMAL_ORDER, status: "pending" }).success).toBe(false);
    });

    it("defaults a new order to placed / unpaid / cash-on-delivery / USD", () => {
        const o = OrderSchema.parse(MINIMAL_ORDER);
        expect(o.status).toBe("placed");
        expect(o.paymentStatus).toBe("pending");
        expect(o.paymentMethod).toBe("cash_on_delivery");
        expect(o.currency).toBe("USD");
        expect(o.statusHistory).toEqual([]);
    });

    it("refuses an empty basket", () => {
        // An order with zero items would still allocate an order number from the atomic
        // COUNTER#ORDER and mail the customer.
        expect(OrderSchema.safeParse({ ...MINIMAL_ORDER, items: [] }).success).toBe(false);
    });

    it("refuses a malformed customer email — it is the delivery address for every status mail", () => {
        expect(OrderSchema.safeParse({ ...MINIMAL_ORDER, customerEmail: "buyer@" }).success)
            .toBe(false);
    });

    it("refuses a fractional or zero item quantity", () => {
        const bad = (quantity: number) => ({
            ...MINIMAL_ORDER,
            items: [{ ...MINIMAL_ORDER.items[0], quantity }],
        });
        expect(OrderSchema.safeParse(bad(0)).success).toBe(false);
        expect(OrderSchema.safeParse(bad(1.5)).success).toBe(false);
    });

    it("requires street, city and county on the shipping address", () => {
        expect(
            OrderSchema.safeParse({
                ...MINIMAL_ORDER,
                shippingAddress: { street: "", city: "Cluj", county: "Cluj" },
            }).success,
        ).toBe(false);
    });

    /**
     * CHARACTERIZATION, NOT ENDORSEMENT — this pins a defect so it cannot drift unnoticed.
     *
     * `ShippingAddressSchema.country` defaults to the literal "Romania". That contradicts
     * the CLAUDE.md/MEMORY rule "NEVER hardcode a country-specific value as a universal
     * default", which every other field in this package now obeys (USD / EN / en-US).
     * A US tenant's order therefore persists `country: "Romania"` whenever the checkout
     * form omits the field.
     *
     * Changing it is a src change and is out of this slice's scope (test-3 is
     * ZERO src changes), and it is not a free edit: orders already persisted carry the
     * value. Reported to the reviewer as finding F-SHARED-1.
     */
    it("MEASURED: shipping country defaults to Romania (see F-SHARED-1 — rule violation)", () => {
        expect(OrderSchema.parse(MINIMAL_ORDER).shippingAddress.country).toBe("Romania");
    });
});

// ---------------------------------------------------------------------------------------

describe("IntegrationsSchema — third-party defaults are the safe ones", () => {
    /**
     * INVARIANT: an integration a tenant never configured must be OFF, and any payment
     * integration must default to its sandbox. `IntegrationsSchema` is persisted inside
     * TenantConfig and read by the renderer at request time, so these defaults are what a
     * tenant created before a field existed will present at runtime.
     */
    it("defaults Paddle to sandbox — never to production", () => {
        expect(IntegrationsSchema.parse({}).paddle.environment).toBe("sandbox");
    });

    it("rejects a Paddle environment outside sandbox/production", () => {
        expect(IntegrationsSchema.safeParse({ paddle: { environment: "staging" } }).success)
            .toBe(false);
    });

    it("defaults privacy analytics to none, and the two boolean integrations to false", () => {
        const i = IntegrationsSchema.parse({});
        expect(i.analytics.provider).toBe("none");
        expect(i.mailerlite).toBe(false);
        expect(i.perplexity).toBe(false);
    });

    it("leaves every secret-bearing field absent rather than empty-string", () => {
        // CLAUDE.md rule 8 — API keys live in TenantConfig at runtime and are never
        // hardcoded. `undefined` is what lets a handler distinguish "not configured" from
        // "configured to the empty string"; a "" default would make that undetectable.
        const i = IntegrationsSchema.parse({});
        expect(i.braveApiKey).toBeUndefined();
        expect(i.google).toBeUndefined();
        expect(i.googleAnalyticsId).toBeUndefined();
        expect(i.fbPixelId).toBeUndefined();
    });

    it("rejects a malformed contactEmail — SES rejects it later, at send time", () => {
        expect(IntegrationsSchema.safeParse({ contactEmail: "not-an-email" }).success).toBe(false);
        expect(IntegrationsSchema.safeParse({ contactEmail: "hi@example.com" }).success).toBe(true);
    });

    it("rejects a malformed orderProcessingEmail (fulfillment notification target)", () => {
        expect(IntegrationsSchema.safeParse({ orderProcessingEmail: "ops@" }).success).toBe(false);
    });

    it("is reachable through TenantConfig with the same defaults", () => {
        // The integrations default is declared inline on TenantConfigSchema as a literal
        // object; this asserts that literal has not drifted from IntegrationsSchema's own
        // per-field defaults for the two fields the renderer branches on.
        const t = TenantConfigSchema.parse(MINIMAL_TENANT);
        expect(t.integrations.paddle.environment).toBe("sandbox");
        expect(t.integrations.analytics.provider).toBe("none");
    });
});
