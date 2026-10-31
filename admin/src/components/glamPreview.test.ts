import { describe, it, expect } from "vitest";
import {
    HREF_BUDGET, PAGE_RESERVE, URL_PREFIX_DEFAULTS, buildFacetListing, catalogListing, catalogListingPath, formatSelection,
    listingHref, selectionFits, utf8Bytes, type FacetValueView,
} from "@amodx/shared";
import {
    CARD_LIMIT, FIDELITY_LIMITS, FIDELITY_NOTICE, attributeRows, effectivePreviewChoice, proseParagraphs, categoryLabel, collectionCategoryIds, defaultProductSlug, previewCards,
    previewPanel, previewProductPage, producerCategoryId, selectionOfHref, siteContextOf, type PreviewItem, type SiteContext,
} from "./glamPreview";

/**
 * CAT-IMPORT-PROFILE-1C — the preview assembly (design docs/slices/cat-import-profile-1.md § 5.1, § 5.2; units § 5.5
 * for `1c`). The dry-run members are built in the shape the backend sends (`previewDrafts`, `siteProductOf`,
 * backend/src/import/glam-pricelist.ts): drafts carry `id = preview:<slug>`, `status: "active"`, `sortOrder: 0` and
 * category ids `<found id>` / `new:<slug>`; site products carry only the site-reader fields.
 */

const TODAY = "2026-10-31";

const draft = (slug: string, categoryIds: string[], over: PreviewItem = {}): PreviewItem => ({
    id: `preview:${slug}`, status: "active", slug, title: slug, brand: "BOEN", categoryIds, sortOrder: 0,
    attributes: [], variants: [{ id: "g", name: "Format", options: [{ value: "A" }] }], ...over,
});

// § 5.5 fixture: kept products of every membership class, two drafts (existing / new collection).
const SITE: PreviewItem[] = [
    { id: "k1-active", status: "active", categoryIds: ["cat-boen"], brand: "Manual", attributes: [{ key: "Esență", value: "Oak" }] },
    { id: "k2-draft", status: "draft", categoryIds: ["cat-boen"], brand: "Manual" },
    { id: "k3-legacy", categoryIds: ["cat-boen"], brand: "Legacy" }, // no status
    { id: "k4-tomorrow", status: "active", categoryIds: ["cat-boen"], brand: "Manual", availableFrom: "2026-11-01" },
    { id: "k5-yesterday", status: "active", categoryIds: ["cat-boen"], brand: "Manual", availableUntil: "2026-10-30" },
];
/** A product of the previous set: the backend leaves it out of `siteProducts` (1a handler row); the admin adds no other source. */
const PREVIOUS_ID = "old-boen-oak";
const DRAFTS: PreviewItem[] = [
    draft("boen-oak", ["cat-boen", "cat-boen-classic"], { attributes: [{ key: "Esență", value: "Oak" }] }),
    draft("boen-ash", ["cat-boen", "new:boen-nordic"], { attributes: [{ key: "Esență", value: "Ash" }] }),
];
const REPORT = { drafts: DRAFTS, siteProducts: SITE };
const CONTEXT: SiteContext = {
    prefixes: URL_PREFIX_DEFAULTS,
    categories: [{ id: "cat-boen", slug: "boen", name: "BOEN" }, { id: "cat-boen-classic", slug: "boen-classic", name: "Classic" }],
};

const panelOf = (scope: Parameters<typeof previewPanel>[2], f = "", context: SiteContext | null = CONTEXT, report = REPORT) => {
    const p = previewPanel(report, context, scope, f, TODAY);
    if (p.kind !== "panel") throw new Error(`unavailable: ${p.reason}`);
    return p;
};
const ids = (items: PreviewItem[]) => items.map((p) => p.id);

