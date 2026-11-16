import { describe, it, expect } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { blockStrings, resolveLocaleStrings } from "@amodx/shared";
import { RENDER_LOADERS } from "../src/render";
import { CategoryShowcaseSchema } from "../src/category-showcase/schema";
import { CategoryShowcasePlugin } from "../src/category-showcase";
import { CategoryShowcaseEditor, storedShowcaseOption, badgeTagsFromText } from "../src/category-showcase/CategoryShowcaseEditor";
import { PostGridSchema } from "../src/post-grid/schema";
import { PostGridPlugin } from "../src/post-grid";
import { PostGridEditor, storedText } from "../src/post-grid/PostGridEditor";
import { SHOWCASE_CASES, POST_GRID_CASES, SHOWCASE_BASE, POST_GRID_BASE, PRODUCTS, CATALOG_PRODUCTS, type StringsKind } from "./sectionBlocksBaselineCases";
import BASELINE from "./sectionBlocks.baseline.json";

/**
 * SHOP-LOOK-1D — the options of the `categoryShowcase` card and the `postGrid` side panel (docs/slices/shop-look-1d.md;
 * design docs/slices/shop-look-1.md § 4.2, § 6.2, § 7).
 *
 * The rule under test (§ 4): ABSENT = TODAY'S BYTES. `sectionBlocks.baseline.json` holds the HTML that the two renders
 * at 61d965d (before this slice) gave for the inputs of `sectionBlocksBaselineCases.ts`. Every "absent" test renders
 * those inputs with the current code and asserts equality, character for character, in BOTH server renderers
 * (`renderToStaticMarkup`, and `renderToString`, which keeps React's `<!-- -->` text separators as the site's streaming
 * render does). Every "present" test asserts the new element AND that removing exactly that element gives back the
 * baseline — so a present option changes nothing else. Negative assertions ("no badge") use only inputs where nothing
 * can match (§ 16.1).
 */

const Showcase = (await RENDER_LOADERS["categoryShowcase"]()).default;
const PostGrid = (await RENDER_LOADERS["postGrid"]()).default;
const STRINGS: Record<StringsKind, any> = {
    "en": blockStrings(resolveLocaleStrings({}), { catalogMode: false }),
    "en-catalog": blockStrings(resolveLocaleStrings({}), { catalogMode: true }),
    "ro": blockStrings(resolveLocaleStrings({ locale: "ro-RO" }), { catalogMode: false }),
};
const B = BASELINE as unknown as Record<"showcase" | "postGrid", { html: Record<string, string>; ssr: Record<string, string> }>;

const showcase = (attrs: Record<string, unknown>, kind: StringsKind = "en", ssr = false) =>
    (ssr ? renderToString : renderToStaticMarkup)(React.createElement(Showcase, { attrs, strings: STRINGS[kind] }));
const postGrid = (attrs: Record<string, unknown>, kind: StringsKind = "en", ssr = false) =>
    (ssr ? renderToString : renderToStaticMarkup)(React.createElement(PostGrid, { attrs, strings: STRINGS[kind] }));
/** `text` with `part` removed exactly once (asserted to occur exactly once). */
const without = (text: string, part: string) => {
    expect(text.split(part).length - 1, `exactly once: ${part}`).toBe(1);
    return text.replace(part, "");
};
const count = (text: string, part: string) => text.split(part).length - 1;
/** Each product card's HTML, in order (the card is the `<a class="group block">` of the grid). */
const cards = (html: string) => html.split('<a href="').slice(1).filter((c) => c.includes('class="group block"'));

/** Every new attribute, as Tiptap stores it before the owner sets it (declared default `null`). */
const SHOWCASE_NULLS = { eyebrow: null, badgeTags: null, showCategoryLabel: null, showDescription: null, showRating: null };
/** Present but drawn as absent: blank text, an empty list, a list of blank entries, unticked boxes. */
const SHOWCASE_BLANKS = [
    { eyebrow: "   ", badgeTags: [], showCategoryLabel: false, showDescription: false, showRating: false },
    { eyebrow: "", badgeTags: ["", "  \t"] },
];
/** Stored values outside the schema (the backend does not check block attributes): read as absent. */
const SHOWCASE_MALFORMED = { eyebrow: 7, badgeTags: "TOP PICK", showCategoryLabel: "true", showDescription: 1, showRating: {} };

