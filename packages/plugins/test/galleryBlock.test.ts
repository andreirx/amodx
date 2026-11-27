import { describe, it, expect } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { LANGUAGE_PACKS, fillTemplate, galleryTexts, resolveLocaleStrings } from "@amodx/shared";
import { RENDER_LOADERS } from "../src/render";
import { getPluginList } from "../src/admin";
import { GalleryBlockSchema } from "../src/gallery/schema";
import { GalleryPlugin } from "../src/gallery";
import { galleryAddress } from "../src/gallery/GalleryRender";
import { steppedIndex, swipeStep, SWIPE_MIN_PX, fillLocaleTemplate } from "../src/gallery/GalleryViewer";
import { withPhotosAdded } from "../src/gallery/GalleryEditor";

/**
 * GALLERY-1 (docs/slices/gallery-1.md) — the `gallery` block: schema, registration, the server HTML (`react-dom/server`,
 * through `RENDER_LOADERS.gallery` as the renderer loads it) for every row of the Evidence taxonomy, the address rule,
 * the locale texts, the accessible names and the lazy tiles. The browser behaviour of the viewer (hydration, open, step,
 * close, focus, keys, swipe, the photo loaded ahead) is exercised in the renderer's jsdom suite
 * `test/unit/gallery-1-client.test.ts`.
 */

const Gallery = (await RENDER_LOADERS["gallery"]()).default;
const EN = galleryTexts(resolveLocaleStrings({ locale: "en-US" }));
const html = (attrs: Record<string, unknown>) => renderToStaticMarkup(React.createElement(Gallery, { attrs, tenantId: "t1", strings: {} }));
const withTexts = (attrs: Record<string, unknown>) => html({ columns: "3", _gallery: EN, ...attrs });

