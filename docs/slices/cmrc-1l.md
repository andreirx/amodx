# CMRC-1L — the order confirmation and tracking pages read the order through the backend (part L of `cmrc-1`)

- **Status:** IMPLEMENTED 2026-11-28 — built, operator gates pending (the staging diff holds one function, one
  route and their IAM statements; then the staging deploy, a synthetic order seeded in the staging table, and the
  confirmation and tracking pages of the test shop opened with the right email, a wrong email and a wrong id).
- **Track:** B (commerce-private). Third build slice of the track.
- **Depends:** `cmrc-1a` and `cmrc-1b` (both on staging since 2026-11-28): `backend/src/lib/commerce-db.ts`,
  `backend/src/customers/self-service.ts`, `renderer/src/lib/customer-api.ts`, `callBackend`. Decision
  CMRC-ORDER-LOOKUP-AUTHORITY = A — **an operator ruling of 2026-11-28 under the human's standing rule of
  2026-11-27; not yet confirmed by the human; the human may overrule** (`docs/slices/cmrc-1.md` § 8, Appendix R).
- **Source plan:** `docs/plan-commerce-private-table.md`; specification `docs/slices/cmrc-1.md` (reviewed draft,
  revision 3). This slice is **part L**: every item marked **[L]** in its § 5.
- **Maturity:** `orderLookupHandler` and the renderer's `getOrderForCustomer` (over HTTP) are PROTOTYPE until the
  operator's staging run passes.
- **Baseline:** `7200d38` (HEAD at the start of the slice; the working tree was clean).

## Guarantee scope (what is true after this slice, and what is not)

| Part | Statement | Basis |
|---|---|---|
| **True** | No code under `renderer/src` builds a commerce-private key (`ORDER#`, `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER`) or reads such an item from DynamoDB. The order confirmation and tracking pages ask the backend (`POST /customer/order-lookup`, renderer key) | § *Proofs*: T3 with an EMPTY exception list; the control with a prefix put back; search G8 |
| **True** | The backend answers the order pages with the 17 fields of `OrderView` and no other attribute of the order | § *Proofs*: T4 (D3 rows), the field pin |
| **True** | The cutover gate of `docs/slices/cmrc-1.md` § 6 is met for the renderer: no renderer read names the main table for these items. (The gate also asks for the per-prefix search and the audit sub-decision of Appendix R.1 at the start of `cmrc-4`.) | T3 |
| **Exception, recorded — NOT conformance** | The order-page read is authorized by possession of the order id and an email equal to the stored normalized email. The email comes from the page address, not from a session. This does not conform to PD-002's identity rule. It is recorded as a dated amendment of PD-002 (`docs/platform-decisions.md`), an operator ruling that the human has not yet confirmed | `docs/platform-decisions.md` PD-002, amendment of 2026-11-28 |
| **Not claimed** | `docs/VISION.md` guarantee 2 is NOT met. The renderer function still has read access to the whole main table (`infra/lib/renderer-hosting.ts`, `grantReadData`), and every order and customer item is still in that table. This slice removes the last place where renderer CODE reads them. The IAM reach ends only when the data leaves the main table (`cmrc-4`, `cmrc-6`) | — |
| **Not claimed** | Anything about the anonymous `GET /public/orders/{id}` (it answers more than the 17 fields and is judged in `cmrc-5`); that the proof of the order pages became stronger (it is the same proof as before) | — |

## Purpose / risk retired

The risk retired: **the public renderer is the reader of an order.** Before this slice one renderer function
(`getOrderForCustomer` in `renderer/src/lib/dynamo-customer-reads.ts`) builds an `ORDER#` key and reads the main
table itself. Track B moves these items to a table that the renderer cannot read (`docs/VISION.md` guarantee 2;
PD-002). That move cannot start while renderer code reads the item directly: after the move, the read would find
the old copy or nothing. After this slice the read goes through a backend route, so the storage move (`cmrc-4`)
changes one binding in `commerce-db.ts` and the two pages follow with no renderer edit.

The property this slice must not break: what the confirmation page and the tracking page show to every visitor, in
every state (§ *V1*).

## Scope

1. Shared: `OrderLookupRequestSchema`, `ORDER_VIEW_FIELDS`, `OrderViewField`, `OrderView` in
   `packages/shared/src/orders-and-customers.ts`.
2. Backend: `orderLookupHandler` (`POST /customer/order-lookup`, D3) in `backend/src/customers/self-service.ts`;
   the refusal sum gains `notFound`.
3. Renderer: `getOrderForCustomer(tenantId, orderId, email)` in `renderer/src/lib/customer-api.ts`; `SitePage.tsx`
   imports it from there (one import); `renderer/src/lib/dynamo-customer-reads.ts` is deleted with its re-export
   line in `renderer/src/lib/dynamo.ts`.
4. Infrastructure: one function and one route in `infra/lib/api-commerce.ts`, wired as the two of `cmrc-1b`.
5. Tests: the order-page captures and the field pin (T11 by the packet's means), T4 (D3 rows), T4-auth, T3 (empty
   list), T5, T6, T8, T9, T7, the shared schema rows.
6. `tools/mcp-server/routes.json` (`localAdditions` +1); documents; the PD-002 amendment.

## Non-scope

- The anonymous `GET /public/orders/{id}` (`cmrc-5`). Token links (option C). Any data copy. `COMMERCE_TABLE_NAME`;
  the binding `COMMERCE_TABLE` in `commerce-db.ts` is not changed. The account pages and their two routes.
  `EMAILLIMIT#`, `COUPONUSE#`. A fix of a finding of `docs/slices/cmrc-1.md` § 10.3 or of § *Findings, not fixed*.
- No change of what the two pages show: no new state, no new text, no new error page.
- The renderer function's role and variables: not changed.
- A timeout for `callBackend` (finding F-CMRC1B-NO-TIMEOUT stays open; § *V3*).

## Architectural boundaries

- **Tenant isolation.** The read is keyed `TENANT#<x-tenant-id>`. The renderer sets that header from the tenant
  record it found for the request's host (`config.id` in `SitePage`), never from a browser value.
- **Customer identity — an exception to PD-002, not conformance.** The order id and the email of the request are
  the values of the page address. The backend admits the `RENDERER` role (and `GLOBAL_ADMIN`, which `requireRole`
  always admits) and no other; a browser has no renderer key and cannot call the route.
- **No scan.** One GetItem on `PK` + `SK`, with a projection. Every projected name has an alias, so no name can
  meet a DynamoDB reserved word (`items`, `status`, `total` are reserved).
- **Dependency direction.** Renderer: `SitePage` → `customer-api.ts` → `api-client.ts`. Backend: handler →
  `commerce-db.ts` → `db.ts`. `packages/shared` gains a schema, a list and two types, no I/O. No new cycle.
- **Data across the boundary.** Raw JSON: `{ orderId, email }` in; `{ order: { …17 fields } }` or
  `{ code: "notFound" }` out. No SDK object, no framework object.
