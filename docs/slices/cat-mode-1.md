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

## 7. Implementation record (builder, 2026-10-29; cycles 2–3 after review-0 and review-1 `escalate`)

Built on `main` `de4ad52`, uncommitted for review. Evidence labels: EXECUTED = command run in this build; OBSERVED =
read in the file; INFERRED = concluded from code, not run; NOT RUN = with the reason. Cycle 2 follows the operator's
directive (packet § 5): CM1-IDENTITY-CONTRACT = B (spec amended, `catalog-mode-1.md` § 8.19 "CM1-A1"),
CM1-SHOWCASE-CLOSURE = A (allocation extended by `packages/plugins/src/category-showcase/**`), CM1-CAPTURES,
CM1-PREDICATE, CM1-READ-DOC, CM1-COVERAGE. Cycle 3 follows packet § 6: CM1-MCP-HARNESS = A (allocation extended by
`tools/mcp-server/src/**`, `tools/mcp-server/test/**`, the `test` script of `tools/mcp-server/package.json`),
CM1-EVIDENCE-LABELS, stale hydration data shaped on every source, `jsdom` declared (`renderer/package.json`,
`package-lock.json`).

### 7.1 What changed, per § 2 item (file:line in the built tree)

1. **Flag at creation.** `catalogMode: z.boolean().default(false)` `packages/shared/src/index.ts:790`; `isCatalogMode()`
   `:1092`. `POST /tenants` copies `body.catalogMode === true` `backend/src/tenant/create.ts:48`. Admin "Create New
   Site" checkbox `admin/src/components/layout/Sidebar.tsx:182`, payload `:115`; MCP `create_tenant` `catalog_mode`
   `tools/mcp-server/src/index.ts:655,659`, body built by `createTenantBody()` `tools/mcp-server/src/tool-shapes.ts:10`. `PUT /settings` narrow parse `ModeFlagsSchema` `backend/src/tenant/settings.ts:40`,
   on the merged item `:162` (mode change → 400; commerce on a catalog site → 400; absent = false on both sides via
   `isCatalogMode(current)`). Settings card: mode read-only, Commerce toggle hidden, through `isCatalogMode(config)`
   `admin/src/pages/Settings.tsx:649`. `GET /tenants` projects the flag `backend/src/tenant/list.ts:30,58`; admin type
   `admin/src/context/TenantContext.tsx:10`; renderer `mapTenant` `renderer/src/lib/dynamo.ts:156`.
2. **Authoritative reads.** `settings.ts:134` (`ConsistentRead`), `:136` (404, nothing written — the intended
   regression: no more `{ name: "Unknown" }` records). `readTenantMode()` `backend/src/lib/catalog-product.ts:20` used by
   `products/create.ts:41`, `products/update.ts:32`, `import/woocommerce.ts:234`, each answering 404. The order handler
   keeps its eventually consistent read (miss → `{}` → CM-D6 403), as spec § 3.1 permits; `backend/ARCHITECTURE.md:252`
   now names the four paths and that exception (CM1-READ-DOC).
3. **Write boundary.** `price` optional `index.ts:1019`; `checkProductWrite()` `catalog-product.ts:57`, refusal list
   `monetaryFieldOf()` `:91`; called on the parsed input `create.ts:53` and the merged item `update.ts:61`. `CATPROD#`
   type `price?: string` `backend/src/lib/catprod.ts:16`. Grant `infra/lib/api-catalog.ts:181`.
4. **WooCommerce refusal** `import/woocommerce.ts:234` — 404 missing / 403 catalog, before the CSV parse and the first write.
5. **Order guard** `backend/src/orders/create.ts:79` — 403 unless `commerceEnabled === true`, before reCAPTCHA and any
   product read. The live-tenant listing (§ 2.5) is the operator's.
6. **Image absence.** `imageLink` `.url().optional()` `index.ts:1059`; `imageLink: null` = removal `update.ts:45`. Editor
   body: `buildProductPayload()` `admin/src/pages/ProductEditor.tsx:34` (pure, the test seam; called `:158`). MCP
   `create_product` omits an empty image: `createProductBody()` `tools/mcp-server/src/tool-shapes.ts:20`, called
   `index.ts:1063`. Legacy page guards
   `renderer/src/components/ProductByIdPage.tsx:38,74,109`.
