# CMRC-1B — the site's account pages read orders and profile through the backend; an empty commerce-private table

- **Status:** IMPLEMENTED 2026-11-28 — built, operator gates pending (the staging diff holds a new table, two
  functions, two routes and their IAM statements, which need the operator's explicit approval; then the staging
  deploy, the two routes called with and without the renderer key, the account pages of the test shop).
- **Track:** B (commerce-private). Second build slice of the track.
- **Depends:** `cmrc-1a` (built; on staging since 2026-11-28): `backend/src/lib/commerce-db.ts`. Operator ruling
  CMRC-TABLE = B (`docs/slices/cmrc-1.md` § 8; the human's standing rule of 2026-11-27). No other open decision of
  § 8 is needed: CMRC-ORDER-LOOKUP-AUTHORITY blocks part L only, and part L is not in this slice.
- **Source plan:** `docs/plan-commerce-private-table.md`; specification `docs/slices/cmrc-1.md` (reviewed draft,
  revision 3). This slice is the pre-agreed split `cmrc-1b` of its § 5.15: requirements **C3, C4, C5, C6, C7, part K
  only** — no item marked **[L]**.
- **Maturity:** `backend/src/customers/self-service.ts`, `renderer/src/lib/customer-api.ts` and the moved
  `callBackend` are PROTOTYPE until the operator's staging run passes. The table is PROTOTYPE (empty, used by nothing).
- **Baseline:** `9d454f5` (HEAD at the start of the slice; the working tree was clean).

## Guarantee scope (what is true after this slice, and what is not)

| Part | Statement | Basis |
|---|---|---|
| **True** | The renderer's account routes (`GET /api/account/orders`, `GET /api/profile`) read no DynamoDB item of a customer. They ask the backend with the renderer key; the backend reads through `commerce-db.ts` | § *Proofs* T4, T5, the answer characterization, T3 |
| **True** | The functions `getCustomerOrders` and `getCustomerProfile` that read DynamoDB are gone from the renderer (S17, S18 of `docs/slices/cmrc-1.md` § 2.2) | T3: its list of permitted renderer reads holds one entry |
| **Retained exception** | S16 `getOrderForCustomer` in `renderer/src/lib/dynamo-customer-reads.ts` still builds an `ORDER#` key and reads the main table for the order confirmation and tracking pages. Part L of `cmrc-1` removes it; it waits for the human's confirmation of CMRC-ORDER-LOOKUP-AUTHORITY | OBSERVED in the file; T3 permits exactly this one read |
| **Retained, operational** | S19 `scripts/migrate-commerce-private-table.ts` keeps its own prefix list (`cmrc-2`) | not changed |
| **Not claimed** | `docs/VISION.md` guarantee 2 is NOT met. The renderer function still has read access to the whole main table (`infra/lib/renderer-hosting.ts`, `grantReadData`), and every order and customer item is still in that table. This slice removes two of the three places where renderer CODE reads them. The IAM reach ends only when the data leaves the main table (`cmrc-4`, `cmrc-6`) | — |
| **Not claimed** | That the new table protects anything. It is empty; no function has its name; no role has a statement on it | T7 |

## Purpose / risk retired

The risk retired: **the public renderer is the reader of a customer's order history and profile.** Before this
slice, two renderer functions build `CUSTORDER#` and `CUSTOMER#` keys and read the main table themselves. Track B
moves these items to a table the renderer cannot read (`docs/VISION.md` guarantee 2; PD-002). That move cannot
start while renderer code reads the items directly: after the move, such a read would find nothing. After this
slice the two account reads go through two backend routes, so the later storage move (`cmrc-4`) changes one binding
in `commerce-db.ts` and the account pages follow with no renderer edit.

Second purpose: **the destination table exists before anything depends on it** (CMRC-TABLE = B). A stateful
resource is reviewed alone, in a diff that cannot break a function. `cmrc-2` proves its copy tool against this
empty table on staging.

The property this slice must not break: every answer the account routes give today — status code and JSON body for
an unknown host, an anonymous visitor, a signed-in customer with no order, a customer with orders, a customer with
and without a profile record, and a failed dependency.

## Scope

1. Backend: `backend/src/customers/self-service.ts` (new) — `orderHistoryHandler` (`POST /customer/order-history`,
   D1) and `profileReadHandler` (`POST /customer/profile-read`, D2). `backend/src/lib/commerce-db.ts` gains
   `orderIdOfCustomerOrder` (left out by `cmrc-1a` because it had no caller).
2. Shared: `CustomerSelfRequestSchema`, `StoredValue`, `OrderHistoryEntry`, `CustomerProfileView` in
   `packages/shared/src/orders-and-customers.ts` (`index.ts` already re-exports the file with `export *`).
3. Renderer: `forward` moves from `booking-proxy.ts` to `api-client.ts` as `callBackend`; `customer-api.ts` (new);
   the two account routes import from it; `getCustomerOrders` and `getCustomerProfile` are deleted from
   `dynamo-customer-reads.ts` and from the re-export of `dynamo.ts`.
4. Infrastructure: `AmodxCommerceTable<suffix>` in `infra/lib/database.ts`; two functions and two routes in
   `infra/lib/api-commerce.ts`.
5. Tests: T4, T5, T7, T10 of `docs/slices/cmrc-1.md` § 5.9, the T2 row for `orderIdOfCustomerOrder`, the T3 list
   (three permitted renderer reads → one), the authorizer rows for the two route keys, the shared schema rows, and
   the account-answer characterization (§ *Proofs*).
6. `tools/mcp-server/routes.json` (`localAdditions` +2), documents.

## Non-scope

- Every **[L]** item: `POST /customer/order-lookup`, `OrderView`, `OrderLookupRequestSchema`, any `SitePage` edit,
  T6, T8, T9, T11. `getOrderForCustomer` stays where it is.
- No data copy. No `COMMERCE_TABLE_NAME`. The binding `COMMERCE_TABLE` in `commerce-db.ts` is not changed.
- The anonymous `GET /public/orders/{id}`; `EMAILLIMIT#`; `COUPONUSE#`.
- The account page's session handling: the three `authOptions` copies in the two route files stay as they are.
- The profile update (`POST /api/profile` → `POST /public/customers/profile`): not changed.
- No fix of a finding of `docs/slices/cmrc-1.md` § 10.3 or of § *Findings, not fixed* below.
- The renderer function's role and variables: not changed.

## Architectural boundaries

- **Tenant isolation.** Each new read is keyed `TENANT#<x-tenant-id>`. The renderer sets that header from the
  tenant record it found for the request's host (`getTenantConfig(host)`), never from a browser value.
- **Customer identity (PD-002, session variant).** The email in the body of D1 and D2 is the email of the
  validated NextAuth session. The account routes read nothing of the browser request except the `host` header.
  The backend admits the `RENDERER` role (and `GLOBAL_ADMIN`, which `requireRole` always admits) and no other.
- **No scan.** One Query on `PK` + `begins_with(SK)` and one GetItem, both with a projection; reserved words
  (`total`, `status`, `name`) are aliased.
- **Dependency direction.** Renderer: route → `customer-api.ts` → `api-client.ts`. Backend: handler →
  `commerce-db.ts` → `db.ts`. `packages/shared` gains a schema and three types, no I/O. No new cycle.
- **Data across the boundary.** Raw JSON: `{ email }` in; `{ orders: [...] }` / `{ profile: {...} | null }` out. No
  SDK object, no framework object.
- **Key ownership (CLAUDE.md rule 10).** The new handler file holds no key prefix; it spreads references of
  `commerce-db.ts` into its commands.

## Verification before building (packet item 1; on the baseline `9d454f5`, before any source edit)

### V1 — what the two account routes answer today (the oracle for C5)

Read: `renderer/src/app/api/account/orders/route.ts`, `renderer/src/app/api/profile/route.ts` (GET),
`renderer/src/lib/dynamo-customer-reads.ts`. OBSERVED:

| Input class | `GET /api/account/orders` | `GET /api/profile` |
|---|---|---|
| The host has no tenant record | 404 `{ "error": "Tenant not found" }` | the same |
| No session, or a session without an email (also an empty email: the check is `!session?.user?.email`) | 401 `{ "error": "Unauthorized - please sign in" }`; no customer read | the same |
| Session; nothing stored for the email | 200 `{ "orders": [], "email": <session email> }` | 200 `{ "email": <session email> }` |
| Session; stored rows | 200 `{ "orders": [ { orderNumber, total, status, createdAt, orderId } … ], "email": <session email> }`. Each field is the stored attribute as it is; `orderId` is the text after the last `#` of the sort key. Order: newest `createdAt` first (`new Date(b.createdAt) - new Date(a.createdAt)`; rows that compare equal keep the order of the Query, which is the sort-key order). All pages are read | 200: the stored item reduced to the attributes `email, name, phone, birthday, defaultAddress` that it has. An item with none of the five answers `{}` (the route's `profile \|\| { email }` keeps `{}` because an empty object is truthy) |
| The email in another form (upper case, spaces, fullwidth) | the same rows: the key is built from `normalizeEmail(email)`; the answer's `email` is the session's text, not the normalized form | the same item |
| An email that matches nothing (`an a@example.com`, `a#b@example.com`, a long string) | 200 `{ "orders": [], "email" }` — no format check exists | 200 `{ "email" }` |
| The read fails (DynamoDB error, `TABLE_NAME` missing) | 500 `{ "error": "Failed to fetch orders" }` | 500 `{ "error": "Failed to fetch profile" }` |
| The browser sends `?email=`, a body, `x-tenant-id` | not read: the route reads `host` and the session only | the same |

Facts that the new code must keep and that the names do not reveal:

- The order of the keys in each order object is fixed by the route's own `map` (`orderNumber, total, status,
  createdAt, orderId`), so the JSON text of the order list is deterministic today. The backend handler builds the
  object in that order and the characterization compares the body TEXT.
- A stored row without an attribute gives `undefined`, which JSON leaves out. So "absent stays absent" already holds.
- The profile's key order is the order DynamoDB returns, which is not defined. The characterization compares the
  profile by value, not by text.
- The projections alias the reserved words: `#total`, `#s` (status), `#n` (name) (PROJECTION-RESERVED-1).

These answers are captured as a test BEFORE the first source edit: `renderer/test/unit/cmrc-1-account-answers.test.ts`
(§ *Proofs*). The same file, unchanged, passes after the change.

### V2 — how `forward` of `booking-proxy.ts` works (the means to reuse)

Read: `renderer/src/lib/booking-proxy.ts:193-224`, `renderer/src/lib/api-client.ts`. OBSERVED:

- **Signature:** `forward(route, tenantId, body?)` → `Promise<Response | null>`.
- **URL:** `process.env.API_URL` without a trailing `/`, then `route`. Not set → logs `API_URL is not set`,
  returns `null`, sends nothing.
- **Key:** `getRendererKey()` of `api-client.ts`: `process.env.AMODX_API_KEY` if set (local development), else the
  secret named by `AMODX_API_KEY_SECRET` from Secrets Manager (cached in the module after the first read). An empty
  key → logs `no renderer key`, returns `null`, sends nothing.
- **Headers, exactly:** `x-api-key`, `x-tenant-id`, and `content-type: application/json` when a body is given. No
  header of the browser request.
- **Method:** POST when a body is given, else GET. `cache: "no-store"`.
- **Timeout:** none. The call has no abort signal; it ends when the backend answers or the connection fails (the
  backend functions have a 29 s limit, the API gateway 30 s). Not changed by this slice.
- **Error mapping:** a thrown `fetch` → one log line with the route (query removed) and the error's NAME, returns
  `null`. Any HTTP status, also 4xx and 5xx, is returned as the `Response`: the caller decides.
- **Callers:** `handleBookingApi` and `handleBookingFeed` in the same file. No other file imports `forward`
  (EXECUTED: `git grep -n "forward\b" -- renderer/src renderer/test`; a text search, a lower bound; the TypeScript
  build after the move is the complete check — a remaining import would not compile).
- **The test seam today:** `renderer/test/unit/sched-1g-proxy.test.ts:16` replaces the whole module
  `@/lib/api-client` with `{ getRendererKey }`. After the move that replacement would also remove `callBackend`, so
  the test's SETUP must change (T10 of the specification); its assertions do not.

### V3 — what the scheduling visitor handlers check (the role rule to reuse)

Read: `backend/src/scheduling/visitor/common.ts:48-80`, `backend/src/auth/policy.ts:29-79`,
`backend/src/auth/authorizer.ts:126-150`. OBSERVED:

- The authorizer compares `x-api-key` with the master key (→ role `GLOBAL_ADMIN`, tenant `ALL`) and then with the
  renderer key (→ `{ sub: "renderer", role: "RENDERER", tenantId: "ALL" }`), on every route, before any other rule.
  A request with no credential is refused by the authorizer on every route except three anonymous route keys
  (`POST /leads`, `POST /contact`, `POST /consent`). The new route keys are not among them.
- The visitor frame calls `requireRole(auth, ["RENDERER"])` with NO target tenant (the renderer's tenant is `ALL`,
  which equals no tenant id). A refusal throws; the frame answers 403.
- `requireRole` does not do what its name and argument say in one case: it admits `GLOBAL_ADMIN` whatever the list
  holds (`policy.ts:39`). It refuses `SERVICE` when the handler passes no scope, and it treats a missing role as
  `EDITOR`. So `requireRole(auth, ["RENDERER"])` means "the renderer key or the master key" (finding
  F-CMRC1-REQUIREROLE-NAME of the specification; not changed here).
- The tenant comes from the `x-tenant-id` header that the admitted caller sets.

The new handlers use the same call. Their order of checks is the specification's (§ 5.6): role → `x-tenant-id` →
body structure → `normalizeEmail` → the read. (The visitor frame checks the tenant header before the role; the
specification puts the role first so that a caller without the role learns nothing about the request shape.)

### V4 — how the commerce nested stack declares a `RENDERER`-role route

Read: `infra/lib/api-commerce.ts:54-129`, `:315-324`. OBSERVED:

- The existing example is `POST /public/customers/profile`: `addRoute('PublicUpdateCustomer', 'POST
  /public/customers/profile', publicUpdateCustomerFunc)` with no `noAuth` option. `addRoute` then creates the route
  with `authorizationType: 'CUSTOM'` and the nested stack's own `CfnAuthorizer` (`CommerceAuthorizer`, which calls
  the parent's authorizer function), an `AWS_PROXY` integration, and a Lambda permission for the API gateway.
- Nothing in the infrastructure says "renderer only": the authorizer admits any valid credential and passes the
  role; the HANDLER refuses the other roles. So the role rule is proven by the handler tests (T4), and the
  infrastructure test proves "not anonymous" (`CUSTOM`).
- `nodeProps.environment` holds `TABLE_NAME`, `EVENT_BUS_NAME`, `RENDERER_URL`, `REVALIDATION_SECRET_NAME`. The new
  functions get `TABLE_NAME` only.

## Data that crosses the renderer → backend boundary

Both routes: POST; headers exactly `x-api-key`, `x-tenant-id`, `content-type: application/json`; request body
`{ "email": "<non-empty string>" }` and no other field (`CustomerSelfRequestSchema`, strict). Answer header
`Cache-Control: no-store`.

| Id | Route | Answer 200 | Read |
|---|---|---|---|
| D1 | `POST /customer/order-history` | `{ "orders": OrderHistoryEntry[] }`, newest first, as V1 | Query `customerOrdersQuery(tenant, normalizeEmail(email))`, all pages, projection `orderNumber, #total, #s, createdAt, SK` |
| D2 | `POST /customer/profile-read` | `{ "profile": CustomerProfileView \| null }` — the item as DynamoDB returns it; `null` when there is none | GetItem `customerRef(tenant, normalizeEmail(email))`, projection `email, #n, phone, birthday, defaultAddress` |

**Input rule.** A value that cannot match a stored record is answered as "nothing found" (`{ orders: [] }`,
`{ profile: null }`), never as an error. No format check and no length bound on the email. **Value rule.** Each
field is the stored attribute, passed through: no schema parse, no default, no `null` removed.

Refusals (a closed sum in the handler file, one exhaustive `switch`, no `default` arm):

| Kind | HTTP answer | When |
|---|---|---|
| `forbidden` | 403 `{ "code": "forbidden" }` | `requireRole` refused the caller |
| `missingTenant` | 400 `{ "code": "missingTenant" }` | no `x-tenant-id` |
| `malformedRequest` | 400 `{ "code": "malformedRequest", "issues": [{ path, message }] }` | the body is not a JSON object of exactly one non-empty string field `email`. The renderer never builds such a body, so this is a renderer defect. No request text is in the answer |

A DynamoDB failure is not a refusal: it throws, the frame answers 500 `{ "code": "internal" }` and logs the route
name and the error's NAME only.

Renderer side (`customer-api.ts`): 200 → the value; any other status, a 200 whose body is not the route's answer,
or no call possible → throws `CustomerApiError` (`route`, `status`: the number, `"unreachable"` or
`"malformedAnswer"`; never the email). The route's existing `catch` then gives today's 500 answer.

## Proofs

| Id | File | Proves | What it cannot see |
|---|---|---|---|
| **C5 characterization** | `renderer/test/unit/cmrc-1-account-answers.test.ts` (new; 39 rows) | **C5.** From stored items and a session to the status and body of `GET /api/account/orders` and `GET /api/profile`, for every input class of § V1. The file stands below both transports: before, the route reads the in-memory table through the renderer's DynamoDB client; after, the route calls `fetch`, and the test's "local backend" passes the call to the REAL handler of `self-service.ts`, which reads the same table. The same file (sha256 `53cb4549…`) passes on a worktree of the baseline `9d454f5` and on the changed tree. The order list is compared as TEXT (key order included); the profile by value | the real DynamoDB (the table is `backend/test/unit/memory-table.ts`); the real authorizer (the local backend refuses a call without the test's key — a stand-in); the infrastructure; the latency |
| T4 | `backend/test/unit/cmrc-1-self-service.test.ts` (new; 82 rows) | **C3.** Per route: `RENDERER` and `GLOBAL_ADMIN` pass; `TENANT_ADMIN`, `EDITOR`, `CUSTOMER`, `SERVICE`, no role, anonymous, another letter case, no authorizer context → 403 and NO DynamoDB command; a refused caller gets 403 also for a malformed request; no `x-tenant-id` → 400; body absent / not JSON / not an object / field absent / not a string / empty / extra field → 400 with the path, no request text, no command; three written forms of one address read one key; the input-rule emails → "nothing found" after the same read; the commands equal the pre-slice renderer commands (written as literals); two and three pages; sort; value rule; `{}` profile; DynamoDB failure → 500 and one log line with the route and the error's name | the real DynamoDB; that the renderer sends the session's email |
| T4-auth | `backend/test/unit/cmrc-1-self-service-auth.test.ts` (new; 8 rows) | The REAL authorizer on the two route keys: no credential or a wrong key → refused (no handler runs); the renderer key → `RENDERER`, then the real handler answers 200 for the tenant of `x-tenant-id`; a valid admin token of the same tenant → admitted by the authorizer as `TENANT_ADMIN`, refused by the handler with 403, nothing read | the API gateway's HTTP status for a refused authorizer (staging) |
| T2 (row added) | `backend/test/unit/cmrc-1-commerce-db.test.ts` | `orderIdOfCustomerOrder` is the inverse of `customerOrderRef` for the order id and equals `sk.split("#").pop()` (the pre-slice rule) for five sort-key shapes | — |
| T3 (list changed) | `backend/test/unit/cmrc-1-key-ownership.test.ts` | **C1 / C4.** In `backend/src`, `renderer/src`, `packages/*/src` the four prefixes are written in `commerce-db.ts` and in exactly ONE renderer read (`getOrderForCustomer`). The list is compared for equality. The precondition row now also requires that the walk read `backend/src/customers/self-service.ts` and `renderer/src/lib/customer-api.ts` | as in `docs/slices/cmrc-1a.md`: a prefix joined at run time; `scripts/`, tests, `admin/`, `tools/`, `infra/` |
| T5 | `renderer/test/unit/cmrc-1-customer-api.test.ts` (new; 53 rows) | **C4 and the identity rule.** Through the real `callBackend`: one POST per function, exactly three headers, the body `{ email }` as given; 400/401/403/404/429/500/502/503 → `CustomerApiError` with the route and the status; failed call / no `API_URL` / no key → `unreachable` (nothing sent for the last two); a 200 body that is not the route's answer → `malformedAnswer`; values deep-equal. The routes: no session → 401 and NO backend call; a session → one call with the session's email and the HOST's tenant; `?email=`, a body, `x-tenant-id`, `x-api-key`, `cookie`, `authorization`, `x-forwarded-for` of the browser are not forwarded; a backend failure (500, 403, the gateway's 404 for a route that does not exist yet, a failed call) → the route's fixed 500 text. `api-client.ts` and `customer-api.ts` hold no address extraction | the backend's side of the call (T4) |
| T7 | `infra/test/amodx-stack.test.ts` rows `(cmrc1b-1)`…`(cmrc1b-5)` | **C6, C3 infra.** The table: one, in the parent, PK/SK strings, PAY_PER_REQUEST, PITR, Retain (delete and replace), no GSI/LSI, no stream, no TTL, no resource policy, no other property but the stack tags. Nothing uses it: no resource, output or parameter of any template mentions it (seven mention forms are each detected on a probe); no function variable by name or value; every DynamoDB grant of the stack tree has a table shape and denotes the main table or the renderer's tag-cache table, never this one (a probe grant IS resolved to it). The two routes: once in the tree, in the commerce nested stack, `CUSTOM` with that stack's authorizer, each on its own function and handler name. Each function: `TABLE_NAME` its only variable; its own role with the one AWS logging policy; every statement an Allow of read actions on the main table; together exactly the read set. Every OTHER commerce function still has `events:PutEvents`. The renderer function: no variable names the table; its DynamoDB grants denote the main table and its tag-cache table only | the deployed stacks (the operator's staging diff); "the renderer's role is unchanged" as a diff — `infra/lib/renderer-hosting.ts` and `amodx-stack.ts` are not edited (EXECUTED: `git status`), so INFERRED |
| T10 | `renderer/test/unit/sched-1g-proxy.test.ts` (setup changed) | **The move changed nothing for scheduling.** The module mock of `@/lib/api-client` is removed (it would also remove `callBackend`); the key comes from `AMODX_API_KEY`. No `expect` line is edited (the diff: the header sentence, the two mock lines, the key setup in `beforeEach`, the restore in `afterEach`, two key assignments inside one test). All rows pass | — |
| shared | `packages/shared/test/cmrc-1-self-request.test.ts` (new; 16 rows) | `CustomerSelfRequestSchema`: exactly `{ email: non-empty string }`; no format rule, no length bound; the email is returned unchanged | — |

**Named identity tests (packet item 4).**

| Case | Test (file › row) |
|---|---|
| A call without the renderer role is refused and reads nothing | T4 › "… → 403 forbidden, and nothing is read" (eight callers × two routes); T4-auth › "a valid admin token of the same tenant → … the HANDLER answers 403 and reads nothing"; T4-auth › "no credential → refused by the authorizer" |
| The tenant comes from `x-tenant-id`, which the renderer sets from the host's tenant record | T4 › "the tenant is the x-tenant-id header: …" (both routes); T5 › "a session → ONE call: the session's email, the HOST's tenant, three headers" and "the tenant of the call follows the host, not the session and not the browser" |
| Another customer's email cannot be reached by anything the browser sends | T5 › "%s → 401, and NO backend call — also when the browser names a customer"; T5 › "a session → ONE call … Nothing of the browser request is forwarded"; characterization › "nothing the BROWSER sends selects the customer or the tenant: ?email=, a body, x-tenant-id, x-api-key are not read" (both routes; every key read is the session customer's) |

**Negative controls (EXECUTED; `.agent-manager/slices/CMRC-1B/evidence/controls.sh`, results in `controls-results.txt`).**
A disposable worktree of `9d454f5` (`/tmp/CMRC-1B-baseline`, removed by a `trap`); the working tree is not touched.

| Control | Result |
|---|---|
| A. The characterization file on the UNTOUCHED baseline (no handler file, no `customer-api.ts`; `git status` of the worktree: only the test file) | exit 0, 39 passed |
| B0. The candidate copied into the worktree: characterization; T5 + T10; T3 + T4 | exit 0: 39; 145; 90 passed |
| B1. Handler sorts oldest first | characterization exit 1, 4 failed |
| B2. Handler answers `{}` for "no record" | characterization exit 1, 7 failed |
| B3. `customer-api` turns a backend failure into "nothing found" | characterization exit 1, 2 failed; T5 exit 1, 19 failed |
| B4. **The two deleted renderer reads put back** (the baseline `dynamo-customer-reads.ts`) | T3 exit 1; the failure names `getCustomerOrders` and `getCustomerProfile` |
| B5. Handler admits `TENANT_ADMIN` | T4 exit 1, 4 failed |
| B6. The orders route takes the email from `?email=` | characterization exit 1, 1 failed; T5 exit 1, 1 failed |
| B7. Handler passes zod's unknown-field message (it quotes the field name) | T4 exit 1, 2 failed |
| B8. Candidate restored | characterization exit 0, 39 passed |

Control A used the main checkout's `node_modules`, so `@amodx/shared` was the build of the changed tree (one schema
and three types more; nothing the baseline renderer code reads changed).

## Abstraction record

| What | Concrete current users | Named axis of variation (dispatch) | Simpler alternative rejected |
|---|---|---|---|
| `callBackend` (`renderer/src/lib/api-client.ts`) | `booking-proxy.ts` (two handlers, under its local name `forward`) and `customer-api.ts` (two functions) | none: one function. It removes a duplicate at a documented boundary (renderer → backend, PD-002) | a second copy of `forward` in `customer-api.ts`; or importing commerce calls from a file named `booking-proxy` |
| `customer-api.ts` | the two account routes | the transport of the customer reads, changed by the ratified Track B (DynamoDB before, the backend now; part L adds the order-page read) | a `callBackend` call inside each route. **Is it smaller?** Yes, by about 25 lines. **Does it lose nothing?** No. It loses (1) the one-line route diff: with the module, each route changes its import and no line of its session, tenant or answer logic — so "C5 by construction" can be read from the diff; (2) one place for the rule "what counts as an answer" (two callers now, three with part L). Kept as a module for these two reasons |
| `SelfServiceRefusal` (closed sum, exhaustive `switch`) | the two handlers | fixed variants (sum type): part L adds `notFound`, and the compiler then names `refusalAnswer` | a status code at each `return` |
| `selfServiceRoute` (file-local frame) | the two handlers | none: one access and input rule | the block written twice |
| `CustomerSelfRequestSchema`, `StoredValue`, `OrderHistoryEntry`, `CustomerProfileView` (shared) | the backend handlers (parse, answer types) and `customer-api.ts` (answer types) | a documented boundary (renderer → backend DTOs; Critical Rule 4) | the types written twice |
| `publishNoEvent` list in `infra/lib/api-commerce.ts` | the stack's event-bus loop | the functions of the commerce stack that publish no audit event: today the two read functions | removing the loop for a per-function grant (changes 36 existing roles; F-CMRC1B-EVENTBUS-LOOP) |

No interface, no port, no new package, no configuration layer.

## Deviations and local decisions

| # | What | Why |
|---|---|---|
| 1 | The shared schema and types are in `packages/shared/src/orders-and-customers.ts`; `index.ts` is not edited | the packet (step 3) and Critical Rule 4: since `refactor-shared-1` `index.ts` re-exports only, and it already has `export * from "./orders-and-customers.js"`. The specification's § 5.4 names `index.ts` (written before that refactor) |
| 2 | `infra/lib/api-commerce.ts`: the event-bus loop at the end of the constructor skips the two new functions | **found by T7, not known to the specification.** The loop grants `events:PutEvents` to every function of the nested stack. § 5.8 says "no event bus" and the packet says "read-only statements on the main table and nothing else". The edit excludes exactly the two; row `(cmrc1b-4)` asserts that every other commerce function keeps the grant, so no existing role changes |
| 3 | `CustomerApiError.status` has a third value, `"malformedAnswer"` | the specification gives `number \| "unreachable"`. A 200 body that is not the route's answer (not JSON, no `orders` list, a `profile` that is not an object or `null`) would otherwise become `undefined`, which the orders route turns into an EMPTY list — a failed dependency that looks like "no orders" |
| 4 | The handler replaces zod's message for an unknown field with `Unrecognized field.` | that zod message quotes the field's NAME, which is request text; § 5.7 says the refusal never echoes a value. Every other zod message for this schema quotes nothing (rows of T4) |
| 5 | `booking-proxy.ts` imports `callBackend as forward` | the packet permits one edit of that file: the import of the moved function, no other line. With the alias the two call sites and the header comments (which name `forward`) stay true and untouched; the import line carries a comment that says where the function is |
| 6 | `renderer/src/app/api/profile/route.ts`: three comments changed besides the import | they said "GET reads directly from DynamoDB", "API_URL … (POST only)" and "No backend GET route exists". After the change each would be false |
| 7 | T10 changes five setup lines of `sched-1g-proxy.test.ts`; the packet says the scheduling proxy tests pass "unchanged" | the specification's T10 (which the packet lists) requires the setup change: the file replaced the whole `@/lib/api-client` module, which now holds `callBackend`. No assertion is edited (§ *Proofs* T10 lists the changed lines) |
| 8 | The characterization file was corrected once after its first baseline run | its path to the backend handler was a computed RELATIVE import; the test runner resolves that against the project root, so the handler was not found (27 rows failed on the changed code). That path is not reached on the untouched code, so the first baseline run could not see it. Corrected to an absolute path from `import.meta.url` (one constant and one import; no assertion and no fixture edited). The corrected file was then run on the baseline again (control A): that run, not the first one, is the evidence |
| 9 | Three expectations of T7 were corrected after the first synth | assumptions not checked before writing: the table carries the stack's tags; a third table exists (the renderer's OpenNext tag cache), so "the only table granted is the main table" is false for the renderer; `NodejsFunction` sets no connection-reuse variable in this synth. The rows now state the observed facts |
| 10 | New test files are named `cmrc-1-*`, the slice is `cmrc-1b` | the names of the specification's § 5.9, as `cmrc-1a` did |
| 11 | `CLAUDE.md` rule 10 is updated (one line) | it said "three renderer reads" and "permits exactly those three reads"; after this slice that is false. Not in the packet's document list; a dependent reference of the change (CLAUDE.md § "Chase ripples") |
| 12 | `docs/authentication-architecture.md` and `docs/caching-architecture.md` are updated | each stated that the account routes read DynamoDB. Not in § 5.4's document list; the same ripple rule |
| 13 | The handlers check the role before the tenant header (the scheduling visitor frame checks the tenant first) | the specification's order (§ 5.6): a caller without the role learns nothing about the request shape (T4 row) |
| 14 | **A new dependency edge, in a test only: renderer test → backend.** `renderer/test/unit/cmrc-1-account-answers.test.ts` imports `backend/test/unit/memory-table.ts` and loads `backend/src/customers/self-service.ts` | the packet asks for one test that passes before and after the change; that needs the stored data below both transports, and after the change the transport ends in the backend handler. No file under `renderer/src` imports backend code; no backend file imports the renderer, so the graph stays a DAG. Consequences: `cd renderer && npm test` and the renderer typecheck now read those two backend files (EXECUTED: both pass). Rejected: a second in-memory table and a hand-written copy of the handler's answer in the renderer test — the copy would be the thing under test. Recorded in `renderer/ARCHITECTURE.md` (read-layer rule, "Tests") |