/** The tiles of a render, in order: the link's attributes and the tile photo's attributes. */
function tiles(out: string) {
    return [...out.matchAll(/<li><a ([^>]*)><img ([^>]*)\/><\/a><\/li>/g)].map((m) => ({ link: attrsOf(m[1]), img: attrsOf(m[2]) }));
}
function attrsOf(s: string): Record<string, string> {
    return Object.fromEntries([...s.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}
/** The closed viewer: everything inside `<dialog …>…</dialog>`. */
const dialogOf = (out: string) => out.slice(out.indexOf("<dialog"), out.indexOf("</dialog>") + "</dialog>".length);

describe("registration", () => {
    it("the block is registered for the editor (every site kind) and has a lazy render loader; the schema's defaults", () => {
        expect(getPluginList().find((p) => p.key === "gallery")).toMatchObject({ key: "gallery", label: "Photo Gallery", offeredOn: [] });
        expect(GalleryPlugin.editorExtension.name).toBe("gallery");
        expect(typeof RENDER_LOADERS["gallery"]).toBe("function");
        expect(GalleryBlockSchema.parse({})).toEqual({ items: [], columns: "3", blockWidth: "content" });
        expect(GalleryBlockSchema.parse({ items: [{ src: "https://img.test/a.jpg" }] }).items).toEqual([{ src: "https://img.test/a.jpg", alt: "" }]);
        expect(GalleryBlockSchema.safeParse({ items: [{ src: "/a.jpg", width: 0 }] }).success).toBe(false);
    });
});

describe("Evidence taxonomy (docs/slices/gallery-1.md)", () => {
    it("row 1 — items absent / empty / not a list: the block renders nothing; no empty frame", () => {
        for (const items of [undefined, [], "x", null, {}]) expect(withTexts({ items }), JSON.stringify(items)).toBe("");
    });

    it("row 2 — valid, with thumb and sizes: a grid; the tile uses thumb; the link points to src; width/height on the <img>", () => {
        const out = withTexts({ items: [{ src: "https://img.test/a.jpg", thumb: "https://img.test/a-t.jpg", alt: "The garden", width: 1600, height: 1200 }] });
        expect(out.startsWith('<div class="my-8"><ul class="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">')).toBe(true);
        expect(tiles(out)).toEqual([{
            link: { href: "https://img.test/a.jpg", "data-gallery-index": "0", class: "block aspect-[4/3] overflow-hidden rounded-md bg-muted" },
            img: { src: "https://img.test/a-t.jpg", alt: "The garden", loading: "lazy", decoding: "async", width: "1600", height: "1200", class: "h-full w-full object-cover" },
        }]);
    });

    it("row 3 — valid, without thumb: the tile uses src (a thumb that fails the address rule counts as absent)", () => {
        const out = withTexts({ items: [{ src: "/uploads/b.jpg", alt: "B" }, { src: "https://img.test/c.jpg", alt: "C", thumb: "javascript:alert(1)" }] });
        expect(tiles(out).map((t) => [t.link.href, t.img.src])).toEqual([["/uploads/b.jpg", "/uploads/b.jpg"], ["https://img.test/c.jpg", "https://img.test/c.jpg"]]);
    });

    it("row 4 — an item with an empty or non-string src (or not an object) is dropped; the others render, renumbered", () => {
        const out = withTexts({ items: [{ src: "" }, { src: "   " }, { src: 7 }, { alt: "no src" }, null, "https://img.test/x.jpg", { src: "https://img.test/ok.jpg", alt: "OK" }] });
        expect(tiles(out).map((t) => [t.link.href, t.link["data-gallery-index"], t.img.alt])).toEqual([["https://img.test/ok.jpg", "0", "OK"]]);
        expect(withTexts({ items: [{ src: "" }, { src: 3 }] })).toBe("");
    });

    it("row 5 — src with a scheme other than https: or not a root-relative path is dropped", () => {
        const bad = ["http://img.test/a.jpg", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:image/png;base64,AAAA", "//evil.test/a.jpg", "uploads/a.jpg", "https:/img.test/a.jpg", "https://", "file:///etc/passwd"];
        const out = withTexts({ items: [...bad.map((src) => ({ src, alt: src })), { src: "https://img.test/kept.jpg", alt: "kept" }] });
        expect(tiles(out).map((t) => t.link.href)).toEqual(["https://img.test/kept.jpg"]);
    });

    it("row 6 — alt absent: alt=\"\", never the file name; the tile link is named by the locale text with its position", () => {
        const out = withTexts({ items: [{ src: "https://img.test/IMG_2041.jpg" }, { src: "https://img.test/IMG_2042.jpg", alt: "   " }, { src: "https://img.test/IMG_2043.jpg", alt: 5 }] });
        for (const [i, t] of tiles(out).entries()) {
            expect(t.img.alt).toBe("");
            expect(t.link["aria-label"]).toBe(`Photo ${i + 1}`);
        }
        expect(out).not.toMatch(/alt="IMG_/);
    });
});

describe("the address rule (rows 4-5; ruling 7: not isDirectMediaUrl, whose contract accepts http:, //host and relative paths)", () => {
    it("accepts https://<host>… and /<path>, trimmed; refuses every other address", () => {
        expect(galleryAddress("https://img.test/a.jpg")).toBe("https://img.test/a.jpg");
        expect(galleryAddress("HTTPS://img.test/a.jpg")).toBe("HTTPS://img.test/a.jpg");
        expect(galleryAddress("  /uploads/a b.jpg ")).toBe("/uploads/a b.jpg");
        expect(galleryAddress("https://img.test/a.jpg?w=400#x")).toBe("https://img.test/a.jpg?w=400#x");
        for (const bad of [undefined, null, 3, {}, "", "  ", "http://img.test/a.jpg", "//img.test/a.jpg", "/\\evil.test/a.jpg", "/\t/evil.test/a.jpg",
            "/a\nb.jpg", "a.jpg", "./a.jpg", "javascript:alert(1)", "data:image/png;base64,AA", "https:img.test", "https:///a.jpg", "https://img.test\\a.jpg", "blob:https://x/y"]) {
            expect(galleryAddress(bad), JSON.stringify(bad)).toBeNull();
        }
    });
});

describe("texts (ruling 2): the server pass's _gallery, in the page's language", () => {
    it("no _gallery (the admin preview) or one not of the server's shape → nothing", () => {
        const items = [{ src: "https://img.test/a.jpg", alt: "A" }];
        expect(html({ items })).toBe("");
        for (const bad of [null, "x", {}, { ...EN, close: "" }, { ...EN, counter: "  " }, { ...EN, photo: 3 }]) {
            expect(html({ items, _gallery: bad }), JSON.stringify(bad)).toBe("");
        }
    });

    it("Romanian page: the dialog's name, the three buttons and a tile's position name in Romanian (template filled)", () => {
        const ro = LANGUAGE_PACKS.ro.site;
        const out = html({ items: [{ src: "https://img.test/a.jpg", alt: "Camera" }, { src: "https://img.test/b.jpg" }], _gallery: galleryTexts(resolveLocaleStrings({ locale: "ro-RO" })) });
        expect(out).toContain(`<dialog aria-label="${ro.galleryViewer}"`);
        for (const t of [ro.galleryClose, ro.galleryPrevious, ro.galleryNext]) expect(out).toContain(`aria-label="${t}" title="${t}"`);
        expect(tiles(out).map((t) => t.link["aria-label"])).toEqual([undefined, "Fotografia 2"]);
        expect(out).not.toContain("Photo");
    });
});

describe("accessibility (ruling 8) and loading (ruling 9) in the server HTML", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ src: `https://img.test/large-${i + 1}.jpg`, thumb: `https://img.test/thumb-${i + 1}.jpg`, alt: i % 2 ? `Photo of room ${i + 1}` : "" }));
    const out = withTexts({ items });

    it("each tile link is named: by its photo's description, else by the locale text with its position", () => {
        const t = tiles(out);
        expect(t).toHaveLength(30);
        for (const [i, tile] of t.entries()) {
            if (i % 2) { expect(tile.img.alt).toBe(`Photo of room ${i + 1}`); expect(tile.link["aria-label"]).toBeUndefined(); }
            else { expect(tile.img.alt).toBe(""); expect(tile.link["aria-label"]).toBe(`Photo ${i + 1}`); }
        }
    });

    it("the closed viewer: a native <dialog> named by the locale text; Close, Previous and Next are named buttons of at least 44 px; a polite counter", () => {
        const dialog = dialogOf(out);
        expect(dialog.startsWith(`<dialog aria-label="${EN.viewer}"`)).toBe(true);
        expect(dialog).not.toContain(" open");
        const buttons = [...dialog.matchAll(/<button type="button" aria-label="([^"]+)" title="[^"]+" class="([^"]+)">/g)];
        expect(buttons.map((b) => b[1])).toEqual([EN.close, EN.previous, EN.next]);
        for (const b of buttons) expect(b[2]).toContain("h-11 w-11");
        expect(dialog).toContain('<p aria-live="polite"');
    });

    it("one photo: no Previous / Next", () => {
        const one = dialogOf(withTexts({ items: [items[0]] }));
        expect(one).toContain(`aria-label="${EN.close}"`);
        expect(one).not.toContain(EN.previous);
        expect(one).not.toContain(EN.next);
    });

    it("ruling 9 (a): the closed viewer holds no image (30 photos)", () => {
        expect(dialogOf(out)).not.toContain("<img");
        expect([...out.matchAll(/<img /g)]).toHaveLength(30);           // the 30 tiles, nothing else
    });

    it("ruling 9 (c): 30 tiles WITH thumb — each tile loads its small file, lazily; no tile <img> holds a large file", () => {
        const imgs = [...out.matchAll(/<img ([^>]*)\/>/g)].map((m) => attrsOf(m[1]));
        expect(imgs).toHaveLength(30);
        for (const [i, img] of imgs.entries()) {
            expect(img.loading).toBe("lazy");
            expect(img.src).toBe(`https://img.test/thumb-${i + 1}.jpg`);
        }
        expect(out).not.toMatch(/<img src="https:\/\/img\.test\/large-/);
    });

    it("ruling 9 (d), NO page-load guarantee: 30 tiles WITHOUT thumb (an editor-built gallery) — each tile <img> IS the large file, deferred only by native lazy loading (the browser loads every lazy image within its distance of the screen; measured 30/30 and 28/30, docs/TECH-DEBT.md § gallery-1)", () => {
        const noThumb = withTexts({ items: items.map(({ thumb: _t, ...item }) => item) });
        const imgs = [...noThumb.matchAll(/<img ([^>]*)\/>/g)].map((m) => attrsOf(m[1]));
        expect(imgs).toHaveLength(30);
        for (const [i, img] of imgs.entries()) {
            expect(img.src).toBe(`https://img.test/large-${i + 1}.jpg`);   // the large file, as the link's target
            expect(img.loading).toBe("lazy");                              // the only deferral there is
        }
        expect(dialogOf(noThumb)).not.toContain("<img");                  // (a) still holds
    });

    it("reduced motion: no animation or transition class in the block, nor in its source files", () => {
        expect(out).not.toMatch(/\b(transition|animate|duration|ease)-?[a-z0-9-]*/);
        for (const file of ["GalleryRender.tsx", "GalleryViewer.tsx"]) {
            const src = readFileSync(new URL(`../src/gallery/${file}`, import.meta.url), "utf8");
            expect(src, file).not.toMatch(/className="[^"]*\b(transition|animate-|duration-|motion-)/);
        }
    });

    it("columns: 2 / 3 / 4 choose the grid; an unknown or inherited value gives 3", () => {
        const grid = (columns: unknown) => withTexts({ items: [items[1]], columns }).match(/<ul class="([^"]+)">/)![1];
        expect(grid("2")).toBe("grid grid-cols-2 gap-2 sm:gap-4");
        expect(grid("3")).toBe("grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4");
        expect(grid("4")).toBe("grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4");
        for (const v of ["5", "constructor", 4, undefined]) expect(grid(v), String(v)).toBe(grid("3"));
    });

    it("sizes go on the <img> only when both are positive integers", () => {
        const one = (extra: Record<string, unknown>) => tiles(withTexts({ items: [{ src: "/a.jpg", alt: "A", ...extra }] }))[0].img;
        expect(one({ width: 800, height: 600 })).toMatchObject({ width: "800", height: "600" });
        for (const extra of [{ width: 800 }, { width: 800, height: 0 }, { width: "800", height: "600" }, { width: 800.5, height: 600 }]) {
            const img = one(extra);
            expect(img.width, JSON.stringify(extra)).toBeUndefined();
            expect(img.height, JSON.stringify(extra)).toBeUndefined();
        }
    });
});