describe("base sets over siteProducts ∪ drafts (§ 5.5)", () => {
    it("the producer's category: active and status-less kept products, both drafts; not draft, not outside the date window, not the previous set", () => {
        const p = panelOf({ kind: "category", id: producerCategoryId(DRAFTS)! });
        expect(p.path).toBe("/category/boen");
        expect(ids(p.listing.items)).toEqual(["k1-active", "k3-legacy", "preview:boen-ash", "preview:boen-oak"]);
        expect(ids(p.listing.items)).not.toContain(PREVIOUS_ID);
        expect(p.baseCount).toBe(4);
    });

    it("the shop: status active only — the legacy product is on its category page, NOT on the shop", () => {
        const p = panelOf({ kind: "shop" });
        expect(p.path).toBe("/shop");
        expect(ids(p.listing.items)).toEqual(["k1-active", "preview:boen-ash", "preview:boen-oak"]);
    });

    it("a draft in an existing collection is listed there by the found id; a draft in a new one only under new:<slug>", () => {
        expect(collectionCategoryIds(DRAFTS)).toEqual(["cat-boen-classic", "new:boen-nordic"]);
        const existing = panelOf({ kind: "category", id: "cat-boen-classic" });
        expect([existing.path, ids(existing.listing.items)]).toEqual(["/category/boen-classic", ["preview:boen-oak"]]);
        const created = panelOf({ kind: "category", id: "new:boen-nordic" });
        expect([created.path, ids(created.listing.items)]).toEqual(["/category/boen-nordic", ["preview:boen-ash"]]);
        expect(categoryLabel("new:boen-nordic", CONTEXT)).toBe("boen-nordic (nouă)");
        expect(categoryLabel("cat-boen-classic", CONTEXT)).toBe("Classic");
    });

    it("the panel shows the producer value from each draft's brand", () => {
        const producer = panelOf({ kind: "category", id: "cat-boen" }).listing.facets.find((f) => f.id === "producator")!;
        expect(producer.values.map((v) => [v.value, v.count])).toEqual([["BOEN", 2], ["Legacy", 1], ["Manual", 1]]);
    });

    it("no copy: each panel equals buildFacetListing called directly on catalogListing(siteProducts ∪ drafts) and the public path", () => {
        const f = formatSelection(new Map([["a.Esență", new Set(["Oak"])]]));
        const cases: [Parameters<typeof previewPanel>[2], string | undefined, string | undefined][] = [
            [{ kind: "shop" }, undefined, undefined],
            [{ kind: "category", id: "cat-boen" }, "cat-boen", "boen"],
            [{ kind: "category", id: "cat-boen-classic" }, "cat-boen-classic", "boen-classic"],
            [{ kind: "category", id: "new:boen-nordic" }, "new:boen-nordic", "boen-nordic"],
        ];
        for (const [scope, categoryId, slug] of cases) {
            for (const sel of ["", f]) {
                const direct = buildFacetListing(catalogListing([...SITE, ...DRAFTS], categoryId, TODAY), sel, catalogListingPath(URL_PREFIX_DEFAULTS, slug));
                expect(panelOf(scope, sel).listing).toEqual(direct);
            }
        }
    });
});

describe("a panel that cannot be built says why", () => {
    it("no site context; a found category missing from the list; an occupied address", () => {
        expect(previewPanel(REPORT, null, { kind: "shop" }, "", TODAY)).toMatchObject({ kind: "unavailable" });
        expect(previewPanel(REPORT, { ...CONTEXT, categories: [] }, { kind: "category", id: "cat-boen" }, "", TODAY))
            .toEqual({ kind: "unavailable", reason: "Categoria cat-boen nu este în lista de categorii a site-ului." });
        expect(previewPanel(REPORT, CONTEXT, { kind: "category", id: "occupied:boen-x" }, "", TODAY)).toMatchObject({ kind: "unavailable" });
    });
});

