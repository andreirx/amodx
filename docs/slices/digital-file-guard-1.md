# DIGITAL-FILE-GUARD-1 — a paid digital product's private file cannot be obtained through the lead form

- **Status:** BUILT 2026-11-26 (working tree, not committed). Staging deploy and staging probe: operator (§ 7).
- **Track:** Courses, payments and growth (security fix; same class as `paddle-hook-1`).
- **Source:** operator selection packet DIGITAL-FILE-GUARD-1, 2026-11-26.
- **Maturity:** PROTOTYPE, unchanged. The lead route and the public product route keep their maturity; this slice
  closes one disclosure path and does not qualify either route for production.
- **Infra / data shape:** none. `CreateLeadFunc` already has `grantReadData` (`infra/lib/api.ts:534`), and the CDK
  read grant includes `dynamodb:Query` (OBSERVED: `node_modules/aws-cdk-lib/aws-dynamodb/lib/perms.js`
  `READ_DATA_ACTIONS`). No stored item changes.

## 1. The defect

Two facts gave a free download of a paid file:

1. **EXECUTED on staging (operator):** `GET /public/products/{slug}`, with no credentials, answered the whole stored
   product item (`backend/src/products/public-get.ts`: no projection, `JSON.stringify(product)`), including
   `resourceId` — the id of the product's private file in the private bucket.
2. **OBSERVED in code:** the site proxy `renderer/src/app/api/leads/route.ts` forwards the visitor's body (`...body`)
   with the renderer key. `backend/src/leads/create.ts` then signed a 15-minute link for any `RESOURCE#<resourceId>`
   of the tenant. The only conditions were the first-party origin and reCAPTCHA. Nothing checked that the resource
   is a free lead magnet.

So a visitor could read a digital product's `resourceId` and post it to `/api/leads` with any email address.

This supports `docs/VISION.md` guarantee 2: public/private trust boundaries are a product guarantee. A file that a
tenant sells is private data; the public surface must not hand it out.

## 2. The rule (operator decision, recorded)

**A resource that ANY product of the tenant references through `resourceId` is not a lead magnet.** The product's
status does not matter (active, draft, archived). For such a resource `POST /leads` still stores the lead and
answers 201, with no `downloadUrl`, and writes one warning log line with the tenant id and the resource id only
(no email). A resource that no product references behaves as before.

**Fail closed:** if the product lookup fails, there is no link.

## 3. G1 — the lead route

### Implementation

