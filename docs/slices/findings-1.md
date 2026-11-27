# findings-1 — close five recorded findings

Status: **built, operator gates pending** (builder 2026-11-27, base `main` at `0c5ff63`; not committed). Maturity:
each part is a direct change at the site of the defect; no new module, package or layer.

## Purpose

Each part removes a way for a private value to leave by default (VISION guarantee 2: the public side never becomes
the authority for private data), or a wasted or stale answer. No visitor sees a change. No live site has a product
today, so no stored item needs a migration. No `infra/` change.

| Part | Finding | Source record |
|---|---|---|
| 1 | F-DFG1-PUBLIC-GET-DENYLIST | `docs/slices/digital-file-guard-1.md` § 5 |
| 2 | F-DFG1-SERVICE-KEY | `docs/slices/digital-file-guard-1.md` § 4 row 22, § 5 |
| 3 | F-DFG1-RENDERER-WHOLE-ITEM | `docs/slices/digital-file-guard-1.md` § 5 |
| 4 | F-ADMIN-FIRST-LOAD-400 | `docs/slices/sched-appt-fixes-1.md` |
| 5 | F-PREVIEW-SITEMAP-EDGE | `docs/slices/lang-1.md` Appendix (lang-1c closeout) |

(The packet title says "four findings"; it lists five parts with five finding ids. All five are built.)

## Part 1 — the public product answer is a fixed list of fields

**Cause.** `backend/src/products/public-get.ts:42` (base) answered `const { resourceId, ...publicProduct } = product`:
the stored item minus one field. Any other attribute (storage keys, importer bookkeeping, a field a later write adds)
left by default.

**Change.** `public-get.ts:11` `PUBLIC_PRODUCT_FIELDS` (29 names); `public-get.ts:55-58` copies each listed field the
item holds (`Object.hasOwn`), nothing else. A listed field the item does not hold is not added. Tenant check, status
and availability checks (404) are unchanged.

**The list** — the union of (a) the fields `public-list.ts` answers (its `ProjectionExpression`, `public-list.ts:49-50`,
and the `CATPROD#` items of `buildCatProdItem`, `backend/src/lib/catprod.ts:31`) and (b) the `ProductSchema` fields
(`packages/shared/src/index.ts:1661`) that the renderer's product pages, their JSON-LD and the product feed show:

| Field | Why it is public |
|---|---|
| `id` | (a); (b) JSON-LD `sku` and URL of the legacy page (`ProductByIdPage.tsx:78,86`), interest toggle |
| `status` | (a) `CATPROD#` items carry it; the route answers only `active` |
| `title` | (a); (b) page heading, metadata, JSON-LD `name`, feed |
| `slug` | (a); (b) product URL, feed `link` |
| `sku` | (a) (search projection) |
| `description` | (a) (search projection); (b) page, metadata, JSON-LD, feed |
| `longDescription` | (b) product page body (`SitePage.tsx` ProductPageView) |
| `price`, `currency`, `salePrice` | (a); (b) page, JSON-LD `offers`, feed |
| `volumePricing` | (a); (b) page price tiers, add-to-cart |
| `availability` | (a); (b) page, JSON-LD `offers.availability`, feed |
| `availableFrom`, `availableUntil` | (a) (projected for the availability rule) |
| `brand` | (b) legacy page JSON-LD `brand` (`ProductByIdPage.tsx:81`), feed `brand` |
| `condition` | (b) legacy page JSON-LD `itemCondition` (`ProductByIdPage.tsx:90`), feed `condition` |
| `categoryIds` | (a); (b) breadcrumbs / category paths (`SitePage.tsx` product branch) |
| `tags` | (a); (b) product page |
| `attributes` | (b) catalog product page `ProductAttributes` |
| `personalizations` | (b) add-to-cart personalization inputs |
| `variants` | (b) variant selector, catalog variant presenter, gallery options |
| `ingredients`, `nutritionalValues` | (b) product page tabs |
| `imageLink`, `additionalImageLinks` | (a) `imageLink`; (b) gallery, metadata `og:image`, JSON-LD `image`, feed |
| `paymentLinkId` | (b) written into the page HTML as `data-product` of the Paddle button (`SitePage.tsx:1397`, `ProductByIdPage.tsx:141`) |
| `seoTitle`, `seoDescription` | (b) page `<title>` and meta description (`SitePage.tsx:277-278`) |
| `sortOrder` | (a) |

