// Review-image resolution for the renderer (rev-4).
//
// A ReviewImage (rev-1 `ReviewImageSchema`) carries a bare `assetKey` — the S3 object KEY of the
// re-hosted photo — plus a per-image moderation `status` and optional `alt`. It is NEVER a URL:
// the ratified spine (rev-2a §4) keeps the field a key and derives the PUBLIC URL at render via
// `${CDN_BASE}/${assetKey}`, served as a RAW asset URL (never next/image — the opennext-1 parking
// rule). This module is the single place that (a) enforces the public-boundary filter and (b)
// performs that key→URL resolution, so the product-page review render and the DB-scope carousel
// prefetch cannot drift apart. Both the READ (dynamo.getProductReviews / getSiteReviews) and the
// key→URL MAPPING live OUTSIDE this file: the dynamo reads only project the raw rows; the mapping
// onto block items (toCarouselReviewItems) is invoked in `SitePage`'s prefetch branches.
//
// TWO CURRENT CALLERS of `toPublicReviewPhotos` (why it is shared, not inlined): `SitePage`
// ProductPageView's review section, and `toCarouselReviewItems` below. Both need the identical
// approved-only filter + URL derivation over the same non-trivial rules. Rejected inlining twice —
// the filter is a security boundary (a private staging key must never leak public), and one copy
// is auditable where two copies rot. Not an interface/registry: variation is nil, growth is nil.

/**
 * PRIVATE quarantine key namespace. A DUPLICATE of the backend single source
 * (`backend/src/lib/review-media.ts` `REVIEW_STAGING_PREFIX`) — the renderer cannot import backend
 * code across the package boundary, so the literal is copied with this pointer, exactly as
 * `isProductAvailable` is duplicated in `dynamo.ts`. Keep the two in sync; they are one contract.
 */
export const REVIEW_STAGING_PREFIX = "review-staging/";

/** A raw ReviewImage as it comes off DynamoDB (metadata only; `assetKey` is an S3 KEY). */
export interface RawReviewImage {
    assetKey?: string;
    status?: string;
    alt?: string;
}

/** A render-ready photo: a resolved RAW asset URL + optional alt. */
export interface PublicReviewPhoto {
    url: string;
    alt?: string;
}

/**
 * The CDN base for re-hosted review photos, or "" when unconfigured.
 *
 * Sourced from `UPLOADS_CDN_URL` — the same public assets CloudFront host the backend stamps into
 * product `imageLink`s and the promoted Asset record's `publicUrl` (`backend/src/assets/create.ts`,
 * `backend/src/lib/review-media.ts`). Returning "" (rather than throwing) when it is absent is a
 * DELIBERATE graceful degradation: with no base the review still renders its text/stars/author —
 * only the photos are omitted. A throw would 500 every page carrying reviews until infra wires the
 * var, which is strictly worse than text-only reviews. NOTE (tracked follow-up): the renderer
 * server Lambda does not yet receive `UPLOADS_CDN_URL` (infra/lib/renderer-hosting.ts) — wiring it
 * is a one-line composition-root change OUTSIDE this slice's writable surface; until then photos
 * degrade to absent. Trailing slash trimmed so `${base}/${key}` never doubles.
 *
 * BOUNDARY, stated precisely: the `UPLOADS_CDN_URL` env var and the assetKey→URL resolution stay
 * server-side, but the RESOLVED `${base}/${key}` is a PUBLIC URL that DOES ship to the client inside
 * the raw `<img src>`/`<a href>` — exactly as a product `imageLink` (also `base`-prefixed) reaches
 * the client already-resolved. What is protected is not the base string but the private staging key
 * and the unapproved image (see `toPublicReviewPhotos`), never the public CDN host itself.
 */
export function reviewAssetCdnBase(): string {
    const raw = process.env.UPLOADS_CDN_URL;
    if (!raw) return "";
    return raw.replace(/\/+$/, "");
}

/**
 * Filter a review's images to the PUBLIC, RENDERABLE set and resolve each to a raw asset URL.
 *
 * Public-boundary filter (mirrors `backend/src/reviews/public-list.ts`): keep an image only when
 *   (a) `status === "approved"` — the per-image human-moderation gate, AND
 *   (b) its `assetKey` is a non-empty string that is NOT under the private staging prefix.
 * (b) is defense-in-depth: an approved image always carries a promoted PUBLIC key, but should a
 * stray (approved + staging) entry ever exist, this guarantees a private quarantine key can never
 * be turned into a public URL and leaked.
 *
 * Pure and base-injected so it is unit-testable with no AWS and no env. When `cdnBase` is "" every
 * image resolves to no URL and the result is empty — text-only reviews, never a broken `/key` src.
 */
export function toPublicReviewPhotos(
    images: RawReviewImage[] | undefined,
    cdnBase: string,
): PublicReviewPhoto[] {
    if (!cdnBase || !Array.isArray(images)) return [];
    const out: PublicReviewPhoto[] = [];
    for (const img of images) {
        if (!img || img.status !== "approved") continue;
        const key = img.assetKey;
        if (typeof key !== "string" || key.length === 0) continue;
        if (key.startsWith(REVIEW_STAGING_PREFIX)) continue;
        out.push({ url: `${cdnBase}/${key}`, ...(img.alt ? { alt: img.alt } : {}) });
    }
    return out;
}

/** A System-A review row off DynamoDB (the projected shape from getProductReviews/getSiteReviews). */
export interface RawDbReview {
    id: string;
    authorName?: string;
    rating?: number;
    content?: string;
    source?: string;
    createdAt?: string;
    images?: RawReviewImage[];
}

/** The reviews-carousel block item shape (System B) the render consumes. */
export interface CarouselReviewItem {
    id: string;
    name: string;
    date: string;
    rating: number;
    text: string;
    source: "google" | "facebook" | "manual";
    photos: PublicReviewPhoto[];
}

/**
 * Map DB reviews (product- or site-scope) onto the reviews-carousel block's item shape, resolving
 * each review's approved photos to raw asset URLs. TWO CURRENT CALLERS: the `product-reviews-by-id`
 * and `site-reviews` prefetch branches in `SitePage` — both take the same {items,...} return of
 * getProductReviews/getSiteReviews and need the identical mapping, so it lives here once.
 *
 * The System-A `source` enum (`google|internal|imported|manual`) is narrowed to the block's badge
 * enum: only `google`/`facebook` carry a badge; everything else maps to `manual` (no badge).
 */
export function toCarouselReviewItems(reviews: RawDbReview[], cdnBase: string): CarouselReviewItem[] {
    return reviews.map((r) => ({
        id: r.id,
        name: r.authorName ?? "",
        date: r.createdAt ?? "",
        rating: r.rating ?? 5,
        text: r.content ?? "",
        source: r.source === "google" ? "google" : r.source === "facebook" ? "facebook" : "manual",
        photos: toPublicReviewPhotos(r.images, cdnBase),
    }));
}