// The literals the render must emit (design § 7, § 7.4). Repeated here on purpose: the test pins the strings.
const SHOWCASE_EYEBROW = (t: string) => `<p class="mx-auto w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">${t}</p>`;
const BADGE = (t: string) => `<span class="absolute top-2 left-2 max-w-[90%] truncate rounded-full bg-primary px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-foreground">${t}</span>`;
const LABEL = (t: string) => `<p class="text-xs uppercase tracking-wide text-center text-muted-foreground mb-1">${t}</p>`;
const SHORT = (t: string) => `<p class="text-sm text-center text-muted-foreground line-clamp-2 mb-1">${t}</p>`;
const RATING = (stars: string, t: string) => `<p class="text-sm text-center text-muted-foreground mb-1"><span aria-hidden="true" class="text-primary mr-1">${stars}</span>${t}</p>`;
const BADGE_OPEN = '<span class="absolute top-2 left-2';

const withProducts = (products: unknown[], extra: Record<string, unknown> = {}) => ({ ...SHOWCASE_BASE, prefetchedProducts: products, ...extra });
/** PRODUCTS with server-pass keys added to one product (by index). */
const productsWith = (i: number, keys: Record<string, unknown>) => PRODUCTS.map((p, j) => (j === i ? { ...p, ...keys } : p));

// ── categoryShowcase: absent / null / blank / malformed → today's HTML ─────────────────────────────────────────────

describe("categoryShowcase — absent = today's bytes (§ 4)", () => {
    const variants: [string, Record<string, unknown>][] = [
        ["absent", {}], ["null", SHOWCASE_NULLS], ["blank 1", SHOWCASE_BLANKS[0]], ["blank 2", SHOWCASE_BLANKS[1]], ["malformed", SHOWCASE_MALFORMED],
    ];
    for (const [name, extra] of variants) {
        it(`${name}: every baseline case renders byte-equal, in both renderers`, () => {
            for (const [key, c] of Object.entries(SHOWCASE_CASES)) {
                expect(showcase({ ...c.attrs, ...extra }, c.strings), `${key} static`).toBe(B.showcase.html[key]);
                expect(showcase({ ...c.attrs, ...extra }, c.strings, true), `${key} ssr`).toBe(B.showcase.ssr[key]);
            }
        });
    }

    it("options on, but no product carries their data (no server keys: a hidden or missing first category, no description, no approved review; the browser fallback fetch's products) → today's HTML", () => {
        const on = { showCategoryLabel: true, showDescription: true, showRating: true };
        for (const [key, c] of Object.entries(SHOWCASE_CASES)) {
            expect(showcase({ ...c.attrs, ...on }, c.strings), key).toBe(B.showcase.html[key]);
            expect(showcase({ ...c.attrs, ...on }, c.strings, true), key).toBe(B.showcase.ssr[key]);
        }
    });

    it("badgeTags that no product's tags hold → no badge, today's HTML", () => {
        expect(showcase({ ...SHOWCASE_BASE, badgeTags: ["SALE", "NEW"] })).toBe(B.showcase.html["tiptap-defaults"]);
    });
});

// ── categoryShowcase: eyebrow ───────────────────────────────────────────────────────────────────────────────────────

describe("categoryShowcase — eyebrow", () => {
    it("a <p> first in the section, above the category name, trimmed; removing it gives today's HTML (both renderers)", () => {
        const html = showcase({ ...SHOWCASE_BASE, eyebrow: "  Our picks " });
        expect(html.startsWith(`<section class="my-12">${SHOWCASE_EYEBROW("Our picks")}<h2`)).toBe(true);
        expect(without(html, SHOWCASE_EYEBROW("Our picks"))).toBe(B.showcase.html["tiptap-defaults"]);
        expect(without(showcase({ ...SHOWCASE_BASE, eyebrow: "Our picks" }, "en", true), SHOWCASE_EYEBROW("Our picks"))).toBe(B.showcase.ssr["tiptap-defaults"]);
    });
    it("without a category name, and on a catalog site (a block option, not a card option): still drawn", () => {
        expect(without(showcase({ ...SHOWCASE_CASES["no-name"].attrs, eyebrow: "Picks" }), SHOWCASE_EYEBROW("Picks"))).toBe(B.showcase.html["no-name"]);
        const c = SHOWCASE_CASES["catalog"];
        expect(without(showcase({ ...c.attrs, eyebrow: "Picks" }, c.strings), SHOWCASE_EYEBROW("Picks"))).toBe(B.showcase.html["catalog"]);
    });
});

