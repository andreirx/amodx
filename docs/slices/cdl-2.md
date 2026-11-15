# CDL-2 — paths: the saved path, else the English default; reserved built-in addresses; the confirmation segment (implementation record)

Status: **BUILT** (2026-11-15, builder iteration 2 — "revision iteration 1": review-0 findings CDL2-R1 to CDL2-R4 and
the operator rulings of 2026-11-15 applied, § 12), uncommitted, awaiting review. Start: `main` at `7bd3d51`, tree
clean. All 12 oracles of the packet's § 6 (oracle 11 in its ruled form) pass on the final tree (§ 11): serving contract
109 / 109 with the partial-prefix row. No allocation addition (§ 10).
Design: `docs/slices/catalog-data-labels-1.md` (RATIFIED), § 7, § 8, § 9 item 5, § 10 row `cdl-2`, § 12, § 14.
Track: catalog; the commerce pages' path fallbacks and confirmation address change too (§ 3, § 7). Maturity: `urlPrefixesOf` is **MATURE** on entry (a pure
rule of 8 lines, every input class of the taxonomy tested; the backend has applied the same rule since `cache-4a`,
`revalidate-paths.ts`). The `checkoutConfirmation` setting is **PROTOTYPE** until the staging run of § 8.4 (operator).

## 1. The rulings (quoted)

Design § 9 item 5:

> 5. **Paths.** One rule everywhere: the path the owner saved, else the English default. The Romanian fallbacks go. The
>    interest default becomes `/my-list` for every tenant; a Romanian site sets `/lista-mea` in Settings. The commerce
>    effect is accepted: cart and checkout routing changes for a tenant with incomplete path settings, with no commerce
>    file edited — the named commerce-freeze exception (§ 7, § 8.5).

Design § 14 (addendum, human 2026-11-15):

> 1. **F-CDL-INTEREST-SLUG — ruled: fix.** The content-slug check (`backend/src/lib/slug-guard.ts:23-29`) reserves five
>    paths (product, category, cart, checkout, shop). It does not reserve the interest, account and search paths, so a
>    content page saved at one of those addresses is accepted and then hidden by the built-in page. `cdl-2` makes the
>    check reserve every path that the renderer serves for that kind of site, and no other. […] The refusal message
>    names the built-in page that owns the address.
> 2. **F-CDL-CONFIRMARE — ruled: option B, a setting.** The checkout confirmation segment `confirmare` is fixed at
>    `renderer/src/components/SitePage.tsx:218`, `:221` and `:503`. It becomes a per-tenant path setting like the other
>    URL prefixes, with an English default, shown on the admin Settings page beside them. This is a named exception to
>    the commerce freeze (human 2026-11-15), limited to this segment: the three lines above, the shared prefix schema
>    and defaults, and the Settings field.

Operator decisions in the packet, applied as written: key `checkoutConfirmation`, default `/confirmation`, stored with
its leading slash, appended to the checkout prefix; account reserved on every site (§ 2 below).

Operator rulings after review-0 (2026-11-15), applied in iteration 2 (§ 12):

> **CDL2-SHARED-DAG = move `catalogListingPath` into `packages/shared/src/index.ts`.** Keep its public `@amodx/shared`
> export and its behaviour. No new file. `catalog-listing.ts` must not import `index.ts`.

> Human ruling 2026-11-15 on the commerce freeze (verbatim): "the only commerce 'freeze' is not moving the entries to a
> separate table yet. 'freeze the track' is an oversimplification. no reason not to fix things that can be fixed
> right now".

Consequence ruled by the operator: the Romanian fallbacks `"/magazin"`, `"/produs"`, `"/comanda"`, `"/cos"` in
`SitePage.tsx` go (F-CDL-DEAD-FALLBACKS); each site reads its prefix through the same per-key rule as its neighbours;
the serving contract must show zero new differences for commerce and content rows. CDL2-R2, CDL2-R3 and CDL2-R4 stand
as the reviewer wrote them.

## 2. Routing facts (packet § 1) — confirmed at `7bd3d51`

All OBSERVED in `renderer/src/components/SitePage.tsx` at `7bd3d51` (line numbers unchanged by this slice):

- `:347` — the interest path is matched first, on a catalog site only (`isCatalogMode(config)`). Confirmed.
- `:360` — `matchCommercePrefix` (`:213-233`) runs next on every site. A match never falls through to content:
  product, category, shop and search render on every site (product branch `:365`, the packet's `:364` is the line
  before it; search `:442`); account, cart, checkout, confirmation and tracking answer "not found" on a non-commerce
  site (`:456`, `if (!commerceEnabled) return notFoundHere()`). Confirmed.
- The confirmation segment: `:218`, `:221`, `:503`; `CheckoutPageView.tsx:377` pushes the visitor to `confirmPrefix`.
  Text search `grep -rn "confirmare\|confirmPrefix"` over `renderer/src`, `admin/src`, `backend/src`, `packages/*/src`
  (EXECUTED): no other use except `CheckoutPageView.tsx:32`, `:179`, `:377` (the prop) and the visitor sentence
  `packages/shared/src/language-packs/ro.ts:168`. Basis: a text search, a subset claim; no backend mail or route
  builds the confirmation URL (the same search over `backend/src` finds nothing).
- Slug check at `7bd3d51`: `backend/src/lib/slug-guard.ts`, callers `content/create.ts:62`, `content/update.ts:99`.
  Confirmed.
- One addition: only the header `InterestWidget` (`InterestShortlist.tsx:164`, rendered twice by `Navbar.tsx:198`,
  `:213`, desktop and mobile) links to the interest list. Product cards carry the interest toggle, which links nowhere
  (§ 14, F-CDL2-CARD-LINKS). Basis: `grep -n listPrefix renderer/src` (EXECUTED), 5 hits, all on that chain.

## 3. What changed (file:line at the end of the build)

