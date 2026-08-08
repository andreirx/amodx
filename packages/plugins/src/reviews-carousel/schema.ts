import { z } from 'zod';

/**
 * One photo attached to a review (rev-4). NOT author-editable: this field is populated ONLY by
 * the renderer's server-side prefetch in a DB scope (`scope === "site-reviews"` OR
 * `scope === "product-reviews-by-id"`) — it maps an approved System-A review's approved photos to
 * already-resolved RAW asset URLs (assetKey → `${CDN}/${key}`). The key→URL resolution and the
 * `UPLOADS_CDN_URL` env var stay server-side; the RESOLVED public `url` (base included) does ship
 * to the client inside the raw `<img src>`/`<a href>`, exactly as a product `imageLink` reaches the
 * client already-resolved. `url` is rendered with a plain <img loading="lazy">, NEVER next/image
 * (opennext-1 parking rule). In "manual" mode this stays absent (authors never type it) and the
 * render GATES it out anyway (ReviewsCarouselRender: a non-DB scope emits no photo markup, so an
 * injected `photos` on a hand-edited manual block cannot leak an unmoderated URL).
 */
const ReviewPhoto = z.object({
    url: z.string(),
    alt: z.string().optional(),
});

const ReviewItem = z.object({
    id: z.string(),
    name: z.string().default("Customer Name"),
    avatarUrl: z.string().optional(),
    date: z.string().default(""),
    rating: z.number().min(1).max(5).default(5),
    text: z.string().default(""),
    source: z.enum(["google", "facebook", "manual"]).default("google"),
    // Populated by server prefetch in a DB scope only (site-reviews / product-reviews-by-id; see
    // ReviewPhoto). Optional + additive → author-typed manual items (which never carry it) stay valid.
    photos: z.array(ReviewPhoto).optional(),
});

export const ReviewsCarouselSchema = z.object({
    headline: z.string().default("Customer Reviews"),
    // Data source discriminator (rev-4, D-REV-5 site-scope render surface).
    //   "manual"                — author-typed `items` below (original behaviour, unchanged).
    //   "product-reviews-by-id" — server prefetch REPLACES `items` with a specific product's
    //                             approved reviews (by `productId`), photos included.
    //   "site-reviews"          — server prefetch REPLACES `items` with the tenant's approved
    //                             SITE-scope (SITEREVIEW#) reviews, photos included.
    // Default is "manual" so every existing block keeps rendering its authored items verbatim.
    scope: z.enum(["manual", "product-reviews-by-id", "site-reviews"]).default("manual"),
    // Target product for "product-reviews-by-id" scope (ignored in other scopes). A product UUID;
    // authored as free text for now (a product picker is a future nicety, tracked in the slice).
    productId: z.string().optional(),
    items: z.array(ReviewItem).default([
        { id: '1', name: "Maria Popescu", date: "2025-01-15", rating: 5, text: "Excellent products!", source: "google" },
        { id: '2', name: "Ion Ionescu", date: "2025-01-10", rating: 5, text: "Great quality and fast delivery.", source: "google" },
    ]),
    showSource: z.boolean().default(true),
    autoScroll: z.boolean().default(false),
    maxLines: z.number().min(2).max(20).default(4),  // visible lines before "Read more"
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