Out (no longer answered): `resourceId`; `PK`, `SK`, `TenantSlug`, `Type`, `tenantId`; `importSource`, `importLabels`,
`importProfileRevision`, `facetModes`; every attribute that is not in `ProductSchema`; and `ProductSchema` fields in
neither (a) nor (b): `productType`, `link`, `category`, `inventoryQuantity`, `weight`, `createdAt`, `updatedAt`.

**Caller search (stop condition: a caller that reads a removed field).** Command, from the repo root:
`grep -rnE "public/products" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.json'
--include='*.py' --include='*.sh' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next
--exclude-dir=.open-next --exclude-dir=cdk.out --exclude-dir=.agent-manager .` Result: no runtime caller of
`/public/products/{slug}`. Matches: `renderer/src/components/SearchBar.tsx:78` (the LIST route), `infra/lib/api-commerce.ts:207-208`
and `infra/lib/api.ts:607` (route declarations / comment), `tools/mcp-server/routes.json:79-80` (route inventory; no
MCP tool calls it), `backend/src/tenant/settings.ts:27` (comment), and three backend unit tests. Basis: a text search;
a caller that builds the path from parts (e.g. `"public/" + "products"`) would not be found. None was seen in the files
read. Stop condition not met.

**Tests.** `backend/test/unit/findings-1.test.ts` Part 1 (5 tests: private fields absent; listed fields unchanged and
nothing else; absent listed field not added; draft → 404; unavailable → 404). Two existing tests asserted the old
contract (whole item minus `resourceId`) and were changed to the new one: `digital-file-guard-1.test.ts` G2 (title
"… the other stored fields are unchanged" → "… its public fields are unchanged"), `settings-keys-1b.test.ts` (g).

## Part 2 — a service key does not receive the private file id

**Cause.** `backend/src/products/list.ts:56` projects `resourceId` and answers it to every caller admitted by
`requireRole(…, "catalog:read")` (`list.ts:17`), which includes a SERVICE key (`backend/src/auth/policy.ts:16`).

**How the handler knows the caller kind (verified on the code).** The authorizer returns `role: "SERVICE"` as a string
literal only on its service-key branch (`backend/src/auth/authorizer.ts:215`); the master key is `GLOBAL_ADMIN`
(`authorizer.ts:138`), the renderer key `RENDERER` (`:147`), Cognito users take `custom:role` (`:263`).
`requireRole` already branches on `auth.role === 'SERVICE'` (`policy.ts:42`). The handler reads the same context
(`event.requestContext.authorizer.lambda`, `list.ts:15`). No authorizer or infra change.

**Change.** `list.ts:67-74`: for `auth.role === "SERVICE"` each item is answered without `resourceId`; every other
caller gets the list unchanged (the admin page `admin/src/pages/DigitalProducts.tsx:121` reads it).

**`GET /products/{id}`.** A service key never gets an answer there: the authorizer refuses it (route absent from
`SERVICE_ROUTE_SCOPES`, `policy.ts:15-20`), and `requireRole` in `get.ts:22` refuses it (no `serviceScope`). No code
change; a test pins it.

**MCP server.** `tools/mcp-server/src/index.ts:1092` (`list_products`), `:1155` (`get_product`), `:1183-1184`
(`update_product`: GET then PUT `{...current.data, ...patch}`) call these routes with the master key
(`getHeaders`, `index.ts:55-65`) → `GLOBAL_ADMIN`, so their answers are unchanged. `update_product` is a reason to
remove `resourceId` only for a service key: removed for every caller, the merge-and-PUT would drop the stored link on
the next update. Other MCP `resourceId` uses are writes (`tool-shapes.ts:28`, product create body) or the upload
route answer (`index.ts:1882`), not reads from these routes.

**Tests.** `findings-1.test.ts` Part 2: TENANT_ADMIN → list unchanged with `resourceId`; GLOBAL_ADMIN → present;
SERVICE → absent, every other field unchanged; `GET /products/{id}` SERVICE → not 200, no DB read; TENANT_ADMIN → present.

## Part 3 — the renderer does not carry the private file id

**Cause.** `renderer/src/lib/dynamo.ts:252,269` (base) returned the whole item; `getProductBySlug` accepted any index
hit whose `SK` starts with `PRODUCT#`, without the `PK` check the backend route has (SETTINGS-KEYS-1B).

