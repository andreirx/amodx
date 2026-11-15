import { describe, it, expect } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { blockStrings, resolveLocaleStrings } from "@amodx/shared";
import { RENDER_LOADERS } from "../src/render";
import { getPluginList } from "../src/admin";
import { CategoryGridSchema } from "../src/category-grid/schema";
import { CategoryGridPlugin } from "../src/category-grid";
import { CategoryGridEditor, withPickedId, withItemMoved, withoutItem, MAX_GRID_CATEGORIES } from "../src/category-grid/CategoryGridEditor";

/**
 * SHOP-LOOK-1C — the `categoryGrid` block (docs/slices/shop-look-1c.md; design docs/slices/shop-look-1.md § 3 rows 4-5,
 * § 4.2, § 6.2, SL-D12). Renders `RENDER_LOADERS["categoryGrid"]` with `react-dom/server` (the renderer's SSR path),
 * with `_categories` as the server pass (`prepareBlocks`, tested in renderer/test/unit/shop-look-1c-grid.test.ts) gives
 * it: the resolved categories, in the picked order, each `{ id, name, path, description?, imageLink? }`.
 */

const CategoryGridRender = (await RENDER_LOADERS["categoryGrid"]()).default;
const STRINGS = blockStrings(resolveLocaleStrings({}), { catalogMode: false });
const html = (attrs: Record<string, unknown>) => renderToStaticMarkup(React.createElement(CategoryGridRender, { attrs, strings: STRINGS }));

const tile = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `c${n}`, name: `Category ${n}`, path: `/category/cat-${n}`, description: `About ${n}`, imageLink: `https://img.test/${n}.jpg`, ...extra,
});
const tiles = (n: number) => Array.from({ length: n }, (_, i) => tile(i + 1));
/** The tile links of a render, in document order: [href, the tile's inner HTML]. */
const tileLinks = (out: string) => [...out.matchAll(/<a href="([^"]*)" class="group relative block aspect-\[3\/4\][^"]*">(.*?)<\/a>/g)].map((m) => [m[1], m[2]]);

/** A tile's inner HTML without its photo element (the first child, when the category has a photo). */
const withoutPhoto = (inner: string) => inner.replace(/^<img [^>]*\/>/, "");

const GRID = {
    "2": '<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">',
    "3": '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">',
    "4": '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">',
};
const SCRIM = '<div class="absolute inset-x-0 bottom-0 flex flex-col"><div aria-hidden="true" class="h-16 bg-gradient-to-t from-foreground/75 to-transparent"></div><div class="bg-foreground/75 px-5 pb-5 text-background">';
const CHIP_CLASS = "inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted";