| File | Lines | Change |
|---|---|---|
| `packages/shared/src/index.ts` | 99, 100-102, 115 | `URL_PREFIX_DEFAULTS.interest` = `/my-list`; new key `checkoutConfirmation` = `/confirmation` (constant and `UrlPrefixesSchema`) |
| `packages/shared/src/index.ts` | 118-134 | `urlPrefixesOf(stored)` — the one new function |
| `packages/shared/src/index.ts` | 136-148, 44-46 | `catalogListingPath` moved here from `catalog-listing.ts` (ruling CDL2-SHARED-DAG), same signature and public export; its shop fallback is `URL_PREFIX_DEFAULTS.shop` (was `"/magazin"`, design row 16). The re-export of `catalog-listing.js` no longer names it |
| `packages/shared/src/catalog-listing.ts` | 1-11 | header comment only (the path rule moved); the file imports nothing |
| `backend/src/lib/slug-guard.ts` | 1-81 | `urlPrefixesOf`; projection `urlPrefixes, catalogMode` (same one `GetCommand`); `PRECEDENCE` (`:13`) — the reserved addresses in the renderer's order; `builtInPageAt` (`:32`) — the page the renderer shows at the slug; one message form naming that page (CDL2-R2) |
| `renderer/src/lib/dynamo.ts` | 50, 180 | `mapTenant`: `urlPrefixes = urlPrefixesOf(item.urlPrefixes)` (was the whole-object fallback) |
| `renderer/src/components/SitePage.tsx` | 218, 221, 503 | the confirmation segment: `prefixes.checkoutConfirmation \|\| URL_PREFIX_DEFAULTS.checkoutConfirmation` (the per-key rule for the new key only) |
| `renderer/src/components/SitePage.tsx` | 1102, 1485, 1510 (row 16), 1462, 1519 (row 17) | `"/magazin"` → `URL_PREFIX_DEFAULTS.shop`, `"/produs"` → `URL_PREFIX_DEFAULTS.product` (design read these at `fd39faa` as `:1044`, `:1426`, `:1451`, `:1403`, `:1460`; mapped by enclosing function, EXECUTED) |
| `renderer/src/components/SitePage.tsx` | 481, 482, 503, 504, 1640, 1729, 1758 (rows 18-19) | iteration 2, human ruling of 2026-11-15: `"/comanda"` → `URL_PREFIX_DEFAULTS.checkout`, `"/magazin"` → `URL_PREFIX_DEFAULTS.shop`, `"/cos"` → `URL_PREFIX_DEFAULTS.cart` (cart view, checkout view, confirmation view ×2, tracking view) |
| `renderer/src/components/SitePage.tsx` | 235 | comment: the interest default is `URL_PREFIX_DEFAULTS.interest`, `/my-list` (was the stale "/lista-mea"; F-CDL2-STALE-COMMENT closed) |
| `admin/src/components/glamPreview.ts` | 2, 18-20, 51, 57 | `siteContextOf`: `prefixes = urlPrefixesOf(settings.urlPrefixes)` |
| `admin/src/pages/Settings.tsx` | 1623-1634, 1667 | new field "Confirmation (after Checkout)" right after Checkout, condition `!isCatalogMode(config)` (the Cart/Checkout condition), bound to `urlPrefixes.checkoutConfirmation`, placeholder `/confirmation`; interest placeholder `/my-list` |

Why the fallback removal of rows 18-19 changes no output (OBSERVED in code, EXECUTED by the serving contract): every one
of the seven sites reads `prefixes` from `SitePage.tsx:362` (`config.urlPrefixes || URL_PREFIX_DEFAULTS`), and `config`
comes from `getTenantConfig(siteId)` (`:335`), which returns `mapTenant(…)` or `null` (`renderer/src/lib/dynamo.ts`,
both return paths), and `null` stops at `:336`. `mapTenant` gives `urlPrefixesOf(…)`, whose every key is a non-blank
text, so the left side of each `||` is never empty and neither the old literal nor the new default is reached. The
serving contract passed 109 / 109 after the removal with `cdl-2/expected-diff.json` unchanged (sha256 prefix
`9b563c40261e335b`, written 14:58, before iteration 2) and with the `cm1-byte-identity/baseline/` captured before the
removal: no new difference on any commerce or content page.

Not edited: every commerce component (oracle 12), `backend/src/tenant/create.ts` (not needed: `TenantConfigSchema.parse`
fills `urlPrefixes` from the schema default, so the created record follows the constant — proven by test),
`backend/src/content/{create,update}.ts`, the per-key readers of design § 3.5.

Tests and suite files: § 5, § 8.

## 4. Enumerations of step 1 (before any edit)

**(a) Readers and constructions of `urlPrefixes` / `URL_PREFIX_DEFAULTS` / `UrlPrefixesSchema`.** Basis:
`grep -rn "urlPrefixes\|URL_PREFIX_DEFAULTS\|UrlPrefixesSchema"` over `renderer/{src,test}`,
`packages/shared/{src,test}`, `packages/plugins/src`, `backend/{src,test}`, `admin/src`, `tools/mcp-server/{src,test}`,
`infra/lib` (EXECUTED), then `npm run typecheck` (EXECUTED, exit 0) after the schema change.

