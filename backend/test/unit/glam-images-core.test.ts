import { describe, it, expect, vi } from "vitest";

/**
 * CAT-IMAGES-1 — the ingest core (`import/glam/images.ts`): the decision per source over a fake copy port, the
 * per-product rewrite with the § 3.4 derivation (slice docs/slices/cat-images-1.md § 2.4–2.7, § 5), the time-budget
 * stop. The core is pure (it imports no lib/db.ts); the § 3.4 rule is passed in, and these rows pass the production
 * one, `withDerivedGallery` — `db.js` is mocked only because `catalog-product.ts`, which holds that rule, imports it.
 */

vi.mock("../../src/lib/db.js", () => ({ db: { send: vi.fn() }, TABLE_NAME: "test-table" }));

import {
    collectSources, decideSource, hiddenWithoutImage, holdsCopiedImage, planProductWrite, resolveSources, rewriteProduct, remainingWork,
    type IngestProduct, type SourceResult,
} from "../../src/import/glam/images.js";
import type { CopyResult } from "../../src/lib/image-upload.js";
import { checkProductWrite, withDerivedGallery } from "../../src/lib/catalog-product.js";

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
        expect(remainingWork(set, new Map(), CDN)).toEqual({ options: 4, extras: 0, sources: 3 });
        const stored = new Map([["a", [{ value: "o1" }, { value: "o2", imageLink: cdn(2) }]]]);
        expect(remainingWork(set, stored, CDN)).toEqual({ options: 2, extras: 0, sources: 2 }); // b still holds src(2) and src(5)
    });

    it("review-0 CIM-F2 witness: a source shared by two products, only the first written → holdings 2 → 1 while distinct URLs stay 1 → 1", () => {
        const set = [product("a", [src(7)]), product("b", [src(7)])];
        expect(remainingWork(set, new Map(), CDN)).toEqual({ options: 2, extras: 0, sources: 1 });
        expect(remainingWork(set, new Map([["a", [{ value: "o1", imageLink: cdn(7) }]]]), CDN)).toEqual({ options: 1, extras: 0, sources: 1 });
    });
});