## Findings, not fixed

Each is recorded in `docs/TECH-DEBT.md` § "CMRC-1B residuals".

- **F-CMRC1B-ACCOUNT-PAGE-HIDES-FAILURE** (OBSERVED, `renderer/src/components/AccountPageView.tsx:101-102`) — the
  page reads a failed answer of the two routes as "no orders" / "no profile". Not new; it now also covers a failed
  backend call.
- **F-CMRC1B-NO-TIMEOUT / latency** (OBSERVED in the code; NOT measured) — each account read is now an API-gateway
  call with the authorizer function and a read function. `callBackend` has no timeout of its own.
- **F-CMRC1B-EVENTBUS-LOOP** (EXECUTED: T7's first run) — four API stacks grant the event bus to every function by a
  loop, also to read-only functions.
- **F-CMRC1B-PARENT-HEADROOM** (EXECUTED: `(sched1b-4)` log) — the parent template is at about 479 of 500 resources.
- **F-CMRC1B-RENDERER-KEY-SCOPE-COMMENT**, **F-CMRC1B-SCANCOMMAND-IMPORT**, **F-CMRC1B-MAP-STALE** — see
  `docs/TECH-DEBT.md`.
- **The source check of `sched-1g-proxy.test.ts`** ("the proxy source holds no address extraction") reads
  `booking-proxy.ts` only; the request headers are now written in `api-client.ts`. The behaviour rows of that file
  still cover the moved function (they run the real `callBackend` and compare the recorded headers), and T5 adds
  the same source check for `api-client.ts` and `customer-api.ts`. The scheduling test's assertion is not edited.
- **F-CMRC1B-APICLIENT-COMMENT** (OBSERVED, `renderer/src/lib/dynamo.ts:42-45`; found in revision 1) — a source
  comment says the callers of `lib/api-client.ts` forward an empty key and are `/api/*` handlers only. Not true for
  `callBackend`'s users. Not edited (this slice may change one line of that file); the two documents that state the
  rule are corrected.
- **F-CMRC1-REQUIREROLE-NAME**, **F-CMRC1-CUSTORDER-STATUS**, **F-CMRC1-PROFILE-FIELDS** of the specification stay
  open and are preserved (the account list still shows the status of the `CUSTORDER#` row).
- A local `next dev` renderer now needs `API_URL` and a renderer key for the two account GETs (before: the table
  and AWS credentials). Without them the routes answer their 500 text.

## Migration / deployment notes

- **Data migration:** none. No item is read, written or moved differently in storage. The new table is empty.
- **What the staging diff must hold** (the operator reads it against this list; these need the operator's
  explicit approval step):
  - parent stack: one table, logical id `CommerceTable6CC80189`, physical name `AmodxCommerceTable-staging`;
  - `CommerceApi` nested stack, per function: `CustomerOrderHistoryFunc49139D9B`,
    `CustomerOrderHistoryFuncServiceRole786F6B34`, `CustomerOrderHistoryFuncServiceRoleDefaultPolicy6A1359DB`,
    `CustomerOrderHistoryInt`, `CustomerOrderHistoryRoute`,
    `CustomerOrderHistoryFuncCustomerOrderHistoryApiPerm4EC47E5A`; and `CustomerProfileReadFuncF03982BC`,
    `CustomerProfileReadFuncServiceRole780D81B5`, `CustomerProfileReadFuncServiceRoleDefaultPolicy2E085DAA`,
    `CustomerProfileReadInt`, `CustomerProfileReadRoute`,
    `CustomerProfileReadFuncCustomerProfileReadApiPerm9C5908C7`; plus one log group per function
    (`CustomerOrderHistoryFuncLogGroup…`, `CustomerProfileReadFuncLogGroup…`: the deployed synth adds them, the test
    synth does not, so their suffixes are not known here);
  - IAM: two new roles, each with ONE policy of two statements — DynamoDB read actions on the main table and its
    indexes. No statement on the new table anywhere. No `events:PutEvents`, no SES, no secret on the two roles;
  - modified, CODE ONLY (asset hash, no property besides the code location): the renderer server function and its
    assets; and every backend function whose bundle includes `@amodx/shared` — expect MANY functions in all four API
    stacks. Reason: the shared package gained one schema, a top-level call that the bundler keeps in each bundle that
    imports the package (85 of the 193 backend source files import it; EXECUTED: `git grep -l`). INFERRED from the
    bundler's rule, not measured per function: the operator's diff is the measurement. The functions built from
    `lib/commerce-db.ts` are among them.
  - **Must NOT appear:** a change to any existing role, policy, variable, route or authorizer; a variable or
    statement that names `AmodxCommerceTable`; a new route with `AuthorizationType: NONE`; a replacement of any
    stateful resource.
  Basis of the ids: the test synth (EXECUTED: row `(cmrc1b-4)` logs them). The ids of existing resources in the test
  synth equal those of the last staging synthesis artefact (`AmodxTable5AD589B7`,
  `RendererHostingTagCacheTable0AB45C6E`; OBSERVED in `infra/cdk.out/AmodxStack-staging.template.json`), so the new
  ids are expected to be the same on staging (INFERRED: a logical id depends on the construct path, not on the stage).
  Counts: the commerce nested stack goes from 258 to about 272 deployed resources; the parent from 478 to 479 (limit
  500).
- **Deploy order.** The backend routes and the renderer change ship in ONE stack deploy (`cdk deploy`). Inside that
  update CloudFormation does not order the renderer function's new code after the nested stack's new routes (no
  dependency links them; INFERRED), so two windows are possible for some minutes:
  - *the renderer's new code runs before the routes exist:* the API gateway answers 404 for the unknown route;
    `customer-api` throws; `/api/account/orders` and `/api/profile` answer 500 with their fixed text (T5 row "the
    route does not exist yet"). **What a signed-in visitor sees:** the account page with an empty order list and
    without stored phone, birthday and address — the page reads a failed answer as "nothing" and shows no error
    (F-CMRC1B-ACCOUNT-PAGE-HIDES-FAILURE). Nothing is written; a reload after the deploy shows the data. Visitors
    who are not signed in, every other page, the checkout, the order confirmation and tracking pages, and every
    tenant without commerce: no change.
  - *the routes exist and the renderer's old code still runs:* the old code reads DynamoDB as before; the routes are
    not called. **A visitor sees no change.**
  To have no window, deploy in two steps (the specification's recommended production order, § 5.11): first a commit
  with the backend, shared and infra changes and `renderer/src` unchanged, then the full commit. The builder commits
  nothing; the operator can cut the two commits by path (`renderer/` last).
- **Rollback:** redeploy the previous commit. The renderer's old code reads DynamoDB again; the two routes and
  functions are removed. No data to restore. **The table stays** (`RETAIN`): the rollback takes it out of the stack
  and does not delete it. Before the next deploy that declares it, the operator deletes the empty
  `AmodxCommerceTable<suffix>` by hand (item count 0 checked first) or imports it; otherwise that deploy fails on the
  existing name (INFERRED from CloudFormation's behaviour for a retained resource with a fixed name; NOT RUN). The
  same two windows apply in reverse during the rollback deploy.
- **Production sensitivity:** the renderer function serves every tenant. This slice changes its code in two API
  routes and one library file used by the booking proxy (`callBackend`). The booking proxy's behaviour is pinned by
  its unchanged assertions (T10) and by the serving rows `sched1g-*`.
- **What a live non-commerce tenant sees (C7):** the same pages, bytes and headers. The changed renderer paths are
  reached only by a signed-in session on `/api/account/orders` or `/api/profile`, and by the booking proxy (same
  function). Evidence: `npm run test:serving` and `npm run test:serving-bundle` pass with no capture changed
  (EXECUTED). Production condition (NOT RUN): the operator's reference URLs before and after.

## Definition of Done

- [x] C3: the two routes exist behind the commerce authorizer; the handlers admit `RENDERER` (and `GLOBAL_ADMIN`)
      only — T4, T4-auth, T7.
- [x] C4, part K: the account routes read through the backend; `getCustomerOrders` and `getCustomerProfile` are
      deleted from `dynamo-customer-reads.ts` and from the re-export of `dynamo.ts` — T3 (one permitted read), T5,
      the function-name search of § *Build record*.
- [x] C5, part K: every input class gets today's answer — the characterization, on the baseline and on the changed
      tree, with controls.
- [x] C6: the empty table exists; no function names it; no role has a statement on it — T7.
- [x] C7: the serving suites pass with no capture changed.
- [x] Key ownership (rule 10): no prefix literal in the new handler file; T3 green with one permitted renderer
      read; the control with the removed reads put back fails.
- [x] `tools/mcp-server/routes.json` +2; documents updated.
- [x] Gates of § *Build record* executed, each exit status recorded.
- [ ] Operator gates (§ *Evidence required*).

## Evidence required

- EXECUTED by the builder: § *Build record*.
- EXECUTED / OBSERVED by the operator: the staging `cdk diff` against the list of § *Migration / deployment notes*
  (explicit approval of the table, the two functions, the two routes and their IAM statements); the staging deploy;
  `AmodxCommerceTable-staging` exists, item count 0, and no role names it; each route called with the renderer key
  (200), with a tenant-admin token (403) and with no credential (refused by the authorizer) — no key or token
  printed; the account page of the test shop signed in (the same orders and profile as before the deploy; the
  profile save works); the CloudWatch logs of the two functions hold no email; the reference URLs of a non-commerce
  tenant equal before and after.
- NOT RUN by the builder: any AWS call, `cdk diff`, a deploy; `cd backend && npm test` (it writes to the live
  staging database; forbidden by the packet); a browser run of the account page (it needs Google sign-in and a
  deployed backend).

## Exit criterion

Part L of `cmrc-1` can add the order-page read as a third function of `customer-api.ts` and a third handler of
`self-service.ts`, once CMRC-ORDER-LOOKUP-AUTHORITY is confirmed. `cmrc-2` can prove the copy tool against the empty
`AmodxCommerceTable-staging`. The storage cutover `cmrc-4` still cannot start: the cutover gate
(`docs/slices/cmrc-1.md` § 6) needs T3 with NO exception, and S16 remains.

## Build record (2026-11-28, builder `claude-fable-5-2`)

Baseline `9d454f5d56d6730d6d83312890c1d1f7b4ca5c26`; working tree clean at the start (EXECUTED: `git status --short`
→ empty). Nothing committed. Nothing stashed.

**Order of the round.** (1) This document with § V1-V4. (2) The characterization on the untouched code. (3) Shared
schema and types. (4) Backend handlers, T4, T4-auth, T2 row. (5) `callBackend`, `customer-api.ts`, the two routes,
the two reads deleted, T3 list, T5, T10. (6) Infra and T7; `routes.json`. (7) Documents. (8) Gates. Then the
baseline run and the negative controls (a worktree), and the gates on the final tree.

**Changed paths.**

| Path | For | Serves |
|---|---|---|
| `backend/src/customers/self-service.ts` (new) | the two handlers | C3 |
| `backend/src/lib/commerce-db.ts` | `orderIdOfCustomerOrder`; header text (one renderer read left) | C3; ripple |
| `packages/shared/src/orders-and-customers.ts` | the request schema and the three answer types | C3 |
| `renderer/src/lib/api-client.ts` | `callBackend` (the moved `forward`; equal text after the two renames — EXECUTED comparison with `git show HEAD:…/booking-proxy.ts`) | C4 |
| `renderer/src/lib/booking-proxy.ts` | imports the moved function; the local definition deleted (1 line added, 34 removed) | C4 (reuse) |
| `renderer/src/lib/customer-api.ts` (new) | the two reads over HTTP | C4 |
| `renderer/src/app/api/account/orders/route.ts`, `renderer/src/app/api/profile/route.ts` | import from `customer-api`; three comments of the profile route | C4, C5 |
| `renderer/src/lib/dynamo-customer-reads.ts`, `renderer/src/lib/dynamo.ts` | the two reads and their re-export deleted | C4 |
| `infra/lib/database.ts` | `commerceTable` | C6 |
| `infra/lib/api-commerce.ts` | two functions, two routes; the event-bus loop skips the two | C3 |
| `tools/mcp-server/routes.json` | the two routes (141 routes, 29 local additions) | definition of done |
| `backend/test/unit/cmrc-1-self-service.test.ts`, `cmrc-1-self-service-auth.test.ts` (new); `cmrc-1-commerce-db.test.ts`, `cmrc-1-key-ownership.test.ts` | T4, T4-auth, T2 row, T3 list | C3, C1/C4 |
| `renderer/test/unit/cmrc-1-account-answers.test.ts`, `cmrc-1-customer-api.test.ts` (new); `sched-1g-proxy.test.ts` | characterization, T5, T10 | C5, C4 |
| `infra/test/amodx-stack.test.ts` | T7 | C6, C3 |
| `packages/shared/test/cmrc-1-self-request.test.ts` (new) | the schema | C3 |
| `docs/slices/cmrc-1b.md` (new), `docs/slices/cmrc-1.md` (Build status), `docs/ROADMAP.md`, `CURRENT_SLICE.md`, `docs/TECH-DEBT.md`, `docs/commerce.md`, `docs/plan-commerce-private-table.md` (status), `backend/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md`, `docs/authentication-architecture.md`, `docs/caching-architecture.md`, `CLAUDE.md` (rule 10); in revision 1 also `infra/ARCHITECTURE.md`, `tools/mcp-server/ARCHITECTURE.md`, `docs/architecture-deep -dive.md` | documents | packet item 10; ripples (deviations 11, 12; § *Revision 1*) |

Not edited (EXECUTED: `git status --short`): `renderer/src/components/SitePage.tsx` and every other [L] path;
`infra/lib/renderer-hosting.ts`, `infra/lib/amodx-stack.ts`; `backend/src/auth/`; any serving capture; any manifest
or lockfile (no package installed).

**Gates (EXECUTED, in the packet's order, on the fresh build of the final code; logs in
`.agent-manager/slices/CMRC-1B/evidence/`).**

| Gate | Command | Exit | Observed |
|---|---|---|---|
| G1 | `npm run build` | 0 | all workspaces |
| G2 | `npm run typecheck` | 0 | |
| G3 | `cd packages/shared && npm test` | 0 | 34 files, 678 tests passed |
| G4 | `npm --prefix backend run test:unit` | 0 | 100 files passed, 3 skipped (the golden-capture files); 2681 tests passed, 3 skipped. The command trace of `cmrc-1a` passes against its unchanged golden |
| G5 | `cd renderer && npm test` | 0 | 68 files, 1056 tests passed |
| G6a | `cd renderer && npm run test:serving` | 0 | 176 passed, 0 failed |
| G6b | `cd renderer && npm run test:serving-bundle` | 0 | 61 passed, 0 failed; no capture file changed (`git status --short -- renderer/test`: the three unit test files only) |
| G7 | `cd infra && npm test` | 0 | 99 passed (94 before + the five `cmrc1b` rows) |
| G8 | `cd tools/mcp-server && npm test` | 0 | route coverage PASS; 23 passed; the report lists `customer: POST /customer/order-history, POST /customer/profile-read` among the routes with no tool |
| G9 | `git diff --check`; `git diff --no-index --check /dev/null <file>` for each of the 8 new files | 0; 1 each | no output in either. Exit 1 is the status of `--no-index` for "the files differ" (control in `docs/slices/cmrc-1a.md` § *Build record*: a clean file gives exit 1 and no output, a file with trailing spaces gives a finding line) |

**Searches (EXECUTED on the final tree; text searches, a lower bound — T3 is the syntax-tree check).**

- `git grep --untracked -n -E 'getOrderForCustomer|getCustomerOrders|getCustomerProfile' -- renderer/src`:
  `getCustomerOrders` / `getCustomerProfile` in `lib/customer-api.ts` and the two API routes (and one comment line of
  `SitePage.tsx`); `getOrderForCustomer` in `lib/dynamo-customer-reads.ts` (declaration), `lib/dynamo.ts`
  (re-export) and `SitePage.tsx`. As gate G8 of the specification, part K.
- The four per-prefix searches of `docs/slices/cmrc-1a.md`: in `backend/src`, `lib/commerce-db.ts` and the five
  comment lines of F-CMRC1A-COMMENT-HITS; no hit in `customers/self-service.ts`; in `renderer/src`, the one `ORDER#`
  of `getOrderForCustomer`; in `scripts/`, S19.

**End-to-end coverage.** The running software was exercised in three ways, none against AWS: the real route
handlers with the real backend handlers and an in-memory table (the characterization); the built renderer under
`next start` and under the OpenNext bundle with a local DynamoDB stub (the two serving suites — they do not request
the two account routes with a session, so for these routes they prove only that nothing else moved); one real CDK
synthesis (T7). No test calls a deployed API gateway, authorizer or table: that is the operator's staging run. A
permanent end-to-end test of the signed-in account page would need a NextAuth session in the serving harness and a
backend stub there; part L adds such a stub (T9 of the specification) — the account routes could join it then.

### Revision 1 (2026-11-28, after review-0: one finding, corrected; no code changed)

Review-0 found no implementation defect and one document defect.

**R1 — the architecture documents were not all brought to the new state.** Reported instances:
`backend/ARCHITECTURE.md` still said the renderer "reads three of them"; `infra/ARCHITECTURE.md` had no description
of the table, the two functions and routes, their restricted wiring, or the new assertions.

**Class of defect:** *a current-state statement in a reference document that the change made false or incomplete,
missed because the search for dependent references was keyed on identifiers and on a hand-made list of files.* The
first round searched for the function names, the file name and the phrase "three renderer reads". A statement that
names none of them ("reads three of them", split over two lines) cannot be found that way, and a document that says
nothing yet (infra) is never a search hit.

**Rule that closes the class:** *for every package with a changed source file, and for every living reference
document, read each passage that speaks about the changed SUBJECT — found by subject words paragraph by paragraph,
not by identifier line by line — and decide for each passage: still true, corrected, or inherited and out of scope.
A package whose document has no such passage gets a section when the change adds a structure to that package.*
Subject of this slice: what the renderer reads of customer, order and account data and by which means; the commerce
table and its wiring; the renderer key's reach.

How the rule was applied (EXECUTED 2026-11-28): a script split each document into paragraphs and printed every
paragraph (or, in a block longer than 30 lines, every line with its neighbours) that names the renderer together
with a subject word (customer, order, commerce, private, profile, account) and a claim word (read, table, key,
grant, three, two, proxy). Documents: the six package documents (`backend`, `renderer`, `infra`, `packages/shared`,
`tools/mcp-server`, `admin`) and `docs/database-patterns.md`, `frontend-patterns.md`, `commerce.md`,
`authentication-architecture.md`, `caching-architecture.md`, `testing-strategy.md`, `architecture-deep -dive.md`,
`documentation.md`, `README.md`. 35 passages in the package documents and 42 lines in the others were printed and
each was read. A first run of the search printed nothing: the shell did not split the file list, so no file was
read. It was run again with a control line (the number of lines read: 3795). The search is still a lower bound (a
passage that uses none of the subject words is not printed); the sections on the changed surface were also read in
full (backend § Table, § Key Patterns, § Testing; renderer § read layer; infra whole document, 269 lines).

| # | Document | Statement | Decision |
|---|---|---|---|
| 1 | `backend/ARCHITECTURE.md` § table of keys | "the public renderer still reads three of them with its own keys and table" | **corrected** (reported): one (`ORDER#`); the other two go through `customers/self-service.ts`; the role can still read all four; the empty table is named |
| 2 | `backend/ARCHITECTURE.md` § Testing | the heading "Three files" over a list to which the first round added two files | **corrected**: five files, three of CMRC-1A and two of CMRC-1B |
| 3 | `backend/ARCHITECTURE.md` § Testing | the command trace covers "the twelve files that use `lib/commerce-db.ts`" | **corrected**: thirteen files use the module now; `self-service.ts` is not in the trace, its commands are pinned by T4 |
| 4 | `infra/ARCHITECTURE.md` | no CMRC-1B description | **added** (reported): § *Commerce-Private Table and Customer Read Routes* — first the two things that are not true yet (the table is unused; the renderer's IAM reach is unchanged), then the table, the two functions and routes, authorization, restricted variables and grants, the event-bus exclusion, the rollback note, the five assertions, the counts. The file tree and the stack tree each get one clause that names the two private tables and the two routes |
| 5 | `renderer/ARCHITECTURE.md` § read layer | `lib/api-client.ts` "returns `""`, which its callers forward to the backend" | **corrected**: `callBackend` forwards no empty key; it makes no call; the account routes answer 500 |
| 6 | `renderer/ARCHITECTURE.md` § read layer | the tests of the new rule, and the test's cross-workspace import, were not stated | **added** (deviation 14) |
| 7 | `docs/caching-architecture.md` § D4 | the same `api-client.ts` statement, and "reached only from `/api/*` handlers … `app/api/{comments,consent,contact,leads,profile}`" | **corrected** by a dated addition (the grep basis of the earlier text is kept as the record it is) |
| 8 | `docs/architecture-deep -dive.md` | the renderer key's scope, three places ("comments, profile, contact/leads/consent"); "DynamoDB table + 4 GSIs" as the whole of `AmodxDatabase` | **corrected**: the account reads are named; one line names the two private tables. The diagram line keeps its width (63 characters) |
| 9 | `tools/mcp-server/ARCHITECTURE.md` § Deliberately not exposed | no row for the two new routes, which the coverage report lists as routes with no tool | **added** |
| 10 | `packages/shared/ARCHITECTURE.md` schema table | the first round changed the file map only; the document's own rule says a new schema is described | **added**: one row for the request schema and the three answer types |
| — | `docs/architecture-deep -dive.md:891` "DynamoDB read (all tenants, all entity types)" for the renderer | still true; it is the statement that the IAM reach remains | no change |
| — | `docs/commerce.md`, `docs/authentication-architecture.md`, the other renderer and backend passages | corrected in the first round; read again | no change |
| — | `infra/ARCHITECTURE.md`: "3 GSIs" in the main-table section (the code has four), "18 named assertions" (the suite has 99), no section for the scheduling table, the authorizer sentence without the renderer key; `docs/testing-strategy.md` file counts; `docs/architecture-deep -dive.md` "~390 resources" | inherited, not caused by this slice | not changed (the review excludes unrelated cleanup); named here so that the next infra slice finds them |
| — | `renderer/src/lib/dynamo.ts:42-45`, a SOURCE comment with statement 5 | not a document; this slice may change one line of that file | not changed; finding F-CMRC1B-APICLIENT-COMMENT |

No source file, test or configuration changed in revision 1 (EXECUTED: no path of the working tree other than a
`.md` file is newer than the first round's build log; `git status --short` lists the same code paths and three more
documents).

**Gates, run again on the tree of revision 1 (EXECUTED 2026-11-28; logs in
`.agent-manager/slices/CMRC-1B/evidence/rev1/`).**

| Gate | Command | Exit | Observed |
|---|---|---|---|
| G1 | `npm run build` | 0 | |
| G2 | `npm run typecheck` | 0 | |
| G3 | `cd packages/shared && npm test` | 0 | 678 passed |
| G4 | `npm --prefix backend run test:unit` | 0 | 2681 passed, 3 skipped |
| G5 | `cd renderer && npm test` | 0 | 1056 passed |
| G6a | `cd renderer && npm run test:serving` | 0 | 176 passed |
| G6b | `cd renderer && npm run test:serving-bundle` | 0 | 61 passed; no capture file changed |
| G7 | `cd infra && npm test` | 0 | 99 passed; the counts of `infra/ARCHITECTURE.md` (parent 413 / 53 functions, deployed ≈ 479; CommerceApi 233 / 38) are the ones this run logs |
| G8 | `cd tools/mcp-server && npm test` | 0 | 23 passed; coverage PASS (the document's tool count still matches) |
| G9 | `git diff --check`; `git diff --no-index --check /dev/null <file>` for each of the 8 new files | 0; 1 each | no output in either |
| controls | `bash .agent-manager/slices/CMRC-1B/evidence/controls.sh "$PWD"` | 0 | the same results as the first round: the answer test passes on the baseline `9d454f5` (39), each of the seven mutations is detected, the worktree is removed |

## References

`docs/slices/cmrc-1.md` § 5.2 (C3-C7), § 5.4, § 5.6 (D1, D2, input rule, value rule), § 5.7, § 5.8, § 5.9 (T4, T5,
T7, T10), § 5.10, § 5.11, § 5.12, § 5.15, § 8 (CMRC-TABLE, CMRC-ORDER-LOOKUP-AUTHORITY), § 9 (A2, A3, A4);
`docs/slices/cmrc-1a.md`; `docs/platform-decisions.md` PD-001, PD-002; `docs/VISION.md` guarantee 2;
`docs/plan-commerce-private-table.md`; precedents `renderer/src/lib/booking-proxy.ts`,
`backend/src/scheduling/visitor/common.ts`, `infra/lib/database.ts` (the scheduling table).

## Closeout (operator, 2026-11-28)

- Relay: builder `claude-fable-5-2`, reviewer `gpt-6.1-sol`, two cycles; review-0 `revise` (R1: architecture
  documents), review-1 `approved`.
- Deviation from the packet, accepted: `renderer/test/unit/sched-1g-proxy.test.ts` is edited. Its mock of
  `@/lib/api-client` would have replaced the moved `callBackend` too; the test now sets `AMODX_API_KEY` and runs the
  real `getRendererKey` and `callBackend`. Its assertions are unchanged.
- Operator gates on the approved tree, each exit 0: build, typecheck, shared, plugins, renderer, serving (176),
  serving-bundle (61), admin unit, backend unit, infra, mcp, `git diff --check`; no change under `backend/src/auth`,
  `backend/src/orders`, `backend/src/reports`, `backend/src/resources`, `admin`, `scripts`, `renderer/middleware.ts`,
  `renderer/src/components`, the serving captures, a manifest or a lockfile.
- Staging diff, read in full before the deploy. Added (15): the table `CommerceTable` (`AmodxCommerceTable-staging`);
  for each of `CustomerOrderHistoryFunc` and `CustomerProfileReadFunc`: the function, its role, its policy, its log
  group, the API permission, the integration and the route. IAM: each function's role may be assumed by Lambda, has
  the basic execution policy and READ actions on the main table and its indexes; API Gateway may invoke each
  function. NO statement names the commerce table. Removed: nothing. Modified: 107 (functions rebuilt because
  `packages/shared/src/orders-and-customers.ts` changed; the renderer; the admin bundle).
  Deploy: `AmodxStack-staging` succeeded.
- Staging proof:
  - `AmodxCommerceTable-staging`: ACTIVE, key `PK`+`SK`, on-demand, no index, no stream, TTL disabled, point-in-time
    recovery enabled, 0 items;
  - both routes refuse a request with no credential and with a wrong key (403);
  - with two synthetic items seeded in `AmodxTable-staging` (a `CUSTORDER#` row and a `CUSTOMER#` profile, an address
    under `example.invalid`; deleted after the run), called as `GLOBAL_ADMIN` (the role `requireRole` always
    admits): order-history answers the row (`orderNumber`, `total`, `status`, `createdAt`, `orderId`), an address
    with no order answers `[]`; profile-read answers the profile (`email`, `name`, `phone`), an address with no
    profile answers `null`; a malformed body answers 400 without echoing the request; no `x-tenant-id` answers 400;
  - the general smoke and the page render check (shop, category, product, search, cart, checkout) pass.
- NOT proven on staging: the call from the deployed renderer with the renderer key (the account pages of a signed-in
  customer). Staging has no customer session a script can open (Google sign-in). Basis: the renderer unit tests
  (the account answers before and after, the identity-substitution cases) and the scheduling proxy tests, which now
  run the real `callBackend`. To check after a production deploy: a signed-in customer opens the account page of a
  live shop and sees the order history and the profile.