describe("ruling 2: the counter and the tile name use the locale table's template rule (a copy, by the stop condition of GALLERY1-TEMPLATE-IMPORT = C)", () => {
    it("fillLocaleTemplate (the gallery's copy, see its comment) gives exactly the text of @amodx/shared fillTemplate", () => {
        const templates = ["{n} of {total}", "{n} din {total}", "Photo {n}", "{total}/{n}/{n}", "no placeholder", "{missing} {n}", "{N} {n}", "{ n }", "{n}{total}", "", "{n_1} {total}", "$& {n} $1"];
        const values = [{ n: 3, total: 30 }, { n: 1, total: 1 }, { n: "$&", total: "$'" }, {}, { n_1: 7 }];
        for (const t of templates) for (const v of values) expect(fillLocaleTemplate(t, v), `${t} ${JSON.stringify(v)}`).toBe(fillTemplate(t, v));
        for (const pack of Object.values(LANGUAGE_PACKS)) {
            expect(fillLocaleTemplate(pack.site.galleryCounter!, { n: 4, total: 30 })).toBe(fillTemplate(pack.site.galleryCounter!, { n: 4, total: 30 }));
            expect(fillLocaleTemplate(pack.site.galleryPhoto!, { n: 4 })).toBe(fillTemplate(pack.site.galleryPhoto!, { n: 4 }));
        }
    });
});

