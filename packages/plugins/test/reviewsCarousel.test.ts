import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RENDER_MAP } from "../src/render";
import { ReviewsCarouselEditor } from "../src/reviews-carousel/ReviewsCarouselEditor";

/**
 * slice `rev-4` — the `reviews-carousel` block's two rev-4 additions, asserted as OUTPUT:
 *   1. review PHOTOS render (bounded thumbnail, lazy, alt, plain <a> to the full image, NOT
 *      next/image), and
 *   2. the `scope` toggle exists in the editor.
 *
 * Same harness rationale as `videoPlugin.test.ts`: `renderToStaticMarkup` is `react-dom/server`
 * (the renderer's own SSR path), needs no jsdom/window, and importing through `RENDER_MAP` doubles
 * as the SSR-safety smoke test for the render entry (`@amodx/plugins/render`).
 *
 * The APPROVED-ONLY + private-key-leak filter lives on the RENDERER side
 * (`renderer/src/lib/review-images.ts`, covered by `renderer/test/unit/review-images.test.ts`):
 * by the time an item reaches this block its `photos` are already the resolved, public, raw URLs.
 * This file pins that such photos EMIT the correct lazy/alt/anchor markup in a DB scope, that a
 * manual/legacy block emits NONE (the DB-scope gate — even when a hand-edited manual block carries
 * an injected `photos` array, which `RenderBlocks` would pass through un-parsed), and that the
 * `scope` toggle exists in the editor.
 */

const ReviewsCarousel = RENDER_MAP["reviewsCarousel"];

function markup(attrs: any): string {
    return renderToStaticMarkup(React.createElement(ReviewsCarousel, { attrs }));
}

describe("reviewsCarousel render — review photos (rev-4)", () => {
    it("renders approved photos as lazy, alt-bearing thumbnails linking to the full raw URL", () => {
        const html = markup({
            headline: "What customers say",
            scope: "site-reviews",
            showSource: true,
            items: [
                {
                    id: "r1",
                    name: "Maria P.",
                    date: "2025-01-15",
                    rating: 5,
                    text: "Beautiful piece.",
                    source: "google",
                    photos: [
                        { url: "https://cdn.example.com/tenantA/abc.jpg", alt: "necklace on model" },
                    ],
                },
            ],
        });

        // Raw <img> with lazy-loading and the alt from the schema — never a next/image wrapper.
        expect(html).toContain('src="https://cdn.example.com/tenantA/abc.jpg"');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('alt="necklace on model"');
        // Plain anchor to the full image (lightbox-free, phase 1).
        expect(html).toContain('href="https://cdn.example.com/tenantA/abc.jpg"');
        // Guard against an accidental next/image migration.
        expect(html).not.toContain("/_next/image");
    });

    it("renders no photo thumbnails for a manual item that carries none", () => {
        const html = markup({
            headline: "Reviews",
            showSource: true,
            items: [
                { id: "m1", name: "Ion I.", date: "2025-01-10", rating: 5, text: "Great!", source: "google" },
            ],
        });
        // The review itself renders...
        expect(html).toContain("Great!");
        // ...but no lazy photo thumbnail (manual items have no `photos`).
        expect(html).not.toContain('loading="lazy"');
    });

    it("emits NO thumbnail for a manual-scope block even when `photos` is injected (DB-scope gate)", () => {
        // A hand-edited/legacy `manual` block: RenderBlocks passes persisted attrs through WITHOUT
        // schema-parsing, so an attacker/author could inject a `photos` array. The render must NOT
        // turn that unmoderated URL into markup — photos are gated to DB scopes only.
        const html = markup({
            headline: "Reviews",
            scope: "manual",
            showSource: true,
            items: [
                {
                    id: "inj",
                    name: "Injected",
                    date: "",
                    rating: 5,
                    text: "Legit text",
                    source: "google",
                    photos: [{ url: "https://evil.example.com/leak.jpg", alt: "leak" }],
                },
            ],
        });
        // The review text still renders...
        expect(html).toContain("Legit text");
        // ...but the injected photo never reaches markup.
        expect(html).not.toContain("https://evil.example.com/leak.jpg");
        expect(html).not.toContain('loading="lazy"');
    });

    it("emits NO thumbnail when `scope` is absent (legacy block) despite injected `photos`", () => {
        const html = markup({
            headline: "Reviews",
            // no `scope` attr at all — pre-rev-4 persisted block
            showSource: true,
            items: [
                {
                    id: "leg",
                    name: "Legacy",
                    date: "",
                    rating: 5,
                    text: "Old block",
                    source: "google",
                    photos: [{ url: "https://cdn.example.com/t/legacy.jpg" }],
                },
            ],
        });
        expect(html).toContain("Old block");
        expect(html).not.toContain("https://cdn.example.com/t/legacy.jpg");
        expect(html).not.toContain('loading="lazy"');
    });

    it("multiple approved photos each render a lazy thumbnail", () => {
        const html = markup({
            headline: "Gallery",
            scope: "product-reviews-by-id",
            showSource: false,
            items: [
                {
                    id: "r2",
                    name: "A",
                    date: "",
                    rating: 4,
                    text: "",
                    source: "manual",
                    photos: [
                        { url: "https://cdn.example.com/t/1.jpg" },
                        { url: "https://cdn.example.com/t/2.webp" },
                    ],
                },
            ],
        });
        expect(html).toContain('src="https://cdn.example.com/t/1.jpg"');
        expect(html).toContain('src="https://cdn.example.com/t/2.webp"');
        expect((html.match(/loading="lazy"/g) || []).length).toBe(2);
    });
});

describe("reviewsCarousel editor — scope toggle (rev-4)", () => {
    // The editor reads only `props.node.attrs`; NodeViewWrapper degrades to a plain <div> with no
    // editor context (same as VideoEditor in videoPlugin.test.ts). We assert its STATIC output.
    function editorMarkup(attrs: any): string {
        return renderToStaticMarkup(
            React.createElement(ReviewsCarouselEditor, {
                node: { attrs },
                updateAttributes: () => {},
            }),
        );
    }

    it("exposes all three data-source options", () => {
        const html = editorMarkup({ headline: "H", scope: "manual", items: [], showSource: true, autoScroll: false, maxLines: 4, blockWidth: "content" });
        expect(html).toContain('value="manual"');
        expect(html).toContain('value="product-reviews-by-id"');
        expect(html).toContain('value="site-reviews"');
    });

    it("shows the productId input when scope is product-reviews-by-id", () => {
        const html = editorMarkup({ headline: "H", scope: "product-reviews-by-id", productId: "abc", items: [], showSource: true, autoScroll: false, maxLines: 4, blockWidth: "content" });
        expect(html).toContain("Product ID (UUID)");
        expect(html).not.toContain("Add Review");
    });

    it("hides the manual item editor and shows the site-scope note when scope is site-reviews", () => {
        const html = editorMarkup({ headline: "H", scope: "site-reviews", items: [{ id: "x", name: "N", rating: 5, text: "t", source: "google", date: "" }], showSource: true, autoScroll: false, maxLines: 4, blockWidth: "content" });
        expect(html).toContain("approved site reviews");
        // The "Add Review" manual affordance is not rendered in site-reviews mode.
        expect(html).not.toContain("Add Review");
    });
});