7. **Update hardening.** `attribute_exists(PK)` `update.ts:76`, cancelled → 404 before the `CATPROD#` rebuild `:79`;
   `importSource` omitted `create.ts:46`, `update.ts:50`; imported-product rules and derived gallery
   `catalog-product.ts:57-88,109`; editor derived note `ProductEditor.tsx:804`.
8. **Variant presenter** `renderer/src/components/SitePage.tsx:695`, in the catalog branch of the former Add-to-Cart slot
   `:900`; native radios `catalog-option-<group id>`.
9. **Surface suppression.** Product page JSON-LD `SitePage.tsx:750`, price `:806`, tiers `:818`, availability (next
   block), Paddle `:888`; `ProductCard` `:650`; shop filter `:1098`, ignored `?availability=` `:271`; `SearchBar`
   `showPrices` only on catalog sites `:778,1040,1091,1157` (`SearchBar.tsx:22,200`). **`categoryShowcase` (cycle 2,
   CM1-SHOWCASE-CLOSURE = A, spec § 3.2.6 as written):** the renderer sets `block.attrs._catalogMode = true` on EVERY
   showcase block of a catalog tenant, whether or not the lookup succeeded `SitePage.tsx:538` (the cycle-1
   `showPrice = false` override is removed); the plugin reads it `packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx:71`
   and, for any product source, emits no stock overlay `:23` and no price line or currency `:58` (`:138` passes it).
   Defence in depth (cycle 3, one rule for every source): on a catalog tenant `prefetchedProducts` — prefetched or
   stale authored — is reduced to `id, title, slug, imageLink` `SitePage.tsx:539`, so the RSC payload carries no
   currency, price or availability on a lookup miss either; the successful-lookup branch is the `de4ad52` code again
   (`prefetchedProducts = items`, `:528`). Legacy page `ProductByIdPage.tsx:81,119,134`; feed 404
   `renderer/src/app/[siteId]/openai-feed/route.ts:18`; F-1 attributes `SitePage.tsx:725`. Admin list
   `admin/src/pages/Products.tsx:196` (`isCatalogMode`), `:207,392`; editor `ProductEditor.tsx:66` (`isCatalogMode`),
   `:218,329,432`. MCP `list_products`: `productListLine()` `tool-shapes.ts:44`, called `index.ts:1018`.
10. **Sitemap** `renderer/src/app/[siteId]/sitemap.xml/route.ts:19-20`.
11. **`importSource`** `index.ts:1079`.

### 7.2 Oracles (packet § 2) — last lines (cycle 3 gate run, fresh `npm run build` exit 0)

| # | Command | Result | Label |
|---|---|---|---|
| 1 | `npm run typecheck` (root) | exit 0; last line `> tsc --noEmit` | EXECUTED |
| 2 | `cd backend && npm run test:unit` | exit 0; `Test Files 33 passed (33)`, `Tests 447 passed (447)`; `test/unit/catalog-mode.test.ts` 38 rows | EXECUTED |
| 3 | `cd renderer && npm run test:serving` (CM1-A1) | exit 0; `# tests 50`, `# pass 50`, `# fail 0`; 32 per-URL identity lines `same`, 0 `DIFF`; re-run on the restored tree after the mutations: 50/50 | EXECUTED |
| 4 | `cd tools/mcp-server && npm test` | exit 0; `PASS: every call targets a live route; ARCHITECTURE.md tool count matches.` then `# pass 6`, `# fail 0` (`test/tool-shapes.test.ts`); no route added, `routes.json` unchanged (not in `git status`) | EXECUTED |
| 5 | negative grep, `renderer/test/serving-contract/cm1-byte-identity/candidate/catalog/product_oak-plank.body` (28 046 bytes) and `product_legacy-plank.body` (20 844 bytes) | 0 hits each for `offers`, `priceCurrency`, `"price"`, `USD`, `Buy`, `Add to Cart`, `Pre-order`, `Out of Stock`, `In Stock`, `InStock`, `OutOfStock`, `availability`, `in_stock`, `out_of_stock`, `preorder`, `Volume Pricing`, `99.00`, `79.00`, `69.00`, `pri_cm1_legacy`, `paddle_button` (`grep -F -o`); radios `120x20`/`140x20`/`180x20` present | EXECUTED |
| 6 | `git status --porcelain`; `git diff --check` | paths inside the allocation as extended by packet §§ 5–6, plus the operator's `docs/slices/catalog-mode-1.md` (§ 8.19); full `git diff --check` exit 0 | EXECUTED |
| 7 | `cdk diff -c stage=staging AmodxStack-staging` | NOT RUN (operator; synth may look up AWS context with real credentials). Expected (INFERRED from `grantReadWriteData`): the `CreateProductFunc` role policy gains the DynamoDB read actions on the table and its indexes; no resource added or removed | NOT RUN |