describe("viewer and editor helpers", () => {
    it("steppedIndex wraps around at both ends", () => {
        expect(steppedIndex(0, -1, 30)).toBe(29);
        expect(steppedIndex(29, 1, 30)).toBe(0);
        expect(steppedIndex(4, 1, 30)).toBe(5);
    });

    it("swipeStep: a mostly horizontal travel of at least SWIPE_MIN_PX; left = next, right = previous", () => {
        expect(swipeStep(-SWIPE_MIN_PX, 0)).toBe(1);
        expect(swipeStep(SWIPE_MIN_PX + 20, 10)).toBe(-1);
        expect(swipeStep(-(SWIPE_MIN_PX - 1), 0)).toBe(0);
        expect(swipeStep(-60, 80)).toBe(0);
    });

    it("withPhotosAdded appends one photo per picked address, in the picked order, with an empty description; blank addresses add nothing; stored fields are kept", () => {
        const stored = [{ src: "https://img.test/a.jpg", thumb: "https://img.test/a-t.jpg", alt: "A", width: 10, height: 10 }];
        expect(withPhotosAdded(stored, ["https://img.test/c.jpg", "", "https://img.test/b.jpg"])).toEqual([
            stored[0], { src: "https://img.test/c.jpg", alt: "" }, { src: "https://img.test/b.jpg", alt: "" },
        ]);
        expect(withPhotosAdded([], [])).toEqual([]);
    });
});