describe("near the URL budget: the path is an input (§ 5.5)", () => {
    const slug = `long-${"x".repeat(120)}`;
    const vA = "a".repeat(3000);
    const select = (...values: string[]) => new Map([["a.Finisaj", new Set(values)]]);
    const custom = { shop: "/magazin", category: "/categorie" };
    const path = `/categorie/${slug}`;
    // The longest vB whose addition still fits on the public path: the page-1 href then ends exactly PAGE_RESERVE bytes
    // short of the budget.
    let n = 1;
    while (selectionFits(path, select(vA, "b".repeat(n + 1)))) n++;
    const vB = "b".repeat(n);
    const site: PreviewItem[] = [
        { id: "n1", status: "active", categoryIds: ["cat-long"], attributes: [{ key: "Finisaj", value: vA }] },
        { id: "n2", status: "active", categoryIds: ["cat-long"], attributes: [{ key: "Finisaj", value: vA }] },
        { id: "n4", status: "active", categoryIds: ["cat-long"], attributes: [{ key: "Finisaj", value: "mat" }] },
    ];
    const drafts = [draft("long-b", ["cat-long"], { attributes: [{ key: "Finisaj", value: vB }] })];
    const report = { drafts, siteProducts: site };
    const context: SiteContext = { prefixes: custom, categories: [{ id: "cat-long", slug, name: "Long" }] };
    const f = formatSelection(select(vA));
    const valueB = (facets: { id: string; values: FacetValueView[] }[]) => facets.find((x) => x.id === "a.Finisaj")!.values.find((v) => v.value === vB)!;

    it("the fixture is near the budget: one more value gives a page-1 href exactly PAGE_RESERVE bytes under it", () => {
        expect(utf8Bytes(listingHref(path, select(vA, vB)))).toBe(HREF_BUDGET - PAGE_RESERVE);
    });

    it("(1) the assembled panel on the public path deep-equals buildFacetListing for the same base, f and path — value states included", () => {
        const p = panelOf({ kind: "category", id: "cat-long" }, f, context, report);
        const base = catalogListing([...site, ...drafts], "cat-long", TODAY);
        expect(p.listing).toEqual(buildFacetListing(base, f, path));
        expect(valueB(p.listing.facets).state).toBe("link");
    });

    it("(2) the same value is too-long on the preview path /_site/<id> + that path — the stated limit (§ 5.3), pinned", () => {
        const base = catalogListing([...site, ...drafts], "cat-long", TODAY);
        const onPreviewPath = buildFacetListing(base, f, `/_site/cm1-catalog${path}`);
        expect(valueB(onPreviewPath.facets).state).toBe("too-long");
        expect(onPreviewPath.budgetHint).toBe(true);
    });

    it("(3) the admin path follows the tenant's urlPrefixes (custom /categorie; absent → URL_PREFIX_DEFAULTS)", () => {
        expect(panelOf({ kind: "category", id: "cat-long" }, f, context, report).path).toBe(`/categorie/${slug}`);
        const defaults = siteContextOf({}, context.categories);
        expect(defaults.prefixes).toBe(URL_PREFIX_DEFAULTS);
        expect(panelOf({ kind: "category", id: "cat-long" }, f, defaults, report).path).toBe(`/category/${slug}`);
        expect(siteContextOf({ urlPrefixes: custom }, []).prefixes).toBe(custom);
    });

    it("a click follows the panel's own href: its f selects the value; the clear link selects nothing", () => {
        const p = panelOf({ kind: "category", id: "cat-long" }, f, context, report);
        const link = valueB(p.listing.facets) as Extract<FacetValueView, { state: "link" }>;
        const next = selectionOfHref(link.href);
        expect(next).toBe(formatSelection(select(vA, vB)));
        const after = panelOf({ kind: "category", id: "cat-long" }, next, context, report);
        expect(valueB(after.listing.facets).state).toBe("selected");
        expect(selectionOfHref(after.listing.clearHref!)).toBe("");
    });
});

describe("cards and the product page (§ 5.1 items 1, 2)", () => {
    const many = Array.from({ length: 30 }, (_, i) => draft(`p${i}`, ["c"], {
        variants: [{ name: "Format", options: Array.from({ length: i === 7 || i === 9 ? 5 : 2 }, (_, j) => ({ value: `${j}` })) }],
    }));

    it("the first 24 drafts in file order, and the count of all", () => {
        const { count, cards } = previewCards(many);
        expect(count).toBe(30);
        expect(cards).toHaveLength(CARD_LIMIT);
        expect(cards.map((c) => c.slug)).toEqual(many.slice(0, 24).map((d) => d.slug));
    });

    it("default product: the most options; ties → the first in file order", () => {
        expect(defaultProductSlug(many)).toBe("p7");
        expect(defaultProductSlug([])).toBeNull();
    });

    it("gallery, variant labels, joined attribute rows, and the prose exactly as the import writes it", () => {
        const prose = "<p>Wood: Oak</p><p>Format: 14mm Plank</p>";
        const page = previewProductPage(draft("boen-oak", ["c"], {
            imageLink: "https://img/1.jpg", additionalImageLinks: ["https://img/2.jpg"], longDescription: prose,
            variants: [{ name: "Format", options: [{ value: "120", imageLink: "https://img/1.jpg" }, { value: "90", imageLink: "https://img/2.jpg" }] }],
            attributes: [{ key: "Esență", value: "Oak" }, { key: "Format", value: "14mm Plank" }, { key: "Format", value: "14mm Chevron" }, { key: "Gol", value: "" }],
        }));
        expect(page.gallery).toEqual(["https://img/1.jpg", "https://img/2.jpg"]);
        expect([page.variantName, page.options.map((o) => o.value)]).toEqual(["Format", ["120", "90"]]);
        expect(page.attributes).toEqual([{ key: "Esență", value: "Oak" }, { key: "Format", value: "14mm Plank, 14mm Chevron" }]);
        expect(page.longDescription).toBe(prose); // CIP1-PROSE = A: unchanged
        expect(previewProductPage(draft("x", ["c"])).longDescription).toBeNull();
    });

    it("attribute rows: a repeated key is one row at its first place, values in stored order", () => {
        expect(attributeRows([{ key: "a", value: "1" }, { key: "b", value: "2" }, { key: "a", value: "3" }])).toEqual([{ key: "a", value: "1, 3" }, { key: "b", value: "2" }]);
        expect(attributeRows(undefined)).toEqual([]);
    });

    it("the fidelity notice is the ruled copy (§ 5.3, CIP1-PREVIEW)", () => {
        expect(FIDELITY_NOTICE).toBe("aspect aproximativ — datele și filtrele sunt exacte pentru adresa publică a site-ului");
    });
});