- Whole-object readers → `urlPrefixesOf`: `renderer/src/lib/dynamo.ts:180`, `admin/src/components/glamPreview.ts:56`,
  `backend/src/lib/slug-guard.ts:20` (the design's three).
- Whole-object readers left as they are, because their input is `mapTenant`'s output and is now complete:
  `SitePage.tsx:214`, `:348`, `:362`, `:711`; `app/[siteId]/sitemap.xml/route.ts:25` (`|| {}`, then per key).
- Raw forwarder, unchanged: `backend/src/lib/revalidate.ts:168-176` (`getTenantRouting`) reads the stored
  `urlPrefixes` as it is and passes it to `revalidate-paths.ts`, which applies the per-key rule itself (`:82-83`, the
  same rule as `urlPrefixesOf`). Missed in iteration 1 (review-0 CDL2-R4 item 2).
- Per-key readers, unchanged (design § 3.5): `backend/src/lib/revalidate-paths.ts:82-83`,
  `backend/src/interest/public.ts:297` (design: `:282`, moved by `cdl-1`), `app/[siteId]/layout.tsx:154`, `:245`, `:266`,
  `:275`, `SitePage.tsx:237`, `:353-354`, `:1233` (design: `:1174`); also `app/[siteId]/openai-feed/route.ts:23`
  (`|| '/product'`, the English default; not in the design list, no change needed).
- Writers: `packages/shared/src/index.ts:91-116`, `:1132` (schema default); `backend/src/tenant/create.ts:54` (via the
  schema); `admin/src/pages/Settings.tsx:507` (`updateUrlPrefix`).
- Tests holding prefix objects: `packages/shared/test/schemas.test.ts:98-149`, `catalog-listing.test.ts:71-80`;
  `admin/src/components/glamPreview.test.ts:117`, `:153-158`; `admin/src/pages/Settings.test.ts:105-113`, `:431-455`;
  renderer unit tests that pass `URL_PREFIX_DEFAULTS` or a literal object to `SitePage` (locale-1a/1b/1d,
  cat-variant-gallery-1 ×2, cmrc-counties-1, site-page-reviews, catalog-product-status); backend
  `revalidate-paths.test.ts`, `edge-invalidation.test.ts`, `invalidate-cdn.test.ts`, `bulk-purge.test.ts` (tenant data).

**(b) Captures and expectations holding `/lista-mea`, `/magazin`, `/produs`, `confirmare`.** Basis: `grep -rln` over
`renderer/test`, `packages/shared/test`, `backend/test`, `admin/src`, `tools/mcp-server` (EXECUTED).

| Holder | Moved by this slice? |
|---|---|
| `/lista-mea` in the catalog captures of every `locale-1/*/before/`, `cmrc-counties-1/before/`, `cm1-byte-identity/baseline/catalog/` | Yes for the running build (catalog fixtures store no `interest`). Other slices' captures are NOT edited; the current set moves to `cdl-2/` (§ 8); `baseline/` is re-captured by its README procedure |
| `/lista-mea` in `renderer/test/unit/locale-1b-server-render.test.ts:231`, `:317` (the list page addressed on a default tenant) | Yes → `my-list` (address only, assertion unchanged) |
| `/lista-mea` in `renderer/test/unit/locale-1b-client.test.ts:15`, `:275`, `:288` (a prop value given to the widget) | No (input data, not the default) |
| `/lista-mea` in `renderer/test/interest-e2e/interest.spec.mjs:95`, `:167`, `:191` (the fixture catalog tenant's list) | Yes → `/my-list` (not run, § 13) |
| `/lista-mea` in `packages/shared/test/schemas.test.ts` (the defaults pin) | Yes → `/my-list` |
| `/magazin`, `/produs` in `admin/src/pages/Settings.test.ts`, `__markup__/*.html`, `glamPreview.test.ts:117`, backend tests | No (tenant data, or admin-english-2's placeholder replacements) |
| `"/magazin"` in `packages/shared/test/catalog-listing.test.ts:80` (empty shop → `/magazin`) | Yes → `/shop` |
| `confirmare` in `cm1-byte-identity/{baseline,candidate,control-de4ad52}/commerce/checkout.body` and every `locale-1/*/before/` commerce set | `baseline/` re-captured (procedure); the others are records, not edited |
| `confirmare` in `contract.test.mjs` (`:1889`, `:1953`, `:2735`-`:2745`) and `locale-1/proof.mjs:57-58` (`orderRequests`) | Yes → `CONFIRMATION_ADDRESS` |
| `confirmare` in `renderer/test/unit/locale-1d-server-render.test.ts:245` | Yes → `confirmation` |
| `confirmare` in `renderer/test/unit/locale-1d-client.test.ts:143` (a prop given to the view) | No (input data) |

## 5. Taxonomy → tests (all EXECUTED, pass)

| Input / state | Expected | Test (file › name) |
|---|---|---|
| stored absent | every default | `packages/shared/test/cdl-2.test.ts` › "stored urlPrefixes absent → every key = its default"; `renderer/test/unit/cdl-2-map-tenant.test.ts` › "no stored urlPrefixes → every default …" |
| stored full object | every stored value | `cdl-2.test.ts` › "stored urlPrefixes full object → every key = the stored value" |
| stored partial (only `interest`) | stored kept, others default | `cdl-2.test.ts` › "stored urlPrefixes partial (only interest) …"; `cdl-2-map-tenant.test.ts` › "partial { interest: "/lista-mea" } …" |
| a key `""` or whitespace | that key's default | `cdl-2.test.ts` › "a stored key "" or whitespace …"; `cdl-2-map-tenant.test.ts` › "a cleared field ("") …"; `catalog-listing.test.ts` › "CDL-2 (§ 7.1): an empty or absent shop prefix falls back to URL_PREFIX_DEFAULTS.shop …"; `admin/src/components/glamPreview.test.ts` › "(3b) CDL-2 (§ 7.1): a partial or blank stored object …" |
| a key not a text | that key's default | `cdl-2.test.ts` › "a stored key that is not a text (number, null, object, array, boolean) …" |
| stored not an object | as absent | `cdl-2.test.ts` › "stored urlPrefixes not an object (text, array, null, number) → as absent"; `cdl-2-map-tenant.test.ts` › "not an object → as absent" |
| renderer, `{ "interest": "/lista-mea" }`, catalog | `/product/<slug>` routes; `/lista-mea` is the list | serving `contract.test.mjs` › `(cdl2-partial-prefixes)`; unit `renderer/test/unit/cdl-2-site-page.test.ts` › "catalog tenant with stored { interest: "/lista-mea" } …" |
| renderer, catalog, no stored `interest` | list at `/my-list`; the header links there | serving `(loc1-diff-cdl-2)` (row CDL2-INTEREST-PATH on all 30 catalog HTML pages, exact) and `(cdl2-partial-prefixes)` control; unit `cdl-2-site-page.test.ts` › "catalog tenant, no stored interest: /my-list is the interest page …" ("card links": see F-CDL2-CARD-LINKS) |
| `POST /tenant` | stores `interest: "/my-list"`, `checkoutConfirmation: "/confirmation"` | `backend/test/unit/cdl-2-paths.test.ts` › "the created tenant record stores interest "/my-list" and checkoutConfirmation "/confirmation"" |
| slug at product / category / cart / checkout / shop | refused, new message | `cdl-2-paths.test.ts` › "slug at product / category / cart / checkout / shop → refused, as today, with the new message form (every site kind)" |
| slug at account or search, any kind | refused; page named | `cdl-2-paths.test.ts` › "slug at account or search, any site kind → refused; the message names the page" |
| slug at the interest address, catalog | refused | `cdl-2-paths.test.ts` › "slug at the interest address, catalog site → refused …" |
| slug at the interest address, commerce or content | accepted | `cdl-2-paths.test.ts` › "slug at the interest address, commerce or content site → accepted" |
| partial stored object | missing keys' defaults reserved | `cdl-2-paths.test.ts` › "tenant with a partial stored object → the defaults of the missing keys are reserved" |
| unrelated slug | accepted | `cdl-2-paths.test.ts` › "an unrelated slug → accepted …" |
| overlapping addresses, equal and nested (review-0 CDL2-R2) | the message names the page the renderer shows at the slug; where the renderer shows content, the first reserved address in its precedence | `cdl-2-paths.test.ts` › "CDL2-R2 — overlapping addresses: the message names the page the renderer shows" (15 rows); the same 15 rows through the real `SitePage`: `renderer/test/unit/cdl-2-site-page.test.ts` › "CDL2-R2 overlaps — the branch the renderer takes …" |
| confirmation, no stored value | `/checkout/confirmation` → confirm; `confirmPrefix` ends `/confirmation`; `/checkout/confirmare` → track | `cdl-2-site-page.test.ts` › "no stored value: /checkout/confirmation is the confirmation page; /checkout/confirmare is a tracking address", "no stored value: the checkout page's confirmPrefix ends with /confirmation"; serving `(cdl2-moved-address)`, `(loc1-order-pages)` |
| confirmation, stored `/multumim` | that segment confirms; `/checkout/confirmation` tracks | `cdl-2-site-page.test.ts` › "stored /multumim: …" |
| admin Settings, the new field | beside Checkout; saved under `urlPrefixes.checkoutConfirmation` | `admin/src/pages/Settings.test.ts` › "URL Prefixes on a non-catalog site: the eight fields — CDL-2 adds Confirmation directly after Checkout …", "CDL-2 (§ 14 item 2): the Confirmation field shows urlPrefixes.checkoutConfirmation …", the markup rows (`withoutCdl2`, § 9); the save path, EXECUTED headless (iteration 2, review-0 CDL2-R3): "CDL-2 (§ 14 item 2): typing /multumim in the Confirmation field and pressing Save sends urlPrefixes.checkoutConfirmation = "/multumim" in the PUT /settings body; every other prefix is kept" (§ 9). Server side, OBSERVED in code: `backend/src/tenant/settings.ts` writes the merged object without a schema parse, so the key is stored as sent |

Also: `cdl-2.test.ts` › unknown keys dropped, a new object returned, the schema holds the same keys;
`cdl-2-paths.test.ts` › one tenant read with the projection; stored custom addresses replace the defaults;
`cdl-2-site-page.test.ts` › custom checkout prefix, a config without the key, a non-catalog `/my-list` is content.
Mutations (EXECUTED, each restored and re-run green): `SitePage.tsx:218` put back to `"/confirmare"` → 4 rows of
`cdl-2-site-page.test.ts` fail; `PRECEDENCE` with the interest list last (the iteration-1 order) → exactly the 3
interest overlap rows of `cdl-2-paths.test.ts` fail; the Confirmation field's `onChange` writing key `confirmation`
→ the Settings save test fails.

## 6. Abstractions (one line each)

- `urlPrefixesOf(stored)` (`packages/shared/src/index.ts`): users `mapTenant`, `siteContextOf`, the slug check (3
  current callers); axis: stored prefix objects that are partial, blank or malformed (data, no dispatch); rejected: the
  literal fallbacks per call site (they already disagreed, `/produs` vs `/product`). Ratified by the design § 3.5.
- `PRECEDENCE` (`slug-guard.ts:13`, a module-level data table, not a function or type; replaces iteration 1's
  `RESERVED_ON_EVERY_SITE`): users: `checkSlugCommerceConflict` and `builtInPageAt`; axis: none — the reserved keys of
  the ruling in the renderer's order, with the page name per key; rejected: an unordered table with a first match (the
  review-0 CDL2-R2 defect).
- `builtInPageAt(slug, prefixes, catalog)` (`slug-guard.ts:32`, module-private): users: the one check, for the page name
  only (the refusal rule itself is unchanged: equal to, or under, a reserved address); axis: none — it is the
  renderer's route precedence (`SitePage.tsx:347`, `matchCommercePrefix`); rejected: (a) first match over the table
  (names the wrong page on overlaps); (b) one shared routing function used by both `matchCommercePrefix` and the
  backend (it would rework `matchCommercePrefix`, which packet § 3 forbids). Cost: a second copy of the precedence,
  pinned by the same 15-row table in a backend and a renderer test (F-CDL2-ROUTE-ORDER-COPY).
- `catalogListingPath` moved from `catalog-listing.ts` to `index.ts` (ruling CDL2-SHARED-DAG): not new; same export.
- Test-suite helpers (not product code): `CONFIRMATION_ADDRESS`, `PRE_CDL2_CONFIRMATION_ADDRESS`, `preCdl2Address`
  (`locale-1/proof.mjs`): users `orderRequests`, rows `loc1-subjects`, `loc1-diff-cdl-2`, `loc1e-cache-headers`,
  `cdl2-moved-address`; axis: the one address that moved between a recorded capture and the running build; rejected:
  editing other slices' records (forbidden) or keeping the old request address (it now serves another page).

No new module, file (other than tests and the capture set), type or configuration layer in product code.

## 7. Effect on a commerce tenant's confirmation address

A commerce tenant that stores no `checkoutConfirmation` (every tenant today) moves from `/checkout/confirmare` to
`/checkout/confirmation`. The checkout page sends the visitor to the new address. The old address now reads as an
order tracking address for the order id `confirmare`: the page says "Order Not Found" (EXECUTED, row
`cdl2-moved-address`, on the serving fixture). A link to the old address (a bookmark, a mail) therefore shows "Order
Not Found". No backend mail builds this address (§ 2). Accepted by the packet (only a test tenant is live).

## 8. Serving contract — this slice's set and the rows it adds or moves

**8.1 The set `renderer/test/serving-contract/locale-1/cdl-2/` (EXECUTED).** `before/`: throwaway worktree
`/private/tmp/CDL-2-base` at `7bd3d51` (node_modules APFS clones; `packages/shared`, `effects`, `plugins` built there;
its shared still has `interest: "/lista-mea"` and no `checkoutConfirmation`). A throwaway script (kept in the
gitignored `.agent-manager/slices/CDL-2/capture-base.mjs`) built and served it with THAT tree's harness, stub and
fixtures (`harness.mjs`, `ddb-stub.mjs`, `cm1-byte-identity.mjs`, `no-dotenv.cjs`, `extract.mjs` are byte-identical in
both trees, `cmp`), and captured the candidate's `EN_US_REQUESTS` + `LOC1_REQUESTS` + `CQ1_REQUESTS` + `CT1_REQUESTS`.
The script first proved that the candidate list, mapped by `preCdl2Address`, equals the base list exactly. The six
order-confirmation requests (commerce and its RO copy) were sent at `/checkout/confirmare…` and recorded under the
current path with `requestedPath`. Build `01fKf0eEYD4V1F3cvuaY3`, 151 captures (200: 141, 307: 8, 404: 2), 34 client
modules, stub `unhandled` = `[]`. Worktree removed.
`expected-diff.json` / `ro-expected.json`: written by `gen.mjs` (kept with the scripts) only after `checkExpected`
reported 0 problems on all 81 en-US URLs, on the RO copies' text and status, and on the two `roNone` pages against
`quote-1/before/`. Chain check (EXECUTED, `chain.mjs`): `variant-gallery-1/before/` (27fa7ca) + its list →
`cdl-2/before/` on all 81 en-US URLs: 0 problems, so the proof chain 27fa7ca → 7bd3d51 is unbroken.

| Row id | Where | Entries |
|---|---|---|
| CDL2-INTEREST-PATH | every HTML page of the catalog-mode subjects (`catalog` 15, `cip1b-catalog` 15) | payload text `"listPrefix":"/lista-mea"` → `"listPrefix":"/my-list"`; on the pages with the header, HTML `href="/lista-mea"><span class="relative">` → `href="/my-list"><span class="relative">` (markup, no visible text) |
| CDL2-CONFIRMATION | commerce `/checkout` | `CheckoutPageView` prop `confirmPrefix` `/checkout/confirmare` → `/checkout/confirmation` |
| CDL2-CONFIRMATION | commerce `/checkout/confirmation`, `…?id=cm1-order-bank&…`, `…?id=cm1-order-cod&…` | Next's route-segment payload text `"k":"checkout/confirmare"` → `"k":"checkout/confirmation"`, `"c":["","checkout","confirmare` → `"c":["","checkout","confirmation` |
| — | every other en-US URL (47), every RO copy URL (text) | nothing |

`cq1RoNone`: the two `roNone` pages each list the two CDL2-INTEREST-PATH entries (against `quote-1/before/`).

**8.2 Rows added or moved** (`contract.test.mjs`):

| Row | Change |
|---|---|
| all `loc1-*` | Read the current set `cdl-2/` (`LOC1_SLICE`, `LOC1_START = "7bd3d51"`) |
| `loc1-subjects` | The per-slice rule: catalog-mode HTML pages list exactly the CDL2-INTEREST-PATH payload entry (+ at most its HTML entry), commerce `/checkout` exactly the `confirmPrefix` entry, the 3 moved pages exactly the two segment entries, every other URL nothing; counts pinned (30, 1, 3); `requestedPath` on exactly the moved captures, equal to `preCdl2Address(path)` |
| `loc1-diff-variant-gallery-1` → `loc1-diff-cdl-2` | Renamed (proves against `7bd3d51`); every control kept, the oak-plank precondition now CDL2-INTEREST-PATH; new controls: old interest address left in the payload, another header-link address, `/checkout` unlisted or with another `confirmPrefix`, a moved page without one segment entry, with a changed text, or replaced by a tracking page |
| `loc1-text-mutation`, `loc1-order-pages` | The confirmation requests at `CONFIRMATION_ADDRESS` (assertions unchanged) |
| `cvg1-text-removal-*` | Read `variant-gallery-1/` explicitly (`cvg1BeforeSet`, `cvg1Json`): they pin CVG1's removal against ITS start; assertions unchanged |
| `cq1-quote-channels` | Adds `cdl-2`'s `cq1RoNone` to the list (CVG1's list read from `variant-gallery-1/` explicitly); new control: without the CDL2 list the page is reported; title names the three changes |
| `loc1e-cache-headers` | The d9999d2 record is matched through `preCdl2Address` and each record is compared with the answer of the current address; the assertion (equal headers) is unchanged |
| `cm1-identity-commerce` | `baseline/` re-captured by the README procedure (history line added): the previous `baseline/` was CM1-A1-equal to `cdl-2/before/` on all 32 URLs; the first candidate run failed exactly this row on exactly `/checkout` (108 / 109); after the re-capture the only CM1-A1 difference to `before/` is `/checkout` and `checkExpected` with the cdl-2 entry reports nothing |
| NEW `cdl2-moved-address` | `preCdl2Address`: the two mapped forms and 9 unchanged paths (negative controls); the 6 recorded captures are 7bd3d51 confirmation pages; the old address answers "Order Not Found" |
| NEW `cdl2-partial-prefixes` | The partial-prefix tenant (§ 8.3) and the control on the catalog subject |

Fixture added: `fixtures.mjs` `CDL2.partial` — a catalog copy with `locale: "en-US"` (so by the suite's rule not an
en-US subject, in no `before/`) storing `urlPrefixes: { interest: "/lista-mea" }`.

No commerce or content row changed except through the confirmation segment: the commerce changes are exactly
`/checkout`'s `confirmPrefix` and the three moved confirmation pages; `cm1-identity-content` passed unchanged in
every run; every content-subject URL lists nothing.

Instrument mutation (EXECUTED): `preCdl2Address` made to return its input → exactly `loc1-subjects`,
`loc1-diff-cdl-2`, `cdl2-moved-address`, `loc1e-cache-headers` fail (105 / 109); restored.

**8.3 The pre-existing defect, now EXECUTED.** The same partial-prefix tenant served by the `7bd3d51` renderer (items put
into that run's stub; `.agent-manager/slices/CDL-2/base-partial.json`): `/product/oak-plank`, `/shop`,
`/category/floors` → 307 not-found handoff; `/lista-mea` → 200. On the candidate: 200, 200, 200, and the list at
`/lista-mea` (row `cdl2-partial-prefixes`). F-CDL-PARTIAL-PREFIXES moves from INFERRED to EXECUTED and is closed.

**8.4 The `cm1-byte-identity/baseline/` refresh (operator record item, iteration 2).** Permitted by the procedure of
`renderer/test/serving-contract/cm1-byte-identity/README.md` § "When a `cm1-identity-*` row fails": a slice that
changes those bytes on purpose captures its start commit into its own immutable `before/` (here `locale-1/cdl-2/before/`,
7bd3d51), commits the exact list of differences and a row that checks it (`expected-diff.json`, `loc1-diff-cdl-2`), and
only then re-captures `baseline/` from its own candidate tree and adds a history line (added, dated 2026-11-15). The
order held: the old `baseline/` was CM1-A1-equal to `cdl-2/before/` on all 32 commerce/content URLs (EXECUTED); the
first candidate run failed exactly `cm1-identity-commerce` on `/checkout` (108 / 109); then the re-capture.
Why each of the 41 changed files changed (EXECUTED: each file at `HEAD` against the working tree, under the CM1-A1
masks; throwaway `.agent-manager/slices/CDL-2/baseline-why.mjs`, `baseline-why2.mjs`):

| Files | Count | Why |
|---|---|---|
| `index.json` | 1 | the build id (`KTdyd9b3U6UspWv85Hifc` → `OJXwutAeo2wzwdh2RXBA1`); the capture list (tenant, path, status, Content-Type) is equal |
| `client-modules.json` | 1 | one module added, `QuoteRequest.tsx` (cat-quote-1, after the last refresh by locale-1e at `656a9eb`); none removed |
| commerce and content bodies except `commerce/checkout.body` | 23 | build id and asset hashes only (CM1-A1-equal) |
| `commerce/checkout.body` | 1 | the `CheckoutPageView` prop `confirmPrefix` `/checkout/confirmare` → `/checkout/confirmation` (row CDL2-CONFIRMATION) |
| catalog bodies except the three product pages | 12 | the interest address `/lista-mea` → `/my-list` (payload, and the header link where rendered; row CDL2-INTEREST-PATH) |
| `catalog/product_{oak,ash,legacy}-plank.body` | 3 | the interest address, plus the catalog product-page changes of cat-quote-1 (the interest toggle's link form) and cat-variant-gallery-1 (the gallery), made after the last refresh. Each equals the 7bd3d51 capture plus only the listed cdl-2 entries (`checkExpected` → `[]`, EXECUTED). No identity row compares catalog bodies, so those slices were not required to refresh them |

No assertion of an earlier slice was relaxed: `cm1-identity-commerce` and `cm1-identity-content` compare with the same
CM1-A1 canonicalisations; `cm1-control` reads `control-de4ad52/`, which is unchanged; `cm1-rewire` is unchanged; no
earlier slice's `before/`, `expected-diff.json` or `ro-expected.json` was edited (`git status`: under `cm1-byte-identity/` only
`baseline/` and the README's history line; under `locale-1/` only `proof.mjs` and the new `cdl-2/`).

## 9. Admin Settings markup

The `__markup__` captures are not re-taken. `Settings.test.ts` `withoutCdl2` removes exactly the new field's markup
(label, input class, placeholder `/confirmation`, value = the tenant's stored segment), which must occur once and
directly after the Checkout field's closing tag; then the page must equal the capture as before. Controls: without the
removal the comparison fails; a moved, doubled or changed field is refused.

The save path (iteration 2, review-0 CDL2-R3), headless, no DOM and no new dependency: the file's existing test-only
state seed (its mocked `useState`) also records, when `seed.capture` is set, every `setConfig` argument; pass-through
wrappers of `Input` and `Button` record their props and render the real component, so the byte-equal markup rows still
pass unchanged; `apiRequest` is mocked. The test calls the Confirmation field's real `onChange` (`updateUrlPrefix`),
applies the recorded updater to the seeded state as React would (react-dom/server ignores a set after the render),
renders the page with that state, presses the real Save button (`save()` → `withContactForSave(config)`) and reads the
`PUT /settings` body: `urlPrefixes` = the stored prefixes with `checkoutConfirmation: "/multumim"`. Control in the same
test: the Checkout field's `onChange` writes `checkout`, not the new key. No production code changed for the test.

Decisions taken locally (one line each; implied by the packet, not new choices):
- Refusal message form: `Slug "<slug>" uses the address "<prefix>" of the built-in <page>. Choose a different slug, or
  change that address in Settings.` The packet's example says "is the address of"; "uses the address" also reads true
  for a slug under the address (`/product/x`), which the unchanged match rule refuses. Page names: product pages,
  category pages, cart page, checkout page, order confirmation page, order tracking page, shop page, account page,
  search page, interest list page (the last two checkout names since iteration 2, CDL2-R2: they are the pages the
  renderer shows under the checkout address).
- Field label "Confirmation (after Checkout)": it says the value is appended to the checkout path.
- The moved address in the serving proof is one named rule (`preCdl2Address`) recorded per capture as
  `requestedPath`, not a rewrite of another slice's records.
- The partial-prefix fixture has a `locale`, so it joins no `before/` (the CT1 / BPF1 precedent).

## 10. Allocation additions

None. `backend/src/tenant/create.ts` needed no change (schema default, § 3). One allocated test path outside the
packet's step list was moved: `renderer/test/interest-e2e/interest.spec.mjs` (3 addresses, § 4 (b)).

## 11. Gates (each run bare; exit code printed by `echo $?`; EXECUTED on the final tree, iteration 2)

| # | Command | Expected | Actual |
|---|---|---|---|
| 1 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run build; echo $?` | 0 | 0 |
| 2 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run typecheck; echo $?` | 0 | 0 |
| 3 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/shared" && npm test; echo $?` | 0 | 0 — 16 files, 308 tests |
| 4 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend" && npm run test:unit; echo $?` | 0 | 0 — 49 files (+1 skipped), 1332 tests |
| 5 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm test; echo $?` | 0 | 0 — 30 files, 447 tests |
| 6 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving; echo $?` | 0 | 0 — 109 / 109, `cdl2-partial-prefixes` included |
| 7 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/admin" && npm run test:unit; echo $?` | 0 | 0 — 12 files, 262 tests |
| 8 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/plugins" && npm test; echo $?` | 0 | 0 — 6 files, 204 tests |
| 9 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/tools/mcp-server" && npm test; echo $?` | 0 | 0 — 15 pass |
| 10 | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check; echo $?` | 0 | 0 |
| 11 | literal searches (below) | as ruled | as ruled |
| 12 | `git diff --name-only` holds none of the five commerce components | none | none |

Logs: `.agent-manager/slices/CDL-2/it1-g1.log` … `it1-g9.log` (gitignored).

Gate 10 and whitespace (corrected in iteration 2, review-0 CDL2-R4 item 3): `git diff --check` covers tracked files only.
The new untracked SOURCE files (tests, `expected-diff.json`, `ro-expected.json`, this record) have no line that ends in
whitespace (EXECUTED, `grep -cE '[[:space:]]+$'` per file: 0). The new captured `.body` files are wire bytes — the
renderer's HTML as served — and 119 of the 151 hold lines that end in whitespace (1,309 lines, EXECUTED; e.g.
`locale-1/cdl-2/before/catalog/about.body:19`). They are not trimmed: a capture is immutable evidence, and trimming
would change the bytes the comparison rows read. Iteration 1's claim "untracked new files: no trailing whitespace" was
wrong: its check had left the captures out without saying so.

Gate 11 in its ruled form (EXECUTED, `grep -rn` over `renderer/src`, `packages/shared/src`, `backend/src`,
`admin/src`):
- `"/magazin"`, `"/produs"`, `"/comanda"`, `"/cos"` outside comments and tests: no hit. Inside tests only:
  `admin/src/components/glamPreview.test.ts`, `admin/src/pages/Settings.test.ts` and the two `__markup__` captures (tenant
  data, admin-english-2's placeholder replacements, and one control value of the new save test).
- `lista-mea`: no hit (the stale comment at `SitePage.tsx:235` is corrected).
- `confirmare`: only `packages/shared/src/language-packs/ro.ts:168` (a visitor sentence).

Cycle check (ruling CDL2-SHARED-DAG, EXECUTED `grep -n "^import\|from \"./" packages/shared/src/catalog-listing.ts`):
no import line at all in `catalog-listing.ts`; `index.ts:44-46` re-exports `utcDay`, `isProductAvailable`,
`catalogListing`, `CatalogListingItem` from `./catalog-listing.js`. So the edge is one way, `index.ts` →
`catalog-listing.ts`, and no cycle remains between the two files.

MCP: no tool text or shape names the URL prefixes (`grep -rni "prefix\|lista\|confirm" tools/mcp-server/src`,
EXECUTED in iteration 1; no MCP file changed since); no backend route changed, so `routes.json` is not refreshed.

## 12. Review-0 and the operator rulings (iteration 2)

| Finding / ruling | Class of defect | Rule that closes the class | Where |
|---|---|---|---|
| CDL2-R1 / CDL2-SHARED-DAG — `catalog-listing.ts` imported `index.ts`, which re-exports it | a module that `index.ts` re-exports depends back on `index.ts` | a module re-exported by `index.ts` imports nothing from `index.ts`; a function that needs a constant of `index.ts` lives in `index.ts` | § 3, § 11 cycle check; the "safe" disposition of iteration 1 is withdrawn |
| CDL2-R2 — the refusal could name the wrong page on overlapping addresses | a first match over an order that is not the renderer's | the page named is the page the renderer shows at the slug (`builtInPageAt`, the renderer's precedence); where it shows content, the first reserved address in that precedence. The refusal rule (equal, or under) is unchanged; no prefix validation added | `slug-guard.ts`; 15-row table in the backend test, the same 15 rows through `SitePage` in the renderer test; mutation EXECUTED (§ 5) |
| CDL2-R3 — the save obligation had no executed test | a taxonomy row bound to code inspection only | a row that says "saved" is bound to a test that runs the real handler and reads the request it sends | `Settings.test.ts`, § 9; mutation EXECUTED (§ 5) |
| CDL2-R4.1 — "`/my-list` was hidden before" | a before-statement about an address that was free | — | § 13 corrected: `/my-list` was an ordinary content address before |
| CDL2-R4.2 — `revalidate.ts:166-175` missing from the inventory | — | — | § 4 (a): `revalidate.ts:168-176`, unchanged and why |
| CDL2-R4.3 — whitespace claim | a check scoped smaller than its claim | the claim names its scope; captures are wire bytes and stay untrimmed | § 11 |
| Human ruling on the commerce freeze | — | — | rows 18-19 removed (§ 3), zero new serving differences; F-CDL-DEAD-FALLBACKS closed |
| Operator record item — `baseline/` refresh | — | — | § 8.4 |

## 13. What the owner sees at a reserved address (before → after)

INFERRED from the code and the unit tests (the admin shows the API's `error` text; not run in a browser).
- Catalog site that stores no interest address, page slug `/my-list`: before — accepted and shown: `/my-list` was an
  ordinary content address (the list page was at `/lista-mea`, and a page saved at `/lista-mea` was accepted and then
  hidden by the list). After — refused: `Slug "/my-list" uses the address "/my-list" of the built-in interest list
  page. Choose a different slug, or change that address in Settings.` A page at `/lista-mea` is now accepted and shown.
- Any site, `/search` or `/account`: before — accepted, then hidden (the search page; the account page, or "not found"
  on a site without commerce). After — refused; the message names the search page or the account page.
- Any site, `/shop` (likewise product, category, cart, checkout): before — `Slug "/shop" conflicts with commerce URL
  prefix "/shop". Choose a different slug.` After — `Slug "/shop" uses the address "/shop" of the built-in shop page.
  Choose a different slug, or change that address in Settings.` Under the checkout address the message names the order
  confirmation page (`/checkout/confirmation`) or the order tracking page (`/checkout/<anything else>`).
- With overlapping saved addresses the message names the page the renderer shows at the slug (for example a catalog
  whose interest address is `/shop`: "interest list page").
- The check runs on create and on a slug change (callers unchanged). Pages already stored at a now-reserved address are
  not flagged (F-CDL2-EXISTING-PAGES).

What changes for a site that stores no path settings: a catalog site's interest list moves to `/my-list` and its header
links follow; a content page at `/lista-mea` becomes reachable. A commerce site's order confirmation moves to
`/checkout/confirmation` (§ 7). On both, new pages at `/search` and `/account` are refused. A site whose stored object
is partial or holds `""` routes every built-in page at the default address again — for a commerce site that includes
the cart, checkout, confirmation and tracking pages and the shop links on them (ruled, design § 9 item 5).

Not run: `renderer/test/interest-e2e` (browser suite; not an oracle of this packet; the `cat-variant-gallery-1` record
F-9 states that 3 rows of `interest.spec.mjs` fail on a clean `27fa7ca`). Its three addresses were moved (§ 4 (b)).
Staging evidence (design § 8.4 `cdl-2`): operator, after review.

## 14. Findings

- **F-CDL2-GUARD-NAME** (name ≠ contract, introduced by the ruled behaviour): `checkSlugCommerceConflict` now reserves
  search, account and the interest list too. Proposed name `checkSlugReservedAddress`. Touches
  `backend/src/content/create.ts:10`, `:62`, `content/update.ts:9`, `:99` and the mocks in
  `backend/test/unit/{content-create-contract,content-update-contract,bulk-purge}.test.ts` — outside this slice's
  allocation, so not applied; the function's header states the real contract and the mismatch.
- **F-CDL2-ROUTE-ORDER-COPY** (new, iteration 2): `slug-guard.ts` `builtInPageAt` copies the renderer's route
  precedence. Drift is caught only where the two 15-row tables cover it, and only if both tables are kept equal by
  hand. A shared "built-in page at this path" function in `@amodx/shared`, used by `matchCommercePrefix` and the slug
  check, would remove the copy; it reworks `matchCommercePrefix` (packet § 3), so it is proposed, not done.
- **F-CDL2-CARD-LINKS** (packet correction): the taxonomy says "header and card links point there". Only the header
  widget links to the interest list; cards carry the toggle, which links nowhere (§ 2).
- **F-CDL2-EXISTING-PAGES**: content pages stored before this slice at `/search`, `/account` or (catalog) `/my-list` stay
  hidden and are not reported; finding them needs a per-tenant query of `ROUTE#` items. Design E21: no `ROUTE#/my-list`
  on either staging catalog tenant; `/search` and `/account` not determined.
- **F-CDL2-SEGMENT-SLASH**: a segment stored without a leading slash (`multumim`) makes `/checkoutmultumim`, as a
  prefix without a slash already breaks the other routes. Prefix validation is non-scope (packet § 8).
- Closed in iteration 2: F-CDL2-SHARED-CYCLE (ruling CDL2-SHARED-DAG), F-CDL2-STALE-COMMENT (`SitePage.tsx:235`),
  F-CDL-DEAD-FALLBACKS (design § 12; rows 18-19 removed).

## 15. What could not be determined

- Whether any staging or prod tenant stores a content page at `/search` or `/account` (no AWS call, by the packet).
- The admin's rendering of the refusal message in a browser (§ 13 is INFERRED).
- The end-to-end browser suite after the address move (NOT RUN, § 13).

## 16. Operator closeout


Operator, 2026-11-15. Review-1 approved. Builder `claude-opus-5-5`, two cycles. Review-0: `gpt-6.1-sol` (escalate,
four findings). Review-1: `claude-sonnet-5-5`, the fallback reviewer the human named for a GPT outage (the Codex
reviewer hit its usage limit after four attempts). Review-1 is the same provider family as the builder; it is less
independent than review-0.

**Gates (operator run on the approved tree).** build 0, typecheck 0, shared 0, plugins 0, renderer 0, serving 0, admin
unit 0, backend unit 0, mcp 0, `git diff --check` 0. Oracles: no change under `infra/`, any `package.json`, the
control capture set or the five commerce components; every changed path is in the allocation; `"/magazin"`,
`"/produs"`, `"/comanda"`, `"/cos"`, `lista-mea`, `/confirmare` have no hit in non-test source under `renderer/src`,
`packages/shared/src`, `backend/src`, `admin/src`; `catalog-listing.ts` has no import line; no earlier slice's
capture under `locale-1/` changed; no trailing whitespace in the new source files (captured `.body` files are wire
bytes and are not checked).

**Staging.** `cdk diff`: code and asset hashes only; no resource added or removed, no permission change. Deployed
to `AmodxStack-staging`. Evidence by script against the deployed site and API:

| Check | Result |
|---|---|
| `cm1-catalog` and `glam-staging` (catalog, no stored `urlPrefixes`) | `/my-list` answers 200 with the interest page; `/lista-mea` answers 404; the shop page's header links point to `/my-list` and none to `/lista-mea`. |
| Slug check, refusals | `/my-list` on `cm1-catalog` names the interest list page; `/account` on `cm1-catalog` the account page; `/search` on `cm1-content` the search page; `/checkout/confirmation` on `cm1-commerce` the order confirmation page; `/shop` on `cm1-catalog` the shop page. Each answer is 400 with the ratified message form. |
| `cm1-commerce` (no stored `urlPrefixes`) | `/checkout/confirmation` answers 200; the checkout page carries that address and no `confirmare`; `/cart` answers 200. |

The partial-prefix tenant of design § 8.4 is covered by the serving-contract row `cdl2-partial-prefixes` (gate
"serving"), not on staging: no staging tenant stores a partial object.

Not checked on staging: a content slug that must be ACCEPTED (for example `/my-list` on a commerce site), because an
accepted request writes a page; the unit tests bind it. The Settings field in a browser. An order placed to the end,
to see the redirect to the confirmation page.

Follow-ups recorded, not done: rename `checkSlugCommerceConflict` (it now reserves more than commerce addresses; its
callers were outside the allocation); pages already saved at a newly reserved address are not reported.