describe("CAT-IMAGE-GATE-1 — publication rules (docs/slices/cat-image-gate-1.md § 3 items 3, 4)", () => {
    const CDN = "https://cdn.test";
    const cdn = `${CDN}/t1/a.jpg`;
    const producer = "https://img.test/1.jpg";
    const rewritten = (options: { value: string; imageLink?: string }[], imageLink?: string) =>
        ({ kind: "rewritten" as const, options, ...(imageLink !== undefined ? { imageLink } : {}), additionalImageLinks: [] });

    it("holdsCopiedImage: an option image or the main image under the CDN; producer URLs and no image do not count", () => {
        expect(holdsCopiedImage([{ value: "a", imageLink: cdn }], undefined, CDN)).toBe(true);
        expect(holdsCopiedImage([{ value: "a" }], cdn, CDN)).toBe(true);
        expect(holdsCopiedImage([{ value: "a", imageLink: producer }], producer, CDN)).toBe(false);
        expect(holdsCopiedImage([{ value: "a" }], undefined, CDN)).toBe(false);
        // the CDN prefix needs its "/": a host that only starts with the CDN text is a producer URL
        expect(holdsCopiedImage([{ value: "a", imageLink: `${CDN}.evil/x.jpg` }], undefined, CDN)).toBe(false);
    });

    const ok = (url: string): SourceResult => ({ kind: "ingested", url, cdnUrl: cdn });
    const dead = (url: string): SourceResult => ({ kind: "failed", url, failure: { kind: "error", code: "ENOTFOUND" } });
    const results = (...r: SourceResult[]) => new Map(r.map((x) => [x.url, x]));

    it("planProductWrite: publish only from draft, only when a copied image is held after the write", () => {
        const read = [{ value: "a", imageLink: producer }];
        expect(planProductWrite({ options: read, imageLink: producer, status: "draft" }, read, results(ok(producer)), derive, CDN))
            .toMatchObject({ kind: "write", publish: true, images: { options: [{ value: "a", imageLink: cdn }], imageLink: cdn } });
        expect(planProductWrite({ options: read, imageLink: producer, status: "draft" }, read, results(dead(producer)), derive, CDN))
            .toMatchObject({ kind: "write", publish: false, images: { options: [{ value: "a" }] } }); // every source failed
        expect(planProductWrite({ options: read, imageLink: producer, status: "draft" }, read, results(), derive, CDN)).toEqual({ kind: "none" }); // not resolved yet
        for (const status of ["active", "archived", undefined]) {
            expect(planProductWrite({ options: read, imageLink: producer, status }, read, results(ok(producer)), derive, CDN)).toMatchObject({ kind: "write", publish: false });
        }
    });

    it("planProductWrite (CIG-R2): a draft already holding a tenant-CDN image gets a publish-only write; a draft with no image gets none", () => {
        const onCdn = [{ value: "a", imageLink: cdn }];
        expect(planProductWrite({ options: onCdn, imageLink: cdn, status: "draft" }, onCdn, results(), derive, CDN)).toEqual({ kind: "write", images: null, publish: true });
        expect(planProductWrite({ options: onCdn, imageLink: cdn, status: "active" }, onCdn, results(), derive, CDN)).toEqual({ kind: "none" });
        expect(planProductWrite({ options: [{ value: "a" }], status: "draft" }, [{ value: "a" }], results(), derive, CDN)).toEqual({ kind: "none" });
    });

    it("planProductWrite re-planned on a later read (CIG-R1): a success is applied where another request removed the image; a failure never removes a stored copied image", () => {
        const read = [{ value: "a", imageLink: producer }];
        // another request removed `a` (its copy failed) and published through another option meanwhile
        expect(planProductWrite({ options: [{ value: "a" }, { value: "b", imageLink: cdn }], imageLink: cdn, status: "active" }, read, results(ok(producer)), derive, CDN))
            .toMatchObject({ kind: "write", publish: false, images: { options: [{ value: "a", imageLink: cdn }, { value: "b", imageLink: cdn }] } });
        // another request stored the copied image and published; this request's failure for the same source changes nothing
        expect(planProductWrite({ options: [{ value: "a", imageLink: cdn }], imageLink: cdn, status: "active" }, read, results(dead(producer)), derive, CDN)).toEqual({ kind: "none" });
        // default `read` = the product's own options: CAT-IMAGES-1's rule unchanged (no image → nothing to resolve)
        expect(rewriteProduct({ id: "p", slug: "p", options: [{ value: "a" }] }, results(ok(producer)), derive)).toEqual({ kind: "unchanged" });
    });

    it("hiddenWithoutImage: draft, no copied image and no producer URL left; undecided or hand-hidden products are not listed", () => {
        expect(hiddenWithoutImage("draft", [{ value: "a" }], undefined, CDN)).toBe(true);
        expect(hiddenWithoutImage("draft", [{ value: "a", imageLink: producer }], producer, CDN)).toBe(false); // still to copy
        expect(hiddenWithoutImage("draft", [{ value: "a", imageLink: cdn }], cdn, CDN)).toBe(false); // hidden by hand, has an image
        expect(hiddenWithoutImage("active", [{ value: "a" }], undefined, CDN)).toBe(false); // published without images
    });
});

// ── CAT-IMPORT-GALLERY-1: an option's extras (docs/slices/cat-import-gallery-1.md § 3 item 3) ──────────────────────

