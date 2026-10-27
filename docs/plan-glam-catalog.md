# Plan — Glam catalog: a presentation store fed from glamCRM pricelists

Written 2026-10-27 by the glamCRM operator session for the amodx session. Status: **PROPOSED**
(no slice launched; the human will hand this to the amodx session).

## Why (the business need, plain language)

glamCRM is the sales tool of a flooring company (GlamourFloors — the codebase's tenant "HOMEANDMORE").
Its acquisitions team maintains **producer pricelists** (BOEN, ALPOD/Egger/Classen/…, ITC, IVC):
every product carries a name, collection, format/unit, technical specs and — for the enriched
2025 lists — a producer image link. Salespeople build offers from this catalog on their phones.

The company wants a **public presentation website**: a store-like catalog with images and
descriptions where a visitor can browse, **pick the items they are interested in, and contact
the company about them** — explicitly **without** producer codes, **without** prices, and
**without** any ordering/checkout. (Prices are negotiated per project; producer codes are the
company's sourcing knowledge.)

amodx already has most of this: a product model with images/galleries/categories/attributes,
product + category + shop pages, JSON-LD and an AI discovery feed, a WooCommerce CSV importer,
and a Leads CRM surface. What is missing is a **catalog-only tenant mode** (suppress every price
surface, no cart), a **glam pricelist importer**, an **interest-list → lead** flow, and a
**tenant-scoped machine credential** so glamCRM can keep the site in sync without a human login.

## What exists today (verified in this repo, 2026-10-27)

| Capability | State | Where |
|---|---|---|
| Product model: title, slug, description, `longDescription` (HTML), `imageLink` + `additionalImageLinks`, `brand`, `categoryIds[]`, `attributes[]` (key/value), `variants[]`, SEO | exists | `packages/shared` `ProductSchema` (`price` and `imageLink` are REQUIRED) |
| Product / category / shop pages render **regardless of `commerceEnabled`** (the flag only enables cart/checkout/orders) | exists | `renderer/src/components/SitePage.tsx` ("Product, category, and shop pages work regardless of commerceEnabled") |
| Price surfaces: product page price + Buy/availability controls; JSON-LD `offers`; **OpenAI feed publishes `price` unconditionally** | exists — must be suppressed in catalog mode | `ProductByIdPage.tsx`, `renderer/src/app/[siteId]/openai-feed/route.ts:28` |
| Sitemap **excludes** products/categories when `commerceEnabled` is false | exists — wrong for a catalog site that wants indexing | `renderer/src/app/[siteId]/sitemap.xml/route.ts:17-18` |
| CSV importer (WooCommerce, Romanian headers mapped; `mediaMap`/`rewriteUrl` can pull images into tenant storage) | exists — the precedent for a glam importer | `backend/src/import/woocommerce.ts` |
| Leads: `{email, name, source, status, data: record}` + admin leads view + MCP tools | exists — the contact channel | `packages/shared` `LeadSchema`, `backend/src/leads` |
| Machine identities: `x-api-key` → `system-robot` (GLOBAL_ADMIN, tenant ALL) or `renderer` (RENDERER, tenant ALL) | exists — **GLOBAL only; no tenant-bound key** | `backend/src/auth/authorizer.ts:106-139` |
| Track B (commerce-private hardening) | PLANNED | **not needed** here: a presentation store has no orders and no customers — nothing private to isolate. Track B stays queued. |

## How glamCRM integrates (the plan)

```
glamCRM (acquisitions)                        amodx (presentation site, one tenant)
─────────────────────                         ─────────────────────────────────────
pricelist XLSX ──pl-tools──► canonical 12-col ──► POST /import/glam-pricelist  (CAT-IMPORT-1)
   (name, collection, unit, format,                 │ idempotent on the glam INTERNAL
    specs, image link; NO codes, NO prices)         │ CODIFICATION (never rendered)
                                                    ▼
                                            products + categories (catalogMode tenant)
                                                    │
visitor browses /shop, /category/…, /product/… — no prices, no cart   (CAT-MODE-1)
visitor shortlists items → "Trimite lista" ──► Lead{source:"Listă interes", data.items[]}  (CAT-INTEREST-1)
                                                    │
glamCRM ◄──── GET /leads (scope leads:read) ◄───────┘   via a TENANT-SCOPED service key (SERVICE-ACCOUNT-1)
   (future glamCRM slice GC-SITE-SYNC-1: push catalog after each yearly replacement,
    pull interest leads as prospects, link them to projects/offers)
```

Phase 1 (this plan) can run with a human doing the import from the admin UI. Phase 2 lets glamCRM
drive both directions with the service key — that is why `SERVICE-ACCOUNT-1` is in this track and
why glamCRM queues `GC-SITE-SYNC-1` (recorded in glamCRM's ROADMAP).

### Data mapping (glam canonical layout → amodx product)

| glam idx | column | amodx |
|---|---|---|
| 0 | colecție | category (one per collection, under a per-producer parent category) + `attributes.colecție` |
| 1 | produs | `title` |
| 2, 5 | cod producător (vechi / înlocuitor) | **NOT IMPORTED** (ruling: no producer codes on the site) |
| 3, 4 | preț achiziție / preț de listă | **NOT IMPORTED** (ruling: no prices) |
| 6 | unitate de măsură | `attributes.unitate` |
| 7, 8 | împachetare / comandă minimă | `attributes` (presentational) |
| 9 | link imagine produs | `imageLink` (policy per CATALOG-MODE-1 D-2: hotlink vs ingest) |
| 10 | specificații tehnice | `longDescription` (HTML-escaped paragraphs) + `description` (first ~300 chars) |
| 11 | format | `attributes.format` — or a `variants[]` option under D-4 (grouping) |
| — | internal codification (glam) | the import's idempotency key — stored in a **non-rendered** field, never shown |
| — | producer (file/sheet) | `brand` + the parent category |

## The slices (amodx side)

| Slice | Kind | Depends on | Doc |
|---|---|---|---|
| `CATALOG-MODE-1` | SPEC (ratifiable; DECISION_REQUIRED blocks) | — | `docs/slices/catalog-mode-1.md` |
| `CAT-IMPORT-1` | impl: the glam pricelist importer + admin entry + MCP parity | spec | `docs/slices/cat-import-1.md` |
| `CAT-MODE-1` | impl: catalog-mode rendering (prices/cart/feed/sitemap) | spec | `docs/slices/cat-mode-1.md` |
| `CAT-INTEREST-1` | impl: the shortlist → lead flow | spec, CAT-MODE-1 | `docs/slices/cat-interest-1.md` |
| `CAT-IMAGES-1` | impl, conditional on D-2 = ingest | CAT-IMPORT-1 | `docs/slices/cat-images-1.md` |
| `SERVICE-ACCOUNT-1` | impl: tenant-scoped machine credential (keys, scopes, audit) | — (parallel) | `docs/slices/service-account-1.md` |

Operator work after the slices: create the tenant, import the lists glamCRM's `docs/PRICELISTS.md` §4
marks **complete** (BOEN, Egger, Classen, Cosmoflooritan, LifeStyle, Organic — the ones with images
and specs), author the content pages, point the domain.

## Preconditions the amodx session must verify before launching

1. **The CFN 500-resource ceiling.** `INFRA-SPLIT-1` (catalog nested stack) was IMPLEMENTED
   2026-08-10 with staging/prod deploys at the human gate. CAT-IMPORT-1, CAT-INTEREST-1 and
   SERVICE-ACCOUNT-1 each add API routes/resources. State the synth count for staging AND prod
   before the first launch; if the split never deployed, it (or its successor) comes first.
2. **Live tenants.** Every renderer change is production-impacting (standing rule). Catalog mode
   must be strictly additive and gated by the tenant flag — a non-catalog tenant's bytes are
   byte-identical before and after (the spec names this oracle).
3. **Relay models** per the human's 2026-10-16 ruling: builder `claude-opus-5-5`, reviewer
   `gpt-6.1-sol`; staging first; prod on the human's word.

## Non-goals

No orders, no checkout, no customer accounts, no Paddle, no Track B/C work. No price storage of any
kind for catalog tenants (not even hidden — see D-1). No producer codes stored anywhere.
