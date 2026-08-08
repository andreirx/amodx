# REV-4: Renderer review display — images on product reviews + site-reviews block

- **Status:** IMPLEMENTED (uncommitted, awaiting review). Undeployed.
- **Track:** REV
- **Depends:** rev-1..3 (all committed)

> **DEPLOY GATE (infra follow-up, OUTSIDE this slice's writable surface).** Review photos are
> re-hosted to the public uploads bucket and the renderer derives their URL as
> `${UPLOADS_CDN_URL}/${assetKey}` at render (rev-2a §4 / `renderer/src/lib/review-images.ts`
> `reviewAssetCdnBase`). The renderer server Lambda does **not** yet receive `UPLOADS_CDN_URL`
> (`infra/lib/renderer-hosting.ts` — this slice bans infra edits). Until that ONE env var is wired,
> photos degrade to ABSENT (review text/stars/author still render; serving suite stays green). Text
> is correct without it; photos require the wiring. Tracked in `docs/TECH-DEBT.md`.

## Block editor option table (reviews-carousel — rev-4)

| Attr | Values | Default | Effect |
|------|--------|---------|--------|
| `scope` | `manual` \| `product-reviews-by-id` \| `site-reviews` | `manual` | `manual`: render authored `items`. `product-reviews-by-id`: prefetch REPLACES `items` with a product's approved reviews (by `productId`) + approved photos. `site-reviews`: prefetch REPLACES `items` with the tenant's approved SITE-scope (`SITEREVIEW#`) reviews + approved photos. |
| `productId` | string (UUID) | "" | Target product for `product-reviews-by-id` (free text for now — a picker is a future nicety). Ignored in other scopes. |
| `headline` | string | "Customer Reviews" | Section heading (all scopes). |
| `items[].photos` | `{url, alt?}[]` | — | NOT author-editable; populated by server prefetch in a DB scope only (assetKey→raw URL resolved server-side). |

**DoD note:** `site-reviews` is the DoD-verified path (business-level render surface, the point of
the slice). `product-reviews-by-id` reuses the identical prefetch/mapping/render machinery over the
existing `getProductReviews` read and is exercised by the same rendered-markup assertions; its only
distinct surface is the `productId` input.

## Scope

1. **Product reviews with photos:** the existing product-page review rendering (and
   the reviews-carousel block) display approved images (public assetKeys → asset CDN
   URLs — RAW asset URLs, NEVER next/image, per the opennext-1 parking rule). Bounded
   thumbnails, lightbox-free (plain <a> to full image is fine for phase 1), lazy
   loading, alt text from schema.
2. **Site-reviews block:** the reviews-carousel plugin gains a scope option
   (product-reviews-by-id | site-reviews) so "what customers say about us" renders on
   any page from site-scope reviews (approved only). Admin side: the block's editor
   exposes the toggle. SSR-safe render entry (split-entry rule).
3. Serving contract: these render on CACHEABLE pages — zero dynamic APIs introduced;
   test:serving stays green; cache-4a purge coverage: review approve/hide mutations
   are ALREADY wrapped (verify classification: ordinary fast-lane or bulk? record).
4. Public reviews list already filters correctly (rev-3 proof) — renderer consumes it
   server-side via existing dynamo read (extend getProductReviews/add site variant —
   note the aliased #src projection from the prod hotfix, keep it).

## Cache-4a invalidation classification (recorded — §3)

**OBSERVED** (`backend/src/reviews/update.ts:567` → `withInvalidation(_handler)`;
`backend/src/lib/invalidate-cdn.ts:5–17`): review approve/hide mutations are on the **BULK**
class, NOT the ordinary fast lane. `withInvalidation()` writes the `SYSTEM / CDN_PENDING` marker →
the debounce-flush Lambda fires a site-wide `/*` CloudFront invalidation after 15 min of quiet, and
the admin shows the "GO LIVE NOW" banner. It does **not** call
`enqueueEdgeInvalidation()`/`revalidateTenantPaths` (the ~10 s targeted `CDN_FAST_PENDING` lane).

**Consequence for rev-4:** a newly approved (or hidden) review's text/photos propagate to already
edge-cached pages on the **bulk cadence** — the 15-min-quiet `/*` flush, or immediately when the
operator clicks "GO LIVE NOW" — not in seconds. This is correct and sufficient for phase 1: a
site-scope review can appear on *any* page, so there is no bounded set of "changed URI paths" to
feed the fast lane (unlike an ordinary single-page edit). No change is made to this classification
in rev-4; the render is a pure read of already-approved data, and the existing bulk wrap already
covers the moderation mutation. Recorded here to satisfy the §3 "verify classification … record".

## Non-scope

Connectors, ratings aggregation/schema.org (future), pagination beyond existing
patterns, next/image.

## DoD / evidence

Plugins/renderer unit + rendered-markup assertions (images render for approved-only;
site block renders site scope; lazy+alt attrs); serving suite green; full build +
typecheck; operator visual checklist for look-and-feel.

## Operator visual checklist — NOT RUN (requires a running renderer + deployed data)

**Status: NOT RUN.** These are look-and-feel / real-browser checks the automated suite cannot
make. They require a running renderer serving a tenant that has approved reviews *with photos* in
the DB, AND the `UPLOADS_CDN_URL` deploy gate wired (see the DEPLOY GATE box at the top) — until
that env var reaches the renderer Lambda, every photo row below degrades to **absent** (text/stars/
author still render). Run this manually after the gate is wired, before sign-off.

**Precondition — CDN gate:**
- [ ] `UPLOADS_CDN_URL` is set on the renderer server Lambda. With it UNSET, confirm reviews still
      render text/stars/author and NO broken `/<assetKey>` image (graceful degradation, not a 500).

**Product page (`/product/<slug>`) — review photos:**
- [ ] An **approved** review with an approved photo shows the photo as a bounded ~80×80 thumbnail
      (`w-20 h-20`, `object-cover`), not full-bleed or overflowing the review card.
- [ ] The thumbnail has visible **alt text** (inspect element / screen-reader) matching the schema.
- [ ] The image tag is a raw `<img loading="lazy">` — **no** `/_next/image` in the URL (view source).
- [ ] Clicking the thumbnail opens the **full image** in a new tab (plain `<a target="_blank">`,
      lightbox-free — phase 1).
- [ ] A review whose photo is **pending** or **hidden** shows the review text but **no** thumbnail;
      the private/unmoderated asset key never appears in page source.
- [ ] A review with **no** photos renders normally (text/stars only), no empty photo strip.

**Site-reviews carousel block (any page carrying a `reviewsCarousel` block, `scope = site-reviews`):**
- [ ] The block shows the tenant's **approved SITE-scope** reviews — not the manually authored
      placeholder items (authored `items` are replaced by the server prefetch).
- [ ] Approved review photos render as bounded, lazy, alt-bearing thumbnails linking to the full
      image, identical to the product-page treatment.
- [ ] Switching the block's editor **Source** toggle to `Product reviews (by ID)` and entering a
      valid product UUID renders that product's approved reviews on the page.
- [ ] `scope = manual` blocks are unchanged — authored items render verbatim, no DB read.

**Theming / chrome:**
- [ ] Thumbnail borders and the editor Source separator use theme tokens (adapt to a dark/alternate
      tenant theme), no hardcoded light-mode color bleeding through.
