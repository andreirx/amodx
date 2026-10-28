# CAT-MODE-1 — catalog-mode tenants: the mode, the write boundary, no price surface anywhere, indexable (IMPL slice)

Status: **READY 2026-10-28** — `CATALOG-MODE-1` ratified and committed (`163c777`, § 8.18); its § 3.2 surface table is
this slice's oracle table and its § 8.5 "cat-mode-1" paragraph is the authoritative list of needs. Prerequisites on
`main`: SETTINGS-KEYS-1 `2ff85c7`, SETTINGS-KEYS-1B `569202e` (the settings route cannot name its item, an index key or
another tenant's hostname — this slice's narrow parse sits on that handler). Track: Glam catalog. First impl slice of
the track; `cat-import-1`, `cat-interest-1`, `cat-images-1`, `cat-facets-1` follow.

## 1. Purpose / risk retired

A tenant created in catalog mode can never hold a price, and no surface the renderer, admin, feeds or MCP tools
produce shows, embeds or publishes a price, an availability or an ordering control for it — while its products and
categories ARE in the sitemap. Every other tenant renders byte-identically (spec § 3.6). The mode is fixed at creation
(CM-D11): there is no online transition, so no transition protocol exists.

## 2. Scope (spec § 3.1, § 3.2, § 4 implementation notes, § 8.5)

