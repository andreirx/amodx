# CATALOG-MODE-1 — the presentation-store tenant mode (SPEC slice)

Status: **PROPOSED** (packet written 2026-10-27 by the glamCRM operator session; see
`docs/plan-glam-catalog.md` for the why and the integration plan). SPEC ONLY — no code changes
with this document; the gate proves it.

## 1. Human direction (2026-10-27), quoted

"generate a presentation website like those with commerce enabled so it looks like an online
store with images and descriptions but **without the producer codes, without prices and without
any possibility of ordering**, rather just offering some sort of 'pick the items you're
interested in and contact us about them'."

## 2. Purpose / risk retired

A tenant can today flip `commerceEnabled=false` and get product/category/shop pages with no cart —
but the pages still print a price, a Buy/availability control, JSON-LD `offers`, and the OpenAI
feed publishes `price` for every product; the sitemap drops the products entirely. A catalog tenant
built on today's code would publish fabricated prices ("0 USD") to search engines and AI agents,
which is a trust defect, not a cosmetic one. This spec defines the mode in which none of that can
happen, by construction.

## 3. What the spec must define

1. **The `catalogMode` tenant flag** (name final at ratification): where it lives in the tenant
   config (`packages/shared` TenantConfig), who may set it (TENANT_ADMIN in the admin settings
   card), and the rule that it is **mutually exclusive with `commerceEnabled`** (both true is a
   validation error, not a precedence rule).
2. **Every price/ordering surface, enumerated, with its catalog-mode behavior** — the spec's table
   is the oracle for CAT-MODE-1. Known today (the builder sweeps for more and lists every hit):
   product page price + sale price + currency; Buy/Pre-order/Out-of-stock controls; availability
   badges; JSON-LD `offers` block; the OpenAI feed's `price`/`sale_price`/availability; cart/
   checkout prefixes and `CartWidget`/`CommerceBar` (already off without `commerceEnabled`);
   category/shop card prices; search result prices; the `/products/[id]` legacy page; Paddle links.
3. **The sitemap/feed inclusion rule**: catalog tenants are INDEXABLE — products and categories
   appear in the sitemap; the OpenAI feed either omits price fields or is withheld (decide).
4. **The import contract** for the glam canonical 12-column layout (`docs/plan-glam-catalog.md`
   data mapping): required/optional columns, the identity key, idempotency semantics
   (re-import updates by key, never duplicates; rows absent from a re-imported file → decide:
   archive vs leave), the dry-run report shape, and the NO-CODES / NO-PRICES law stated as a
   schema-level guarantee for CAT-IMPORT-1 (the importer has no code path that writes those).
5. **The interest-list contract**: client-side shortlist persistence; submission payload
   (contact fields + `items[]` of product ids + titles at submission time); the backend record
   (Lead vs FormSubmission — D-5); notification; abuse posture (public route: rate limit, honeypot,
   size caps — the same posture as forms submissions).
6. **The renderer byte-identity oracle for non-catalog tenants**: a named check that a tenant
   without the flag renders byte-identical HTML before/after CAT-MODE-1 (the live-tenants rule).

## 4. DECISION_REQUIRED blocks

DECISION_REQUIRED:
- ID: CM-D1-PRICE-ABSENCE
  QUESTION: `ProductSchema.price` is REQUIRED (`z.string()`). How does a catalog product carry no
    price without lying?
  OPTIONS:
  - (a) TENANT-MODE SUPPRESSION ONLY: schema unchanged; the importer writes `price: "0"`; every
    render/feed surface is gated by `catalogMode`. RISK: a stored "0" is a lie in the data — one
    missed surface (a future feed, an MCP tool, an export) publishes "0 lei"; the data cannot be
    trusted by itself. REWARD: no schema change, no migration, smallest diff.
  - (b) PRICE OPTIONAL UNDER CATALOG MODE: `price` becomes optional in the shared schema with a
    refinement "required unless the tenant is catalogMode" enforced at the write boundary; the
    importer writes NO price; render surfaces treat absence as "nothing to show". RISK: a shared
    schema change touches every product writer/reader (backend, renderer, admin editor, MCP) —
    each must handle absence honestly; a cross-cutting diff. REWARD: the data tells the truth —
    there is no price to leak, by construction; no surface can fabricate one.
  RECOMMENDED: (b). The human's ruling is "without prices", not "with hidden prices"; the
    standing honest-absence law applies to data as much as to UI. The write-boundary refinement
    keeps commerce tenants exactly as strict as today.
  BLOCKING_REASON: fixes the shared product contract that CAT-IMPORT-1, CAT-MODE-1 and the MCP
    tools all build against; reversing it after products exist is a data migration.