- **Key ownership (CLAUDE.md rule 10).** The handler holds no key prefix; it spreads `orderRef` of
  `commerce-db.ts` into its command. After this slice the rule holds for `backend/src`, `renderer/src` and
  `packages/*/src` with no exception.

## Verification before building (on the baseline `7200d38`, before any source edit)

### V1 — what the two pages show today, per state (the oracle for C5)

Read: `renderer/src/components/SitePage.tsx` (branches `checkout-confirm`, `checkout-track`),
`renderer/src/components/site-page/order-views.tsx`, `renderer/src/components/site-page/addresses.ts`,
`renderer/src/lib/dynamo-customer-reads.ts`. OBSERVED:

- Both branches are reached only on a tenant with `commerceEnabled` (else the not-found path), and only when the
  page address matches the tenant's checkout prefix.
- The read is called only when BOTH values are non-empty: confirmation — `query.id` and `query.email`; tracking —
  the path segment after the checkout prefix and `query.email`.
- The read (`getOrderForCustomer`): one GetItem of the whole item `TENANT#<tenant>` / `ORDER#<id>`; `null` when
  there is no item; `null` when `stored customerEmail !== normalizeEmail(given email)`; else the item without
  `internalNotes`.
- The page receives ONE of two values: an order, or `null`. **"No such order", "another tenant's order" and "the
  email is not equal" are the same `null` today.** The visitor cannot tell them apart. This slice keeps that: the
  backend gives one 404 answer for all of them, and the renderer function returns `null` for it.

| # | State | Confirmation page (`<checkout><confirmation>`) today | Tracking page (`<checkout>/<order id>`) today | Is the order read? |
|---|---|---|---|---|
| S1 | **Order shown**: the id names an order of this tenant and the email, after `normalizeEmail`, equals the stored `customerEmail` | the order view: "Order Confirmed!", the order number, the bank block (bank transfer and the tenant has bank details) or the cash-on-delivery block, the items, the totals, the shipping address | the tracking view: the order number, the date, the status steps, the status history (when stored), the tracking number (when stored), the items, the total | yes |
| S2 | **No order requested**: the id or the email is absent or empty | the "thank you" view ("Thank you for your order!", a link to the shop) | (email absent or empty) the "Order Not Found" view | **no** |
| S3 | **Order not found**: no item with this id in this tenant | the "thank you" view — the same as S2 | the "Order Not Found" view — the same as S2 | yes |
| S4 | **Another tenant's order**: the id exists under another tenant | as S3 (the key holds the tenant) | as S3 | yes |
| S5 | **Email not equal** to the stored one | as S3 | as S3 | yes |
| S6 | **Malformed link**: an email that cannot match (a space inside, no `@`), an id with `#` | as S3 — no format check exists; the value matches nothing | as S3 | yes |
| S7 | **The read fails** (DynamoDB error, no table name) | the error leaves `SitePage`; the render fails (§ *V3*) | the same | yes, it throws |

The confirmation page has two looks (the order view; the "thank you" view). The tracking page has two looks (the
tracking view; the "Order Not Found" view). The states S2-S6 of one page give the same look.

Where the pages render: the read needs a query value, and the cacheable route passes `query: {}` (the header of
`SitePage.tsx`). So on the cacheable route only S2 is possible and nothing is read. Every state that reads the
order renders on the dynamic twin (`app/[siteId]/%5Fdyn/[[...slug]]`), which answers `no-store`.

### V2 — what the pages READ from the order object, field by field

Read: `site-page/order-views.tsx` (every `order.` expression), `SitePage.tsx` (it passes the object to the view and
reads nothing of it), `FBPurchaseEvent` and `CelebrationWrapper` (the two client components of the confirmation
view: they get `orderId`, `value`, `currency`, `items[{ id, quantity }]`, and nothing — never the order object).
OBSERVED:

| Field of the order | Confirmation view | Tracking view | In `OrderView` (the 17)? |
|---|---|---|---|
| `id` | the Facebook purchase event (`orderId`) | — | yes |
| `orderNumber` | heading; bank reference | heading | yes |
| `createdAt` | — | "placed on" date | yes |
| `currency` | every amount; the purchase event | every amount | yes |
| `customerName` | shipping block | — | yes |
| `customerPhone` | shipping block (when stored) | — | yes |
| `discount` | the discount line (when > 0) | — | yes |
| `estimatedDeliveryDate` | cash-on-delivery block (when stored) | — | yes |
| `items` (each: `productId`, `quantity`, `productTitle`, `totalPrice`, `personalizations[].label/value`) | the item list; the purchase event | the item list | yes |
| `paymentMethod` | which payment block | — | yes |
| `shippingAddress` (`street`, `city`, `county`, `postalCode`) | shipping block (when stored) | — | yes |
| `shippingCost` | the shipping line | — | yes |
| `status` | — | the status steps | yes |
| `statusHistory` (each: `timestamp`, `status`, `note`) | — | the history block (when stored) | yes |
| `subtotal` | the subtotal line | — | yes |
| `total` | the total line; bank amount; cash amount; the purchase event | the total line | yes |
| `trackingNumber` | — | the tracking block (when stored) | yes |

17 fields, and they are the 17 of `OrderViewField` (`docs/slices/cmrc-1.md` § 5.6). **No field that a view reads
is outside `OrderView`: no STOP.** A nested value (an item, the address, a history entry) is one stored attribute
and passes through whole. The reading above is by eye; the executable form is the field pin of § *Proofs* (a
recorder around the order object: it also sees a read through destructuring, and it fails on an enumeration of the
object).

What the old read gave and the new one does not: every other attribute of the item except `internalNotes`
(`customerEmail`, `billingDetails`, `couponCode`, `couponDiscount`, `PK`, `SK`, `Type`, `tenantId`, `updatedAt`, …).
No view reads one of them, and no order object goes to a client component, so no page changes.

### V3 — timing and failure (packet item 5)

OBSERVED in the code; nothing here is measured.

