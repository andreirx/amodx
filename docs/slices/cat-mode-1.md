# CAT-MODE-1 — catalog-mode rendering: no price surface anywhere, indexable (IMPL slice)

Status: **PROPOSED**, blocked on `CATALOG-MODE-1` ratification (§3.2 of the spec is this slice's
oracle table). D-1 = (b) and D-6 = (A) ratified 2026-10-27. Track: Glam catalog.

## 1. Purpose / risk retired

Under `catalogMode`, no surface the renderer, admin, feeds or MCP tools produce can show,
embed or publish a price, an availability, or an ordering control for that tenant — and the
tenant's products/categories ARE in the sitemap. Every other tenant renders byte-identically.

## 2. Scope (the spec's surface table, executed)

1. `catalogMode` in TenantConfig (shared schema) + the admin settings card toggle (TENANT_ADMIN;
   mutually exclusive with `commerceEnabled` — zod refinement; admin shows the rule in business
   language).
2. Renderer: product page (price/sale/currency/Buy/Pre-order/Out-of-stock/availability → absent,
   not hidden: the elements are not emitted); category + shop + search cards (no price); JSON-LD
   (no `offers`; `Product` schema stays — name/image/brand/description are the AI-discovery value);
   OpenAI feed (per the ratified rule: price-less entries or withheld); `/products/[id]` legacy
   page; `CartWidget`/`CommerceBar`/cart+checkout prefixes return 404 under catalogMode even if
   requested directly (not merely unlinked).
3. Sitemap: include products + categories for catalogMode tenants (today's `commerceEnabled`
   coupling becomes `commerceEnabled || catalogMode`).
4. Admin product editor: under a catalogMode tenant the price/availability/Paddle fields are not
   shown; validation accepts absence (D-1 b).
5. MCP tools: `product_get`/`list` responses for catalog tenants omit price fields (no `null`
   price leaking as a value). Note `tools/mcp-server/src/index.ts:1017` prints
   `(${p.price} ${p.currency})` — it must not print "undefined".
6. **Order guard (CM-D6 = A, the ONE named exception to the commerce-track freeze):**
   `backend/src/orders/create.ts` refuses with 403 and a business-language message unless the
   tenant config's `commerceEnabled` is true; the check runs right after the tenant config read
   (:69-74), before reCAPTCHA and before any product read. Before the change the operator lists
   every live tenant (staging and prod) with `commerceEnabled` and with any `ORDER#` record, and
   states that no selling tenant has the flag unset. No other CommerceApi file changes;
   `products/bulk-price.ts` is read for priceless items and the finding recorded.

## 3. Non-scope

Any UI beyond removing surfaces (CAT-INTEREST-1 adds the shortlist); theme work.

## 4. Architectural boundaries

Gated by the tenant flag at each render site through ONE predicate (`isCatalogMode(config)` in
`packages/shared`) — no surface re-derives the rule. The renderer serves all live tenants: the
change is additive; the byte-identity oracle (below) is the live-tenant guarantee.

## 5. Definition of Done / evidence

- The surface table from the spec, every row with file:line, each marked suppressed/unaffected
  and covered by a test (renderer unit/snapshot: catalog tenant vs commerce tenant fixtures).
- **Byte-identity oracle**: the rendered HTML of two existing non-catalog fixtures (one commerce
  tenant, one plain content tenant) is byte-identical before and after this slice (snapshot
  files committed; the reviewer diffs them).
- A catalog-tenant product page snapshot contains none of: a currency code, `offers`, the Buy
  strings, `availability` (negative grep over the rendered file, exact terminators).
- Direct GET of `/cart` and `/checkout` on a catalog tenant → 404.
- Order guard: unit rows — `commerceEnabled` true → unchanged path; false/absent → 403, no
  product read, no write (db-mock asserts zero calls after the config read).
- Sitemap for a catalog tenant lists its products; the OpenAI feed per the ratified rule.
- Staging: the glam tenant's `/shop`, a category and a product page screenshots (390 + 1366);
  Google Rich Results test of one product page shows a Product with no offer (operator-run).
- Typecheck + unit suites bare-green; no CDK change (state it). Backend: `npm run test:unit`
  only — never `cd backend && npm test` (it writes live staging tables).

## 6. References

`docs/slices/catalog-mode-1.md` §3.2; `renderer/src/components/SitePage.tsx`,
`ProductByIdPage.tsx`, `renderer/src/app/[siteId]/{sitemap.xml,openai-feed}/route.ts`.
