import { describe, it, expect } from "vitest";
import {
    normalizeEdgePaths,
    planEdgeInvalidation,
    FAST_LANE_WILDCARD_THRESHOLD,
} from "../../src/lib/edge-invalidation.js";
import { purgeTargets, type TenantRouting } from "../../src/lib/revalidate-paths.js";

/**
 * cache-4a evidence: the fast-lane coalescing rule that turns a set of accumulated changed
 * paths into the `Paths.Items` of ONE CloudFront invalidation.
 *
 * Pure: no AWS SDK, no DynamoDB, no environment. Run with `npm run test:unit`
 * (config `vitest.unit.config.ts`, no `setupFiles`), NOT `npm test` (live staging DynamoDB).
 *
 * DoD 4 (invalidation-volume guardrail) lives here: dedupe within a drain window, and a
 * distinct-path ceiling above which the drain collapses to a single `/*`.
 */

describe("normalizeEdgePaths", () => {
    it("guarantees exactly one leading slash", () => {
        expect(normalizeEdgePaths(["about", "/produs/inel"])).toEqual(["/about", "/produs/inel"]);
    });

    it("collapses ACCIDENTAL multiple leading slashes to exactly one (billing correctness)", () => {
        // To CloudFront `//about` and `/about` are two distinct paths — a stray double slash
        // would bill twice and defeat the dedupe. Normalization folds them into one charged path.
        expect(normalizeEdgePaths(["//about", "///x", "/about"])).toEqual(["/about", "/x"]);
    });

    it("drops blanks, whitespace-only, and non-strings", () => {
        expect(normalizeEdgePaths(["", "   ", "/live", undefined as unknown as string])).toEqual(["/live"]);
    });

    it("dedupes while preserving first-seen order (coalescing within a window)", () => {
        expect(normalizeEdgePaths(["/a", "/b", "/a", "b", "/c"])).toEqual(["/a", "/b", "/c"]);
    });

    it("returns [] for an empty input", () => {
        expect(normalizeEdgePaths([])).toEqual([]);
    });
});

describe("planEdgeInvalidation — the drain-time plan", () => {
    it("returns the deduped, slash-normalized paths verbatim under the threshold", () => {
        expect(planEdgeInvalidation(["/about", "about", "/produs/inel"])).toEqual([
            "/about",
            "/produs/inel",
        ]);
    });

    it("returns [] for nothing to invalidate (caller then skips the CloudFront call)", () => {
        expect(planEdgeInvalidation([])).toEqual([]);
        expect(planEdgeInvalidation(["", "  "])).toEqual([]);
    });

    it("keeps a batch of exactly the threshold as targeted paths (no collapse)", () => {
        const paths = Array.from({ length: FAST_LANE_WILDCARD_THRESHOLD }, (_, i) => `/p/${i}`);
        const plan = planEdgeInvalidation(paths);
        expect(plan).toHaveLength(FAST_LANE_WILDCARD_THRESHOLD);
        expect(plan).not.toContain("/*");
    });

    it("collapses to a single /* once DISTINCT paths exceed the threshold (stampede guardrail)", () => {
        const paths = Array.from({ length: FAST_LANE_WILDCARD_THRESHOLD + 1 }, (_, i) => `/p/${i}`);
        expect(planEdgeInvalidation(paths)).toEqual(["/*"]);
    });

    it("counts DISTINCT paths for the threshold, not raw entries — dupes never trip the collapse", () => {
        // Far more than the threshold in raw entries, but only two distinct paths.
        const noisy = Array.from({ length: FAST_LANE_WILDCARD_THRESHOLD * 5 }, (_, i) =>
            i % 2 === 0 ? "/about" : "/contact",
        );
        expect(planEdgeInvalidation(noisy)).toEqual(["/about", "/contact"]);
    });
});

/**
 * The two pure pieces compose into the fast-lane pipeline a mutation drives:
 *   purgeTargets(routing, kind, slugs).map(t => t.slug)  ->  enqueue  ->  planEdgeInvalidation
 * A CloudFront invalidation path is the viewer URI (`slug`), host-agnostic — no domain prefix,
 * unlike the ISR key. This test pins that the fast-lane Items are exactly those slugs.
 */
describe("fast-lane pipeline — purgeTargets slugs are the CloudFront Items", () => {
    const ROMANIAN: TenantRouting = {
        domain: "bijuterie.ro",
        urlPrefixes: { product: "/produs", category: "/categorie" },
    };

    it("an ordinary product rename yields the new + old URI paths, no domain", () => {
        const targets = purgeTargets(ROMANIAN, "product", ["inel-nou", "inel-vechi"]);
        const items = planEdgeInvalidation(targets.map((t) => t.slug));
        expect(items).toEqual(["/produs/inel-nou", "/produs/inel-vechi"]);
    });

    it("a page edit yields its absolute path unchanged", () => {
        const targets = purgeTargets(ROMANIAN, "page", ["/despre-noi"]);
        expect(planEdgeInvalidation(targets.map((t) => t.slug))).toEqual(["/despre-noi"]);
    });

    it("a domainless tenant yields nothing to invalidate (no live edge entry exists)", () => {
        const targets = purgeTargets({}, "page", ["/about"]);
        expect(planEdgeInvalidation(targets.map((t) => t.slug))).toEqual([]);
    });
});