| | Today | After this slice |
|---|---|---|
| The read | one DynamoDB GetItem from the renderer function | one HTTPS call from the renderer function to the API gateway, which runs the authorizer function and then the read function (one GetItem) |
| The read fails | the SDK error leaves `getOrderForCustomer` and `SitePage`; nothing catches it (`docs/caching-architecture.md` § *Failed reads throw*, ruling CACHE-1-D4). The dynamic twin answers **HTTP 500**, not stored (`no-store`); no `error.tsx` exists under `renderer/src/app`, so the page is the framework's error page | `getOrderForCustomer` throws `CustomerApiError` for: no `API_URL`, no key, a failed call, any status that is not the route's answer (400, 403, 500, the gateway's own 404 for a route that does not exist), a 200 body that is not the route's answer. Nothing catches it. **The same class of answer: HTTP 500 on the dynamic twin, not stored** |
| "Not found" | `null` → the page's S3 look | the route's 404 `{ "code": "notFound" }` → `null` → the same look. A 404 WITHOUT that code is a failure, not "not found" — else a deploy in progress would show a buyer "Order Not Found" |
| The read is slow or never answers | the AWS SDK retries; the renderer function ends at its 15 s limit (`infra/lib/renderer-hosting.ts`); the visitor gets the edge's error for a failed origin | `callBackend` has no timeout of its own (F-CMRC1B-NO-TIMEOUT, open); the renderer function ends at its 15 s limit, before the backend's 29 s limit; the visitor gets the same edge error. Same class; NOT RUN on a deployed stack |
| A stored page can keep a failure | no: every state that reads renders on the dynamic twin (`private, no-store`); a thrown render error is never stored | the same: the read is still reached only with a query value, so only on the twin. The backend answer carries `Cache-Control: no-store` and the call is made with `cache: "no-store"` |

Added latency (INFERRED, not measured): one API-gateway round trip with the authorizer function; a cold start of
the two functions adds to the first request. The operator's staging run observes it.

## Data that crosses the renderer → backend boundary

`POST /customer/order-lookup` (D3). Headers exactly `x-api-key` (the renderer key), `x-tenant-id`,
`content-type: application/json`. Request body `{ "orderId": "<non-empty string>", "email": "<non-empty string>" }`
and no other field (`OrderLookupRequestSchema`, strict). Answer header `Cache-Control: no-store`.

| Answer | When |
|---|---|
| 200 `{ "order": OrderView }` | the item `TENANT#<x-tenant-id>` / `ORDER#<orderId>` exists and its stored `customerEmail` is strictly equal to `normalizeEmail(email)`. `OrderView` = the fields of `ORDER_VIEW_FIELDS` that the item has, each the stored value passed through (no parse, no default, no `null` removed), in the order of the list |
| 404 `{ "code": "notFound" }` | no such item; an item of another tenant (the key holds the tenant); the email is not equal — one answer for all |
| 403 `{ "code": "forbidden" }` | `requireRole` refused the caller (any role but `RENDERER` and `GLOBAL_ADMIN`); nothing is read |
| 400 `{ "code": "missingTenant" }` | no `x-tenant-id`; nothing is read |
| 400 `{ "code": "malformedRequest", "issues": [{ path, message }] }` | the body is not a JSON object of exactly the two non-empty string fields. The renderer never builds such a body. No request text is in the answer; nothing is read |
| 500 `{ "code": "internal" }` | a DynamoDB or other unexpected failure; logged with the route and the error's NAME only |

`ORDER_VIEW_FIELDS` = `id, orderNumber, createdAt, currency, customerName, customerPhone, discount,
estimatedDeliveryDate, items, paymentMethod, shippingAddress, shippingCost, status, statusHistory, subtotal, total,
trackingNumber`.

**Input rule.** No format check and no length bound on the order id or the email. A value that cannot match is
"not found", never an error. **The email rule is exactly the old one**: only the request side is normalized; a
stored `customerEmail` that is not in normalized form is reached by no request (the cases of
`renderer/test/unit/order-email-1.test.ts` before this slice, now rows of T4).

Renderer side (`getOrderForCustomer` in `customer-api.ts`): 200 with an `order` object → the object; 404 with
`code: "notFound"` → `null`; anything else → `CustomerApiError` (`route`, `status`: the number, `"unreachable"` or
`"malformedAnswer"`; never the email or the order id).

## Proofs

| Id | File | Proves | What it cannot see |
|---|---|---|---|
| **The page oracle (T11 by the packet's means)** | `renderer/test/unit/cmrc-1-order-pages.test.ts` (new; 76 rows) with the capture `renderer/test/unit/cmrc-1-order-pages-before.json` (34 states) | **C5.** From stored items and a page address to the static markup of the confirmation page and the tracking page, for every state of § *V1* (S1: 11 states, three order shapes, three written forms of the email, a Romanian tenant; S2: 7; S3: 2; S4: 2; S5: 5; S6: 7). The file stands below both transports: before, `SitePage` reads the in-memory table through the renderer's DynamoDB client; after, `SitePage` calls `fetch`, and the test's "local backend" passes the call to the REAL `orderLookupHandler`, which reads the same table. The capture was written by this file on the untouched baseline `7200d38`. On the changed tree every state's markup is BYTE-EQUAL to it. Each state also asserts the read: exactly ONE GetItem on the key of the host's tenant and the requested id, or NO read (S2). The props of the two client components (`FBPurchaseEvent`, `CelebrationWrapper`) are printed into the markup as JSON, so what crosses to the browser is compared. The stored orders carry attributes that no page shows (internal notes, billing details, coupon, the email): a row asserts that none appears in any capture. S7 (the read fails): the render rejects, for both pages | the HTTP status and headers; the layout around the page (navbar, footer); the RSC flight payload and hydration; CSS (the serving rows below see these for the fixture orders). The real DynamoDB (the table is `backend/test/unit/memory-table.ts`, which honours the projection as written); the real authorizer (the local backend refuses a call without the test's key — a stand-in); the infrastructure; latency |
| **The field pin** | the same file, second `describe` (2 rows) | **§ V2.** A recorder (a Proxy) around the order object notes every property the two real views read. Over the three stored order shapes the union is exactly the 17 `OrderView` fields (written in the test as an independent list); per view: 13 for the confirmation, 8 for the tracking page. No view enumerates the object (a spread would read every attribute). A control row shows the recorder sees a read through destructuring and an enumeration | a field that a view reads only for an order shape the test does not store. The three shapes take every branch of the two views (bank transfer, cash on delivery, address present and absent, history present and absent) — OBSERVED by reading `order-views.tsx` against the shapes |
| T4 (D3 rows) | `backend/test/unit/cmrc-1-order-lookup.test.ts` (new; 59 rows) | **C3 for D3.** `RENDERER` and `GLOBAL_ADMIN` pass; `TENANT_ADMIN`, `EDITOR`, `CUSTOMER` (the buyer), `SERVICE`, no role, anonymous, another letter case, no authorizer context → 403 and NO DynamoDB command; a refused caller gets 403 also for a malformed request; no `x-tenant-id` → 400; 14 malformed bodies → 400 with the path, no request text, no command; the ONE GetItem (key, the 18 projected names, every name aliased; the list holds three reserved words); the tenant is `x-tenant-id`; the order id is used as given; the email rule (8 written forms of the stored address → the order; 9 other texts → 404 after the same read; a stored email that is not in normalized form, absent, `null` or a list → reached by no request); ONE "not found": six causes give the same body, byte for byte, each after one read; the answer: exactly the view fields the item has, in the list's order, `null` and numbers unchanged, absent stays absent, `{}` for an item with none — also when the table returns the WHOLE item; DynamoDB failure → 500 and one log line with the route and the error's name, no email, no order id | the real DynamoDB; what the renderer sends |
| T4-auth | `backend/test/unit/cmrc-1-self-service-auth.test.ts` (third route added; 12 rows, 4 per route) | The REAL authorizer on the route key `POST /customer/order-lookup`: no credential or a wrong key → refused; the renderer key → `RENDERER`, then the real handler reads the tenant of `x-tenant-id`; a valid admin token → admitted by the authorizer as `TENANT_ADMIN`, refused by the handler with 403, nothing read | the API gateway's HTTP status for a refused authorizer (staging) |
| T3 (list EMPTY) | `backend/test/unit/cmrc-1-key-ownership.test.ts` | **C1 / C4, with no exception.** In `backend/src`, `renderer/src`, `packages/*/src` the four prefixes are written in `commerce-db.ts` only; the list of hits outside it is compared with `[]`. The precondition row requires that the walk read `SitePage.tsx`, `customer-api.ts`, `dynamo.ts`, and that the deleted file is not there | as before: a prefix joined at run time; `scripts/`, tests, `admin/`, `tools/`, `infra/` |
| T5 (D3 rows) | `renderer/test/unit/cmrc-1-customer-api.test.ts` (23 rows added; 76 in the file) | **The transport of the order read**, through the real `callBackend`: one POST, exactly three headers, the body `{ orderId, email }` as given (not trimmed, not normalized); 200 → the order, deep-equal; the route's 404 `notFound` → `null`; a 404 that is NOT the route's (the API gateway's, another code, not JSON, a list) → `CustomerApiError` 404; 400/401/403/429/500/502/503 → the error, also when the body says `notFound`; a failed call, no `API_URL`, no key → `unreachable` (nothing sent for the last two); a 200 body that is not the route's answer (7 forms) → `malformedAnswer` | the backend's side (T4) |
| T6 | `renderer/test/unit/order-email-1.test.ts` (rewritten; 12 rows) | The renderer half of the ORDER-EMAIL-1 rule: the email is FORWARDED as typed (7 written forms), with the order id and the tenant; the backend's "not found" → `null`. The stored-form cases moved to T4 ("the email rule"). The file name stays: it is still the order-email-1 rule | — |
| T8 | `renderer/test/unit/cdl-2-site-page.test.ts`, `locale-1d-server-render.test.ts` (one `vi.mock` line and a comment each) | The two files that reach the order pages with a mocked read: the same mock function now stands for `@/lib/customer-api`. No assertion is edited. They were the ONLY two files that failed after the import moved (EXECUTED: the full renderer run before the edit: 2 files, 8 rows failed). The other 14 files that name `getOrderForCustomer` in their `@/lib/dynamo` mock never reach the order pages; their entry is now an unused key and is left in place | — |
| T9 | `renderer/test/serving-contract/backend-stub.mjs` (new), `harness.mjs`, `contract.test.mjs` | The serving suites have a backend for ONE route. The stub answers `POST /customer/order-lookup` from the fixture items (the constructed key, the tenant header, the email rule, the 17 fields, 404) and DROPS every other request. Run of 2026-11-28 on the `next start` target: 16 lookups answered 200, 5 answered 404, and 14 booking-proxy forwards dropped (so the `sched1g-*` rows keep "503 at the forward step") | the backend's rule (the stub is a second, hand-written statement of it; the list and `normalizeEmail` are imported from `@amodx/shared`) |
| T7 | `infra/test/amodx-stack.test.ts` rows `(cmrc1b-1)`…`(cmrc1b-5)`, now over three routes | The third route: once in the tree, in the commerce nested stack, `CUSTOM` with that stack's authorizer, on its own function with handler `index.orderLookupHandler`; no other route of the tree is under `/customer/`. The function: `TABLE_NAME` its only variable; its own role with the one AWS logging policy; every statement an Allow of read actions on the main table, together exactly the read set — no write, no SES, no `events:PutEvents`, no secret, no invoke. Every OTHER commerce function still has `events:PutEvents`. Nothing uses the commerce table. The renderer function's grants are unchanged | the deployed stacks (the operator's staging diff) |
| shared | `packages/shared/test/cmrc-1-order-lookup-request.test.ts` (new; 28 rows) | `OrderLookupRequestSchema`: exactly two non-empty strings, no format rule, no length bound, values returned unchanged; `ORDER_VIEW_FIELDS` is the 17-name list and holds none of eight private attribute names | — |

**What the serving suites cover of the two pages (packet item 4).** OBSERVED in `renderer/test/serving-contract/`
(`locale-1/proof.mjs` `orderRequests`, the row titles of the run):

- The pages render on the dynamic twin for every request with a query string; a confirmation address with no
  query renders on the cacheable route and reads nothing.
- `next start` target (`npm run test:serving`): for the EN commerce fixture and its RO copy, the confirmation and
  tracking pages of the two fixture orders, the confirmation with no query, and a tracking page with another
  email, are requested by the rows `loc1-text-commerce`, `loc1-diff-cdl-2`, `loc1-ro-commerce` (the page BYTES and
  visible text against the captures of commit `7bd3d51`, equal except the changes those slices list — captures
  taken when the renderer read the WHOLE order item itself), `loc1-order-pages` (the texts of each state),
  `loc1e-cache-headers` (status, `Cache-Control`, `Content-Type`, `Vary` against `d9999d2`) and
  `cdl2-moved-address`. All pass with no capture changed. So for those fixture orders the HTTP answer — status,
  the four headers, and the body as those rows compare it — is what it was. These rows are not a full state table (no absent id, no
  other tenant, no malformed link): that is the page oracle above.
- OpenNext bundle target (`npm run test:serving-bundle`): NO row requests an order page with an order (the stub's
  journal is empty on that target). Coverage gap, recorded: F-CMRC1L-BUNDLE-COVERAGE.

**Negative controls (EXECUTED 2026-11-28; `.agent-manager/slices/CMRC-1L/evidence/controls.sh`, results in
`controls-results.txt`).** A disposable worktree of `7200d38` (`/tmp/CMRC-1L-baseline`, removed by a `trap`); the
working tree is not touched.

| Control | Result |
|---|---|
| A1. The oracle file and the capture on the UNTOUCHED baseline (`git status` of the worktree: those two files only) | exit 0, 76 passed |
| A2. A fresh capture made in that worktree | byte-equal to the committed capture file (`cmp`) |
| B0. The candidate copied into the worktree: oracle; T5 + T6; D3 rows; T3 | exit 0: 76; 88; 59; 8 passed |
| B1. The handler leaves `trackingNumber` out of its answer | oracle exit 1 (3 failed: the tracking states); D3 rows exit 1 |
| B2. The handler answers the order for ANY email | oracle exit 1 (9 failed); D3 rows exit 1 (12 failed) |
| B3. The handler normalizes BOTH sides of the email comparison (the looser rule of `orders/public-get.ts`) | oracle exit 1 (the two stored-not-normalized states); D3 rows exit 1 |
| B4. The handler answers the whole item minus `internalNotes` (the old renderer result) | D3 rows exit 1 (16 failed). The oracle PASSES, as it must: the pages read 17 fields only, so a wider answer cannot change them — the 17-field limit is proven by T4, not by the pages |
| B5. `customer-api` turns a failed backend call into "not found" | oracle exit 1 (row S7); T5 exit 1 (9 failed) |
| B6. `customer-api` reads the API gateway's own 404 as "not found" | T5 exit 1 (4 failed) |
| B7. `customer-api` normalizes the email itself | T5 + T6 exit 1 (6 failed) |
| B8. **A commerce-private prefix put back in a renderer file**: (a) the deleted `dynamo-customer-reads.ts` restored; (b) an `ORDER#` key template added to `customer-api.ts` | T3 exit 1 in both |
| B9. A view reads a field outside the 17 (`order.internalNotes`) | oracle exit 1 (the field pin) |
| B10. Candidate restored | exit 0: 76; 88; 59; 8 passed |

## Abstraction record

| What | Concrete current users | Named axis of variation (dispatch) | Simpler alternative rejected |
|---|---|---|---|
| `ORDER_VIEW_FIELDS` (shared const) with `OrderViewField`, `OrderView` | the backend handler (projection and answer), `customer-api.ts` (answer type), the serving stub | none: one list at a documented boundary (renderer → backend DTO; Critical Rule 4). The PD-002 exception names it | the list written in the handler and again in the stub and the type |
| `selfServiceRoute` made generic over the request schema (file-local frame) | the three handlers | the request shape, demonstrated: `{ email }` for two routes, `{ orderId, email }` for the third. The access rule is one for all | a second frame for the order lookup: the role, tenant and body checks written twice |
| `ReadResult` (file-local: the 200 body, or a refusal) | the three reads | fixed variants (sum type): today only `notFound` of the order lookup is decided by the stored data | a thrown "not found" — an expected outcome hidden from the signature |
| `SelfServiceRefusal` gains `notFound` | the three handlers | fixed variants (sum type). Adding the variant alone gave ONE compiler error: `self-service.ts(74,54) TS2366` in `refusalAnswer` — the one site to touch | — |
| `jsonObjectOf` (file-local, `customer-api.ts`) | `readForCustomer` and `getOrderForCustomer` | none: removes a duplicate | the same six lines twice |
| `backend-stub.mjs` (serving suites) | `startStubs()` of `harness.mjs`: the contract rows and the bundle rows | the backend route the renderer calls during a render — one today | (a) no stub: 21 order-page requests of existing rows would answer 500; (b) the stub inside `harness.mjs`: the other stubs are one file each |

No interface, no port, no new package, no configuration layer.

## Deviations and local decisions

| # | What | Why |
|---|---|---|
| 1 | **T11 is a headless render comparison in `renderer/test/unit/`, not a serving-contract baseline built from a worktree** (`docs/slices/cmrc-1.md` § 5.9 T11: module `cmrc-1-order-pages.mjs`, a baseline directory, three new rows) | the build packet names the means ("the means of the existing `*-server-render.test.ts` files; static markup with JSON-serialized client props") and freezes the serving row counts (176, 61) and captures. What the chosen means does not compare is stated in § *Proofs*; the existing serving rows cover the HTTP level for the fixture orders |
| 2 | **Row `(iso1)` of the serving suite is edited**: its list of permitted variable names gains `API_URL` and `AMODX_API_KEY`, and it asserts their values (the stub's loopback address; the harness's test key). No other row is edited; no capture is changed; the counts stay 176 and 61 | T9 cannot exist without it. Since this slice the order pages call the backend, so the serving renderer needs a backend address and a key; `(iso1)` is the row that pins the harness's variable list. Its claim is unchanged — the environment is constructed, never inherited — and it now also fails on an inherited key. Precedent in the same row: `REVALIDATION_SECRET` (LANG-1B). **This is the one place where an existing serving row's expectation changed; the packet says "a moved row is a STOP". I read that rule as about the pages (a capture or an answer that moves), and `(iso1)` as a statement about the harness that T9 changes by design. The operator may read it differently: see § *Open point for the operator*.** |
| 3 | The booking-proxy rows now reach a real `fetch` | before, the renderer had no `API_URL` and `callBackend` returned at once; now it sends the call and the stub drops it. The answer is the same (503 `unavailable`); two comments in `contract.test.mjs` that said "`API_URL` is unset" are corrected |
| 4 | A 404 is "not found" only with the body `{ code: "notFound" }` | the specification's table says "Backend 404 `notFound` → `null`". The API gateway answers its own 404 for a route that does not exist. Reading that as "not found" would show a buyer "Order Not Found" during a deploy — a failed dependency that looks like absence |
| 5 | The answer is built by picking the 17 fields, in addition to the projection | "the 17 fields and no other" is the boundary of the PD-002 exception; it must not depend on a projection being honoured (T4 row with a table that returns the whole item) |
| 6 | Every projected name has an alias (`#total` → `total`) | three of the 18 names are DynamoDB reserved words; one rule for all names closes the class, also for a name added to the list later (PROJECTION-RESERVED-1) |
| 7 | The D3 rows of T4 are a new file, `cmrc-1-order-lookup.test.ts`, not rows of `cmrc-1-self-service.test.ts` | that file's shared rows assume the body `{ email }` and a 200 "nothing found" answer for every route. A third shape would bend its assertions |
| 8 | The shared schema and types are in `packages/shared/src/orders-and-customers.ts`; `index.ts` is not edited | as `cmrc-1b` (since `refactor-shared-1` `index.ts` re-exports only) |
| 9 | `SitePage.tsx`: two lines differ — the old import line loses one name, one import line is added | "one import" (§ 5.4). No other line of the file changes |
| 10 | Comments corrected outside the path list of § 5.4: the header of `renderer/src/lib/dynamo.ts` (a dated addition), `renderer/src/lib/api-client.ts` (the key's scope), `backend/src/lib/commerce-db.ts` (its header said one renderer read is left) | each stated something that this change makes false (CLAUDE.md § "Chase ripples"). `dynamo.ts`: the comment said the backend client is reached "only from `/api/*` handlers … no callers under `components/`"; since this slice `SitePage` reaches it |
| 11 | Documents outside § 5.4's list: `CLAUDE.md` rule 10, `docs/authentication-architecture.md`, `docs/caching-architecture.md`, `docs/architecture-deep -dive.md`, `infra/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md`, `tools/mcp-server/ARCHITECTURE.md`, the two serving READMEs | the rule of `docs/slices/cmrc-1b.md` § *Revision 1*: every passage of a living document that speaks about the changed subject is read and brought to the new state |
| 12 | The oracle test's row count was corrected once before any source edit | a wrong COUNT in one assertion of the test (13 states, where the file holds 15). The capture file was not changed; its hash is recorded in the evidence directory, and control A2 shows a fresh baseline capture is byte-equal to it |
| 13 | New test files are named `cmrc-1-*` | the names of the specification's § 5.9, as `cmrc-1a` and `cmrc-1b` did |
| 14 | A second renderer test imports backend files (`cmrc-1-order-pages.test.ts` → `backend/test/unit/memory-table.ts`, `backend/src/customers/self-service.ts`) | the same edge as `cmrc-1-account-answers.test.ts` (`docs/slices/cmrc-1b.md` deviation 14): renderer TEST → backend, one direction; no file under `renderer/src` imports backend code |

### Open point for the operator (not blocking the review of the code)

- ID: CMRC1L-ISO1-ROW
  QUESTION: Is the edit of serving row `(iso1)` (deviation 2) accepted?
  PROBLEM: The packet says the serving suites must not move and a moved row is a STOP. The packet also puts T9 in
  scope: a backend stub for the order pages. T9 needs two new variables in the serving renderer's environment, and
  `(iso1)` fails on any variable that is not in its list. So T9 and "no existing row changes" cannot both hold.
  The build chose T9 and changed the list of `(iso1)` (two names, three value assertions).
  OPTIONS:
  - A. Accept. Reward: the existing rows that request the order pages keep proving them at the HTTP level, through
    the new transport. Risk: the hermetic harness now holds a renderer key variable; it is a fixed test value and
    the row asserts it, so an inherited key still fails.
  - B. Refuse: remove the stub and the two variables. Then 21 order-page requests of existing rows (`loc1-*`,
    `cdl2-*`) answer HTTP 500 and those rows fail, unless their order-page URLs are taken out — which removes HTTP
    coverage of these pages. Risk: larger than A.
  RECOMMENDED: A.

## Findings, not fixed

Each is recorded in `docs/TECH-DEBT.md` § "CMRC-1L residuals".

- **The PD-002 exception is an operator ruling the human has not confirmed.** If the human overrules it (option C,
  token links), this slice's route is replaced by a token lookup in a new slice; the data-module and renderer
  structure stay.
- **F-CMRC1-EMAIL-IN-PAGE-URL** stays open: the email is in the address of both pages.
- **F-CMRC1L-DEPLOY-WINDOW** — during a one-step deploy the two pages can answer HTTP 500 for some minutes
  (§ *Migration / deployment notes*).
- **F-CMRC1B-NO-TIMEOUT** now covers the order pages; latency is not measured.
- **F-CMRC1L-BUNDLE-COVERAGE** — the bundle target has no order-page row.
- **F-CMRC1L-CONFIRM-NOT-FOUND-LOOK** — the confirmation page says "Thank you for your order!" for an id that does
  not exist (pre-existing; preserved; the oracle pins it).
- **F-CMRC1L-SITEPAGE-COMMENT** — a header comment of `SitePage.tsx` says customer-private data is not server
  rendered; not true for the order pages, before and after. Not edited.
- **F-CMRC1-PUBLIC-ORDER-GET**, **F-CMRC1-CONFIRM-DISCOUNT**, **F-CMRC1-REQUIREROLE-NAME** stay open and preserved.
- A local `next dev` renderer needs `API_URL` and a renderer key for the two pages.
- The generated `*_MAP.md` files are not regenerated (F-CMRC1B-MAP-STALE).

## Migration / deployment notes

- **Data migration:** none. No item is read, written or moved differently in storage.
- **What the staging diff must hold** (these need the operator's explicit approval step):
  - `CommerceApi` nested stack, ADDED: `CustomerOrderLookupFunc29F199D2`,
    `CustomerOrderLookupFuncServiceRoleFDFD7FE9`, `CustomerOrderLookupFuncServiceRoleDefaultPolicyDF36752F`,
    `CustomerOrderLookupInt`, `CustomerOrderLookupRoute`,
    `CustomerOrderLookupFuncCustomerOrderLookupApiPermDE841578`; plus one log group
    (`CustomerOrderLookupFuncLogGroup…`: the deployed synth adds it, the test synth does not, so its suffix is not
    known here). Seven resources; the nested stack goes from about 271 to about 278 (limit 500).
  - IAM: ONE new role with ONE policy of two statements — DynamoDB read actions on the main table and its indexes.
    A Lambda permission for the API gateway to invoke the function. No statement on `AmodxCommerceTable`. No
    `events:PutEvents`, no SES, no secret on the role.
  - MODIFIED, code only (asset hash, no property besides the code location): the renderer server function and its
    assets; the two functions `CustomerOrderHistoryFunc` and `CustomerProfileReadFunc` (the same source file); and
    every backend function whose bundle includes `@amodx/shared` — expect MANY functions in all API stacks, as in
    `cmrc-1b` (the shared package gained a schema and a list; INFERRED from the bundler's rule, not measured per
    function: the operator's diff is the measurement); the admin bundle if it includes the changed shared file.
  - **Must NOT appear:** a change to any existing role, policy, variable, route or authorizer; a change to
    `CommerceTable6CC80189` or any other stateful resource; a variable or statement that names
    `AmodxCommerceTable`; a new route with `AuthorizationType: NONE`; a change to the renderer function's role or
    variables; a change in the parent stack other than code assets and the nested-stack pointers.
  Basis of the ids: the test synth (EXECUTED: row `(cmrc1b-4)` logs them). The ids of the two `cmrc-1b` groups in
  this synth equal the ones the staging diff of `cmrc-1b` showed, so the new ids are expected to be the same on
  staging (INFERRED: a logical id depends on the construct path, not on the stage).
- **Deploy order.** The route and the renderer change ship in ONE stack deploy. CloudFormation does not order the
  renderer function's new code after the nested stack's new route (INFERRED), so two windows are possible for some
  minutes:
  - *the renderer's new code runs before the route exists:* the API gateway answers its own 404; the renderer
    treats it as a failed dependency. **What a visitor sees:** a confirmation or tracking address WITH an order id
    and an email answers HTTP 500 (the framework's error page). A buyer who finishes the checkout in that window
    sees that error instead of the confirmation; the order exists and its mail is sent; a reload after the deploy
    shows the page. A confirmation address with no query, every other page, the account page, and every tenant
    without commerce: no change. Nothing is written and nothing is stored.
  - *the route exists and the renderer's old code still runs:* the old code reads DynamoDB as before. **No
    change.**
  **To have no window, deploy in two steps** (the specification's recommended production order, § 5.11): first a
  commit with the backend, shared and infra changes and `renderer/src` unchanged, then the full commit. The builder
  commits nothing; the operator can cut the two commits by path (`renderer/` last).
- **Rollback:** redeploy the previous commit. The renderer's old code reads the order from the main table again —
  correct for as long as the orders ARE in the main table, that is until `cmrc-4`. The route and its function are
  removed. No data to restore; the commerce table is not touched by this slice. The first window applies in reverse
  during the rollback deploy. **After `cmrc-4` this slice cannot be rolled back alone**: the old read would find no
  order.
- **Production sensitivity:** the renderer function serves every tenant. This slice changes the code of two page
  branches (`checkout-confirm`, `checkout-track`), reached only on a tenant with commerce enabled, and deletes one
  library file.
- **What a live non-commerce tenant sees (C7):** the same pages, bytes and headers. Evidence: both serving suites
  pass with no capture changed (EXECUTED). Production condition (NOT RUN): the operator's reference URLs before
  and after.

## Definition of Done

- [x] C3 [L]: `POST /customer/order-lookup` exists behind the commerce authorizer; the handler admits `RENDERER`
      (and `GLOBAL_ADMIN`) only; it answers the 17 fields and no other — T4, T4-auth, T7.
- [x] C4 [L]: `SitePage` reads the order through `customer-api.ts`; `dynamo-customer-reads.ts` and its re-export
      line are deleted — T3, T5, the function-name search of § *Build record*.
- [x] C1: no exception left in the key-ownership test; the control with a prefix put back fails.
- [x] C5 [L]: the two pages render byte-equal markup in every state — the page oracle, captured on the baseline,
      with controls; the field pin; the serving rows for the fixture orders.
- [x] C7: the serving suites pass (176, 61) with no capture changed.
- [x] The PD-002 exception is recorded as a dated amendment with its authority line; no document claims
      conformance for this read.
- [x] `tools/mcp-server/routes.json` +1; documents updated.
- [x] Gates of § *Build record* executed, each exit status recorded.
- [ ] Operator gates (§ *Evidence required*).
- [ ] The human's confirmation of CMRC-ORDER-LOOKUP-AUTHORITY = A (or an overrule).

## Evidence required

- EXECUTED by the builder: § *Build record*.
- EXECUTED / OBSERVED by the operator: the staging `cdk diff` against the list of § *Migration / deployment notes*
  (explicit approval of the function, the route and their IAM statements); the staging deploy; the route called
  with no credential and with a wrong key (refused by the authorizer) and with a tenant-admin token (403) — no key
  or token printed; a synthetic order seeded in the staging table (an address under `example.invalid`; deleted
  after the run), then the confirmation page and the tracking page of the test shop opened with the right email
  (the order), a wrong email and a wrong id (the "no order" look of each page, not an error page); the CloudWatch
  logs of the new function hold no email and no order id; the reference URLs of a non-commerce tenant equal before
  and after.
- NOT RUN by the builder: any AWS call, `cdk diff`, a deploy; `cd backend && npm test` (it writes to the live
  staging database; forbidden by the packet); a browser run of the two pages against a deployed backend; a
  measurement of the added latency.

## Exit criterion

The renderer holds no read of a commerce-private item, so the cutover gate of `docs/slices/cmrc-1.md` § 6 has no
renderer exception left. `cmrc-2` (the copy tool and the write freeze) can be written; `cmrc-4` can start once its
other conditions hold.

## Build record (2026-11-28, builder `claude-fable-5-2`)

Baseline `7200d38cf2af594cf2bd95a844ff160d36fdc8d5`; working tree clean at the start (EXECUTED: `git status --short`
→ empty). Nothing committed. Nothing stashed. Operational trail: `.agent-manager/slices/CMRC-1L/` (`build-progress.md`,
`evidence/`).

**Order of the round.** (1) This document with § V1-V3. (2) The page oracle and its capture on the untouched code.
(3) Shared schema, list and types. (4) Backend handler; the D3 rows of T4; T4-auth. (5) `customer-api.ts`, the
`SitePage` import, the deletions, T3, T5, T6, T8. (6) Infra and T7; T9 (the serving stub); `routes.json`. (7)
Documents. (8) The controls (a worktree), then the gates on the final code.

**Changed paths.**

| Path | For | Serves |
|---|---|---|
| `packages/shared/src/orders-and-customers.ts` | `OrderLookupRequestSchema`, `ORDER_VIEW_FIELDS`, `OrderViewField`, `OrderView` | C3 [L] |
| `backend/src/customers/self-service.ts` | `orderLookupHandler`; `notFound`; the frame takes the route's schema; reads return `ReadResult` | C3 [L] |
| `backend/src/lib/commerce-db.ts` | header text only (no renderer read is left) | ripple |
| `renderer/src/lib/customer-api.ts` | `getOrderForCustomer` over HTTP; `jsonObjectOf` | C4 [L] |
| `renderer/src/components/SitePage.tsx` | the import of `getOrderForCustomer` (two lines) | C4 [L] |
| `renderer/src/lib/dynamo-customer-reads.ts` | DELETED | C4 [L], C1 |
| `renderer/src/lib/dynamo.ts` | the re-export line deleted; a dated addition to one header comment | C4 [L]; ripple |
| `renderer/src/lib/api-client.ts` | comment: the key's scope gains the route | ripple |
| `infra/lib/api-commerce.ts` | `CustomerOrderLookupFunc`, its route, its place in `publishNoEvent` | C3 [L] |
| `tools/mcp-server/routes.json` | the route (142 routes, 30 local additions) | definition of done |
| `backend/test/unit/cmrc-1-order-lookup.test.ts` (new), `cmrc-1-self-service-auth.test.ts`, `cmrc-1-key-ownership.test.ts` | T4 D3 rows, T4-auth, T3 | C3, C1 |
| `renderer/test/unit/cmrc-1-order-pages.test.ts`, `cmrc-1-order-pages-before.json` (new) | the page oracle, the field pin | C5 [L] |
| `renderer/test/unit/cmrc-1-customer-api.test.ts`, `order-email-1.test.ts`, `cdl-2-site-page.test.ts`, `locale-1d-server-render.test.ts` | T5, T6, T8 | C4 [L] |
| `renderer/test/serving-contract/backend-stub.mjs` (new), `harness.mjs`, `contract.test.mjs` | T9; row `(iso1)`; two comments; one log line | C5, C7 |
| `infra/test/amodx-stack.test.ts` | T7 over three routes | C3 [L] |
| `packages/shared/test/cmrc-1-order-lookup-request.test.ts` (new) | the schema and the list | C3 [L] |
| `docs/slices/cmrc-1l.md` (new), `docs/platform-decisions.md`, `docs/slices/cmrc-1.md`, `docs/ROADMAP.md`, `CURRENT_SLICE.md`, `docs/TECH-DEBT.md`, `docs/commerce.md`, `docs/plan-commerce-private-table.md`, `backend/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, `infra/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md`, `tools/mcp-server/ARCHITECTURE.md`, `docs/authentication-architecture.md`, `docs/caching-architecture.md`, `docs/architecture-deep -dive.md`, `CLAUDE.md` (rule 10), `renderer/test/serving-contract/README.md`, `renderer/test/serving-bundle/README.md` | documents | packet item 8; ripples (deviation 11) |

Not edited (EXECUTED: `git status --short`, `git diff --stat` on the named files → empty): `infra/lib/renderer-hosting.ts`,
`infra/lib/amodx-stack.ts`, `infra/lib/database.ts`; `backend/src/auth/`, `backend/src/orders/` (among them
`public-get.ts`); the account routes and `AccountPageView.tsx`; `renderer/src/components/site-page/order-views.tsx`;
`renderer/middleware.ts`; the T1 files and the command-trace golden of `cmrc-1a`; `cmrc-1-self-service.test.ts` and
`cmrc-1-account-answers.test.ts` of `cmrc-1b`; every serving capture and fixture; any manifest or lockfile (no
package installed).

**Gates (EXECUTED 2026-11-28, in the packet's order, on the fresh build of the final code; logs and
`exits.txt` in `.agent-manager/slices/CMRC-1L/evidence/gates/`).**

| Gate | Command | Exit | Observed |
|---|---|---|---|
| G1 | `npm run build` | 0 | all workspaces |
| G2 | `npm run typecheck` | 0 | |
| G3 | `cd packages/shared && npm test` | 0 | 35 files, 706 tests passed |
| G4 | `npm --prefix backend run test:unit` | 0 | 101 files passed, 3 skipped (the golden-capture files); 2744 tests passed, 3 skipped. The command trace of `cmrc-1a` passes against its unchanged golden |
| G5 | `cd renderer && npm test` | 0 | 69 files, 1150 tests passed |
| G6a | `cd renderer && npm run test:serving` | 0 | 176 passed, 0 failed; backend stub: 16 lookups → 200, 5 → 404, 14 booking forwards dropped |
| G6b | `cd renderer && npm run test:serving-bundle` | 0 | 61 passed, 0 failed; backend stub: no request. No capture file changed (`git status --short -- renderer/test`: the test files, the two READMEs, the stub and the oracle files only) |
| G7 | `cd infra && npm test` | 0 | 99 passed; `(cmrc1b-4)` logs the ids of § *Migration / deployment notes* and `CommerceApi` 239 resources / 39 functions |
| G8 | `cd tools/mcp-server && npm test` | 0 | route coverage PASS; 23 passed; the report lists `customer: POST /customer/order-history, POST /customer/order-lookup, POST /customer/profile-read` among the routes with no tool |
| G9 | `git add -N` the six new files, `git diff --check`, then `git reset -q --` on those six | 0 | no output. The index holds no staged path before and after (EXECUTED: `git diff --cached --name-only` → empty both times) |
| controls | `bash .agent-manager/slices/CMRC-1L/evidence/controls.sh "$PWD"` | 0 | § *Proofs*, negative controls: no unexpected result |

**Searches (EXECUTED on the final tree; text searches, a lower bound — T3 is the syntax-tree check).**

- `git grep --untracked -n -E 'getOrderForCustomer|getCustomerOrders|getCustomerProfile' -- renderer/src`:
  `getOrderForCustomer` in `lib/customer-api.ts` and `components/SitePage.tsx` only (gate G8 of the specification,
  part L); the other two names in `lib/customer-api.ts` and the two API routes (and one comment line of
  `SitePage.tsx`).
- The four per-prefix searches of `docs/slices/cmrc-1.md` § 2.2 over `backend/src renderer/src tools scripts`: in
  `backend/src`, `lib/commerce-db.ts` and comment lines of five handler files (F-CMRC1A-COMMENT-HITS); **no hit in
  `renderer/src`**; in `scripts/`, S19 (`migrate-commerce-private-table.ts`).
- `git grep --untracked -n dynamo-customer-reads` outside documents: two lines of the key-ownership test and one
  comment of `customer-api.ts` (each says the file is deleted).

**End-to-end coverage.** The running software was exercised in four ways, none against AWS: the real `SitePage`
with the real backend handler and an in-memory table (the page oracle); the built renderer under `next start` with
a local DynamoDB stub and the backend stub (176 rows; 21 order-page reads went through the backend route); the
OpenNext bundle (61 rows; it requests no order page with an order); one real CDK synthesis (T7). No test calls a
deployed API gateway, authorizer, function or table: that is the operator's staging run.

## References

`docs/slices/cmrc-1.md` § 5.2 (C1, C3, C4, C5), § 5.4, § 5.6 (D3, the input rule, the value rule), § 5.7, § 5.8,
§ 5.9 (T4, T5, T6, T8, T9, T11), § 5.10-§ 5.12, § 6 (cutover gate), § 8 (CMRC-ORDER-LOOKUP-AUTHORITY), Appendix R;
`docs/slices/cmrc-1a.md`; `docs/slices/cmrc-1b.md`; `docs/platform-decisions.md` PD-001, PD-002 (the amendments of
2026-11-21 and 2026-11-28); `docs/VISION.md` guarantee 2; `docs/caching-architecture.md` § *Failed reads throw*,
§ *Serving contract*; `docs/plan-commerce-private-table.md`.

## Closeout (operator, 2026-11-28)

- Relay: builder `claude-fable-5-2`, reviewer `gpt-6.1-sol`, one cycle; review-0 `escalate` with one decision and
  no implementation finding.
- Operator ruling CMRC1L-ISO1-ROW = A (the reviewer's recommendation): the packet's rule "no serving row may move"
  gets ONE exception, the isolation row `(iso1)` of `renderer/test/serving-contract/contract.test.mjs`. The order
  pages now read through the backend, so the serving renderer of the harness gets `API_URL` (a loopback backend stub
  that answers `POST /customer/order-lookup` only and drops every other request) and `AMODX_API_KEY` (a constructed
  test key); the row lists both and asserts their values (the stub's `http://127.0.0.1:<port>` address; the test key,
  never an inherited one). No capture file and no fixture changed. Rejected: keeping the row frozen, which would
  remove the order pages from the serving suites. With this ruling no finding is open; closed out without another
  cycle.
- Operator gates on the candidate, each exit 0: build, typecheck, shared, plugins, renderer, serving (176),
  serving-bundle (61), admin unit, backend unit, infra, mcp, `git diff --check`; no change under `backend/src/auth`,
  `backend/src/orders`, `backend/src/reports`, `backend/src/resources`, `admin`, `scripts`, `renderer/middleware.ts`,
  `renderer/src/components/site-page`, the serving fixtures and captures, a manifest or a lockfile.
- Staging diff, read in full before the deploy. Added (7): `CustomerOrderLookupFunc`, its role, policy, log group,
  API permission, integration and route. IAM: the role may be assumed by Lambda, has the basic execution policy and
  READ actions on the main table and its indexes; API Gateway may invoke the function. No statement names the
  commerce table. Removed: nothing. Deploy: `AmodxStack-staging` succeeded.
- Staging proof, with ONE synthetic order seeded in `AmodxTable-staging` for `cm1-commerce` (an address under
  `example.invalid`, an internal-note marker; deleted after the run):
  - the route refuses no credential and a wrong key (403); as `GLOBAL_ADMIN` it answers the order view (13 of the 17
    fields are present for this order) without the internal note; a wrong email and a wrong id get the same answer,
    404 `{"code":"notFound"}`;
  - the pages, opened as a guest through the deployed renderer (which calls the route with the renderer key from
    Secrets Manager): the confirmation page and the tracking page show the order number with the right id and
    email, and no order data with a wrong email, a wrong id or no email; no page shows the internal note; after the
    delete the tracking page shows no order (no stored copy of the page);
  - the general smoke and the page render check pass.
  This is also the staging proof that the deployed renderer reaches the backend through `callBackend` with its
  key, which `cmrc-1b` could not show.
- NOT proven on staging: the look of the pages (only marker text was compared; the before/after captures of the unit
  suite pin the markup); the backend-failure and timeout presentation on a deployment.
- The PD-002 amendment in `docs/platform-decisions.md` is an operator ruling, not yet confirmed by the human.