1. **The flag and its creation-time binding (CM-D11).** `catalogMode: z.boolean().default(false)` in TenantConfig
   next to `commerceEnabled`; set ONLY at `POST /tenants` (`backend/src/tenant/create.ts`, which already parses the
   new tenant with `TenantConfigSchema`): the body accepts `catalogMode`; MCP `create_tenant` gains
   `catalog_mode?: boolean`; the admin "Create New Site" dialog (`admin/src/components/layout/Sidebar.tsx`) gains the
   checkbox. `PUT /settings` (`backend/src/tenant/settings.ts`) gets its FIRST validation, a narrow parse of exactly
   `{ commerceEnabled, catalogMode }` on the merged item: a `catalogMode` different from the stored one → 400 ("the
   mode is fixed at creation"); `commerceEnabled: true` with `catalogMode: true` → 400; an absent flag is false on
   both sides; never a full `TenantConfigSchema.parse` of stored configs (regression class named in the spec). The
   Settings card shows the mode read-only and hides the Commerce toggle on a catalog tenant.
2. **Every mode-enforcing read is authoritative (CM-D11 accepted refinement).** `settings.ts` update,
   `products/create.ts`, `products/update.ts`, `import/woocommerce.ts` read the tenant record with
   `ConsistentRead: true` and answer 404 on a missing record instead of defaulting; the intended regression: a save
   for a truly missing tenant used to create `{ name: "Unknown", … }`, now 404. `orders/create.ts` already fails closed.
3. **The write boundary (CM-D1 = b, CM-D8 = A + refinement).** `ProductSchema.price` becomes optional with the rule
   "required unless the tenant is in catalog mode", enforced at `products/create.ts` and `products/update.ts` (on the
   merged item). On a catalog tenant the write REFUSES (400, never drops): `price`, `salePrice`, non-empty
   `volumePricing`, any variant `priceOverride`, a non-empty `personalizations` array. `products/create.ts` needs
   `grantReadWriteData` (it reads the tenant config now — F-2). Product writes stay plain `Put`s (no ConditionCheck:
   the mode cannot change). Commerce tenants stay exactly as strict as today.
4. **WooCommerce import refusal (CM-D8 guard 1; the SECOND named exception to the commerce-track freeze).**
   `backend/src/import/woocommerce.ts` reads the tenant config (consistent) before its first write and refuses a
   catalog tenant with the CM-D6 status/body shape.
5. **Order guard (CM-D6 = A, the first named exception).** `backend/src/orders/create.ts` refuses with 403 and a
   business-language message unless `commerceEnabled` is true, right after the tenant config read, before reCAPTCHA
   and any product read. Before the change the operator lists every live tenant (staging and prod) with
   `commerceEnabled` and any `ORDER#` record and states that no selling tenant has the flag unset.
6. **Image absence (CM-D7 = a).** `imageLink: z.string().url().optional()` — storage never holds `""` or `null`;
   the UPDATE request accepts `imageLink: null` as the removal instruction and the handler deletes the key; create
   never accepts `null`; the editor sends `null` when a stored image is cleared and omits an empty image on create;
   MCP `create_product` `image_link` optional; the legacy page's unchecked `<img>` elements
   (`ProductByIdPage.tsx`) and JSON-LD `image` guard absence; the client rule "drop empty `price`/`salePrice`" applies
   under catalog mode only.
7. **Product update hardening (C10-1, C10-3).** `products/update.ts`: the product `Put` carries
   `ConditionExpression: "attribute_exists(PK)"` (cancelled → 404; the CATPROD# rebuild never runs). `importSource`
   joins the `.omit({...})` lists of `create.ts` and `update.ts` (authoring can never set, change or remove it). For a
   product carrying `importSource`: exactly one variant group, unique option values (400 on collision), option
   `imageLink: ""` refused, and `imageLink`/`additionalImageLinks` RE-DERIVED from the options on every write (the
   editor marks the two fields as derived; a direct edit is overwritten).
8. **Catalog variant presenter (CM-D4 amended).** A read-only presenter of the product's single variant group
   (option labels with their images) on the product page, rendered only under `isCatalogMode`; the only `variants`
   reader under catalog mode (`AddToCartButton` stays commerce-only); it exposes the selected option to the
   interest control (`cat-interest-1`). No gallery reader is missing: `SitePage.tsx` already passes
   `additionalImageLinks` to the gallery.
9. **Surface suppression (spec § 3.2, every row).** Product page: price/sale/currency/Buy/Pre-order/Out-of-stock/
   availability elements NOT emitted; category, shop and search cards; JSON-LD without `offers`; the legacy
   `/products/[id]` page; `CartWidget`/`CommerceBar`/cart and checkout prefixes → 404 under catalog mode;
   `categoryShowcase` receives `_catalogMode` (price line and stock overlay off,
   `packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx`); MCP `list_products` must not print
   `(undefined USD)` and `get_product` row per § 3.2; the OpenAI feed = 404 for catalog tenants (S3 ruling:
   withhold, since the feed's required price fields cannot be honest). F-1 renders the imported `attributes`
   (`unitate`, `împachetare`, `comandă minimă`) on the product page.
10. **Sitemap (S3).** `app/[siteId]/sitemap.xml/route.ts`: `commerceEnabled || catalogMode` for products and categories.
11. **`importSource`** optional string on `ProductSchema` (for `cat-import-1`'s replace rule; display-safe).

## 3. Non-scope

Any UI beyond removing surfaces and the presenter (`cat-interest-1` adds the shortlist; `cat-facets-1` the filters);
theme work; any transition between modes (`MODE-MIGRATION-1`); projection races between admin edits
(`CATPROD-CONSISTENCY-1`).

## 4. Architectural boundaries

Gated by the tenant flag at each render site through ONE predicate (`isCatalogMode(config)` in `packages/shared`) —
no surface re-derives the rule. The renderer serves all live tenants: the change is additive; the byte-identity oracle
is the live-tenant guarantee. The two commerce-freeze exceptions are exactly items 4 and 5. CDK: no resource change
except `grantReadWriteData` on the product-create function (named gain: it must read the tenant config); state the
synth delta.

## 5. Definition of Done / evidence

- The spec's § 3.2 surface table, every row with file:line, marked suppressed/unaffected and covered by a test
  (renderer unit/snapshot: catalog tenant vs commerce tenant fixtures).
- **`CM1-BYTE-IDENTITY` (spec § 3.6)**: before/after captures of the two staging non-catalog tenants the operator
  names at launch, on the cache-keyed `id=cm1-<run>` parameter with existing query strings preserved, each URL with
  `x-cache: Miss from cloudfront` recorded; byte-identical after masking the enumerated derived lines.
- Catalog-tenant product page: no currency code, no `offers`, no Buy strings, no `availability` (negative grep
  over the rendered file, exact terminators); the presenter renders a 3-option fixture group.
- Unit rows: creation with `catalogMode`; settings mode change → 400; both flags → 400; absent flag = false;
  missing tenant → 404 on every enforcing read; refusal of each monetary field incl. `personalizations`; WooCommerce
  refusal; order guard (`commerceEnabled` true → unchanged; false/absent → 403, zero calls after the config read);
  `imageLink: null` on update removes the key; `""` refused; update `Put` condition cancelled → 404 and no
  projection write; `importSource` omitted from authoring input; derived gallery recomputed.
- Direct GET of `/cart` and `/checkout` on a catalog tenant → 404; sitemap lists the catalog tenant's products;
  feed → 404.
- Staging: a catalog tenant created through the API with `catalogMode`; `/shop`, a category and a product page
  screenshots (390 + 1366); Google Rich Results test of one product page shows a Product with no offer (operator-run).
- Typecheck + `npm run test:unit` bare-green (never `cd backend && npm test`); MCP drift oracle green; synth delta stated.

## 6. References

`docs/slices/catalog-mode-1.md` §§ 3.1, 3.2, 3.6, 4, 8.5; `docs/slices/settings-keys-1.md` §§ 2, 12;
`renderer/src/components/SitePage.tsx`, `ProductByIdPage.tsx`, `renderer/src/app/[siteId]/{sitemap.xml,openai-feed}/route.ts`;
`backend/src/tenant/{create,settings}.ts`, `backend/src/products/{create,update}.ts`, `backend/src/orders/create.ts`,
`backend/src/import/woocommerce.ts`.