describe("categoryGrid — tiles (§ 4.2, SL-D12)", () => {
    it("no server data (`_categories` absent: the admin preview) → nothing, even with a headline and chips", () => {
        expect(html({ headline: "Shop", eyebrow: "Rooms", chips: [{ label: "All", href: "/shop" }] })).toBe("");
        expect(html({ _categories: "not an array", headline: "Shop" })).toBe("");
    });

    it("0 categories: no tile, no grid; eyebrow, headline and chips still drawn; with none of those → nothing", () => {
        const out = html({ _categories: [], eyebrow: "Rooms", headline: "Shop by room", chips: [{ label: "All", href: "/shop" }] });
        expect(tileLinks(out)).toEqual([]);
        expect(out).not.toContain('class="grid ');
        expect(out).toContain(">Rooms</p>");
        expect(out).toContain(">Shop by room</h2>");
        expect(out).toContain(">All</a>");
        expect(html({ _categories: [] })).toBe("");
        expect(html({ _categories: [], eyebrow: "  ", headline: "", chips: [{ label: "", href: "/x" }] })).toBe("");
    });

    it("1 category: one tile — photo, name, description, linked to its path", () => {
        const out = html({ _categories: [tile(1)] });
        expect(out).toBe(
            '<section class="my-12">' + GRID["4"] +
            '<a href="/category/cat-1" class="group relative block aspect-[3/4] overflow-hidden rounded-lg bg-muted">' +
            '<img src="https://img.test/1.jpg" alt="" loading="lazy" class="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"/>' +
            SCRIM + '<h3 class="text-xl font-semibold leading-tight">Category 1</h3><p class="mt-1 text-sm line-clamp-2">About 1</p></div></div></a>' +
            "</div></section>",
        );
    });

    it("12 categories: twelve tiles, in the given (picked) order", () => {
        const twelve = tiles(12).reverse();
        const links = tileLinks(html({ _categories: twelve }));
        expect(links.map((l) => l[0])).toEqual(twelve.map((t) => t.path));
        for (const [i, [, inner]] of links.entries()) expect(inner).toContain(`>${twelve[i].name}</h3>`);
    });

    it("whatever `_categories` holds is drawn: the render does not re-check status (the server pass skips hidden and missing ones)", () => {
        // The order and the skipping are the server pass's (renderer test); the render draws each given tile once, in order.
        const given = [tile(3), tile(1)];
        expect(tileLinks(html({ _categories: given })).map((l) => l[0])).toEqual(["/category/cat-3", "/category/cat-1"]);
    });

    it("a category without a photo: no <img> (no broken image); the tile keeps its muted background and the scrim", () => {
        for (const imageLink of [undefined, "", "   "]) {
            const [[, inner]] = tileLinks(html({ _categories: [tile(1, { imageLink })] }));
            expect(inner).not.toContain("<img");
            expect(inner.startsWith(SCRIM)).toBe(true);
        }
    });

    it("a category without a description: no <p> for it (no empty element)", () => {
        for (const description of [undefined, "", "  "]) {
            const [[, inner]] = tileLinks(html({ _categories: [tile(1, { description })] }));
            expect(withoutPhoto(inner)).toBe(`${SCRIM}<h3 class="text-xl font-semibold leading-tight">Category 1</h3></div></div>`);
        }
    });

    it("overlay rule: every tile text sits inside the scrim (bg-foreground/75) and is text-background; no colour literal", () => {
        const out = html({ _categories: tiles(3), ctaText: "Shop category" });
        for (const [, inner] of tileLinks(out)) {
            // The photo (when present) is the only element before the scrim; every text element is inside the scrim's
            // text panel (`bg-foreground/75 … text-background`), so it inherits text-background over the scrim.
            expect(withoutPhoto(inner).startsWith(SCRIM)).toBe(true);
            expect(withoutPhoto(inner).endsWith("</div></div>")).toBe(true);
        }
        // Critical Rule 6: every class of the render is a theme token — no palette colour, no arbitrary colour value.
        const src = readFileSync(new URL("../src/category-grid/CategoryGridRender.tsx", import.meta.url), "utf8");
        const classes = [...src.matchAll(/(?:className="|: ")([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
        expect(classes.length).toBeGreaterThan(40);
        const literal = /^(?:[a-z-]+:)*(?:text|bg|from|via|to|border)-(?:\[|black|white|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)/;
        expect(classes.filter((c) => literal.test(c))).toEqual([]);
    });
});

describe("categoryGrid — options (§ 4.2, § 6.2)", () => {
    it("columns 2 / 3 / 4: the grid class of § 6.2 (1 column on a phone, 2 from sm, the block's columns from lg)", () => {
        for (const c of ["2", "3", "4"] as const) expect(html({ _categories: tiles(2), columns: c })).toContain(GRID[c]);
        for (const c of [undefined, null, "5", 4, "constructor", "toString"]) expect(html({ _categories: tiles(2), columns: c })).toContain(GRID["4"]);
    });

    it("ctaText blank → no foot text; set → the text at the foot of each tile", () => {
        for (const ctaText of [undefined, "", "   "]) expect(html({ _categories: tiles(2), ctaText })).not.toContain("tracking-widest\">");
        const links = tileLinks(html({ _categories: tiles(2), ctaText: " Shop category " }));
        for (const [, inner] of links) expect(inner.endsWith('<p class="mt-3 text-xs font-semibold uppercase tracking-widest">Shop category</p></div></div>')).toBe(true);
    });

    it("eyebrow, headline: blank → no element; set → the element (trimmed), eyebrow above the headline", () => {
        expect(html({ _categories: tiles(1), eyebrow: " ", headline: "" })).not.toContain('<div class="text-center mb-10">');
        const both = html({ _categories: tiles(1), eyebrow: " Rooms ", headline: "Shop by room" });
        expect(both).toContain('<div class="text-center mb-10"><p class="inline-block w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">Rooms</p><h2 class="text-3xl md:text-4xl font-bold tracking-tight text-foreground">Shop by room</h2></div>');
        expect(html({ _categories: tiles(1), headline: "Only" })).toContain('<div class="text-center mb-10"><h2 class="text-3xl md:text-4xl font-bold tracking-tight text-foreground">Only</h2></div>');
        expect(html({ _categories: tiles(1), eyebrow: "Only" })).toMatch(/<div class="text-center mb-10"><p [^>]*>Only<\/p><\/div>/);
    });

    it("chips: none → no row; label and href → the pills, in order, after the grid; an item without a label or an href is skipped", () => {
        for (const chips of [undefined, null, [], "x"]) expect(html({ _categories: tiles(1), chips })).not.toContain("<ul");
        const out = html({ _categories: tiles(1), chips: [
            { label: "Oak", href: "/category/oak" }, { label: "", href: "/x" }, { label: "No link", href: "  " }, { href: "/y" }, null,
            { label: "Sale", href: "https://sale.test/" },
        ] });
        expect(out.endsWith(`</div><ul class="mt-8 flex flex-wrap justify-center gap-3"><li><a href="/category/oak" class="${CHIP_CLASS}">Oak</a></li><li><a href="https://sale.test/" class="${CHIP_CLASS}">Sale</a></li></ul></section>`)).toBe(true);
    });

    it("links pass through the tenant URL helper `_getUrl` (tiles and chips, SL-D14)", () => {
        const _getUrl = (p: string) => `/_site/t1${p}`;
        const out = html({ _categories: [tile(1)], chips: [{ label: "Oak", href: "/oak" }], _getUrl });
        expect(tileLinks(out).map((l) => l[0])).toEqual(["/_site/t1/category/cat-1"]);
        expect(out).toContain('<a href="/_site/t1/oak"');
    });
});

describe("categoryGrid — schema (§ 4.2)", () => {
    it("defaults; 12 ids accepted, a 13th refused; chips up to 12; columns 2/3/4 only", () => {
        expect(CategoryGridSchema.parse({})).toEqual({ eyebrow: "", headline: "", categoryIds: [], columns: "4", ctaText: "", chips: [], blockWidth: "content" });
        const ids = Array.from({ length: 13 }, (_, i) => `c${i}`);
        expect(CategoryGridSchema.safeParse({ categoryIds: ids.slice(0, 12) }).success).toBe(true);
        expect(CategoryGridSchema.safeParse({ categoryIds: ids }).success).toBe(false);
        const chip = { label: "a", href: "/a" };
        expect(CategoryGridSchema.safeParse({ chips: Array(12).fill(chip) }).success).toBe(true);
        expect(CategoryGridSchema.safeParse({ chips: Array(13).fill(chip) }).success).toBe(false);
        expect(CategoryGridSchema.safeParse({ columns: "5" }).success).toBe(false);
    });

    it("the Tiptap attributes declare the schema's keys with the schema's defaults (the two declarations change together)", () => {
        expect(getPluginList().find((p) => p.key === "categoryGrid")?.label).toBe("Category Grid");
        const declared = (CategoryGridPlugin.editorExtension as any).config.addAttributes.call({}) as Record<string, { default: unknown }>;
        expect(Object.fromEntries(Object.entries(declared).map(([k, v]) => [k, v.default]))).toEqual(CategoryGridSchema.parse({}));
    });
});

describe("categoryGrid — split entry (design § 1.5, locale-1c D3)", () => {
    it("the render file imports only react: no editor code, no Tiptap, no runtime @amodx/shared", () => {
        const src = readFileSync(new URL("../src/category-grid/CategoryGridRender.tsx", import.meta.url), "utf8");
        const imports = [...src.matchAll(/^import .* from ["']([^"']+)["'];?$/gm)].map((m) => m[1]);
        expect(imports).toEqual(["react"]);
    });
});

describe("categoryGrid — editor", () => {
    it("withPickedId: appends at the end; a blank, already picked or 13th id leaves the list unchanged", () => {
        expect(withPickedId([], "a")).toEqual(["a"]);
        expect(withPickedId(["a"], "b")).toEqual(["a", "b"]);
        expect(withPickedId(["a"], "a")).toEqual(["a"]);
        expect(withPickedId(["a"], "")).toEqual(["a"]);
        const full = Array.from({ length: MAX_GRID_CATEGORIES }, (_, i) => `c${i}`);
        expect(withPickedId(full, "x")).toBe(full);
    });

    it("withItemMoved: swaps with the neighbour; unchanged at either end; withoutItem removes one item", () => {
        expect(withItemMoved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
        expect(withItemMoved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
        expect(withItemMoved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
        expect(withItemMoved(["a", "b"], 1, 1)).toEqual(["a", "b"]);
        expect(withoutItem(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    });

    it("offers every option with its stored value; the picked ids in order with move and remove; the chips", () => {
        const out = renderToStaticMarkup(React.createElement(CategoryGridEditor, {
            node: { attrs: { eyebrow: "Rooms", headline: "Shop by room", categoryIds: ["c2", "c1"], columns: "3", ctaText: "Shop", chips: [{ label: "Oak", href: "/oak" }], blockWidth: "content" } },
            updateAttributes: () => {}, editor: { storage: {} },
        }));
        for (const t of ["Category Grid", "Label above:", "Headline:", "Tile foot text:", "Categories:", "Links under the grid", "Add link"]) expect(out, t).toContain(t);
        for (const v of ['value="Rooms"', 'value="Shop by room"', 'value="Shop"', 'value="Oak"', 'value="/oak"']) expect(out, v).toContain(v);
        expect(out).toContain('<option value="3" selected="">3 columns</option>');
        const picked = [...out.matchAll(/<span class="flex-1 text-sm text-gray-800">([^<]*)<\/span>/g)].map((m) => m[1]);
        expect(picked).toEqual(["c2", "c1"]);
        expect(out.split('title="Move up"').length - 1).toBe(3);   // two picked ids + one chip
        expect(out.split('title="Remove"').length - 1).toBe(3);
        const empty = renderToStaticMarkup(React.createElement(CategoryGridEditor, { node: { attrs: { categoryIds: [], chips: [] } }, updateAttributes: () => {}, editor: { storage: {} } }));
        expect(empty).toContain("No category picked");
    });
});