describe("CAT-IMPORT-GALLERY-1 — extras are sources; a failed extra is removed; an extra never publishes", () => {
    const withExtras = (id: string, options: { value: string; imageLink?: string; additionalImageLinks?: string[] }[]): IngestProduct =>
        ({ id, slug: `slug-${id}`, options });
    const ok = (n: number): SourceResult => ({ kind: "ingested", url: src(n), cdnUrl: cdn(n) });
    const dead = (n: number): SourceResult => ({ kind: "failed", url: src(n), failure: { kind: "error", code: "ENOTFOUND" } });

    it("collectSources: per option the main image, then its extras (holder `extra: true`); CDN extras skipped; one URL many holders", () => {
        const sources = collectSources([
            withExtras("a", [{ value: "o1", imageLink: src(1), additionalImageLinks: [src(2), cdn(9), src(3)] }]),
            withExtras("b", [{ value: "o1", imageLink: src(2) }]),
        ], CDN);
        expect(sources).toEqual([
            { url: src(1), holders: [{ productId: "a", slug: "slug-a", option: "o1" }] },
            { url: src(2), holders: [{ productId: "a", slug: "slug-a", option: "o1", extra: true }, { productId: "b", slug: "slug-b", option: "o1" }] },
            { url: src(3), holders: [{ productId: "a", slug: "slug-a", option: "o1", extra: true }] },
        ]);
    });

    it("rewriteProduct: a copied extra becomes its CDN URL, a failed one is removed, an unresolved one is kept; the gallery is derived again", () => {
        const p = withExtras("a", [
            { value: "o1", imageLink: src(1), additionalImageLinks: [src(2), src(3), src(4)] },
            { value: "o2", imageLink: src(5) },
        ]);
        const rewrite = rewriteProduct(p, new Map([[src(1), ok(1)], [src(2), ok(2)], [src(3), dead(3)]]), derive);
        expect(rewrite).toEqual({
            kind: "rewritten",
            options: [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [cdn(2), src(4)] }, { value: "o2", imageLink: src(5) }],
            imageLink: cdn(1),
            additionalImageLinks: [cdn(2), src(4), src(5)],
        });
    });

    it("rewriteProduct: when every extra fails, the key is removed (never stored empty); only extras resolved → still a rewrite", () => {
        const p = withExtras("a", [{ value: "o1", imageLink: src(1), additionalImageLinks: [src(2)] }]);
        const rewrite = rewriteProduct(p, new Map([[src(2), dead(2)]]), derive);
        expect(rewrite).toEqual({ kind: "rewritten", options: [{ value: "o1", imageLink: src(1) }], imageLink: src(1), additionalImageLinks: [] });
        expect("additionalImageLinks" in (rewrite as any).options[0]).toBe(false);
        expect(rewriteProduct(p, new Map(), derive)).toEqual({ kind: "unchanged" });
    });

    it("remainingWork counts extra holdings apart from main holdings; both form the measure", () => {
        const set = [withExtras("a", [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [src(2), cdn(3), src(4)] }])];
        expect(remainingWork(set, new Map(), CDN)).toEqual({ options: 0, extras: 2, sources: 2 });
        expect(remainingWork(set, new Map([["a", [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [cdn(2)] }]]]), CDN))
            .toEqual({ options: 0, extras: 0, sources: 0 });
    });

    it("an extra never publishes: a draft whose only copied image is an extra stays draft and is listed hidden", () => {
        // The option has no main image, so the derived product imageLink IS the copied extra.
        const current = { options: [{ value: "o1", additionalImageLinks: [src(2)] }], status: "draft" };
        const plan = planProductWrite(current, current.options, new Map([[src(2), ok(2)]]), derive, CDN);
        expect(plan).toEqual({
            kind: "write",
            images: { kind: "rewritten", options: [{ value: "o1", additionalImageLinks: [cdn(2)] }], imageLink: cdn(2), additionalImageLinks: [] },
            publish: false,
        });
        expect(holdsCopiedImage([{ value: "o1", additionalImageLinks: [cdn(2)] }], cdn(2), CDN)).toBe(false);
        expect(hiddenWithoutImage("draft", [{ value: "o1", additionalImageLinks: [cdn(2)] }], cdn(2), CDN)).toBe(true);
    });

    it("a copied main image publishes even when the option's extra fails (the extra is removed in the same write)", () => {
        const current = { options: [{ value: "o1", imageLink: src(1), additionalImageLinks: [src(2)] }], status: "draft" };
        const plan = planProductWrite(current, current.options, new Map([[src(1), ok(1)], [src(2), dead(2)]]), derive, CDN);
        expect(plan).toMatchObject({ kind: "write", publish: true, images: { options: [{ value: "o1", imageLink: cdn(1) }] } });
    });
});