Also EXECUTED: `cd admin && npm run test:unit` → exit 0, `Test Files 3 passed (3)`, `Tests 24 passed (24)`.

MCP test output (`npm test`, after the drift oracle's `PASS`):
`ok 1 - create_tenant with catalog_mode: true → { name, domain, catalogMode: true }`;
`ok 2 - create_tenant without catalog_mode → catalogMode: false`;
`ok 3 - create_product without an image (absent or empty) sends no imageLink key and never ""`;
`ok 4 - create_product without a price sends no price key; with both, both are sent`;
`ok 5 - list_products line for a priceless product prints no "undefined" and no price part`;
`ok 6 - list_products line for a priced product keeps the price part`.
Mutation: the formatter changed back to always print ` (${p.price} ${p.currency})` → `not ok 5`, `# fail 1`; restored.

**Lockfile (cycle 3, `"jsdom": "28.1.0"` declared in `renderer/package.json` devDependencies; `npm install` from the
root, exit 0).** Compared programmatically with `HEAD`: 1 649 package entries before and after; 0 added, 0 removed,
0 version changes; the only content change is the `renderer` workspace entry (the declaration line); 42 existing
entries (jsdom 28.1.0 and its dependency tree) lose their `"optional": true, "peer": true` flags because jsdom is no
longer only vitest's optional peer. `npm audit`: no advisory touches jsdom or its tree; the 9 high/critical advisories
(`handlebars` critical; `@node-minify/core`, `@opennextjs/aws`, `@tiptap/core`, `aws-cdk-lib`, `brace-expansion`,
`fast-uri`, `glob`, `vite` high) are pre-existing and not introduced or changed by this edge. `cm1-showcase-dom.mjs`
is a committed test (row `cm1-catalog-showcase-dom` runs it on every `npm run test:serving`), not an operator probe.

### 7.3 CM1-BYTE-IDENTITY Layer 1 under CM1-A1

What the gate compares (spec § 8.19): status, Content-Type, the HTML outside the RSC payload unsorted byte for
byte, every flight row's bytes, and which client component each element mounts (`"$L<module path>#<export>"`,
resolved through each capture set's own `client-modules.json`, read from its build's
`*_client-reference-manifest.js` files). **What it no longer compares:** the order of rows inside the hydration
payload (compared as a sorted set), where the stream cut it into chunks, and the four digits of the footer year;
plus the ratified asset-path and build-id masks. Code: `renderer/test/serving-contract/cm1-byte-identity.mjs:77`
(`readClientModules`), `:179` (`maskBody`), `:254` (`compareTenant`).

**Cycle 3 correction of rule 3 (an implementation defect of mine, not a new canonicalisation).** The Flight encoder
sometimes outlines a client reference's export name into its own string row: `21:"ProductImageGallery"`, used as
`22:I[894921,[…],"$21"]`. Cycle 2 took `"$21"` literally as the export, so the identity token carried a
timing-dependent id; it matched by chance until the cycle-3 gate run, where content `/product/plain-rug` showed
`21:"ProductImageGallery"` in the baseline and `22:` in the candidate (EXECUTED; that page's code did not change in
cycle 3). Survey (EXECUTED): 87 such references on 39 pages of each capture set, none referenced outside an `I[` row.
Rule now (`cm1-byte-identity.mjs:179-222`): the reference is resolved to the name; the outlined row is removed with its
client reference, only when no other row references it (else it fails loudly); counted as `clientRefExportRows`.
Nothing a visitor or crawler reads is masked by it: the name survives in the identity token. Determinism after the
fix (EXECUTED): three independent builds of the current tree are identical on 51 of 51 URLs, and each matches the
baseline on all 32 commerce/content URLs.

Baseline re-captured in cycle 3 from a worktree of `de4ad52` (build `EnDoO3f0jr-r2N0gB4-lB`; procedure
`.../cm1-byte-identity/README.md`) because the catalog URL list gained Ash's legacy page. Candidate set committed from
the gate run (build `99GSde7mY529yTXny3bxf`): commerce 18, content 14, catalog 19. Commerce 18/18 and content 14/14
`same`; catalog 14 of 19 changed (`cm1-control`).