DECISION_REQUIRED:
- ID: CM-D2-IMAGE-POLICY
  QUESTION: glam's enriched lists carry PRODUCER image URLs (external hosts). Hotlink or ingest?
  OPTIONS:
  - (a) HOTLINK: `imageLink` = the producer URL as imported. RISK: producer sites move/rot (the
    BNR-URL incident shape: a silent 302-to-HTML killed a feed for five weeks); `next/image` needs
    an allowlist per host; a dead link = honest absence on a storefront that is ALL images.
    REWARD: zero storage, zero copy step, instant import.
  - (b) INGEST on import: the WooCommerce importer's existing `mediaMap`/`rewriteUrl` path copies
    each image into tenant media (S3/CDN) and stores the tenant URL; failures are reported per
    row in the dry-run/import report and render as honest absence. RISK: import time + storage;
    a copy step that must be idempotent (re-import must not re-upload unchanged images — key by
    source URL hash). REWARD: the storefront's images are the tenant's and stable; no external
    allowlist; the same media pipeline reviews/content already use.
  RECOMMENDED: (b), as CAT-IMAGES-1 riding CAT-IMPORT-1's report. A storefront whose images rot
    with a third party's web redesign is the BNR incident with pictures.
  BLOCKING_REASON: decides whether CAT-IMAGES-1 exists and what `imageLink` means for catalog
    products.

DECISION_REQUIRED:
- ID: CM-D3-IDENTITY-KEY
  QUESTION: What is the import's idempotency key?
  OPTIONS:
  - (a) glam INTERNAL CODIFICATION (`category-pricelist-collection-idx`, immutable by glam law,
    unique among active products) stored on the amodx product in a NON-RENDERED field (e.g.
    `attributes` is rendered — so a dedicated `externalRef: { system: "glamcrm", key }` field).
    RISK: a new shared field; the key is glam-internal and must never reach a render surface
    (the spec names the oracle). REWARD: exact, stable identity across yearly replacements —
    glam's replacement law carries the codification onto the new product, so the site updates
    in place.
  - (b) title+collection+producer composite. RISK: a renamed product duplicates; a producer
    rename orphans a whole collection. REWARD: no new field.
  RECOMMENDED: (a) — it is the identity glam built for exactly this purpose.
  BLOCKING_REASON: idempotency semantics of every import after the first.

DECISION_REQUIRED:
- ID: CM-D4-EXPLODE-VS-GROUP
  QUESTION: glam's law is one product per colour/format variant (needed for ordering). Does the
    storefront show 462 BOEN rows, or group variants under one presentational product?
  OPTIONS:
  - (a) ONE-TO-ONE: each glam product = one amodx product. RISK: category pages of near-identical
    rows; the visitor's "interest list" fills with variants of one floor. REWARD: trivial mapping;
    the identity key is 1:1; no inference.
  - (b) GROUP BY STYLE: the importer groups rows sharing (producer, collection, base name) into
    one product with `variants[]` options (colour/format), each option carrying its own image and
    its own glam key; the interest list records the chosen option. RISK: the grouping rule is a
    heuristic over names — a wrong split or merge misrepresents the catalog; the identity key
    becomes per-option. REWARD: a storefront that looks like a storefront.
  RECOMMENDED: (a) for the first import, with the grouping rule as a NAMED follow-up once the
    human sees real category pages — a heuristic over producer naming must be ratified against
    real data, not guessed in a spec (the glam pl-tools history: every "uniform layout" assumption
    was refuted by the raw files).
  BLOCKING_REASON: the product count, the identity key's grain and the interest-list payload.

DECISION_REQUIRED:
- ID: CM-D5-INTEREST-RECORD
  QUESTION: An interest-list submission becomes a Lead or a FormSubmission?
  OPTIONS:
  - (a) LEAD with `source: "Listă interes"` and `data.items[]`. RISK: `Lead.email` is required —
    a phone-only submission needs a rule (email required on the form, or the schema relaxes).
    REWARD: the CRM status workflow (New→Contacted→Converted) is exactly a sales lead's life;
    admin leads view + MCP tools + glamCRM pull (GC-SITE-SYNC-1) already have the shape.
  - (b) FORM SUBMISSION. RISK: no status workflow; items are opaque custom fields. REWARD: the
    forms abuse posture is already attached.
  RECOMMENDED: (a), borrowing (b)'s abuse posture for the public route.
  BLOCKING_REASON: the record glamCRM will read; the admin surface the client works from.

## 5. Non-scope

Orders, checkout, customer accounts, Paddle, reviews, Track B/C. Any grouping heuristic (D-4 b)
beyond naming it. The glamCRM side (GC-SITE-SYNC-1 is glamCRM's own future slice).

## 6. Definition of Done

- This document complete per the house format with every block above ratified or recorded as
  contested in the ratification packet; the enumerated surface table filled from a builder sweep
  (`grep -rn "price\|salePrice\|availability\|Buy" renderer/src admin/src tools/mcp-server/src`
  — every hit classified: suppressed / unaffected / out of scope, with file:line).
- `npm run typecheck` at every workspace untouched-green (no code in this slice).
- The three impl packets (`cat-import-1`, `cat-mode-1`, `cat-interest-1`) updated to the ratified
  decisions before any of them launches.

## 7. References

`docs/plan-glam-catalog.md`; glamCRM `docs/PRICELISTS.md` §1–2 (the canonical layout and the
identity laws); `docs/platform-decisions.md` PD-001/002 (unaffected: no customer identity here);
`backend/src/import/woocommerce.ts` (importer precedent); `docs/slices/import-policy-1.md`
(importer tenant-binding precedent).