- `backend/src/lib/resource-products.ts` — `productIdsReferencingResource(tenantId, resourceId)`: the ids of every
  product of the tenant whose `resourceId` is that resource. It is the query that `resources/presign.ts` had as the
  local `getProductsForResource`, moved, renamed to say what it returns (ids, not products), and changed in one way:
  it now follows `LastEvaluatedKey` to the end. Before, it read one page only (≤ 1 MB of the tenant's products), so a
  referencing product past that page was not found. For the lead route that would fail OPEN (link signed); "any
  product" needs every page.
- Every page of that query is a strongly consistent read (`ConsistentRead: true`) — revision 1, reviewer finding
  F-DFG1-CONSISTENCY. **Rule:** an absence that authorizes signing must not come from an eventually consistent read.
  The lead route signs when the answer is empty; an eventually consistent read can miss a product write that
  completed just before it, and that miss would sign the product's file. A consistent read sees every write that
  completed before the read. It is not a snapshot across pages against edits that run at the same time (a product
  saved while the pages are read can be missed by the page already read). In the lead route this is the only read
  whose absence leads to a link: a missing `RESOURCE#` item leads to no link (fail closed).
- `backend/src/leads/create.ts` — after the existing `RESOURCE#` read finds the resource, the handler calls the lookup.
  One or more ids → warning line, no link. No id → link as before. The guard is in the handler, so it covers both
  callers the authorizer admits: the site proxy (renderer key, role RENDERER) and an anonymous direct call
  (`backend/src/auth/authorizer.ts:236`; the handler's Origin check applies).
- `backend/src/resources/presign.ts` — calls the shared function. `hasUserPurchasedProduct` is not changed.
- A `resourceId` that is not a string is treated as absent. Reason: the same string is the `RESOURCE#` key and the
  value the product filter compares; a number or object could match no product by type and fail open. Before, a
  non-string value could only match a `RESOURCE#` key by its string form; resource ids are UUIDs written by the upload
  route, so no real request changes outcome.

Abstraction (one line): `productIdsReferencingResource` in `backend/src/lib/` — users: `resources/presign.ts`
`downloadHandler`, `leads/create.ts`; axis: none (a shared query, not a dispatch seam; two current callers, and the
packet forbids a duplicate); rejected: exporting it from `presign.ts`, which would make one handler import another.

**Cost.** One `Query` on the tenant's partition (`PK = TENANT#<t>`, `begins_with(SK, "PRODUCT#")`) with
`FilterExpression resourceId = :id`, projection `id` and `ConsistentRead: true`. DynamoDB applies the filter after the
read, so each call reads (and is billed for) every product item of the tenant, page by page, at the strongly
consistent rate: 1 read unit per 4 KB, twice the eventually consistent rate. The same cost now applies to the
download route (`resources/presign.ts`), the second caller. It runs only when the request carries a string
`resourceId` AND that resource exists for the tenant (an unknown id costs no product read). Not a scan: the key
condition names one tenant partition (CLAUDE.md rule 2 holds).

**Log line (L3):** `[leads/create] product file refused as lead magnet: tenant=<tenantId> resource=<resourceId>`.
The resource id in it is the id of a stored resource (the `RESOURCE#` read matched it exactly), so a request cannot
put free text into the log through it. No email, no body.

### Rows

| Row | State | Required | Built | Test (`backend/test/unit/digital-file-guard-1.test.ts`) |
|---|---|---|---|---|
| L1 | no `resourceId` in the request | as today | 201, lead stored, no link, no product read | "L1: no resourceId…"; "L1: a resourceId that is not a string…" |
| L2 | resource referenced by no product | 201 with `downloadUrl` | as before; the link signs the resource's `s3Key` in the private bucket | "L2: …" |
| L3 | resource referenced by a product (active, draft, archived) | 201, no link, warning without email | 201 `{"message":"Subscribed"}`, lead stored, one warning line | "L3: … active / draft / archived"; "L3: the lookup has no status condition…"; "L3: … later page is found" |
| L4 | unknown resource id, or another tenant's resource | 201, no link | 201, no link, no product read (the `RESOURCE#` read is keyed by the caller's tenant) | "L4: unknown…"; "L4: another tenant's…" |
| L5 | the product lookup throws | no link; status chosen | **500** `{"error":"Internal error"}`; the lead is already stored; no link | "L5: …" |

**L5 — why 500 and not 201.** The lookup runs after the lead is written. A 201 without a link would tell a visitor of
a genuine free lead magnet (an L2 resource during a read failure) "success" with no file and no way to retry; a 500
shows the block's error text and the visitor can submit again (the lead write is a `Put` on `LEAD#<email>`, so a retry
overwrites the same item). The failure is logged by the handler's existing `catch` (`[leads/create] Error:` + the SDK
error; the query values hold the tenant and resource ids, not the email). Either status gives no link; 500 is the
one that does not misreport the outcome. It is also how the handler already answers any other read failure.

## 4. G2 — no public surface exposes `resourceId`

Every path by which product data leaves without an admin token. "Not exposed" rows give the basis. All rows are
OBSERVED in source unless marked.