// ── Iteration 1 (review-0) ────────────────────────────────────────────────────────────────────────────────────────

describe("preview choices are checked against the report they are shown with (review-0 R2)", () => {
    it("a collection referenced as new:<slug> becomes a stored id in the next dry run (no input edit): the panel follows the report", () => {
        const first = [draft("boen-oak", ["cat-boen", "new:boen-classic"]), draft("boen-ash", ["cat-boen", "new:boen-nordic"])];
        const wanted = { productSlug: "boen-ash", collectionId: "new:boen-classic" }; // chosen on the first report
        expect(effectivePreviewChoice(first, wanted)).toEqual(wanted);
        // another import created "boen-classic"; the next dry run names it by its stored id
        const second = [draft("boen-oak", ["cat-boen", "cat-classic-1"]), draft("boen-ash", ["cat-boen", "new:boen-nordic"])];
        const context: SiteContext = { ...CONTEXT, categories: [...CONTEXT.categories, { id: "cat-classic-1", slug: "boen-classic", name: "Classic" }] };
        const report = { drafts: second, siteProducts: [] };
        const stale = previewPanel(report, context, { kind: "category", id: wanted.collectionId }, "", TODAY);
        expect(stale.kind === "panel" && stale.baseCount).toBe(0); // the obsolete reference lists nothing
        const effective = effectivePreviewChoice(second, wanted);
        expect(effective).toEqual({ productSlug: "boen-ash", collectionId: "cat-classic-1" });
        const fresh = panelOf({ kind: "category", id: effective.collectionId! }, "", context, report);
        expect(ids(fresh.listing.items)).toEqual(["preview:boen-oak"]);
    });

    it("a product no longer in the report falls back to the default; nothing chosen → the defaults", () => {
        const drafts = [draft("a", ["c"]), draft("b", ["c", "d"], { variants: [{ name: "F", options: [{ value: "1" }, { value: "2" }] }] })];
        expect(effectivePreviewChoice(drafts, { productSlug: "gone", collectionId: "gone" })).toEqual({ productSlug: "b", collectionId: "d" });
        expect(effectivePreviewChoice(drafts, { productSlug: null, collectionId: null })).toEqual({ productSlug: "b", collectionId: "d" });
    });
});

describe("the stated fidelity limits (§ 5.3, review-0 R3)", () => {
    it("theme/layout, snapshot (products, prefixes), UTC date window, the /_site/ budget limit, images", () => {
        const text = FIDELITY_LIMITS.join("\n");
        expect(text).toContain("tema, fonturile și așezarea paginilor nu sunt aplicate");
        expect(text).toContain("prefixele de adresă schimbate după verificare");
        expect(text).toContain("ziua UTC");
        expect(text).toContain("/_site/<id>/…");
        expect(text).toContain("poate fi activă aici și inactivă acolo");
        expect(text).toContain("Imaginile sunt adresele producătorului");
    });
});

describe("the prose as the component shows it (review-0 R5)", () => {
    /** The importer's transformation (backend glam/map.ts htmlParagraphs + escapeHtml), restated as the witness's input. */
    const importerProse = (lines: string[]) => lines.map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")}</p>`).join("");

    it("one paragraph per line, every escaped character back to its text", () => {
        const lines = ["Wood: Oak", "Surface: Beveled 4V, Brushed", `Note: "A & B" isn't <b>bold</b>`, "Literal: &lt; stays &amp;lt;"];
        expect(proseParagraphs(importerProse(lines))).toEqual(lines);
    });

    it("literal tag-like text is text, not markup", () => {
        expect(proseParagraphs("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toEqual(["<script>alert(1)</script>"]);
    });

    it("any other form is returned whole and undecoded (shown as text)", () => {
        expect(proseParagraphs("<p>a</p><b>x</b>")).toEqual(["<p>a</p><b>x</b>"]);
        expect(proseParagraphs("plain &amp; text")).toEqual(["plain &amp; text"]);
    });
});
