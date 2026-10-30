import { describe, it, expect, vi } from "vitest";

/**
 * CAT-IMAGES-1 — the ingest core (`import/glam/images.ts`): the decision per source over a fake copy port, the
 * per-product rewrite with the § 3.4 derivation (slice docs/slices/cat-images-1.md § 2.4–2.7, § 5), the time-budget
 * stop. The core is pure (it imports no lib/db.ts); the § 3.4 rule is passed in, and these rows pass the production
 * one, `withDerivedGallery` — `db.js` is mocked only because `catalog-product.ts`, which holds that rule, imports it.
 */

vi.mock("../../src/lib/db.js", () => ({ db: { send: vi.fn() }, TABLE_NAME: "test-table" }));

import {
    collectSources, decideSource, resolveSources, rewriteProduct, remainingWork,
    type IngestProduct, type SourceResult,
} from "../../src/import/glam/images.js";
import type { CopyResult } from "../../src/lib/image-upload.js";
import { withDerivedGallery } from "../../src/lib/catalog-product.js";

const derive = (options: any[]) => withDerivedGallery({}, options) as { imageLink?: string; additionalImageLinks: string[] };

const CDN = "https://cdn.test";
const src = (n: number) => `https://producer.test/${n}.jpg`;
const cdn = (n: number) => `${CDN}/t1/${n}.jpg`;

const product = (id: string, images: (string | undefined)[]): IngestProduct => ({
    id,
    slug: `slug-${id}`,
    options: images.map((imageLink, i) => (imageLink === undefined ? { value: `o${i + 1}` } : { value: `o${i + 1}`, imageLink })),
});

describe("collectSources", () => {
    it("distinct producer URLs in product then option order, with every holder; CDN-hosted options skipped", () => {
        const sources = collectSources([
            product("a", [src(1), src(2), undefined]),
            product("b", [src(2), cdn(9)]),
        ], CDN);
        expect(sources).toEqual([
            { url: src(1), holders: [{ productId: "a", slug: "slug-a", option: "o1" }] },
            { url: src(2), holders: [{ productId: "a", slug: "slug-a", option: "o2" }, { productId: "b", slug: "slug-b", option: "o1" }] },
        ]);
    });

    it("a URL that only starts like the CDN host (no '/' after it) is a producer URL", () => {
        expect(collectSources([product("a", ["https://cdn.test.evil/x.jpg"])], CDN)).toHaveLength(1);
    });
});

describe("decideSource — one row per kind", () => {
    it.each<[string, string | undefined, CopyResult | undefined, SourceResult]>([
        ["MEDIAMAP# hit → cached (no copy)", cdn(1), undefined, { kind: "cached", url: src(1), cdnUrl: cdn(1) }],
        ["copied → ingested with its CDN URL", undefined, { kind: "copied", cdnUrl: cdn(2) }, { kind: "ingested", url: src(1), cdnUrl: cdn(2) }],
        ["refused → refused with the rule", undefined, { kind: "refused", rule: "r" }, { kind: "refused", url: src(1), rule: "r" }],
        ["failed (HTTP) → failed with status, content-type, bytes", undefined,
            { kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 9 } },
            { kind: "failed", url: src(1), failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 9 } }],
        ["failed (no answer) → failed with the error code", undefined,
            { kind: "failed", failure: { kind: "error", code: "CERT_HAS_EXPIRED" } },
            { kind: "failed", url: src(1), failure: { kind: "error", code: "CERT_HAS_EXPIRED" } }],
    ])("%s", (_label, cached, copy, expected) => {
        expect(decideSource(src(1), cached, copy)).toEqual(expected);
    });
});

describe("resolveSources — over a fake copy port", () => {
    const outcomes: Record<string, CopyResult> = {
        [src(1)]: { kind: "copied", cdnUrl: cdn(1) },
        [src(2)]: { kind: "refused", rule: "x resolves to 10.0.0.1: private 10.0.0.0/8 (RFC 1918)" },
        [src(3)]: { kind: "failed", failure: { kind: "error", code: "ETIMEDOUT" } },
    };
    const sources = [1, 2, 3, 4].map((n) => ({ url: src(n), holders: [] }));

    it("cached sources are never copied; every other source gets exactly one copy", async () => {
        const copy = vi.fn(async (url: string) => outcomes[url]);
        const results = await resolveSources(sources, new Map([[src(4), cdn(4)]]), copy, () => true, 2);
        expect(copy.mock.calls.map((c) => c[0]).sort()).toEqual([src(1), src(2), src(3)]);
        expect([...results.values()].map((r) => r.kind).sort()).toEqual(["cached", "failed", "ingested", "refused"]);
    });

    it("the time budget: no new copy starts once mayStartCopy() is false; unstarted sources stay unresolved", async () => {
        let started = 0;
        const copy = vi.fn(async (url: string) => { started++; return outcomes[url] ?? { kind: "copied", cdnUrl: cdn(0) } as CopyResult; });
        const results = await resolveSources(sources, new Map(), copy, () => started < 2, 1);
        expect(copy).toHaveBeenCalledTimes(2);
        expect([...results.keys()]).toEqual([src(1), src(2)]);
    });

    it("a copy that throws (infrastructure, not a source outcome) → raised only after every other worker stopped", async () => {
        let inFlight = 0;
        const copy = vi.fn(async (url: string) => {
            inFlight++;
            await new Promise((r) => setTimeout(r, url === src(1) ? 1 : 20));
            inFlight--;
            if (url === src(1)) throw new Error("S3 down");
            return outcomes[url] ?? ({ kind: "copied", cdnUrl: cdn(0) } as CopyResult);
        });
        let calls = 0;
        await expect(resolveSources(sources, new Map(), copy, () => calls++ < 4, 4)).rejects.toThrow("S3 down");
        expect(inFlight).toBe(0);
    });

    it("a budget already spent still resolves the cached sources", async () => {
        const copy = vi.fn();
        const results = await resolveSources(sources, new Map([[src(3), cdn(3)]]), copy, () => false, 4);
        expect(copy).not.toHaveBeenCalled();
        expect([...results.values()]).toEqual([{ kind: "cached", url: src(3), cdnUrl: cdn(3) }]);
    });
});