**Change.** `dynamo.ts:256` `withoutPrivateFile` drops `resourceId` after the read; used at `:275` (`getProductById`)
and `:294` (`getProductBySlug`). `:291`: `item.PK === TENANT#<tenantId> && SK startsWith PRODUCT#`. No
`ProjectionExpression` (the smaller change; no field list to prove). No renderer code reads `product.resourceId`
(grep `resourceId` in `renderer/src`: only the booking feed's own path parameter, a different value).

**Serving outcome.** Every product item of the serving stub is built at `renderer/test/serving-contract/fixtures.mjs:232`
with `PK: TENANT#<tenantId>`; `test:serving` 174/174 and `test:serving-bundle` 61/61 pass with no baseline changed.

**Tests.** `renderer/test/unit/findings-1-product-read.test.ts` (6): both reads drop `resourceId`, other fields equal;
a hit from another partition → null; a foreign hit before the own one → the own one; no item / unavailable → null.

## Part 4 — the admin does not send two requests without a site

**Cause.** `admin/src/App.tsx:81-84` mounts `TenantProvider` and `AdminLayout` together. The site is selected, and
`AMODX_TENANT_ID` written to localStorage, only after `GET /tenants` answers (`admin/src/context/TenantContext.tsx:32-48`).
Meanwhile two mount effects run with no site condition:
- `admin/src/components/layout/AdminLayout.tsx:85-86` (base) calls `fetchLinks()` → `apiRequest("/content")` (`:35`);
- `admin/src/components/InvalidationBanner.tsx:69-71` (base) polls `apiRequest("/system/invalidation")` for every
  GLOBAL_ADMIN.

`apiRequest` sets `x-tenant-id` only from localStorage (`admin/src/lib/api.ts:34,46`); in a new browser it is empty,
so the backend answers 400 (`backend/src/system/invalidation.ts:43`, and the content list). A second effect of the
same cause: `fetchLinks` depended only on `commerceEnabled` / `catalogMode` (`AdminLayout.tsx:82` base), so after the
selection the link list reloaded only when one of those changed from `undefined`.

**Change.** Both call sites depend on the selected site id (`currentTenant?.id`): `AdminLayout.tsx:33-35,87`
(`fetchLinks` returns without a request when no site is selected; the id is a dependency, so the links load once the
site is selected) and `InvalidationBanner.tsx:47,73,79` (no poll without a site). The backend answer is unchanged;
no error is hidden.

**Tests.** `admin/src/components/findings-1-site-requests.test.ts` (6): per call site, no site → no request; site → one
request; no site then site → one request after the selection.

## Part 5 — the sitemap of a site addressed by id

**Code.** Purge list: `backend/src/content/update.ts:234` (`setPurgeSlugs` returns `[...siblings, ...root,
"/sitemap.xml"]`, also used by `content/create.ts:168`), enqueued to the fast lane by
`backend/src/lib/invalidate-cdn.ts` `enqueueEdgeInvalidation` (host-agnostic URI paths, `:160-164`). Cache header:
`renderer/src/app/[siteId]/sitemap.xml/route.ts:107` (base `:98-101`, `public, s-maxage=3600, stale-while-revalidate=59`).

**Choice: option (b), the by-id answers are not kept at the edge.** (b) changes one header for the by-id form and adds
zero invalidation paths. (a) would add two paths to every change that names the sitemap and needs the preview paths to
bypass the ISR lane (`revalidate-paths.ts` builds domain keys only). No CDK change: the renderer cache policy has
`minTtl: 0` (`infra/lib/renderer-hosting.ts:499`, "a `no-store` origin response is not stored"; read, not changed).

**How the route knows the address form (revision 1).** The middleware rewrites the domain form to
`/<host>/sitemap.xml` (`renderer/middleware.ts:463-466`) and both by-id forms to `/<tenantId>/sitemap.xml`
(`byIdTarget`, `:208`). When a tenant's id equals its domain — valid: `TenantConfigSchema` allows it and
`tenant/create.ts:30` accepts a supplied id — `[siteId]` is the same string for all three requests, so no rule over
`siteId`, `config.id` and `config.domain` can tell them apart (review-0 R1; the iteration-0 rule
`siteId === config.id && siteId !== config.domain` kept the one-hour header on both by-id forms in that case).

Rule: **the address form comes only from the middleware**, the one component that decides it.
- `SITEMAP_BY_ID_HEADER` = `x-amodx-sitemap-by-id` (`renderer/src/lib/site-segment.ts:36`, the module that already
  holds the middleware→`[siteId]` contract; edge-safe, no import added).
- `sitemapFormHeaders(request, byIdSitemap)` (`middleware.ts:218`): on a by-id request for the root `/sitemap.xml`
  (`restOfPath === '/sitemap.xml'`, the only by-id path `byIdTarget` sends to the handler) the forwarded request carries
  the header `"1"` (`/tenant/` `:382`, `/_site/` `:404`); on the domain branch a viewer-sent copy is deleted (`:467`).
  When neither applies it returns `undefined` and the rewrite is the call of before (`:475`), so every other request is
  forwarded exactly as before.
- The route sets `private, no-store` when the header is `"1"` (`route.ts:102,107`).

**Own-domain sites byte for byte.** Header and bytes pinned by the existing rows `lang1c-sitemap` and
`lang1c-sitemap-identity` (50+ fixture tenants), both pass; the new row adds a tenant whose id equals its domain and a
domain request that carries a viewer-sent copy of the header. Purge list unchanged.

**Limit.** The middleware matcher (`middleware.ts:511`) skips paths that start with `api`; a request such as
`/api.x/sitemap.xml` reaches the handler without the middleware, so a viewer-sent header is not removed there and that
answer is `no-store`. It is not a tenant's public sitemap address, and `no-store` only makes that answer uncached.

**Tests.** Serving row `(findings1-preview-sitemap)` (`renderer/test/serving-contract/contract.test.mjs:831`), for two
tenants — the fixture tenant (id ≠ domain) and `findings1-equal.serving-contract.test` (id = domain, added in the row
with the stub's `putItem`; no other row reads that id or host):
- domain `/sitemap.xml` → 200, `public, s-maxage=3600, stale-while-revalidate=59`;
- domain `/sitemap.xml` with a viewer-sent `x-amodx-sitemap-by-id: 1` → the same header and bytes;
- `/_site/<id>/sitemap.xml` and `/tenant/<id>/sitemap.xml` on a preview host → 200, `private, no-store`, the domain's
  content-type and bytes.

Test rule (review-0): every supported by-id form and the domain form, for distinct AND equal id/domain. Bundle
expectation entry `{ "4": SAME }` (`contract.test.mjs:105`; only open-next 4 was run).

## Abstractions introduced

- `PUBLIC_PRODUCT_FIELDS` (const, `public-get.ts`) — users: `public-get.ts` handler; axis: none (it is the contract
  data of one route); rejected: inline object literal of 29 `product.x` lines (same list, harder to review).
- `withoutPrivateFile` (local function, `renderer/src/lib/dynamo.ts`) — users: `getProductById`, `getProductBySlug`;
  axis: none (one rule, two callers); rejected: the same destructure written twice.
- `SITEMAP_BY_ID_HEADER` (const, `renderer/src/lib/site-segment.ts`) — users: `middleware.ts` (sets / removes) and the
  sitemap route (reads); axis: none (one fact crossing the middleware→route boundary); rejected: a header string written
  twice, and any rule over identifier values (fails for id = domain).
- `sitemapFormHeaders` (local function, `middleware.ts`) — users: the `/tenant/`, `/_site/` and domain branches; axis:
  none; rejected: the same set/delete written at three rewrite sites.

## Revisions

- **Revision 1 (review-0 R1).** Defect class: the route inferred the request's address form from identifier values,
  which coincide when a tenant's id equals its domain. Closed by one rule: the form is stated by the middleware
  (`SITEMAP_BY_ID_HEADER`) and the route reads only that. Files: `renderer/middleware.ts`,
  `renderer/src/lib/site-segment.ts`, `renderer/src/app/[siteId]/sitemap.xml/route.ts`, the serving row, this record,
  `docs/caching-architecture.md`, `renderer/ARCHITECTURE.md`. Parts 1–4 unchanged.

## Evidence (builder, 2026-11-27; gates re-run after revision 1)

All EXECUTED in the working tree after the last code change, unless marked.

| Gate | Command | Result |
|---|---|---|
| Build | `npm run build` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Backend unit | `npm --prefix backend run test:unit` | 82 files passed, 1 skipped (`cat-import-profile-1-golden.capture.test.ts`, a capture script, skipped by design); 2069 tests passed |
| Admin unit | `cd admin && npm run test:unit` | 24 files, 414 tests passed |
| Renderer unit | `cd renderer && npm test` | 61 files, 929 tests passed |
| Serving | `cd renderer && npm run test:serving` | 174/174 pass |
| Serving bundle | `cd renderer && npm run test:serving-bundle` | 61/61 pass (the packet's `test:serving:bundle` is this script) |
| MCP | `cd tools/mcp-server && npm test` | 17/17 pass; no backend route changed, `routes.json` not refreshed |
| Whitespace | `git diff --check` | exit 0 |
| Tests detect the defects | the three new unit files run against `HEAD` in a temporary worktree `/tmp/FINDINGS-1-base` (removed; iteration 0) | backend 4 fail / 6 pass, admin 4 fail / 2 pass, renderer 4 fail / 2 pass — every failing test is a defect test; every "as before" test passes on the base |
| Serving row detects the iteration-0 rule | the candidate with the iteration-0 route rule, `test:serving` in a temporary worktree `/tmp/FINDINGS-1-r1-old` (removed) | **execution-failed**: Turbopack refused the symlinked `node_modules` outside the worktree root (harness `next build`); no row ran. Evidence that the old rule fails the equal case is review-0's EXECUTED table; the row asserts exactly that case |

## Not verified

- NOT RUN: staging. The operator deploys and checks: in a new browser, sign-in → no 400 for `/content` or
  `/system/invalidation` in the network panel; `/_site/<id>/sitemap.xml` through CloudFront answers `private, no-store`
  and a page change shows on the next request; a service key's `GET /products` has no `resourceId`;
  `GET /public/products/<slug>` of a test product has none of the out fields.
- NOT RUN: `cd backend && npm test` (live staging; forbidden by the packet).
- INFERRED: CloudFront does not store a `no-store` answer under `minTtl: 0` (CDK comment and AWS behaviour; the bundle
  suite's emulated edge passes, a real distribution was not exercised).
- The caller search of Part 1 is a text search (basis above), not a compiler query.
- OBSERVED on the two local targets only (`next start`, the OpenNext bundle behind the suite's emulated edge): the
  middleware's request-header override reaches the route handler. A real Lambda@CloudFront path was not exercised.

## Observations (not changed; outside this slice)

- `backend/src/products/get.ts:22`: `requireRole` throws inside the outer `try`, so a refused caller gets **500** with
  the refusal message, not 403 (`list.ts` maps it to 403). No data leaves.
- `renderer/src/lib/dynamo.ts:48` imports `ScanCommand`; it is not used (no scan runs). Dead import.
- `docs/commerce.md:854` names the route `/public/products/{id}`; the route is `/public/products/{slug}`
  (`infra/lib/api-commerce.ts:208`). Doc name mismatch; proposed fix: rename in the doc.
- `openai-feed` by id (`/_site/<id>/openai-feed`) answers `public, s-maxage=900` (`openai-feed/route.ts:46`), the same
  shape of edge staleness as F-PREVIEW-SITEMAP-EDGE, bounded at 15 minutes.

## Operator closeout 2026-11-27 — SHIPPED on staging; production deploy pending

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, two cycles, approved. Review-0 asked for one change (the sitemap
rule failed for a tenant whose id equals its domain); corrected in revision 1.

Operator-executed on the final tree:

| Check | Result |
|---|---|
| Gates: build, typecheck, shared, plugins, renderer unit, serving, serving bundle, admin unit, backend unit, infra, MCP, `git diff --check` | every exit 0; no serving baseline moved; no `infra/` path changed |
| Staging diff, read before the deploy | code only: `ListProductsFunc`, `PublicGetProductFunc`, the renderer functions and assets, the admin assets |
| Part 1 on staging (a digital product made on `cm1-commerce`, then deleted) | the public answer holds 19 keys, all on the list; no storage key, no `resourceId`, no bookkeeping field |
| Part 2 on staging | an admin session still receives `resourceId` in `GET /products` |
| Part 3 on staging | the product page renders with the title; its bytes do not hold the file id |
| Part 4 on staging (new browser, sign-in) | no API answer of 400 or above; no `/content` or `/system/invalidation` request without a site; with a site, both are sent for that site and answer 200 |
| Part 5 on staging, real CloudFront | `/_site/<id>/sitemap.xml` and `/tenant/<id>/sitemap.xml`: `private, no-store`, `Miss from cloudfront` twice in a row, and the product made seconds before is listed. This also shows the middleware's header reaches the route on the deployed Lambda |

Not verified on staging: the service-key side of Part 2 (no service key was used; unit tests cover it) and the
own-domain sitemap header (the staging distribution has no tenant domain; the serving suites cover it).
The four items under "Observations" stay open; none lets data leave.