Per-URL count table (printed by the identity rows) — first and last rows:
- `(cm1-identity-commerce) same / baseline {"flightChunks":4,"clientRefRows":17,"clientRefUses":20,"clientRefExportRows":2,"assetPath":25,"buildId":1,"footerYear":2} candidate {…the same…}`
- `(cm1-identity-content) same /llms.txt baseline {"flightChunks":0,"clientRefRows":0,"clientRefUses":0,"clientRefExportRows":0,"assetPath":0,"buildId":0,"footerYear":0} candidate {…the same…}`

Mutations (EXECUTED, each restored):
- **Bound row `cm1-rewire`**: `(cm1-rewire) AddToCartButton row 25 → SearchBar row 20 / module 309985: both mutations change the canonical body (red)`.
- M1 "Volume Pricing" → "Volume pricing": `not ok 40 - (cm1-identity-commerce)`; `# pass 49`, `# fail 1`.
- M2 plugin guard disabled: `not ok 46 - (cm1-catalog-showcase-stale)`, `not ok 47 - (cm1-catalog-showcase-dom)`; `# fail 2`.
- M3 cycle-3 shaping disabled: `not ok 45 - (cm1-catalog-listings)`, `not ok 46 - (cm1-catalog-showcase-stale)`; `# fail 2`.
- Admin seam `imageLink = null` → `delete`: 1 of 6 rows red. MCP formatter: above.

### 7.4 § 3.2 rows — evidence per row ("tested" = a check fails if the row breaks; "cited" = code + preservation basis)

| Spec row (group) | Class | Evidence |
|---|---|---|
| 3.2.1 feed `price`/`sale_price`/`availability` | SUPPRESSED (404) | tested: `cm1-catalog-feed`; commerce/content feeds `cm1-identity-*` |
| 3.2.1 legacy page JSON-LD `offers`, price/sale/currency, Buy/Pre-order/Out of Stock | SUPPRESSED | tested: `cm1-catalog-listings` (`/products/<oak>`, `/products/<ash>`, `/products/<legacy-plank>` with price, sale, tier, Paddle, preorder stored) |
| 3.2.1 `SearchBar` type + dropdown price | CHANGED / SUPPRESSED | **cited, untested surface**: `SearchBar.tsx:22,200`, prop passed only on catalog `SitePage.tsx:778,1040,1091,1157`. The dropdown fills from a browser fetch; no HTTP capture shows it; the renderer's unit runner (`test/unit/**`) is outside the allocation. Non-catalog prop absence: tested by `cm1-identity-*` |
| 3.2.1 `AddToCartButton`, its props | UNAFFECTED | tested: `cm1-identity-commerce`; `cm1-rewire` proves a swapped component would be seen |
| 3.2.1 shop `?availability=` (data and view) | SUPPRESSED | tested: `cm1-catalog-listings` (filter ignored, no "All Products"/"In Stock" filter row) |
| 3.2.1 shop empty-state text, pagination URL | SUPPRESSED | **cited**: `SitePage.tsx:1126` (empty text reads `availability`, forced `undefined` on catalog, `:271`), `:1136` (pagination URL); the fixture stays under one page and is never empty, so neither branch renders |
| 3.2.1 `SoftwareApplication` "0", access-policy "Purchase" | OUT OF SCOPE | cited (spec) |
| 3.2.1 `ProductCard` price/sale/availability; product page JSON-LD `offers`, price, tiers, availability, Paddle Buy | SUPPRESSED | tested: `cm1-catalog-product` (oak, ash, legacy-plank), `cm1-catalog-listings`; oracle 5 |
| 3.2.1 `lib/dynamo.ts` filters/projections/feed mapping | UNAFFECTED | cited: emit nothing; `cm1-identity-*` covers their commerce outputs |
| 3.2.2 `ProductEditor` save body (`imageLink` null/omit, empty price/salePrice, option `priceOverride`/`availability`/empty image) | SUPPRESSED / CHANGED | tested: `admin/src/pages/ProductEditor.test.ts` (6 rows) on `buildProductPayload` |
| 3.2.2 `ProductEditor` hidden inputs, title-only validation, Personalization tab, derived note | SUPPRESSED / CHANGED | **cited, untested**: `ProductEditor.tsx:150-152,218,329,432,804`; admin has no DOM harness |
| 3.2.2 `Products.tsx` Adjust Prices, price + inventory columns | SUPPRESSED | **cited, untested**: `Products.tsx:196,207,392` |
| 3.2.2 Settings mode read-only / toggle hidden; create checkbox | CHANGED | **cited, untested**: `Settings.tsx:649`, `Sidebar.tsx:115,182` |
| 3.2.2 OrderDetail, DigitalProductEditor, DeliverySettings, csv-headers, InvalidationBanner | UNAFFECTED / OUT OF SCOPE | cited (spec) |
| 3.2.3 MCP `create_tenant` `catalog_mode`, `create_product` price/image optional, `list_products` price part | CHANGED | tested: `tools/mcp-server/test/tool-shapes.test.ts` (6 rows) on the functions the handlers call (`index.ts:659,1018,1063`) |
| 3.2.3 MCP tool schemas and `update_product` text | CHANGED | cited: `index.ts:655,1050,1053,1097` (descriptions); route coverage: oracle 4 |
| 3.2.3 `get_product`, `sale_price`, `availability` default, `bulk_price_adjust`, help text | UNAFFECTED / OUT OF SCOPE | cited (spec; F-6 named) |
| 3.2.4 `products/create.ts`, `update.ts`, `catprod.ts` types, `woocommerce.ts` guard, `orders/create.ts` guard | CHANGED | tested: `backend/test/unit/catalog-mode.test.ts` (38 rows) |
| 3.2.4 `public-list`, `public-get`, `bulk-price`, `list`, `categories/public-get` | UNAFFECTED | cited (spec: data absence by every write path; CommerceApi frozen) |
| 3.2.5 schema rows | CHANGED / UNAFFECTED | tested: backend rows (`price` optional + required-unless-catalog, `imageLink` `""`/`null`, `importSource` stripped) |
| 3.2.6 `categoryShowcase` price line + stock overlay | SUPPRESSED | tested: `cm1-catalog-listings` (`/`, successful lookup), `cm1-catalog-showcase-stale` (lookup miss + stale authored data: no price line, no overlay, and no `availability`/`currency`/`price` in the payload; commerce positive control), `cm1-catalog-showcase-dom` (browser fallback + stale prefetch in jsdom; commerce controls) |
| 3.2.6 legacy `<img>` / JSON-LD `image` / og:image absence guards | CHANGED | tested: `cm1-catalog-product` — Ash's legacy by-ID page `/products/e0000000-…-000000000002` has no main `<img>`, no JSON-LD `image`, no `og:image`; Oak's has all three (positive control) |
| 3.2.6 legacy `additionalImageLinks` loop, slug-page gallery | UNAFFECTED | cited: entries are schema URLs (no absent entry exists); `ProductImageGallery.tsx:14`; commerce images `cm1-identity-*` |
| 3.2.6 `CommerceBar`, `CartWidget`, robots, llms | UNAFFECTED | tested: `cm1-identity-*`, `cm1-catalog-cart` |
| 3.2.6 sitemap | CHANGED | tested: `cm1-catalog-sitemap` |
| 3.2.6 variant presenter | ADDED | tested: `cm1-catalog-product` (3 options; none under commerce) |