describe("CAT-IMPORT-GALLERY-1 — the write boundary (every product write: create, update — the admin save —, the import)", () => {
    const imported = (options: any[], extra: Record<string, unknown> = {}) => ({
        importSource: "glam:alpod/her", title: "T", variants: [{ id: "g", name: "Format", options }], imageLink: "https://stale.test/x.jpg",
        additionalImageLinks: ["https://stale.test/y.jpg"], ...extra,
    });

    it("an option's additionalImageLinks is accepted (not a monetary key) and the gallery is derived by the one rule", () => {
        const check = checkProductWrite(imported([
            { value: "A", imageLink: src(1), additionalImageLinks: [src(2), src(3)] },
            { value: "B", imageLink: src(4), additionalImageLinks: [src(3)] },
        ]), true);
        expect(check).toMatchObject({ kind: "accepted", item: { imageLink: src(1), additionalImageLinks: [src(2), src(3), src(4)] } });
        if (check.kind === "accepted") expect(check.item.variants[0].options[0].additionalImageLinks).toEqual([src(2), src(3)]);
    });

    it("a monetary key is still refused next to extras", () => {
        expect(checkProductWrite(imported([{ value: "A", imageLink: src(1), additionalImageLinks: [src(2)], priceOverride: "1" }]), true))
            .toEqual({ kind: "refused", error: "A catalog site stores no prices: remove the variant option priceOverride." });
    });
});

describe("CAT-IMPORT-GALLERY-1 R-CIG-REBASE — extras follow the CIG-R1 rebase of the main image", () => {
    const ok = (n: number): SourceResult => ({ kind: "ingested", url: src(n), cdnUrl: cdn(n) });
    const dead = (n: number): SourceResult => ({ kind: "refused", url: src(n), rule: "destination not allowed" });

    // Round 3 (operator ruling R-CIG-REBASE): merge by the ORIGINAL holding — the read's order is the order, one stored
    // image per holding. (The round-2 row here expected `cdn(2), src(4), cdn(3)` under a name claiming read order.)
    it("a copied extra that a concurrent request removed is restored IN ITS READ POSITION; another request's copy (known by MEDIAMAP#) keeps its holding", () => {
        // read: main 1, extras 2, 3, 4; now (another request): main copied, 2 removed after a failure, 3 copied, 4 untouched
        const read = [{ value: "o1", imageLink: src(1), additionalImageLinks: [src(2), src(3), src(4)] }];
        const now = { id: "a", slug: "slug-a", options: [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [cdn(3), src(4)] }] };
        const stored = new Map([[src(3), cdn(3)]]); // the other request's MEDIAMAP# entry for source 3
        const rewrite = rewriteProduct(now, new Map([[src(1), dead(1)], [src(2), ok(2)], [src(3), dead(3)]]), derive, read, stored);
        expect(rewrite).toEqual({
            kind: "rewritten",
            options: [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [cdn(2), cdn(3), src(4)] }],
            imageLink: cdn(1),
            additionalImageLinks: [cdn(2), cdn(3), src(4)],
        });
    });

    it("mixed outcomes over five holdings: every image in read order — restored copies, kept foreign copies, kept sources", () => {
        const read = [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [src(2), src(3), src(4), src(5), src(6)] }];
        // another request: 2 and 5 failed (removed), 3 and 6 copied (its own random names), 4 untouched
        const foreign = (n: number) => `${CDN}/t1/other-${n}.jpg`;
        const now = { id: "a", slug: "slug-a", options: [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [foreign(3), src(4), foreign(6)] }] };
        const stored = new Map([[src(3), foreign(3)], [src(6), foreign(6)], [src(2), cdn(2)], [src(4), cdn(4)], [src(5), cdn(5)]]);
        const results = new Map([[src(2), ok(2)], [src(3), dead(3)], [src(4), ok(4)], [src(5), ok(5)], [src(6), dead(6)]]);
        expect(rewriteProduct(now, results, derive, read, stored)).toMatchObject({
            kind: "rewritten",
            options: [{ value: "o1", additionalImageLinks: [cdn(2), foreign(3), cdn(4), cdn(5), foreign(6)] }],
        });
    });

    it("two overlapping SUCCESSFUL copies of one source (different CDN URLs): the stored copy is kept, the second is never appended — whichever MEDIAMAP# write came last", () => {
        const read = [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [src(5)] }];
        const theirs = `${CDN}/t1/first-copy-5.jpg`;
        const now = { id: "a", slug: "slug-a", options: [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [theirs] }] };
        const results = new Map([[src(5), ok(5)]]); // this request's copy: cdn(5) ≠ theirs
        expect(rewriteProduct(now, results, derive, read, new Map([[src(5), theirs]]))).toEqual({ kind: "unchanged" }); // their entry last
        expect(rewriteProduct(now, results, derive, read, new Map([[src(5), cdn(5)]]))).toEqual({ kind: "unchanged" }); // ours last
    });

    it("without any identity (no MEDIAMAP# entry for the source): the unknown copy is kept after the holdings — misordered, never dropped, and this request's copy is restored", () => {
        const read = [{ value: "o1", imageLink: src(1), additionalImageLinks: [src(2), src(3), src(4)] }];
        const now = { id: "a", slug: "slug-a", options: [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [cdn(3), src(4)] }] };
        const rewrite = rewriteProduct(now, new Map([[src(1), dead(1)], [src(2), ok(2)], [src(3), dead(3)]]), derive, read);
        expect(rewrite).toMatchObject({ kind: "rewritten", options: [{ value: "o1", additionalImageLinks: [cdn(2), src(4), cdn(3)] }] });
    });

    it("a failure never removes what another request stored; nothing to do → unchanged", () => {
        const read = [{ value: "o1", imageLink: src(1), additionalImageLinks: [src(2)] }];
        const now = { id: "a", slug: "slug-a", options: [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [cdn(2)] }] };
        expect(rewriteProduct(now, new Map([[src(1), dead(1)], [src(2), dead(2)]]), derive, read)).toEqual({ kind: "unchanged" });
    });
});