describe("rewriteProduct — successes rewritten, failures removed, derived fields by the § 3.4 rule", () => {
    const results = new Map<string, SourceResult>([
        [src(1), { kind: "failed", url: src(1), failure: { kind: "error", code: "ENOTFOUND" } }],
        [src(2), { kind: "ingested", url: src(2), cdnUrl: cdn(2) }],
        [src(3), { kind: "cached", url: src(3), cdnUrl: cdn(3) }],
        [src(4), { kind: "refused", url: src(4), rule: "r" }],
    ]);

    it("the original main image fails → the next option image becomes the main one", () => {
        const rewrite = rewriteProduct(product("a", [src(1), src(2), src(3)]), results, derive);
        expect(rewrite).toEqual({
            kind: "rewritten",
            options: [{ value: "o1" }, { value: "o2", imageLink: cdn(2) }, { value: "o3", imageLink: cdn(3) }],
            imageLink: cdn(2),
            additionalImageLinks: [cdn(3)],
        });
        // The failed option keeps its label and has NO imageLink key (never "" or null — CM-D7).
        if (rewrite.kind === "rewritten") expect(Object.keys(rewrite.options[0])).toEqual(["value"]);
    });

    it("every source fails → imageless: the imageLink key absent, additionalImageLinks []", () => {
        const rewrite = rewriteProduct(product("a", [src(1), src(4), undefined]), results, derive);
        expect(rewrite).toEqual({
            kind: "rewritten",
            options: [{ value: "o1" }, { value: "o2" }, { value: "o3" }],
            additionalImageLinks: [],
        });
        expect("imageLink" in rewrite).toBe(false);
    });

    it("unresolved sources stay producer URLs and take part in the derivation; other option keys are kept", () => {
        const p: IngestProduct = { id: "a", slug: "s", options: [{ value: "o1", imageLink: src(9), extra: 1 }, { value: "o2", imageLink: src(2), extra: 2 }] };
        expect(rewriteProduct(p, results, derive)).toEqual({
            kind: "rewritten",
            options: [{ value: "o1", imageLink: src(9), extra: 1 }, { value: "o2", imageLink: cdn(2), extra: 2 }],
            imageLink: src(9),
            additionalImageLinks: [cdn(2)],
        });
    });

    it("a product none of whose sources is resolved → unchanged (no write)", () => {
        expect(rewriteProduct(product("a", [src(9), undefined]), results, derive)).toEqual({ kind: "unchanged" });
    });

    it("two options sharing one copied image → one gallery entry (distinct images)", () => {
        const rewrite = rewriteProduct(product("a", [src(2), src(2), src(3)]), results, derive);
        expect(rewrite).toMatchObject({ imageLink: cdn(2), additionalImageLinks: [cdn(3)] });
    });
});

describe("remainingWork — the termination measure", () => {
    it("counts holdings (product, option) on a producer URL, and the distinct URLs among them; CDN URLs and removed images do not count", () => {
        const set = [product("a", [src(1), src(2)]), product("b", [src(2), src(5)])];
        expect(remainingWork(set, new Map(), CDN)).toEqual({ options: 4, sources: 3 });
        const stored = new Map([["a", [{ value: "o1" }, { value: "o2", imageLink: cdn(2) }]]]);
        expect(remainingWork(set, stored, CDN)).toEqual({ options: 2, sources: 2 }); // b still holds src(2) and src(5)
    });

    it("review-0 CIM-F2 witness: a source shared by two products, only the first written → holdings 2 → 1 while distinct URLs stay 1 → 1", () => {
        const set = [product("a", [src(7)]), product("b", [src(7)])];
        expect(remainingWork(set, new Map(), CDN)).toEqual({ options: 2, sources: 1 });
        expect(remainingWork(set, new Map([["a", [{ value: "o1", imageLink: cdn(7) }]]]), CDN)).toEqual({ options: 1, sources: 1 });
    });
});