### 7.5 Deviations (each recorded, none reopens a ruling)

- **Image absence = key absent.** Renderer image guards test `=== undefined` (§ 3.2 closing rule); WooCommerce
  stores `imageLink: ""` on commerce products (`import/woocommerce.ts:382`), so a truthiness guard would change live
  pages (§ 3.6). The catalog-only presenter treats `""` as no image.
- **Invalid product body → 400** (was 500) on `POST /products` and `PUT /products/{id}` (`safeParse`).
- **Imported-product option image:** refused when present and not a URL (covers `""`).
- **Editor:** Personalization tab hidden on catalog sites; empty option images omitted on every catalog save.
- **Packet text:** `attributes` is `{ key, value }` in the code (`index.ts:1033-1036`), not `{name,value}`.
- **Plugin type:** `CategoryShowcaseRender.tsx` keeps `price: string` (comment: absent on a catalog site, never read
  there) so the commerce volume-price arithmetic is untouched.
- **Rule 3 export dereference** (§ 7.3): an implementation correction inside CM1-A1 rule 3, recorded for review.
- Withdrawn: the cycle-1 renderer-only showcase mechanism and unapproved masks (cycle 2); the lockfile-only jsdom
  (cycle 3, now declared); the stale-payload residual (cycle 3, now shaped).

### 7.6 Not done / follow-ups (named, not built)

