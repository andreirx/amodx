import { describe, it, expect, afterEach } from "vitest";
import {
    toPublicReviewPhotos,
    toCarouselReviewItems,
    reviewAssetCdnBase,
    REVIEW_STAGING_PREFIX,
} from "../../src/lib/review-images";

/**
 * slice `rev-4` — `src/lib/review-images.ts`: the public-boundary filter + assetKey→URL resolution
 * shared by the product-page review render and the site-reviews carousel prefetch.
 *
 * This is the SECURITY-relevant half of rev-4 (a private quarantine key must never become a public
 * URL) plus the approved-only guarantee, both pinned WITHOUT AWS or a running renderer — the helper
 * is pure and takes the CDN base as an argument. The plugin's markup emission is pinned separately
 * in `packages/plugins/test/reviewsCarousel.test.ts`.
 */

const BASE = "https://cdn.example.com";

const img = (over: Record<string, unknown> = {}) => ({
    assetKey: "tenantA/photo.jpg",
    status: "approved",
    ...over,
});

describe("toPublicReviewPhotos — approved-only + URL resolution", () => {
    it("resolves an approved public image to `${base}/${assetKey}` with alt", () => {
        const out = toPublicReviewPhotos([img({ alt: "on model" })], BASE);
        expect(out).toEqual([{ url: "https://cdn.example.com/tenantA/photo.jpg", alt: "on model" }]);
    });

    it("omits alt when the image has none", () => {
        const out = toPublicReviewPhotos([img()], BASE);
        expect(out).toEqual([{ url: "https://cdn.example.com/tenantA/photo.jpg" }]);
    });

    it("drops pending and hidden images (per-image moderation gate)", () => {
        const out = toPublicReviewPhotos(
            [img({ status: "pending" }), img({ status: "hidden" }), img()],
            BASE,
        );
        expect(out).toHaveLength(1);
        expect(out[0].url).toBe("https://cdn.example.com/tenantA/photo.jpg");
    });

    it("NEVER resolves a private staging key, even if marked approved (leak guard)", () => {
        const out = toPublicReviewPhotos(
            [img({ assetKey: `${REVIEW_STAGING_PREFIX}tenantA/batch/1/original`, status: "approved" })],
            BASE,
        );
        expect(out).toEqual([]);
    });

    it("drops entries with a missing or empty assetKey", () => {
        const out = toPublicReviewPhotos(
            [img({ assetKey: undefined }), img({ assetKey: "" }), img()],
            BASE,
        );
        expect(out).toHaveLength(1);
    });

    it("returns [] when the CDN base is empty (text-only degradation, never a broken /key src)", () => {
        expect(toPublicReviewPhotos([img()], "")).toEqual([]);
    });

    it("returns [] for a non-array / undefined images field", () => {
        expect(toPublicReviewPhotos(undefined, BASE)).toEqual([]);
        // @ts-expect-error — exercising a malformed persisted shape
        expect(toPublicReviewPhotos("nope", BASE)).toEqual([]);
    });
});

describe("toCarouselReviewItems — DB review → carousel item mapping", () => {
    it("maps fields and narrows the source enum to the badge enum", () => {
        const out = toCarouselReviewItems(
            [
                { id: "a", authorName: "Maria", rating: 5, content: "Lovely", source: "google", createdAt: "2025-01-01", images: [img()] },
                { id: "b", authorName: "Imp", rating: 4, content: "ok", source: "imported", createdAt: "2025-01-02" },
                { id: "c", authorName: "Fb", rating: 3, content: "", source: "facebook", createdAt: "2025-01-03" },
            ],
            BASE,
        );
        expect(out[0]).toEqual({
            id: "a", name: "Maria", date: "2025-01-01", rating: 5, text: "Lovely",
            source: "google", photos: [{ url: "https://cdn.example.com/tenantA/photo.jpg" }],
        });
        // "imported"/"internal" carry no badge → mapped to "manual"; "facebook" preserved.
        expect(out[1].source).toBe("manual");
        expect(out[2].source).toBe("facebook");
        expect(out[1].photos).toEqual([]);
    });

    it("applies the approved-only photo filter per review", () => {
        const out = toCarouselReviewItems(
            [{ id: "a", authorName: "M", rating: 5, content: "x", source: "google", createdAt: "2025-01-01", images: [img({ status: "pending" }), img()] }],
            BASE,
        );
        expect(out[0].photos).toHaveLength(1);
    });
});

describe("reviewAssetCdnBase — env sourcing", () => {
    const original = process.env.UPLOADS_CDN_URL;
    afterEach(() => {
        if (original === undefined) delete process.env.UPLOADS_CDN_URL;
        else process.env.UPLOADS_CDN_URL = original;
    });

    it("returns '' when UPLOADS_CDN_URL is unset", () => {
        delete process.env.UPLOADS_CDN_URL;
        expect(reviewAssetCdnBase()).toBe("");
    });

    it("trims a trailing slash so `${base}/${key}` never doubles", () => {
        process.env.UPLOADS_CDN_URL = "https://cdn.example.com/";
        expect(reviewAssetCdnBase()).toBe("https://cdn.example.com");
    });

    it("passes a clean base through unchanged", () => {
        process.env.UPLOADS_CDN_URL = "https://cdn.example.com";
        expect(reviewAssetCdnBase()).toBe("https://cdn.example.com");
    });
});