**How the list was built (revision 1, reviewer finding F-DFG1-AUDIT-COVERAGE).** Iteration 0 listed the paths found by
searching for product readers; it missed the order routes, which carry copied product fields. The list below is the
union of four enumerations, each from a deterministic text search (grep), not from memory. Each is complete for the
forms it searched (the `noAuth` route option, the authorizer's anonymous route list, the renderer's route files, the
key prefixes in the renderer's data module); a route or read declared in another form would not be found:

- **A. Routes with no authorizer:** every `noAuth: true` in `infra/lib/*.ts` — 13 routes, all in
  `infra/lib/api-commerce.ts` (207-210, 286-287, 350, 404, 488) and `infra/lib/api-engagement.ts` (146, 224, 245-246).
  `infra/lib/api.ts` and `infra/lib/api-scheduling.ts` have none (the scheduling routes are all `CUSTOM`).
- **A'. Routes the authorizer admits anonymously:** `POST /leads`, `POST /contact`, `POST /consent`
  (`backend/src/auth/authorizer.ts:236`).
- **B. Routes a visitor reaches through the renderer key:** the renderer's proxies `renderer/src/app/api/*/route.ts`
  (account/orders, comments, consent, contact, leads, posts, profile, ref, revalidate, auth) and
  `renderer/src/app/%5Fbook/[siteId]/api/[op]/route.ts` (scheduling only; `backend/src/scheduling/` reads no `PRODUCT#`
  or `CATPROD#` key).
- **C. Renderer server reads of product-bearing keys:** every `PRODUCT#`, `CATPROD#`, `ORDER#`, `CUSTORDER#` key in
  `renderer/src/lib/dynamo.ts` (lines 259, 279, 315, 405, 466, 498, 545, 649, 986), and every caller that hands the
  result to a page.

Routes in A/A'/B that carry no product data: `GET /public/delivery/dates`, `GET /public/popups`,
`POST /public/forms/{slug}/submit`, `POST /contact`, `POST /consent`, `GET /public/reviews/{productId}` (review
projection, `backend/src/reviews/public-list.ts:44`), and the comments, posts, profile, ref, revalidate and auth proxies.
Not in A/A'/B but public by intent: `POST /webhooks/paddle` is behind the default authorizer
(`infra/lib/api.ts:797-801`) and answers a fixed body with no read (`backend/src/webhooks/paddle.ts`).

| # | Path | file:line | Could `resourceId` leave? | Fix / basis |
|---|---|---|---|---|
| 1 | `GET /public/products/{slug}` (no auth) | `backend/src/products/public-get.ts:42-47` | **Yes, before this slice** (whole item) | **Fixed:** `const { resourceId: _privateFile, ...publicProduct } = product;` the answer is the rest of the item. Test: G2 row (stored item with `resourceId` → answer has none, other fields equal). No in-repo caller of this route (grep `public/products` in renderer, plugins, admin, MCP: only `SearchBar.tsx:78` calls the list route) |
| 2 | `GET /public/products` (no auth), whole-tenant read | `backend/src/products/public-list.ts:48` | No | `ProjectionExpression` allow-list without `resourceId` (with or without `search`) |
| 3 | `GET /public/products?category=` | `backend/src/products/public-list.ts:22` → `queryCatProducts` | No | `CATPROD#` items are built only by `buildCatProdItem` (`backend/src/lib/catprod.ts:31`), an allow-list without `resourceId`; every writer (`products/create`, `update`, `bulk-price`, `import/woocommerce`, `glam-pricelist`, `glam-images`) goes through `writeCatProductItems` |
| 4 | `GET /public/categories/{slug}` (no auth) | `backend/src/categories/public-get.ts:37` | No | products from `queryCatProducts` (row 3) |
| 5 | `GET /public/categories` | `backend/src/categories/public-list.ts:27` | No | category projection, no product data |
| 6 | Interest list submit / resolve (public) | `backend/src/interest/public.ts:58,63` | No | `SUBMIT_PROJECTION` / `RESOLVE_PROJECTION` field lists |
| 7 | Coupon validate (public) | `backend/src/coupons/public-validate.ts:25` | No | projection `SK, categoryIds` |
| 8 | Order create (public) | `backend/src/orders/create.ts:559,676` | No | answers `{ orderId, orderNumber, couponDiscount }` only; the order item copies named product fields, no `resourceId` (grep: no `resourceId` in `backend/src/orders/`) |
| 9 | Renderer product page (slug) | `renderer/src/components/SitePage.tsx:396,435`; view from `:1241` | No | `getProductBySlug` (`renderer/src/lib/dynamo.ts:269`) returns the whole item to a SERVER component; `ProductPageView` passes named fields only to client components (`ProductImageGallery`, `AddToCartButton`, `InterestToggle` via `interestToggleProps:1147`, `catalogGalleryProps:1194`, `CatalogVariantPresenter`, `QuoteRequest`); JSON-LD lists named fields. No `product={product}` to a client component, no spread of the item |
| 10 | Renderer product page metadata | `renderer/src/components/SitePage.tsx:274` | No | title, description, image only |
| 11 | Renderer legacy page `/products/<id>` | `renderer/src/components/ProductByIdPage.tsx:28,52` | No | `getProductById` whole item to server component; rendered field by field; JSON-LD named fields |
| 12 | Category showcase card data | `renderer/src/components/SitePage.tsx:850` | No | only `item.description` is read from `getProductById` |
| 13 | Shop, catalog listing, search pages | `renderer/src/lib/dynamo.ts:409,469,502` | No | projection field lists |
| 14 | Category page | `renderer/src/lib/dynamo.ts:302` | No | `CATPROD#` items (row 3) |
| 15 | Product feed `/openai-feed` | `renderer/src/app/[siteId]/openai-feed/route.ts:21` → `dynamo.ts:991` | No | projection field list, then mapped to feed fields |
| 16 | `sitemap.xml` | `renderer/src/app/[siteId]/sitemap.xml/route.ts:41` | No | `getActiveProducts` (row 13); only `slug` is written |
| 17 | `llms.txt` | `renderer/src/app/[siteId]/llms.txt/route.ts` | No | reads no product (grep: no product read in the file) |
| 18 | MCP server tools | `tools/mcp-server/src/index.ts` | Not a public path | every product tool calls an admin route with the admin credentials (`getHeaders`); no tool calls a `/public/` product route |
| 19 | `GET /public/orders/{id}` (no auth; order id + matching email) | `backend/src/orders/public-get.ts:30-36` | No (current write shape) | Answers the stored order minus `internalNotes, PK, SK`. Its `items` lines are written by `orders/create.ts:198-207` as `productId, productTitle, quantity, unitPrice, totalPrice, selectedVariant, personalizations, imageLink` — named product fields, no `resourceId`; `orders/update.ts` and `update-status.ts` only read `items` (for mail lines); no `resourceId` anywhere in `backend/src/orders/` (grep exit 1) |
| 20 | Renderer confirmation and tracking pages | `renderer/src/components/SitePage.tsx:555-571` → `getOrderForCustomer` (`renderer/src/lib/dynamo.ts:540-552`) → `ConfirmationPageView` (`:1833`) / `OrderTrackingView` (`:1953`) | No (current write shape) | the same stored order minus `internalNotes`; basis as row 19 |
| 21 | Renderer account orders proxy | `renderer/src/app/api/account/orders/route.ts:57` → `dynamo.ts:649` | No | `CUSTORDER#` projection `orderNumber, total, #s, createdAt, SK` (no lines) |
| 22 | `GET /products` with a SERVICE key (`catalog:read`) | `backend/src/auth/policy.ts:16`; `backend/src/products/list.ts:56` | **Yes** (projection names `resourceId`) | **Not fixed — admin product route, out of scope.** Finding F-DFG1-SERVICE-KEY (§ 5). After G1, knowing the id no longer yields the file through the lead form |

### Other fields that leave through `public-get.ts` the same way (row 1)

The **current defined write shapes** of a product item hold no cost, supplier-price or internal-note field (OBSERVED:
`ProductSchema`, `packages/shared/src/index.ts`; admin writes strip unknown keys through the zod parse; importer item
shapes in `import/glam-pricelist.ts` `productItem` and `import/woocommerce.ts`). This is a statement about the code
that writes items today, not a proof about every item already stored: an item written by an older version, or by
hand, can hold other attributes, and `public-get.ts` would answer them. The same qualification applies to rows 19-20
(order items). Fields that the current shapes let leave, none clearly private, so not removed (finding
F-DFG1-PUBLIC-GET-DENYLIST):

- storage keys: `PK`, `SK`, `TenantSlug`, `Type`, `tenantId`;
- importer bookkeeping: `importSource` (`glam:<producer>/<sheet>` — the producer is also the public `brand`; the
  sheet name is internal), `importLabels`, `importProfileRevision`, `facetModes`;
- `inventoryQuantity`, `weight`, `createdAt`, `updatedAt`;
- unpublished statuses never leave: the route answers 404 for a non-active or unavailable product.

## 5. Findings (not built)

Closed by `findings-1` (`docs/slices/findings-1.md`): F-DFG1-SERVICE-KEY (Part 2), F-DFG1-PUBLIC-GET-DENYLIST (Part 1),
F-DFG1-RENDERER-WHOLE-ITEM (Part 3). The text below is the record as written on 2026-11-26.

- **F-CMRC1-PRESIGN-ENTITLEMENT** (already named in `docs/slices/cmrc-1.md`; ROADMAP `presign-entitlement-1`):
  `hasUserPurchasedProduct` (`backend/src/resources/presign.ts:21-58`) reads `CUSTORDER#` with projection `items`,
  which those items do not hold (`backend/src/orders/create.ts:439-448` writes `orderNumber, total, status,
  createdAt, Type`), so a non-admin is always refused; and no site screen calls `GET /resources/{id}/download` (only
  the MCP tool, `tools/mcp-server/src/index.ts:1857`). With the inert Paddle webhook (`paddle-hook-1`), **a paid
  digital product has no delivery path today**. Product decision for the human. Not changed here. Recorded in
  `docs/TECH-DEBT.md`.
- **F-DFG1-SERVICE-KEY** — `GET /products` answers `resourceId` to a SERVICE key holding `catalog:read` (an
  integration credential, not an admin session). Fix shape: drop `resourceId` from the `list.ts` projection for a
  SERVICE caller, or from the projection entirely if the admin UI reads it elsewhere
  (`admin/src/pages/DigitalProducts.tsx:121` reads it from the list today). Admin product route: out of this slice.
- **F-DFG1-PUBLIC-GET-DENYLIST** — `public-get.ts` still answers the stored item minus one field (a deny-list). A
  future private field leaks by default. Fix shape: an allow-list of public fields, as `public-list.ts` has. Not done
  here: the route has no in-repo caller to define "the public fields", and the packet allows only the one-line fix.
- **F-DFG1-RENDERER-WHOLE-ITEM** — `getProductBySlug` / `getProductById` (`renderer/src/lib/dynamo.ts:252,269`) return
  the whole item to server components. Not exposed today (§ 4 rows 9–12), but one future `product={product}` on a
  client component would serialise `resourceId` into the RSC payload. Fix shape: a projection on both reads.
- **Route comments do not match the routes:** `resources/presign.ts` comments say `POST /resources/upload-url` and
  `GET /resources/{id}/download-url`; the routes are `/resources/upload` and `/resources/{id}/download`
  (`infra/lib/api.ts:512,517`). Comment-only; not changed here.
- **Generated map stale:** `backend/src/resources/presign_ts_MAP.md` (generated by `rmap`, "do not hand-edit") still
  lists `getProductsForResource`. The next `rmap` refresh regenerates it.

## 6. Evidence (builder runs, 2026-11-26; all gates re-run after revision 1)

| Check | Result | Label |
|---|---|---|
| `backend/test/unit/digital-file-guard-1.test.ts` on the working tree (revision 1) | 15/15 pass | EXECUTED |
| Revision 1 mutant: the same files with only `ConsistentRead: true` removed (temporary worktree) | exactly the new row "L3: a product reference committed just before the lead is seen" fails; 14 pass. The fake database serves a stale view to a query without `ConsistentRead: true` | EXECUTED |
| Iteration 0: same test file (14 rows) on `HEAD` (temporary worktree, only `lib/resource-products.ts` added so the import resolves) | 9 fail / 5 pass: every L3, L5, non-string, second-caller (page 2) and G2 row fails; L1, L2, L4 ×2 and the lib-only row pass (unchanged behaviour by design) | EXECUTED |
| `npm run build` | exit 0 | EXECUTED |
| `npm run typecheck` | exit 0 | EXECUTED |
| `npm --prefix packages/shared test` | 599/599 | EXECUTED |
| `npm --prefix packages/plugins test` | 355/355 | EXECUTED |
| `npm --prefix renderer test` | 57 files, 904/904 | EXECUTED |
| `npm --prefix renderer run test:serving` | 173/173 | EXECUTED |
| `npm --prefix backend run test:unit` | 81 files pass, 1 skipped (opt-in golden capture, skipped before this slice); 2059 pass (revision 1; 2058 in iteration 0) | EXECUTED |
| `npm --prefix tools/mcp-server test` | 17/17 (no route changed; `routes.json` not refreshed) | EXECUTED |
| `git diff --check` | exit 0 (new files checked separately: no trailing whitespace) | EXECUTED |
| Staging deploy and probe | — | NOT RUN (operator) |

## 7. What the operator must run on staging

Deploy the backend. Functions whose code changes: `CreateLeadFunc` (`infra/lib/api.ts:523`), `PublicGetProductFunc`
(`infra/lib/api-commerce.ts:186`), and `CreateResourceFunc` / `GetResourceFunc` (`infra/lib/api.ts:481,490`, both
bundle `resources/presign.ts`). No infra diff is expected: `cdk diff` should show only Lambda code assets.

1. **G2 (the EXECUTED probe of § 1, repeated):** `GET /public/products/{slug}` of a digital product that has a
   `resourceId`, no credentials. Expect 200 and no `resourceId` key in the body. Other keys unchanged.
2. **G1, L3:** on a tenant site with a domain, `POST https://<site>/api/leads` (same-origin, with a reCAPTCHA token if
   the tenant needs one) with `{ "email": "<probe address>", "resourceId": "<that product's resourceId>" }`. Expect
   201, `{"message":"Subscribed"}`, no `downloadUrl`; one CloudWatch line in `CreateLeadFunc`:
   `product file refused as lead magnet: tenant=<t> resource=<id>`, with no email. If staging still has no tenant
   domain (as in § 1), this row stays NOT RUN; the unit rows are the evidence.
3. **G1, L2 regression:** a lead magnet block whose resource no product references still answers a `downloadUrl`.
   Do not paste the link into a report.
4. Delete the probe lead afterwards (`DELETE /leads/...` from the admin Leads page).

## Operator closeout (2026-11-26)

- Models: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`; two review cycles (review-0: the product lookup must be a
  strongly consistent read, and three product-data exits were missing from the audit; both closed).
- Operator gates (log read, exit codes bare): build, typecheck, shared, plugins, renderer, serving, serving bundle,
  admin unit, backend unit, infra, MCP, `git diff --check` — all 0. The operator's gate script ended red on its own
  "protected paths" list, which was copied from an earlier slice and names `backend/src/products`; this slice changes
  `public-get.ts` on purpose. Wrong oracle, no defect.
- Staging diff, read before the deploy: no resource added or removed; functions change by code bundle only.
- Staging probe with test data (tenant `cm1-commerce`; one private resource record and one digital product created,
  then removed): BEFORE the fix `GET /public/products/{slug}` answered `resourceId` equal to the private file id, with
  no credentials; AFTER the deploy the same request answers no `resourceId`.
- Not observed on staging: the lead route's refusal (G1). A direct call to the backend is refused before the handler
  (401 with the public web key; 403 "Invalid request origin" with an admin token), and the site proxy needs a tenant
  domain, which no staging tenant has. G1 is proven by unit tests (rows L1–L5).
- Open for the human (not built): a paid digital product has no delivery path today (TECH-DEBT entry of this slice).

### Production (the human, 2026-11-26)

Deployed. The human states: "there are no products whatsoever right now in any tenant". So no private file of a
product existed while the lead route could sign one; the exposure had nothing to expose.