- **Operator, before prod:** the § 2.5 listing of live tenants with `commerceEnabled` / `ORDER#`; also look for a stored
  non-boolean `commerceEnabled` (the narrow parse would refuse that tenant's next settings save with 400); Layer 2 on
  staging under CM1-A1 (including the rule-3 export dereference); `cdk diff`; screenshots; Rich Results test.
- **Untested surfaces** (cited in § 7.4): SearchBar dropdown; admin hidden controls, read-only mode, create checkbox;
  shop empty-state and pagination branches.
- **Not in § 2:** F-5, F-6; the WooCommerce "Import CSV" button stays visible on catalog sites (backend 403).
- **Pre-existing, outside this slice:** `tenant/list.ts` GLOBAL_ADMIN query without `ProjectionExpression`;
  `admin/src/pages/Products.tsx:134` defaults the import currency to `"RON"`; product JSON-LD reaches the page only in
  the flight payload (`next/script`); `SoftwareApplication` "0" offer; sitemap cap 1000 products; 9 high/critical
  `npm audit` advisories (§ 7.2).

### 7.7 Abstractions introduced (one line each)

- `isCatalogMode()` (`packages/shared`) — users: renderer `SitePage`, `ProductByIdPage`, sitemap, feed; backend
  `settings.ts`, `lib/catalog-product.ts`; admin `ProductEditor`, `Products`, `Settings`; axis: the one mode rule every
  surface asks (spec § 4); rejected: each site reading `catalogMode`.
- `lib/catalog-product.ts` (`readTenantMode`, `checkProductWrite`, sum type `ProductWriteCheck`) — users:
  `products/create.ts`, `products/update.ts`, `import/woocommerce.ts`; axis: none (removes duplication); rejected: inline copies.
- `buildProductPayload()` (`ProductEditor.tsx:34`) — users: `handleSave`, `ProductEditor.test.ts`; axis: test seam;
  rejected: testing through a DOM render (no admin DOM harness).
- `tools/mcp-server/src/tool-shapes.ts` (`createTenantBody`, `createProductBody`, `productListLine`) — users: the
  `create_tenant`, `create_product`, `list_products` handlers in `index.ts` (replacing their inline code) and
  `test/tool-shapes.test.ts`; axis: test seam (`index.ts` runs `dotenv.config()` and `main()` on import); rejected:
  importing `index.ts` under a stubbed environment.
- `cm1-byte-identity.mjs` (`readClientModules`, `captureCm1`, `maskBody`, `compareTenant`, `splitFlight`, capture CLI)
  and `cm1-showcase-dom.mjs` — users: the `cm1-*` rows and the baseline CLI; axis: none (one capture/canonicalisation
  definition for both sides; one isolated DOM test); rejected: two copies / jsdom globals in the suite process.

### 7.8 Operator closeout (2026-10-29)

- **Review:** approved at cycle 3 (review-2, `gpt-6.1-sol`); cycles 1–2 escalated on the identity gate (spec
  defect → CM1-A1) and the showcase mechanism (packet allocation omitted `packages/plugins/src/category-showcase`).
- **Operator gates (first independent execution; the reviewer's sandbox could not run the suites):** typecheck 0;
  backend `test:unit` 33 files / 447; renderer `test:serving` 50/50; admin `test:unit` 24/24; MCP route check +
  `tool-shapes` 6/6; negative grep 0 hits on both catalog product captures; `git diff --check` 0; allocation clean.
- **CDK delta (staging diff):** `CreateProductFunc` role gains the read actions (`grantWriteData` →
  `grantReadWriteData`); no resource added or removed; 41 Lambda code-hash changes (the shared package is bundled
  into every function).
- **Layer 2:** spec § 8.20 (CM1-A2) — commerce 18/18, content 14/14 identical; catalog differs on exactly the 13
  slice surfaces. Three staging deploys this day: the candidate (first with the inherited `.env.local` values —
  wrong stage, see § 8.20), the baseline and the candidate again with explicit staging values.
- **Prod (human):** deploy from `main` after the pre-prod queries (tenants with `commerceEnabled`, non-boolean
  values, orders per tenant) with `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_USER_POOL_ID`, `NEXT_PUBLIC_USER_POOL_CLIENT_ID`
  set to prod's stack outputs on the command line — this also repairs the empty API URL the 2026-10-28 prod
  renderer carries (checkout/coupons).
- **Follow-ups filed (ROADMAP):** `BUILD-ENV-1`, `LAYER2-CANON-1`; earlier: `CATPROD-CONSISTENCY-1`, the untested
  surfaces of § 7.6.
