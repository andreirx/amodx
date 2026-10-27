# CATALOG-MODE-1 — the presentation-store tenant mode (SPEC slice)

Status: **PROPOSED** (packet written 2026-10-27 by the glamCRM operator session; see
`docs/plan-glam-catalog.md` for the why and the integration plan). SPEC ONLY — no code changes
with this document; the gate proves it. **Amended 2026-10-27 by the amodx operator** after a
code check: CM-D1 ratified (b); new block CM-D6-ORDER-GUARD ratified (A); CM-D5 re-cast on the
lead-key evidence; § 3.5 abuse posture corrected to what forms actually do. Open for ratification:
CM-D2, CM-D3, CM-D4, CM-D5.

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
   **Backend rows (added 2026-10-27, operator code check):** the public order route
   (`backend/src/orders/create.ts`, CommerceApi) accepts an order for ANY tenant — no backend
   handler reads `commerceEnabled` (only `tenant/list.ts` does), so the renderer's 404 on
   `/cart`/`/checkout` does not stop a direct POST (→ CM-D6). Price readers in CommerceApi code:
   `orders/create.ts:120` (`unitPrice = product.salePrice || product.price`),
   `products/bulk-price.ts`, `products/public-list.ts:49-50` (projection). They read untyped
   DynamoDB items, so the compiler does NOT flag them when `price` becomes optional — the table
   lists each with its catalog-mode behaviour.
3. **The sitemap/feed inclusion rule**: catalog tenants are INDEXABLE — products and categories
   appear in the sitemap; the OpenAI feed either omits price fields or is withheld (decide).
4. **The import contract** for the glam canonical 12-column layout (`docs/plan-glam-catalog.md`
   data mapping): required/optional columns, the identity key, idempotency semantics
   (re-import updates by key, never duplicates; rows absent from a re-imported file → decide:
   archive vs leave), the dry-run report shape, and the NO-CODES / NO-PRICES law stated as a
   schema-level guarantee for CAT-IMPORT-1 (the importer has no code path that writes those).
5. **The interest-list contract**: client-side shortlist persistence; submission payload
   (contact fields + `items[]` of product ids + titles at submission time); the backend record
   (D-5); notification; abuse posture. **Corrected 2026-10-27:** the forms posture is what
   `backend/src/forms/public-submit.ts` does — the browser calls the public route directly
   (`renderer/src/components/DynamicForm.tsx:56`, no renderer hop), the handler checks
   `x-tenant-id` against the request origin (`verifyTenantFromOrigin`, :18) and reCAPTCHA
   (deployment-level mandatory, :24-51). Forms have NO per-IP rate limit and NO honeypot today.
   The interest route mirrors that posture and adds size caps and item-id validation; a rate
   limit or honeypot is new work and is named as such if the spec wants it.
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
  RATIFIED 2026-10-27 (human, accepting the operator's recommendation): **(b), together with
    CM-D6 = A.** With the order guard, no catalog-tenant request reaches the CommerceApi code that
    reads `price` (`orders/create.ts:120`); `products/bulk-price.ts` is checked for priceless
    items (read, no change expected) and the result is recorded in the surface table.
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
  EVIDENCE (operator code check 2026-10-27): a Lead is ONE record per person per tenant —
    `SK: LEAD#<email>`, written by an unconditional `Put` from three handlers
    (`leads/create.ts:62-66`, `contact/send.ts:99`, `comments/create.ts:68`); `DELETE
    /leads/{email}` addresses it by email. A second interest list from the same visitor, or a
    later contact-form message or blog comment, OVERWRITES the first list. A FormSubmission is
    one record per submission (`SK: FORMSUB#<formId>#<submissionId>`, `forms/public-submit.ts:122`)
    and the handler already sends the tenant a notification email (:143).
  QUESTION: Where does an interest-list submission live so that no submission is lost?
  OPTIONS:
  - (a) LEAD AS TODAY (`data.items[]` on `LEAD#<email>`). RISK: silent loss — the next touch
    from the same email replaces the items; glamCRM reads only the last one. REWARD: the existing
    leads view and status workflow. Not acceptable without (a2).
  - (a2) LEAD + MERGE: the interest handler updates `LEAD#<email>` with a conditional append to
    `data.interestLists[]` (one entry per submission, capped). RISK: the other three writers still
    `Put` and would erase the appended history unless they change too — that widens the slice into
    contact/comments/leads handlers. REWARD: one person record carrying every list.
  - (b) FORM SUBMISSION on a system form "Listă interes" per catalog tenant. RISK: no status
    workflow (New→Contacted) — the client tracks follow-up elsewhere; items are a structured field
    on a generic record; glamCRM reads form submissions (a `forms`-scoped read, not `leads:read`).
    REWARD: one record per submission by construction, the abuse posture and the notification
    email already exist, no change to other writers.
  - (c) NEW RECORD `INTEREST#<submissionId>` with its own status field, plus the usual person-Lead
    upsert for the contact. RISK: a new record type, a list route and an admin view (the largest
    option). REWARD: per-submission history AND a status workflow, nothing overwritten.
  RECOMMENDED: none yet — the decision-review pass challenges (b) vs (c) against what the client
    will actually do with a list (follow-up tracking needed or not); the human ratifies.
  BLOCKING_REASON: the record glamCRM will read; the admin surface the client works from.

DECISION_REQUIRED:
- ID: CM-D6-ORDER-GUARD
  QUESTION: "No possibility of ordering" — enforced in the renderer only, or at the order API?
  OPTIONS:
  - (A) GUARD IN THE ORDER HANDLER: `backend/src/orders/create.ts` (CommerceApi) refuses with 403
    unless the tenant's `commerceEnabled` is true. About 3 lines; Lambda code only, no infra.
    RISK: a named exception to the "do not touch commerce" rule; a selling tenant with the flag
    unset would stop receiving orders (the implementing slice reads every live tenant's flag first
    and states the result). REWARD: the promise holds at the API for every non-selling tenant, not
    only the catalog one.
  - (B) RENDERER ONLY. RISK: a direct POST writes a real order on a catalog tenant ("0" or NaN
    totals). REWARD: no commerce code touched.
  RATIFIED 2026-10-27 (human): **(A)**, implemented inside CAT-MODE-1 as its one named exception to
    the commerce-track freeze.

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
