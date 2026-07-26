import { describe, it, expect } from "vitest";
import { purgeTargets, type TenantRouting } from "../../src/lib/revalidate-paths.js";

/**
 * cache-2 evidence: tenant config + slug → the exact `revalidatePath(domain, slug)`
 * arguments the mutation handlers will emit.
 *
 * Pure: no AWS SDK, no DynamoDB, no environment. Run with
 * `npm run test:unit` (config `vitest.unit.config.ts`, which has no `setupFiles`),
 * NOT with `npm test` — that one talks to live staging DynamoDB.
 *
 * The defect this pins: the old code emitted `/<tenantId>/<path>`, which addresses no ISR
 * cache entry that can exist in production. Every assertion below therefore asserts the
 * DOMAIN, and `tenantId` appears nowhere in this file — it is not an input to the rule.
 */

const ROMANIAN: TenantRouting = {
    domain: "bijuterie.ro",
    urlPrefixes: { product: "/produs", category: "/categorie" },
};

const DEFAULTS: TenantRouting = { domain: "shop.example.com" };

describe("purgeTargets — content pages", () => {
    it("keys the purge by domain, not by tenant id", () => {
        expect(purgeTargets(DEFAULTS, "page", ["/about"])).toEqual([
            { domain: "shop.example.com", slug: "/about" },
        ]);
    });

    it("purges both paths on a rename (new slug first, old slug second)", () => {
        expect(purgeTargets(DEFAULTS, "page", ["/about-us", "/about"])).toEqual([
            { domain: "shop.example.com", slug: "/about-us" },
            { domain: "shop.example.com", slug: "/about" },
        ]);
    });

    it("collapses an unchanged 'old' slug so callers may pass it unconditionally", () => {
        expect(purgeTargets(DEFAULTS, "page", ["/about", "/about"])).toEqual([
            { domain: "shop.example.com", slug: "/about" },
        ]);
    });

    it("drops undefined and blank slugs (delete handlers pass a possibly-absent slug)", () => {
        expect(purgeTargets(DEFAULTS, "page", [undefined, "  ", "/live"])).toEqual([
            { domain: "shop.example.com", slug: "/live" },
        ]);
    });

    it("returns nothing at all when every slug is absent", () => {
        expect(purgeTargets(DEFAULTS, "page", [undefined])).toEqual([]);
    });

    it("does not prefix content slugs — they are already absolute paths", () => {
        expect(purgeTargets(ROMANIAN, "page", ["/despre-noi"])).toEqual([
            { domain: "bijuterie.ro", slug: "/despre-noi" },
        ]);
    });
});

describe("purgeTargets — commerce entities", () => {
    it("uses the hardcoded default prefix when the tenant configures none", () => {
        expect(purgeTargets(DEFAULTS, "product", ["widget"])).toEqual([
            { domain: "shop.example.com", slug: "/product/widget" },
        ]);
        expect(purgeTargets(DEFAULTS, "category", ["tools"])).toEqual([
            { domain: "shop.example.com", slug: "/category/tools" },
        ]);
    });

    it("uses the tenant's own prefix when configured (closes Known Gap 2)", () => {
        expect(purgeTargets(ROMANIAN, "product", ["inel-de-aur"])).toEqual([
            { domain: "bijuterie.ro", slug: "/produs/inel-de-aur" },
        ]);
        expect(purgeTargets(ROMANIAN, "category", ["inele"])).toEqual([
            { domain: "bijuterie.ro", slug: "/categorie/inele" },
        ]);
    });

    it("purges the old product URL too on a rename, under the tenant's prefix", () => {
        expect(purgeTargets(ROMANIAN, "product", ["inel-nou", "inel-vechi"])).toEqual([
            { domain: "bijuterie.ro", slug: "/produs/inel-nou" },
            { domain: "bijuterie.ro", slug: "/produs/inel-vechi" },
        ]);
    });

    it("tolerates a stored slug that already carries a leading slash", () => {
        expect(purgeTargets(DEFAULTS, "product", ["/widget"])).toEqual([
            { domain: "shop.example.com", slug: "/product/widget" },
        ]);
    });

    it("tolerates a configured prefix stored without a leading slash", () => {
        const routing: TenantRouting = { domain: "a.test", urlPrefixes: { product: "produs" } };
        expect(purgeTargets(routing, "product", ["x"])).toEqual([
            { domain: "a.test", slug: "/produs/x" },
        ]);
    });

    it("falls back to the default when a prefix is present but empty", () => {
        const routing: TenantRouting = { domain: "a.test", urlPrefixes: { product: "" } };
        expect(purgeTargets(routing, "product", ["x"])).toEqual([
            { domain: "a.test", slug: "/product/x" },
        ]);
    });
});

describe("purgeTargets — tenants with no usable domain", () => {
    it("returns nothing when the tenant record has no domain", () => {
        expect(purgeTargets({}, "page", ["/about"])).toEqual([]);
    });

    it("returns nothing for a blank/whitespace domain", () => {
        expect(purgeTargets({ domain: "   " }, "product", ["widget"])).toEqual([]);
    });

    it("trims a domain with stray whitespace rather than emitting a broken key", () => {
        expect(purgeTargets({ domain: " a.test " }, "page", ["/x"])).toEqual([
            { domain: "a.test", slug: "/x" },
        ]);
    });
});

/**
 * DOCUMENTED CONTRACT, not a wish: a tenant has exactly ONE domain.
 *
 * Evidence (2026-07-26): `TenantConfigSchema.domain` is a single `z.string()`;
 * `backend/src/tenant/create.ts` and `tenant/settings.ts` write one `Domain` attribute
 * (the `GSI_Domain` partition key) mirrored from it; `renderer/src/lib/tenant-directory.ts`
 * admits a host only on an exact match of that value, so no second host can ever produce an
 * ISR entry for the tenant.
 *
 * Per operator decision CACHE-2-D1 this replaces the slice's original "multi-domain" evidence
 * item, which has no representable input: supporting aliases (apex + www, a migration domain)
 * is a SCHEMA CHANGE — `TenantConfigSchema.domain` would become a list, `GSI_Domain` would
 * need one item per host, and the middleware host gate plus the CloudFront alias list would
 * have to follow. That is a separate slice, not a test case. This test pins the contract as it
 * actually is, so that such a change fails HERE first — at the one place in the purge path the
 * fan-out would have to be written (`TenantRouting.domain` in `revalidate-paths.ts`).
 */
describe("purgeTargets — one domain per tenant (current data model)", () => {
    it("maps one tenant to exactly the domain-keyed targets, and nothing else", () => {
        // Exact equality, not a shape check: the full emitted argument list is the contract.
        expect(purgeTargets(ROMANIAN, "product", ["inel-nou", "inel-vechi"])).toEqual([
            { domain: "bijuterie.ro", slug: "/produs/inel-nou" },
            { domain: "bijuterie.ro", slug: "/produs/inel-vechi" },
        ]);
    });

    it("emits one target per distinct slug — the list varies over slugs, never over domains", () => {
        const targets = purgeTargets(ROMANIAN, "page", ["/a", "/b", "/c"]);
        expect(targets).toHaveLength(3);
        expect(new Set(targets.map((t) => t.domain))).toEqual(new Set(["bijuterie.ro"]));
    });
});