// ── categoryShowcase: badge (§ 7.4, § 16 R6) ───────────────────────────────────────────────────────────────────────

describe("categoryShowcase — badge (§ 7.4: at most one per card, the block's order wins)", () => {
    const badges = (html: string) => cards(html).map((card) => card.match(/<span class="absolute top-2 left-2[^"]*">([^<]*)<\/span>/)?.[1] ?? null);

    it("zero, one and several matching tags, with the block list in both orders", () => {
        // PRODUCTS tags: p1 [TOP PICK, oak], p2 [], p3 [POPULAR], p4 [POPULAR, TOP PICK], p5 []
        expect(badges(showcase({ ...SHOWCASE_BASE, badgeTags: ["oak"] }))).toEqual(["oak", null, null, null, null]);
        expect(badges(showcase({ ...SHOWCASE_BASE, badgeTags: ["TOP PICK", "POPULAR"] }))).toEqual(["TOP PICK", null, "POPULAR", "TOP PICK", null]);
        expect(badges(showcase({ ...SHOWCASE_BASE, badgeTags: ["POPULAR", "TOP PICK"] }))).toEqual(["TOP PICK", null, "POPULAR", "POPULAR", null]);
        expect(badges(showcase({ ...SHOWCASE_BASE, badgeTags: ["oak", "TOP PICK", "POPULAR"] }))).toEqual(["oak", null, "POPULAR", "TOP PICK", null]);
    });

    it("the order of the product's own tags never changes the badge (the § 7.4 example)", () => {
        for (const tags of [["POPULAR", "TOP PICK"], ["TOP PICK", "POPULAR"]]) {
            const html = showcase(withProducts([{ ...PRODUCTS[0], tags }], { badgeTags: ["TOP PICK", "POPULAR"] }));
            expect(badges(html)).toEqual(["TOP PICK"]);
            expect(count(html, BADGE_OPEN)).toBe(1);
        }
    });

    it("never more than one badge on a card", () => {
        const html = showcase({ ...SHOWCASE_BASE, badgeTags: ["oak", "TOP PICK", "POPULAR"] });
        for (const card of cards(html)) expect(count(card, BADGE_OPEN)).toBeLessThanOrEqual(1);
    });

    it("the badge is the tag as stored (uppercase is CSS), inside the photo box after the out-of-stock overlay; removing it gives today's HTML", () => {
        const html = showcase({ ...SHOWCASE_BASE, badgeTags: ["oak"] });
        expect(without(html, BADGE("oak"))).toBe(B.showcase.html["tiptap-defaults"]);
        expect(without(showcase({ ...SHOWCASE_BASE, badgeTags: ["oak"] }, "en", true), BADGE("oak"))).toBe(B.showcase.ssr["tiptap-defaults"]);
        const pine = cards(showcase({ ...SHOWCASE_BASE, badgeTags: ["POPULAR"] }))[3];
        expect(pine.indexOf("Out of Stock")).toBeGreaterThan(-1);
        expect(pine.indexOf(BADGE("POPULAR"))).toBeGreaterThan(pine.indexOf("Out of Stock"));
        expect(pine.indexOf(BADGE("POPULAR"))).toBeLessThan(pine.indexOf("<h3"));
    });

    // BADGE-CASE-1 (docs/slices/badge-case-1.md; amends § 7.4): the two strings match when they are equal after
    // `toLowerCase()` on both sides. Spaces still count. The text drawn is the block's entry as stored.

    it("letter case does not count: the block's entry in any case matches the product's tag; the text is the block's entry as stored", () => {
        // p1 [TOP PICK, oak] and p4 [POPULAR, TOP PICK] hold the tag; removing the two badges gives today's HTML
        for (const entry of ["top pick", "Top Pick"]) {
            const html = showcase({ ...SHOWCASE_BASE, badgeTags: [entry] });
            expect(badges(html), entry).toEqual([entry, null, null, entry, null]);
            expect(html.split(BADGE(entry)).join(""), entry).toBe(B.showcase.html["tiptap-defaults"]);
        }
        // and the other way round: a lower-case product tag matches the upper-case block entry
        expect(badges(showcase(withProducts([{ ...PRODUCTS[0], tags: ["top pick"] }], { badgeTags: ["TOP PICK"] })))).toEqual(["TOP PICK"]);
    });

    it("spaces count: a tag that differs by a space does not match (no trimming)", () => {
        for (const badgeTags of [["TOP PICK "], [" TOP PICK"], ["TOPPICK"]]) {
            expect(showcase({ ...SHOWCASE_BASE, badgeTags }), JSON.stringify(badgeTags)).toBe(B.showcase.html["tiptap-defaults"]);
        }
        // and the other way round: a product tag with a space does not match the clean block entry
        const spaced = withProducts([{ ...PRODUCTS[0], tags: ["TOP PICK "] }]);
        expect(showcase({ ...spaced, badgeTags: ["TOP PICK"] })).toBe(showcase(spaced));
        expect(count(showcase(spaced), BADGE_OPEN)).toBe(0);
    });

    it("letter case does not change the precedence: the block's first matching entry wins, in both orders", () => {
        for (const tags of [["POPULAR", "TOP PICK"], ["TOP PICK", "POPULAR"]]) {
            const products = [{ ...PRODUCTS[0], tags }];
            expect(badges(showcase(withProducts(products, { badgeTags: ["popular", "Top pick"] }))), JSON.stringify(tags)).toEqual(["popular"]);
            expect(badges(showcase(withProducts(products, { badgeTags: ["Top pick", "popular"] }))), JSON.stringify(tags)).toEqual(["Top pick"]);
        }
    });

    it("two block entries that differ only by case: one badge, the first entry", () => {
        for (const tags of [["SALE"], ["sale"], ["Sale"]]) {
            const html = showcase(withProducts([{ ...PRODUCTS[0], tags }], { badgeTags: ["Sale", "SALE"] }));
            expect(badges(html), JSON.stringify(tags)).toEqual(["Sale"]);
            expect(count(html, BADGE_OPEN), JSON.stringify(tags)).toBe(1);
        }
    });

    it("a product tag that is not a string never matches and never throws; a string beside it still matches", () => {
        const mixed = [{ ...PRODUCTS[0], tags: [42, null, { a: 1 }, "top pick"] }];
        expect(badges(showcase(withProducts(mixed, { badgeTags: ["TOP PICK"] })))).toEqual(["TOP PICK"]);
        // only non-strings: the block entries spell what `String(value)` would give, so a conversion would match them
        const odd = withProducts([{ ...PRODUCTS[0], tags: [42, null, { a: 1 }, true, undefined] }]);
        const html = showcase({ ...odd, badgeTags: ["42", "null", "[object Object]", "true", "undefined"] });
        expect(count(html, BADGE_OPEN)).toBe(0);
        expect(html).toBe(showcase(odd));
    });

    it("a blank entry of badgeTags is ignored (never matches a blank product tag); the next entry still counts", () => {
        const products = [{ ...PRODUCTS[0], tags: ["", "  "] }, PRODUCTS[2]];
        expect(badges(showcase(withProducts(products, { badgeTags: ["", "  ", "POPULAR"] })))).toEqual([null, "POPULAR"]);
    });

    it("a product without tags, or with tags that are not a list → no badge", () => {
        const { tags: _t, ...noTags } = PRODUCTS[0];
        const html = showcase(withProducts([noTags, { ...PRODUCTS[0], tags: "TOP PICK" }, { ...PRODUCTS[0], tags: null }], { badgeTags: ["TOP PICK"] }));
        expect(count(html, BADGE_OPEN)).toBe(0);
    });

    it("a catalog site: no badge (SL-D10), even when the products carry tags", () => {
        const c = SHOWCASE_CASES["catalog"];
        expect(showcase({ ...c.attrs, badgeTags: ["TOP PICK"] }, c.strings)).toBe(B.showcase.html["catalog"]);
        const tagged = CATALOG_PRODUCTS.map((p) => ({ ...p, tags: ["TOP PICK"] }));
        expect(count(showcase({ ...c.attrs, prefetchedProducts: tagged, badgeTags: ["TOP PICK"] }, c.strings), BADGE_OPEN)).toBe(0);
    });
});

// ── categoryShowcase: category label, short text, rating ───────────────────────────────────────────────────────────

describe("categoryShowcase — category label, short text, rating (§ 7, § 7.2, § 7.3)", () => {
    const keys = { _categoryName: "Hardwood", _descriptionText: "Solid oak, oiled.", _rating: { average: 4.3, count: 3, text: "4.3/5 (3 reviews)" } };
    const on = { showCategoryLabel: true, showDescription: true, showRating: true };

    it("each element in its place — label above the title, short text and rating under it — and removing them gives today's HTML", () => {
        const html = showcase(withProducts(productsWith(0, keys), on));
        const first = cards(html)[0];
        const order = [LABEL("Hardwood"), "<h3", SHORT("Solid oak, oiled."), RATING("★★★★", "4.3/5 (3 reviews)"), '<p class="text-sm text-center text-primary font-medium">'].map((p) => first.indexOf(p));
        expect(order.every((i) => i > -1)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        const back = [LABEL("Hardwood"), SHORT("Solid oak, oiled."), RATING("★★★★", "4.3/5 (3 reviews)")].reduce(without, html);
        expect(back).toBe(B.showcase.html["tiptap-defaults"]);
    });

    it("each option alone draws only its own element (the other keys present but their options off)", () => {
        const products = productsWith(0, keys);
        expect(without(showcase(withProducts(products, { showCategoryLabel: true })), LABEL("Hardwood"))).toBe(B.showcase.html["tiptap-defaults"]);
        expect(without(showcase(withProducts(products, { showDescription: true })), SHORT("Solid oak, oiled."))).toBe(B.showcase.html["tiptap-defaults"]);
        expect(without(showcase(withProducts(products, { showRating: true })), RATING("★★★★", "4.3/5 (3 reviews)"))).toBe(B.showcase.html["tiptap-defaults"]);
        expect(showcase(withProducts(products))).toBe(B.showcase.html["tiptap-defaults"]);
    });

    it("streaming renderer: the same elements, nothing else", () => {
        const ssr = showcase(withProducts(productsWith(0, keys), on), "en", true);
        const back = [LABEL("Hardwood"), SHORT("Solid oak, oiled."), RATING("★★★★", "4.3/5 (3 reviews)")].reduce(without, ssr);
        expect(back).toBe(B.showcase.ssr["tiptap-defaults"]);
    });

    it("text that holds HTML is drawn as text, never as HTML (the server gives plain text; the card escapes whatever reaches it)", () => {
        const html = showcase(withProducts(productsWith(0, { _descriptionText: "<b>Oak</b> & <script>x</script>" }), { showDescription: true }));
        expect(html).toContain(SHORT("&lt;b&gt;Oak&lt;/b&gt; &amp; &lt;script&gt;x&lt;/script&gt;"));
        expect(html).not.toContain("<b>Oak");
    });

    it("blank label or short text → no element", () => {
        expect(showcase(withProducts(productsWith(0, { _categoryName: "  ", _descriptionText: "" }), on))).toBe(B.showcase.html["tiptap-defaults"]);
    });

    it("rating: the stars are the rounded average (0 to 5) and hidden from screen readers; a malformed rating → no element", () => {
        const one = (r: unknown) => showcase(withProducts(productsWith(0, { _rating: r }), { showRating: true }));
        expect(one({ average: 4.5, count: 2, text: "4.5/5 (2 reviews)" })).toContain(RATING("★★★★★", "4.5/5 (2 reviews)"));
        expect(one({ average: 1, count: 1, text: "1/5 (1 review)" })).toContain(RATING("★", "1/5 (1 review)"));
        expect(one({ average: 9, count: 1, text: "9/5" })).toContain(RATING("★★★★★", "9/5"));
        for (const bad of [{ average: Number.NaN, count: 1, text: "x" }, { average: 4, count: 1 }, "4/5", null]) {
            expect(one(bad), JSON.stringify(bad)).toBe(B.showcase.html["tiptap-defaults"]);
        }
    });

    it("a catalog site: no label, short text or rating (SL-D10), even if the products carry the keys", () => {
        const c = SHOWCASE_CASES["catalog"];
        const products = CATALOG_PRODUCTS.map((p) => ({ ...p, ...keys }));
        expect(showcase({ ...c.attrs, prefetchedProducts: products, ...on }, c.strings)).toBe(B.showcase.html["catalog"]);
    });

    it("the browser fallback fetch's products (CATPROD# items: tags, no server keys): only the badge can show", () => {
        // Same product shape as the server's CATPROD# read; what differs on that path is that no `_…` key is added.
        const html = showcase({ ...SHOWCASE_BASE, ...on, badgeTags: ["TOP PICK"] });
        expect(count(html, BADGE_OPEN)).toBe(2);
        expect([BADGE("TOP PICK"), BADGE("TOP PICK")].reduce(without_all, html)).toBe(B.showcase.html["tiptap-defaults"]);
    });
});
function without_all(text: string, part: string) { return text.split(part).join(""); }

// ── categoryShowcase: schema, Tiptap, editor ────────────────────────────────────────────────────────────────────────

describe("categoryShowcase — schema, Tiptap attributes, editor", () => {
    it("the schema adds no key when the options are absent (no default), accepts each option, refuses an 11th badge tag", () => {
        const parsed = CategoryShowcaseSchema.parse({});
        for (const k of Object.keys(SHOWCASE_NULLS)) expect(Object.hasOwn(parsed, k), k).toBe(false);
        expect(CategoryShowcaseSchema.parse({ eyebrow: "x", badgeTags: ["A"], showCategoryLabel: true, showDescription: false, showRating: true })).toMatchObject({ eyebrow: "x", badgeTags: ["A"], showRating: true });
        expect(CategoryShowcaseSchema.safeParse({ badgeTags: Array.from({ length: 10 }, (_, i) => `t${i}`) }).success).toBe(true);
        expect(CategoryShowcaseSchema.safeParse({ badgeTags: Array.from({ length: 11 }, (_, i) => `t${i}`) }).success).toBe(false);
        expect(CategoryShowcaseSchema.safeParse({ showRating: "yes" }).success).toBe(false);
    });

    it("the five Tiptap attributes default to null (absent), the others unchanged", () => {
        const attrs = (CategoryShowcasePlugin.editorExtension as any).config.addAttributes();
        for (const k of Object.keys(SHOWCASE_NULLS)) expect(attrs[k], k).toEqual({ default: null });
        expect(attrs.ctaText).toEqual({ default: "View All Products" });
    });

    it("the editor offers every option with its stored value", () => {
        const html = renderToStaticMarkup(React.createElement(CategoryShowcaseEditor, {
            node: { attrs: { ...SHOWCASE_BASE, eyebrow: "Picks", badgeTags: ["TOP PICK", "NEW"], showCategoryLabel: true, showDescription: null, showRating: true } },
            updateAttributes: () => {}, editor: { storage: {} },
        }));
        for (const t of ["Label above the name", "Badge tags", "Category name", "Short description", "Rating (approved reviews)", 'value="Picks"', 'value="TOP PICK, NEW"']) expect(html, t).toContain(t);
        expect(count(html, `checked=""`)).toBe(3); // Prices, Category name, Rating (Short description stored null → unticked)
    });

    it("a cleared option stores null (absent again): blank text, an unticked box, an empty tag field", () => {
        for (const v of ["", "  ", "\t"]) expect(storedShowcaseOption(v)).toBeNull();
        expect(storedShowcaseOption(false)).toBeNull();
        expect(storedShowcaseOption(true)).toBe(true);
        expect(storedShowcaseOption("Picks ")).toBe("Picks ");
        for (const v of ["", " , ,", "   "]) expect(badgeTagsFromText(v)).toBeNull();
    });

    it("the tag field: comma-separated, each entry trimmed, blanks dropped, case kept, the first 10", () => {
        expect(badgeTagsFromText(" TOP PICK, , New ,")).toEqual(["TOP PICK", "New"]);
        expect(badgeTagsFromText(Array.from({ length: 12 }, (_, i) => `t${i}`).join(","))).toEqual(Array.from({ length: 10 }, (_, i) => `t${i}`));
    });
});

// ── postGrid ────────────────────────────────────────────────────────────────────────────────────────────────────────

const POST_NULLS = { eyebrow: null, asideText: null, asideQuote: null, asideButtonText: null, asideButtonLink: null };
const POST_BLANKS = { eyebrow: "  ", asideText: " ", asideQuote: "\n", asideButtonText: "\t", asideButtonLink: "" };
const POST_MALFORMED = { eyebrow: 3, asideText: ["x"], asideQuote: { q: 1 }, asideButtonText: true, asideButtonLink: 5 };
const POST_EYEBROW = (t: string) => `<p class="w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">${t}</p>`;
const ASIDE_OPEN = '<div class="grid gap-10 md:grid-cols-3"><aside class="space-y-6">';
const ASIDE_TEXT = (t: string) => `<p class="text-lg leading-relaxed text-muted-foreground">${t}</p>`;
const ASIDE_QUOTE = (t: string) => `<blockquote class="border-l-2 border-primary pl-4 italic text-foreground">${t}</blockquote>`;
const ASIDE_BUTTON = (href: string, t: string) => `<a href="${href}" class="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90">${t}</a>`;
/** The panel markup around today's list: removing it gives the baseline. */
const unwrapAside = (html: string, inner: string) => {
    const wrapped = `${ASIDE_OPEN}${inner}</aside><div class="md:col-span-2">`;
    return without(html, wrapped).replace(/<\/div><\/div><\/section>$/, "</section>");
};

describe("postGrid — absent = today's bytes (§ 4)", () => {
    const variants: [string, Record<string, unknown>][] = [["absent", {}], ["null", POST_NULLS], ["blank", POST_BLANKS], ["malformed", POST_MALFORMED]];
    for (const [name, extra] of variants) {
        it(`${name}: every baseline case renders byte-equal, in both renderers`, () => {
            for (const [key, c] of Object.entries(POST_GRID_CASES)) {
                expect(postGrid({ ...c.attrs, ...extra }, c.strings), `${key} static`).toBe(B.postGrid.html[key]);
                expect(postGrid({ ...c.attrs, ...extra }, c.strings, true), `${key} ssr`).toBe(B.postGrid.ssr[key]);
            }
        });
    }
    it("a button link without a button text → no button, no panel (today's HTML)", () => {
        expect(postGrid({ ...POST_GRID_BASE, asideButtonLink: "/blog" })).toBe(B.postGrid.html["tiptap-defaults-list"]);
    });
    it("the status boxes (no posts; no server data → spinner) are unchanged with every option set", () => {
        const all = { eyebrow: "News", asideText: "T", asideQuote: "Q", asideButtonText: "B", asideButtonLink: "/b" };
        for (const key of ["no-posts", "no-server-data"]) expect(postGrid({ ...POST_GRID_CASES[key].attrs, ...all }), key).toBe(B.postGrid.html[key]);
    });
});

describe("postGrid — eyebrow and side panel", () => {
    it("eyebrow: a <p> above the headline, trimmed; removing it gives today's HTML (both renderers); without a headline too", () => {
        const html = postGrid({ ...POST_GRID_BASE, eyebrow: " From the journal " });
        // (React hoists a `<link rel="preload">` for the first image in front of the section.)
        expect(html).toContain(`<section class="py-16 px-6 max-w-7xl mx-auto">${POST_EYEBROW("From the journal")}<h2`);
        expect(without(html, POST_EYEBROW("From the journal"))).toBe(B.postGrid.html["tiptap-defaults-list"]);
        expect(without(postGrid({ ...POST_GRID_BASE, eyebrow: "J" }, "en", true), POST_EYEBROW("J"))).toBe(B.postGrid.ssr["tiptap-defaults-list"]);
        expect(without(postGrid({ ...POST_GRID_CASES["no-headline"].attrs, eyebrow: "J" }), POST_EYEBROW("J"))).toBe(B.postGrid.html["no-headline"]);
    });

    it("each part alone: the panel holds only that part; today's list follows in the right two thirds", () => {
        expect(unwrapAside(postGrid({ ...POST_GRID_BASE, asideText: " Notes from the workshop. " }), ASIDE_TEXT("Notes from the workshop."))).toBe(B.postGrid.html["tiptap-defaults-list"]);
        expect(unwrapAside(postGrid({ ...POST_GRID_BASE, asideQuote: "Wood is alive." }), ASIDE_QUOTE("Wood is alive."))).toBe(B.postGrid.html["tiptap-defaults-list"]);
        expect(unwrapAside(postGrid({ ...POST_GRID_BASE, asideButtonText: "All articles", asideButtonLink: "/blog" }), ASIDE_BUTTON("/blog", "All articles"))).toBe(B.postGrid.html["tiptap-defaults-list"]);
    });

    it("a button text without a link → the button goes to # (the hero's second-button rule)", () => {
        expect(unwrapAside(postGrid({ ...POST_GRID_BASE, asideButtonText: "All articles" }), ASIDE_BUTTON("#", "All articles"))).toBe(B.postGrid.html["tiptap-defaults-list"]);
    });

    it("all parts, in order (text, quote, button); the link passes through the tenant URL helper; grid layout too", () => {
        const all = { asideText: "Notes.", asideQuote: "Wood is alive.", asideButtonText: "All articles", asideButtonLink: "/blog", _getUrl: (p: string) => `/_site/t1${p}` };
        const inner = ASIDE_TEXT("Notes.") + ASIDE_QUOTE("Wood is alive.") + ASIDE_BUTTON("/_site/t1/blog", "All articles");
        expect(unwrapAside(postGrid({ ...POST_GRID_BASE, ...all }), inner)).toBe(B.postGrid.html["tiptap-defaults-list"]);
        expect(unwrapAside(postGrid({ ...POST_GRID_CASES["grid-3"].attrs, ...all }), inner)).toBe(B.postGrid.html["grid-3"]);
        const ssr = postGrid({ ...POST_GRID_BASE, ...all }, "en", true);
        expect(unwrapAside(ssr, inner)).toBe(B.postGrid.ssr["tiptap-defaults-list"]);
    });

    it("phone order (§ 6.2): the panel comes before the list in the HTML (above it below md); left third from md", () => {
        const html = postGrid({ ...POST_GRID_BASE, asideText: "Notes." });
        expect(html.indexOf("<aside")).toBeLessThan(html.indexOf("First post"));
        expect(html).toContain('<div class="grid gap-10 md:grid-cols-3">');
        expect(html).toContain('<div class="md:col-span-2">');
    });

    it("the schema adds no key when absent; the five Tiptap attributes default to null", () => {
        const parsed = PostGridSchema.parse({});
        for (const k of Object.keys(POST_NULLS)) expect(Object.hasOwn(parsed, k), k).toBe(false);
        expect(PostGridSchema.parse({ ...POST_GRID_BASE, ...POST_BLANKS })).toMatchObject(POST_BLANKS);
        const attrs = (PostGridPlugin.editorExtension as any).config.addAttributes();
        for (const k of Object.keys(POST_NULLS)) expect(attrs[k], k).toEqual({ default: null });
    });

    it("the editor offers every option with its stored value; a cleared field stores null", () => {
        const html = renderToStaticMarkup(React.createElement(PostGridEditor, {
            node: { attrs: { ...POST_GRID_BASE, eyebrow: "J", asideText: "Notes", asideQuote: "Wood", asideButtonText: "All", asideButtonLink: "/blog" } },
            updateAttributes: () => {}, editor: { storage: {} },
        }));
        for (const t of ["Label above the headline", "Side panel", "Text", "Quote", "Button Text", "Button Link", 'value="J"', ">Notes</textarea>", ">Wood</textarea>", 'value="All"', 'value="/blog"']) expect(html, t).toContain(t);
        for (const v of ["", " ", "\n\t"]) expect(storedText(v)).toBeNull();
        expect(storedText("Notes ")).toBe("Notes ");
    });
});

// ── both renders: imports and colours ──────────────────────────────────────────────────────────────────────────────

describe("both renders — split entry and theme tokens", () => {
    const files = ["../src/category-showcase/CategoryShowcaseRender.tsx", "../src/post-grid/PostGridRender.tsx"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8"));

    it("no runtime import of @amodx/shared (D3: type imports only)", () => {
        for (const src of files) {
            const imports = src.split("\n").filter((l) => l.startsWith("import ") && l.includes("@amodx/shared"));
            expect(imports.length).toBeGreaterThan(0);
            for (const line of imports) expect(line).toMatch(/^import type /);
        }
    });

    it("the new elements use theme classes only — no palette colour (Critical Rule 6)", () => {
        const html = showcase(withProducts(productsWith(0, { _categoryName: "H", _descriptionText: "D", _rating: { average: 4, count: 1, text: "4/5" } }), { eyebrow: "E", badgeTags: ["oak"], showCategoryLabel: true, showDescription: true, showRating: true }))
            + postGrid({ ...POST_GRID_BASE, eyebrow: "E", asideText: "T", asideQuote: "Q", asideButtonText: "B" });
        const added = [SHOWCASE_EYEBROW("E"), BADGE("oak"), LABEL("H"), SHORT("D"), RATING("★★★★", "4/5"), POST_EYEBROW("E"), ASIDE_OPEN, ASIDE_TEXT("T"), ASIDE_QUOTE("Q"), ASIDE_BUTTON("#", "B")];
        for (const part of added) {
            expect(html, part).toContain(part);
            expect(part).not.toMatch(/-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-|\b)/);
        }
    });
});