// ── RESIDUAL CAT-IMAGES-OVERLAP-1 (frozen by operator ruling 2026-11-02 ~03:20Z) ─────────────────────────────────────
// CHARACTERIZATION of the current behaviour — NOT a conformity oracle. It pins a known defect so the follow-up sees it
// change; the follow-up's fix must REPLACE this expectation (the correct result is `A-r2, B-r1`).
describe("RESIDUAL CAT-IMAGES-OVERLAP-1 (characterization, not a conformity oracle) — the holding fallback when a stored copy has no identity", () => {
    it("holdings A, B; stored B-r1 (another request's copy, its MEDIAMAP# entry since overwritten); this request copied A and B: B-r1 is matched to holding A — A's copy is SUPPRESSED and B is stored TWICE", () => {
        const A = src(41), B = src(42);
        const Ar2 = `${CDN}/t1/r2-41.jpg`, Br1 = `${CDN}/t1/r1-42.jpg`, Br2 = `${CDN}/t1/r2-42.jpg`;
        const read = [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [A, B] }];
        const now = { id: "a", slug: "slug-a", options: [{ value: "o1", imageLink: cdn(1), additionalImageLinks: [Br1] }] };
        const results = new Map<string, SourceResult>([[A, { kind: "ingested", url: A, cdnUrl: Ar2 }], [B, { kind: "ingested", url: B, cdnUrl: Br2 }]]);
        const stored = new Map([[A, Ar2], [B, Br2]]); // MEDIAMAP# now holds THIS request's copies
        expect(rewriteProduct(now, results, derive, read, stored)).toMatchObject({
            kind: "rewritten",
            options: [{ value: "o1", additionalImageLinks: [Br1, Br2] }], // defect: A-r2 missing, B twice
        });
    });
});
