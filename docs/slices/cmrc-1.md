# CMRC-1 — the commerce private table track, re-verified on today's code; `cmrc-1` specified in full (SPECIFICATION slice)

Status: **PLANNED (specification draft, revision 1 of 2026-11-22, not ratified) — six decisions open (§ 8).** Track: B
(commerce-private). Depends: `fnd-1`, `fnd-2` (shipped: every email key is normalized, § 3 row P4). Source plan:
`docs/plan-commerce-private-table.md` (status "proposed", 2026-07/08). Invariants: PD-001, PD-002
(`docs/platform-decisions.md`), tenant isolation, no DynamoDB scan. Maturity target of `cmrc-1`: PROTOTYPE until
the staging procedure of § 5.13 passes; MATURE when `cmrc-4` passes on staging.

**Build status (2026-11-28):** `cmrc-1a` (C2, and C1 for the backend sites only: the data module, the re-pointing of S1-S15, T1b, T2, T3; the renderer sites S16-S18 of C1 stay) is built —
`docs/slices/cmrc-1a.md`, baseline `a78c006`, operator gates pending. Not built: `cmrc-1b` (C3-C6 part K) and part L.
The § 2.2 site table below is corrected to `a78c006`. Every other file:line citation of this document stays as read
at `5aee9cb`. `cmrc-1a` made the twelve handler files of S1-S15 shorter by zero to nine lines each (the largest:
`customers/get.ts`, nine), so a citation into one of them can be off by that much on the current tree
(`backend/src/orders/create.ts`: by one line, except inside the transaction items, old lines 386-458).

This document changes no code. It does three things: it checks the source plan claim by claim against `main` at
`5aee9cb` (§ 2, § 3), it specifies the first build slice `cmrc-1` in full (§ 5), and it re-cuts `cmrc-2`…`cmrc-6`
to today's code (§ 6), including the seam for a later WooCommerce pickup (§ 7). Revision 1 applies the eight
corrections of review-0 and the operator rulings of 2026-11-22; revision 2 applies the four corrections of review-1; revision 3 the two of review-2.
Each correction is closed as a class, recorded in § 12.

Evidence labels: **OBSERVED** — read in the file at `5aee9cb` on 2026-11-22 (file:line given); **EXECUTED** — a
command run by the author on 2026-11-22 (command given); **INFERRED** — reasoned, not seen; **NOT RUN** — needs AWS,
a deployment or the human. No AWS call was made for this document. Every claim about deployed data is a condition
with the check that would establish it.

---

## 0. Reading guide (one paragraph each)

- **What is wrong today.** The renderer function has read access to the whole main table
  (`infra/lib/renderer-hosting.ts:272`). Orders, customer profiles, the email→order list and the order counter live
  in that table. So a fault in the public renderer can read every customer's order and profile. Three renderer
  functions read them directly today (§ 2.2).
- **What `cmrc-1` changes.** The renderer stops reading those records. It asks the backend through new
  renderer-key routes (two of them, plus a third for the order pages once its authority is decided, § 5.2 part L). One backend file, `backend/src/lib/commerce-db.ts`, becomes the only code that names the
  private keys and their table. An empty private table is created and given to nobody. Storage does not move yet:
  every byte stays in the main table.
- **Why this order.** When one file names the table, the later storage cutover (`cmrc-4`) is, for the moved
  kinds, a change of one constant plus infrastructure (plus, under CMRC-MAIN-KEYS = B, one key change of a kind that
  does not move). A later WooCommerce pickup that writes through the same file moves with it.
- **What is open.** Six decisions (§ 8). Two touch `cmrc-1`: CMRC-TABLE blocks only its table item (C6);
  CMRC-ORDER-LOOKUP-AUTHORITY blocks only the order-page lookup (every item marked **[L]** in § 5). Everything else
  in § 5 is complete and buildable now.

## 1. Direction of the human (settled, not open)

1. 2026-11-20: Track B (`cmrc-1`…`cmrc-6`) is mandatory before a school's orders live in AMODX
   (`docs/ROADMAP.md:271`, `CURRENT_SLICE.md:19`).
2. 2026-11-22: the first school keeps its WordPress + WooCommerce shop, which takes the payments. AMODX will pick up
   paid orders and their clients through a read-only WooCommerce API key (a later slice) and schedule the people.
   New writers of `CUSTOMER#` and of order-like records are therefore coming. They must not be written into the main
   table in a form that needs a second migration (§ 7).
3. 2026-11-22 (recorded in `docs/slices/pay-2.md` § 1 item 3): "No real shop tenant exists; a demo comes first. No
   migration of live orders." § 8 CMRC-TEST-ONLY shows why this is not yet established from the repository.

## 2. The problem, verified on HEAD

### 2.1 What the renderer function can read (OBSERVED)

| Fact | Where |
|---|---|
| The renderer server function gets the main table name as `TABLE_NAME` | `infra/lib/renderer-hosting.ts:247` |
| It gets read on the whole main table (`grantReadData`: GetItem, BatchGetItem, Query, Scan, ConditionCheckItem, DescribeTable — the CDK read action set, INFERRED from the CDK method name, not read in the synthesized policy) | `infra/lib/renderer-hosting.ts:272` |
| It gets the renderer key secret (role `RENDERER` at the backend) | `infra/lib/renderer-hosting.ts:253`, `:269` |
| It has no statement on the scheduling table (proved by test I4) | `infra/lib/amodx-stack.ts:505-509`; `infra/test/amodx-stack.test.ts:2284` |

So every main-table item of every tenant is readable by the renderer function, including the four commerce-private
key families and the other customer-linked items of § 2.3.

### 2.2 Every read and write site of the four plan keys

Commands (EXECUTED, repository root, 2026-11-22; one per prefix; `.md` and MAP files excluded):

```bash
git grep -n -F 'ORDER#'        -- backend/src renderer/src tools scripts ':!*.md'
git grep -n -F 'CUSTORDER#'    -- backend/src renderer/src tools scripts ':!*.md'
git grep -n -F 'CUSTOMER#'     -- backend/src renderer/src tools scripts ':!*.md'
git grep -n -F 'COUNTER#ORDER' -- backend/src renderer/src tools scripts ':!*.md'
```

A text search is a **lower bound**: it finds a key written as one literal. It misses a key built from parts (for
example `"ORD" + "ER#"`) or read through a generic helper. Each hit below was read in its file. Two widening searches
found nothing more: `git grep -n -F 'COUNTER#'` (only `create.ts:387`, the migration script and a shared test
comment) and a search for quoted `CUST…`/`…ORDER"` strings (only the unrelated scheduling `CUST#` of
`backend/src/lib/scheduling-db.ts:175`, `:733` and the authorizer role literal `"CUSTOMER"`).

The S1-S15 lines are those of `a78c006`, the commit before `cmrc-1a` (corrected 2026-11-28 from the inventory of
`docs/slices/cmrc-1a.md`; no site was added or removed since `5aee9cb`). Since `cmrc-1a` the backend sites S1-S15 take
the key and the table from `backend/src/lib/commerce-db.ts`; within `backend/src` the four prefixes are written in
that file only. S16-S18 (the renderer) and S19 (the operational tool) are not changed by `cmrc-1a`: they still build
the keys and choose their table themselves, so C1 is met for the backend and open for the renderer.

| # | Site (OBSERVED) | Key | Operation | Table | Reached by |
|---|---|---|---|---|---|
| S1 | `backend/src/orders/create.ts:385-394` | `COUNTER#ORDER` | UpdateItem (`if_not_exists + 1`), **before** the transaction, once per order | main | `POST /public/orders` (anonymous) |
| S2 | `backend/src/orders/create.ts:403-435` | `ORDER#<orderId>` | Put in the transaction | main | same |
| S3 | `backend/src/orders/create.ts:437-450` | `CUSTORDER#<email>#<orderId>` | Put in the transaction (`orderNumber, total, status, createdAt, Type`) | main | same |
| S4 | `backend/src/orders/create.ts:452-492` | `CUSTOMER#<email>` | Update in the transaction (`if_not_exists` profile fields, additive counters) | main | same |
| S5 | `backend/src/orders/get.ts:25-28` | `ORDER#` | GetItem | main | `GET /orders/{id}` (admin) |
| S6 | `backend/src/orders/list.ts:28-31`, `:50-57` | `ORDER#` prefix | Query, projection | main | `GET /orders` (admin) |
| S7 | `backend/src/orders/public-get.ts:16-19` | `ORDER#` | GetItem, then compares `normalizeEmail(stored)` with `normalizeEmail(query email)`; authority = possession of order id + email, no session | main | `GET /public/orders/{id}?email=` (anonymous) |
| S8 | `backend/src/orders/update-status.ts:48-51`, `:73-79` | `ORDER#` | GetItem, UpdateItem | main | `PUT /orders/{id}/status` (admin) |
| S9 | `backend/src/orders/update.ts:77-87`; `:120`, `:122`, `:154-161` | `ORDER#` | UpdateItem (field patch); GetItem and conditional UpdateItem (payment transition) | main | `PUT /orders/{id}` (admin; `pay-1`) |
| S10 | `backend/src/reports/summary.ts:23-33` | `ORDER#` prefix | Query, projection | main | `GET /reports/summary` (admin) |
| S11 | `backend/src/customers/get.ts:28-31`, `:36-43` | `CUSTOMER#`, `CUSTORDER#<email>#` | GetItem, Query | main | `GET /customers/{email}` (admin) |
| S12 | `backend/src/customers/list.ts:17-26` | `CUSTOMER#` prefix | Query | main | `GET /customers` (admin) |
| S13 | `backend/src/customers/update.ts:34-44` | `CUSTOMER#` | UpdateItem | main | `PUT /customers/{email}` (admin) |
| S14 | `backend/src/customers/public-update.ts:73-77`, `:107-113` | `CUSTOMER#` | GetItem, UpdateItem | main | `POST /public/customers/profile` (renderer key) |
| S15 | `backend/src/resources/presign.ts:40-50` | `CUSTORDER#<email>#` | Query, projection `#items` | main | `GET /resources/{id}/download` (`infra/lib/api.ts:490-497`, `:517`) |
| S16 | `renderer/src/lib/dynamo-customer-reads.ts` `getOrderForCustomer` | `ORDER#` | GetItem; returns the item without `internalNotes` when `stored customerEmail === normalizeEmail(given)`; the order id and the email come from the page address, with **no session check** (the `checkout-confirm` / `checkout-track` branches of `SitePage` in `SitePage.tsx`) | main | `renderer/src/components/SitePage.tsx` (the two `getOrderForCustomer` calls of `SitePage`) |
| S17 | `renderer/src/lib/dynamo-customer-reads.ts` `getCustomerOrders` | `CUSTORDER#<email>#` | Query, paginated, projection | main | `renderer/src/app/api/account/orders/route.ts:57` |
| S18 | `renderer/src/lib/dynamo-customer-reads.ts` `getCustomerProfile` | `CUSTOMER#<email>` | GetItem, projection | main | `renderer/src/app/api/profile/route.ts:151` |
| S19 | `scripts/migrate-commerce-private-table.ts:8` | all four | Query + BatchWrite (operational tool) | both | `npm run migrate-commerce-private-table` (`package.json:22`) |

`tools/` has no hit: the MCP server reaches orders and customers only through the admin HTTP routes
(`tools/mcp-server/routes.json`). Tests with hits (not runtime sites): `backend/test/unit/email-key-normalization.test.ts`,
`backend/test/unit/pay-1.test.ts`, `renderer/test/unit/order-email-1.test.ts`,
`renderer/test/serving-contract/fixtures.mjs`, `renderer/test/serving-contract/locale-1/proof.mjs` (EXECUTED:
`git grep -l -E 'ORDER#|CUSTOMER#|CUSTORDER#' -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.mjs'`).

The SSR order read (S16) runs only on the dynamic twin `app/[siteId]/%5Fdyn/[[...slug]]`: the cacheable route
passes `query: {}` (`SitePage.tsx:10-15`), so `query.id`/`query.email` are absent there (INFERRED from the
`SitePage` header and `%5Fdyn/[[...slug]]/page.tsx:14`).

### 2.3 Customer-linked items the plan does not name (OBSERVED)

| Key | Content | Where | Exposure today |
|---|---|---|---|
| `SYSTEM` / `EMAILLIMIT#<normalizedEmail>` | the buyer's email **in plain text** in the key, an hourly count, `ttl` | `backend/src/orders/create.ts:543-575` | Readable by the renderer. The main table has **no TTL setting** (`infra/lib/database.ts:23-30`; synthesized `AmodxTable-staging` has no `TimeToLiveSpecification`, EXECUTED with `node -e` on `infra/cdk.out/AmodxStack-staging.template.json`, artefact dated 2026-11-22 20:31), so the `ttl` attribute deletes nothing: every buyer's email stays (INFERRED for the deployed tables: TTL could have been enabled outside CDK — NOT RUN, check: `aws dynamodb describe-time-to-live --table-name AmodxTable`). |
| `TENANT#…` / `COUPONUSE#<couponId>#<sha256(normalizedEmail)>` | per-customer coupon use count (`coupon-fix-1`) | `backend/src/orders/create.ts:307`, `:510-520` | Readable by the renderer. A hash, not the address; anyone who holds a candidate address can test it (INFERRED). The code comment says "Track B decides the item's final table" (`create.ts:498`). |

### 2.4 The GSI gate of the plan, resolved from the code

The plan makes GSI participation a hard pre-migration gate (plan § Assumptions). A DynamoDB item is in a GSI only
if it has every key attribute of that index (AWS rule for sparse indexes; INFERRED from AWS documentation, not
re-read today). The main table's indexes (`infra/lib/database.ts:33-58`): `GSI_Domain` (`Domain`, `PK`), `GSI_Type`
(`Type`, `CreatedAt`), `GSI_Status` (`Status`, `ScheduledFor`), `GSI_Slug` (`TenantSlug`).

- The writers of the four families set `Type` but none of `CreatedAt`, `Domain`, `Status`, `ScheduledFor`,
  `TenantSlug` (they write `createdAt`, `status` in lower case; names are case-sensitive): `create.ts:401-491`.
  EXECUTED: `git grep -n -w -E 'Status|ScheduledFor|TenantSlug|Domain|CreatedAt' -- backend/src/orders
  backend/src/customers backend/src/reports` → two hits, both text inside a comment and an error message
  (`create.ts:317`, `update-status.ts:38`).
- No code queries `GSI_Type` or `GSI_Status`. EXECUTED: `git grep -n -E 'GSI_Type|GSI_Status' -- backend renderer
  admin tools scripts ':!*.md'` → only a comment in `backend/src/tenant/settings.ts:23`.

So the four families take part in no index, and the private table needs no GSI. **Condition for deployed data:**
items written by older code could carry those attributes. Check (NOT RUN; `cmrc-2`'s `plan` mode does it per
tenant): for each moved item, report any of `CreatedAt`, `Domain`, `Status`, `ScheduledFor`, `TenantSlug`.

Consequence for an earlier record (finding F-CMRC1-GSI-EVIDENCE, § 10.3): `docs/slices/cat-mode-1.md:340-342` reports
"orders per tenant (`GSI_Type`, `Type = "Order"`) = none" on production. By the rule above an `ORDER#` item is never
in `GSI_Type`, so that query returns none whether orders exist or not. It is not evidence that production has no
orders.

## 3. The plan against HEAD, claim by claim

"Plan" = `docs/plan-commerce-private-table.md`. Verdict: **still true** / **changed** (how) / **no longer exists**.

| # | Plan claim | Verdict on `5aee9cb` |
|---|---|---|
| P1 | Renderer has `grantReadData()` on the main table | Still true: `infra/lib/renderer-hosting.ts:272`. |
| P2 | Moved families: `ORDER#`, `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER` | Still true; § 2.2. Changed: two more customer-linked items exist (§ 2.3); decision CMRC-MAIN-KEYS. |
| P3 | Not moved: `LEAD#`, `FORMSUB#`, `AUDIT#`, `SIGNAL#`, `CONSENT#`, `COUPON#` | Still true; all six exist (e.g. `backend/src/leads/create.ts`, `forms/public-submit.ts`, `consent/create.ts`, `audit/worker.ts`, `signals/create.ts`, `coupons/create.ts`; EXECUTED `git grep -l -F '<prefix>' -- backend/src`). Since `newsletter-1` (2026-11-27) a seventh main-table kind of personal data exists and is not moved either: `NEWSLETTER#<normalized email>` (`backend/src/leads/newsletter.ts`). |
| P4 | "The current checkout only lowercases"; keys must move to `normalizeEmail()` | Changed: done by `fnd-2`. Every key site above derives the email with `normalizeEmail()` (`create.ts:73`, `customers/get.ts:24-30`, `customers/update.ts:30-36`, `public-update.ts:56`, `presign.ts:38`, `getOrderForCustomer`, `getCustomerOrders`, `getCustomerProfile` in `renderer/src/lib/dynamo-customer-reads.ts`). PD-001's "Conformance status — nothing conforms yet" paragraph (`docs/platform-decisions.md`, PD-001 Invariants) is stale (finding F-CMRC1-PD001-STALE). The historical backfill F-FND2-1 stays open. |
| P5 | API: `GET /customer/orders`, `GET /customer/profile`, `POST /customer/profile`; no email in URL; prefer a JSON body | Changed by this spec: three **POST** reads with the email in the body (§ 5.6). A GET cannot carry a body, and a header carrier needs log exclusion; the scheduling feed already uses a POST to keep a secret out of API logs (`renderer/src/lib/booking-proxy.ts:294-295`). The profile update stays on the existing `POST /public/customers/profile` (`infra/lib/api-commerce.ts:324`), which is already renderer-key only (`public-update.ts:37-41`). |
| P6 | `commerce-db.ts`, typed functions, table from `COMMERCE_TABLE_NAME` **falling back** to `TABLE_NAME` | Changed by this spec: no fallback. A fallback makes a missing variable silently read the main table after the cutover, and the security property becomes false with no error. `cmrc-1` binds the module to `TABLE_NAME`; `cmrc-4` changes that one binding to a required `COMMERCE_TABLE_NAME` (§ 5.5). |
| P7 | Phase 1: remove `getOrderForCustomer` from `renderer/src/app/[siteId]/[[...slug]]/page.tsx` | Changed: the page body moved to `renderer/src/components/SitePage.tsx` (the two `getOrderForCustomer` calls of `SitePage`); it runs only on the dynamic twin (§ 2.2). The two order pages are server-rendered functions in `renderer/src/components/site-page/order-views.tsx` (`ConfirmationPageView`, `OrderTrackingView`; refactor-sitepage-1) that read 17 named fields (§ 5.6 D3). |
| P8 | Phase 2: backend renderer-only read endpoints | No longer exists as a gap to "add later" — nothing exists yet: `routes.json` has no `/customer/` route (EXECUTED: python read of `tools/mcp-server/routes.json`, 148 routes). Specified in § 5. |
| P9 | Phase 3: rewrite `api/account/orders/route.ts` and `api/profile/route.ts` | Still true: `account/orders/route.ts:3`, `:57`; `profile/route.ts:3`, `:151`. The profile POST already proxies (`profile/route.ts:84-103`). |
| P10 | Phase 4: table in CDK, `PAY_PER_REQUEST`, PITR | Still true; the scheduling table is the exact precedent (`infra/lib/database.ts:60-72`). |
| P11 | Phase 5: one-time migration script "proposed future" | Changed: `scripts/migrate-commerce-private-table.ts` exists (370 lines, `package.json:22`). It has only `plan`, `migrate`, `verify` (`:10`); no `--strict`, `--post-cutover`, `purge-plan`, `purge`, `purge-verify`; it writes with `BatchWrite` (`:235`); it does not normalize keys (EXECUTED: `grep -n -E 'normalize|purge|strict|post-cutover'` → none). Not wired into CI or tests. |
| P12 | GSI participation = hard gate | Changed: resolved from the code (§ 2.4); one deployed-data condition left for `cmrc-2`. |
| P13 | Phase 6 transaction shape: five items incl. `COUNTER#ORDER` | Changed: the counter is a separate UpdateItem **before** the transaction (`create.ts:383-397`) and keeps its number across a retry (`orderNumber === undefined` guard). The transaction also holds `COUPONUSE#` (`:510-520`). Cross-table works the same; the counter needs no transaction. The `CUSTOMER#` write is an Update with `if_not_exists` (`:450-491`) — still true. |
| P14 | Phase 6 handler list (orders get/list/public-get/update/update-status, customers get/list/update/public-update, reports) | Still true, but incomplete: `backend/src/resources/presign.ts:38-47` (S15) also reads `CUSTORDER#`. |
| P15 | Phase 7/8 validation and purge with backup reference + NDJSON | Still true as a requirement; tool modes missing (P11). |
| P16 | CI guard as a lint rule, not a grep | Still true as a requirement; nothing exists. `cmrc-1` adds an AST-based key-ownership test (§ 5.9 T3) that covers most of it. |
| P17 | Remove the three renderer helpers after Phases 1+3 | Still true (S16-S18). Changed place: since `refactor-renderer-reads-1` the three are declared in `renderer/src/lib/dynamo-customer-reads.ts` and re-exported by `renderer/src/lib/dynamo.ts`; the plan's "from renderer/src/lib/dynamo.ts" means both files. Sixteen renderer unit test files name `getOrderForCustomer` — fifteen in their `@/lib/dynamo` mock, one (`order-email-1.test.ts`) through the real function — plus one serving fixture comment (EXECUTED: `git grep -l getOrderForCustomer -- 'renderer/test/unit/*.ts'` → 16; `-- renderer/test` → 17); § 5.9 says which change. |
| P18 | Rejected: dedicated customer-read Lambda behind CloudFront | Still valid; nothing in the code contradicts it. |
| P19 | PD-002 renderer-proxy, session variant | Changed for one read. Account order history (S17) and profile (S18) take the email from a validated NextAuth session (`account/orders/route.ts:49-57`, `profile/route.ts:141-151`): PD-002's session variant. The order confirmation and tracking read (S16) does not: a guest opens it with the order id and the email from the page address (the `checkout-confirm` / `checkout-track` branches of `SitePage` in `SitePage.tsx`, `CheckoutPageView.tsx:401`); PD-002 (`docs/platform-decisions.md`, PD-002 § Invariants) requires a session-derived email, and its 2026-11-21 booking-token variant covers scheduling only. Today's code does not conform; moving the read behind the backend makes the gap visible. This document claims no PD-002 conformance for that read: decision CMRC-ORDER-LOOKUP-AUTHORITY (§ 8). |
| P20 | PD-001 tenant-local identity `tenantId + normalizedEmail` | Still true; the key is unchanged. |
| P21 | "Commerce is test-only" (plan Status; `docs/ROADMAP.md:18`, `:106`) | Not established on HEAD; § 8 CMRC-TEST-ONLY. |
| P22 | Deploy 1 registers routes in the commerce nested stack | Still feasible: the last staging synthesis has 258 resources in that template (EXECUTED: `node -e` count on `infra/cdk.out/AmodxStackstagingCommerceApi1DB8077F.nested.template.json`, artefact 2026-11-22 20:28); `cmrc-1` adds about 15 (INFERRED: 3 × function, role, policy, integration, route, permission). Limit 500. |
| P23 | Proxy pattern | New since the plan: `renderer/src/lib/booking-proxy.ts` (`forward`, `:213-243`) calls the backend with exactly the renderer key, `x-tenant-id` and `content-type`. Reused in § 5. |
| P24 | Dependents | New since the plan: `sched-1h` (paid course through the checkout) and `loyalty-1` wait for `cmrc-4` (`docs/slices/sched-1.md:1483`, `:1684`; `docs/ROADMAP.md:286`). |

## 4. What scheduling already proved, and what `cmrc` reuses

| Scheduling element (OBSERVED) | `cmrc` reuses it as a pattern | `cmrc` must not share it |
|---|---|---|
| A private table: PK/SK strings, `PAY_PER_REQUEST`, PITR, `RETAIN`, no GSI, the renderer has no statement (`infra/lib/database.ts:60-72`) | Yes: same settings for the commerce table (§ 5.8). TTL: none in `cmrc-1` (no commerce item needs it yet). | The table itself — unless CMRC-TABLE = A (§ 8). |
| One data module that is the only code naming the table (`backend/src/lib/scheduling-db.ts:1-8`) | Yes, the rule. Not the size: scheduling's module holds the business decisions' transactions (2299 lines). Commerce today keeps its commands in the handlers; `commerce-db.ts` binds table + key only (§ 5.5). | The module. A cross-import would tie two release paths. |
| The nested stack with its own authorizer and a per-function grant switch (`infra/lib/api-scheduling.ts:100-138`) | The commerce routes already live in their own nested stack (`api-commerce.ts:67-128`); the three new routes go there. A per-function grant switch is added in `cmrc-4`, when grants differ per function. | The scheduling stack. |
| Grant set: each function gets the main-table read + exactly its private-table access | Yes, in `cmrc-4`. In `cmrc-1` no function gets the new table. | — |
| The renderer proxy with the renderer key (`booking-proxy.ts:213-243`), no browser header forwarded, `Cache-Control: private, no-store` | Yes: the `forward` function is moved to `renderer/src/lib/api-client.ts` and reused (§ 5.4, § 9 A3). | The scheduling input table `BOOKING_OPS`: D1 and D2 take no browser input (the email comes from the session); D3 **[L]** takes the page address's order id and email (§ 5.6). |
| Infra test that the renderer role has no statement on the private table (`infra/test/amodx-stack.test.ts:2284`) | Yes: same assertion for the commerce table (§ 5.9 T7). | — |
| Persons: scheduling stores `who: Person` inside `BOOKING#` and a keys-only `CUST#<email>#<bookingId>` adjacency; it never creates `CUSTOMER#` (`docs/slices/sched-1.md:215`, `:478`, `:574`) | — | A shared client record is decision CMRC-CLIENT (§ 8). |

## 5. `cmrc-1` in full

### 5.1 Purpose and risk retired

Risk retired: **the renderer is a reader of customer-private commerce records.** After `cmrc-1` no renderer code
reads `ORDER#`, `CUSTORDER#`, `CUSTOMER#` or `COUNTER#ORDER`; the renderer gets narrow answers from the backend.
Until part L ships, one renderer read stays: the order-page read S16 (§ 5.2). The IAM grant is still there (it is removed in effect only when the data leaves the main table, `cmrc-4` +
`cmrc-6`). Second risk retired: **the storage location is spread over 15 backend sites.** After `cmrc-1` one file
binds it.

### 5.2 Scope (requirements)

**Two parts.** **Part K** is every row below without a mark: complete, buildable now. **Part L** (the order-page
lookup) is every item marked **[L]** in § 5: it waits for decision CMRC-ORDER-LOOKUP-AUTHORITY (§ 8). Under answer A,
part L is built as written. Under B, part L is built with the email from the session (D3's request shape is unchanged;
its source changes) and C5 is rewritten for the order pages before the build. Under C, part L leaves `cmrc-1` and
moves into the token slice; S16 stays in `renderer/src/lib/dynamo-customer-reads.ts` (re-exported by `renderer/src/lib/dynamo.ts`) until then. If `cmrc-1` is built while the
decision is open, it is built as part K only, and S16 stays where it is. **Part K alone is a valid delivery, but
`cmrc-4` (the storage cutover) cannot start until S16 is gone** — part L built under A or B, or the token slice under
C (the cutover gate, § 6). A cutover with S16 in place would leave the confirmation and tracking pages reading the
old main-table copies: new orders invisible, existing orders stale.

| Id | Requirement |
|---|---|
| C1 | `backend/src/lib/commerce-db.ts` is the only runtime code (backend and renderer) that contains the key prefixes `ORDER#`, `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER` and the only code that chooses their table. In `cmrc-1` that table is the main table (`TABLE_NAME`). One named exception while part L is not built: the `ORDER#` literal of `getOrderForCustomer` in `renderer/src/lib/dynamo-customer-reads.ts` (S16). **[L]** removes it; `cmrc-4` requires it removed (§ 6 cutover gate). |
| C2 | Every site S1-S15 builds its key and table from `commerce-db.ts`. Every DynamoDB command those handlers send is **unchanged** (same command type, table, key, expressions, values, transaction items, order of calls) and every HTTP answer is unchanged. Proof: the command-trace characterization T1b against a baseline captured at `5aee9cb` (§ 5.9). |
| C3 | New backend routes for the `RENDERER` role (and `GLOBAL_ADMIN`, which `requireRole` always admits — the scheduling visitor precedent, `backend/src/scheduling/visitor/common.ts:4-8`): `POST /customer/order-history`, `POST /customer/profile-read`; **[L]** `POST /customer/order-lookup` (§ 5.6). |
| C4 | The renderer reads no commerce-private item through the account routes: `getCustomerOrders`, `getCustomerProfile` are deleted from `renderer/src/lib/dynamo-customer-reads.ts` and from the re-export of `renderer/src/lib/dynamo.ts`; the account orders route and the profile GET call the backend. **[L]** `getOrderForCustomer` is deleted too (with it the file `dynamo-customer-reads.ts`, which then holds nothing, and the re-export line of `dynamo.ts`) and `SitePage` calls the backend for the order pages. |
| C5 | Every input gets today's answer (the rule of § 5.6 "Input rule"): the same status codes and JSON bodies for `/api/account/orders` and `/api/profile`; **[L]** under answer A, the same page (G6 comparison) for the order confirmation and tracking pages in every state — order shown, no order requested, not found, malformed link. |
| C6 | An empty commerce-private table exists (decision CMRC-TABLE = B). No function has its name, no role has a statement on it. |
| C7 | A non-commerce tenant sees no change (§ 5.12). |

### 5.3 Non-scope

No data copy. No change of where any item is stored. No change to order creation behaviour, mails, coupons, admin
pages, the MCP tools. No `COMMERCE_TABLE_NAME` variable. No removal of the anonymous `GET /public/orders/{id}`
(finding F-CMRC1-PUBLIC-ORDER-GET, decided in `cmrc-5`). No change to `EMAILLIMIT#` or `COUPONUSE#` (decision
CMRC-MAIN-KEYS). No change to the account page's session handling (the three `authOptions` copies stay; § 10.2 D4).
No fix of the defects in § 10.3. No WooCommerce code.

**Architectural boundaries.** Tenant isolation: every new read is keyed `TENANT#<x-tenant-id>`, and the renderer sets
that header from the tenant record it found for the host, never from the browser (PD-002's tenant rule). Customer
identity: D1 and D2 take the email from the validated session (PD-002's identity rule). D3 **[L]** takes it from the
page address; no PD-002 conformance is claimed for D3 until CMRC-ORDER-LOOKUP-AUTHORITY is decided. No scan: Get and Query on
PK + SK prefix only; D1 and D2 use projections. Dependency direction: `customer-api.ts` → `api-client.ts` (renderer);
handlers → `commerce-db.ts` → `db.ts` (backend); nothing in `packages/shared` gains I/O. Data crossing the boundary is
the raw JSON of § 5.6. Plugin split entry, admin, colours: untouched.

### 5.4 Paths

| Path | New / changed | For | Serves |
|---|---|---|---|
| `backend/src/lib/commerce-db.ts` | new | located references (table + key) for the four families (§ 5.5) | C1, C2 |
| `backend/src/orders/create.ts`, `get.ts`, `list.ts`, `public-get.ts`, `update.ts`, `update-status.ts` | changed: key and `TableName` from `commerce-db.ts` | S1-S9 | C2 |
| `backend/src/customers/get.ts`, `list.ts`, `update.ts`, `public-update.ts` | changed: same | S11-S14 | C2 |
| `backend/src/reports/summary.ts`, `backend/src/resources/presign.ts` | changed: same | S10, S15 | C2 |
| `backend/src/customers/self-service.ts` | new: exported handlers `orderHistoryHandler`, `profileReadHandler`, **[L]** `orderLookupHandler`, and their file-local role/parse/refusal helpers (precedent: two handlers in `resources/presign.ts`, `infra/lib/api.ts:483-497`) | C3 | C3 |
| `packages/shared/src/index.ts` | changed: the request schemas and answer types of § 5.6 (**[L]**: `OrderLookupRequestSchema`, `OrderView`) | C3 | C3 |
| `infra/lib/database.ts` | changed: `commerceTable` (`AmodxCommerceTable${suffix}`) | C6 | C6 |
| `infra/lib/api-commerce.ts` | changed: two functions (**[L]** a third) with main-table **read** only, no SES, no event bus, and their routes with the commerce authorizer | C3 | C3 |
| `renderer/src/lib/api-client.ts` | changed: receives `forward` from `booking-proxy.ts`, renamed `callBackend`, same contract; log prefix `[backend-call]` | C4 | C4 |
| `renderer/src/lib/booking-proxy.ts` | changed: imports `callBackend` instead of its local `forward` (no other line) | — | reuse (§ 9 A3) |
| `renderer/src/lib/customer-api.ts` | new: `getCustomerOrders`, `getCustomerProfile`; **[L]** `getOrderForCustomer(tenantId, orderId, email)` (same name, same signature, same result rule as the deleted helper) — each one `callBackend` call | C4 | C4 |
| `renderer/src/app/api/account/orders/route.ts`, `renderer/src/app/api/profile/route.ts` | changed: import from `@/lib/customer-api` instead of `@/lib/dynamo` | C4, C5 | C4 |
| `renderer/src/components/SitePage.tsx` | **[L]** changed: import `getOrderForCustomer` from `@/lib/customer-api` | C4 | C4 |
| `renderer/src/lib/dynamo-customer-reads.ts` | changed: `getCustomerOrders`, `getCustomerProfile` deleted (the file keeps `getOrderForCustomer`); **[L]** `getOrderForCustomer` deleted, so the file is deleted | C4 | C4 |
| `renderer/src/lib/dynamo.ts` | changed: its re-export line `export { … } from "./dynamo-customer-reads"` names only `getOrderForCustomer`; **[L]** the re-export line deleted | C4 | C4 |
| tests (§ 5.9), `tools/mcp-server/routes.json` (`localAdditions` +2, **[L]** +1), `docs/commerce.md`, `backend/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, `docs/plan-commerce-private-table.md` (status line), `docs/ROADMAP.md`, `docs/TECH-DEBT.md` | changed | definition of done | — |

Name note: keeping `getOrderForCustomer`, `getCustomerOrders`, `getCustomerProfile` as names is correct only
because their contract does not change (same inputs, same result, same "null when the email does not match" rule);
only their transport changes. The module name `customer-api` says "over HTTP". If a builder finds a contract
difference, the name must change with it.

### 5.5 The data module contract (`backend/src/lib/commerce-db.ts`)

The module exports **located references**: values that carry the table and the key together, so a caller cannot
name a key without its table. Handlers keep building their commands; they spread a reference into the command.

```ts
// cmrc-1: the main table. cmrc-4 replaces this ONE binding with a required COMMERCE_TABLE_NAME (no fallback).
const COMMERCE_TABLE = TABLE_NAME;            // from ./db.js

type Ref = { TableName: string; Key: { PK: string; SK: string } };
type PrefixQuery = { TableName: string; KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)";
                     ExpressionAttributeValues: { ":pk": string; ":sk": string } };

export const orderRef        = (tenantId: string, orderId: string): Ref
export const customerRef     = (tenantId: string, normalizedEmail: string): Ref
export const customerOrderRef = (tenantId: string, normalizedEmail: string, orderId: string): Ref
export const orderCounterRef = (tenantId: string): Ref
export const ordersQuery          = (tenantId: string): PrefixQuery                     // "ORDER#"
export const customersQuery       = (tenantId: string): PrefixQuery                     // "CUSTOMER#"
export const customerOrdersQuery  = (tenantId: string, normalizedEmail: string): PrefixQuery // "CUSTORDER#<email>#"
export const orderIdOfCustomerOrder = (sk: string): string   // last segment, as getCustomerOrders (lib/dynamo-customer-reads.ts) today
/** Every key prefix this module owns — the copy/verify/purge tool (cmrc-2) imports it; a new kind is added here. */
export const COMMERCE_PRIVATE_PREFIXES = ["ORDER#", "CUSTORDER#", "CUSTOMER#", "COUNTER#ORDER"] as const;
```

Rules:

- Inputs are used as given. Callers pass `normalizeEmail()` output, as they do today (P4). The module does not
  normalize: normalizing twice is harmless (`normalizeEmail` is idempotent, PD-001), but a hidden second place of the
  rule is not.
- A caller merges its own `ExpressionAttributeValues` after the reference's, for example
  `{ ...ordersQuery(t), ProjectionExpression, ExpressionAttributeNames, ExpressionAttributeValues: { ...q.ExpressionAttributeValues, ":x": v } }`.
- In `create.ts` the three transaction items take their `TableName` from the references and the two coupon items keep
  `TABLE_NAME`. On `cmrc-1` both are the main table; on `cmrc-4` the same code becomes a cross-table transaction with
  no edit to the transaction in `create.ts` (INFERRED; proved in `cmrc-4`). The one `create.ts` edit `cmrc-4` may
  make is outside the moved kinds: the mail-counter key under CMRC-MAIN-KEYS = B (§ 6 `cmrc-4`).
- No function returns a `Result`: a reference cannot fail. Reads and writes stay in the handlers and keep today's
  error handling.

Why not a function per access (the plan's "read/write order records"): the 15 sites send 20 different command
shapes; one function per shape copies each command into a second file and adds a second place to change it. The
reference form changes the minimum and keeps every command visible where it is decided. This is recorded as an
abstraction in § 9 A1.

### 5.6 Data that crosses the renderer → backend boundary (raw DTOs)

All routes: method POST, headers exactly `x-api-key` (renderer key), `x-tenant-id` (the id of the tenant record the
renderer found for the host), `content-type: application/json`. Answer header `Cache-Control: no-store`. Source of
the body: D1 and D2 — the email of the validated NextAuth session, never a value of the browser request. D3 **[L]** —
the order id and the email from the page address (`query.id` + `query.email`, or the tracking path segment +
`query.email`), exactly the values the `checkout-confirm` / `checkout-track` branches of `SitePage` in `SitePage.tsx` use today; under CMRC-ORDER-LOOKUP-AUTHORITY = B the
email comes from the session instead.

**Input rule (closes review-0 correction 3 as a class).** Every input gets today's answer. A value that cannot match
a stored record is answered as "nothing found", never as an error. Errors are kept for two causes only: a dependency
failure (DynamoDB, the network, the key), and a request structure the renderer never builds (a renderer defect).
Consequences:

- No format check on the email or the order id. The backend applies `normalizeEmail()` and then the same read as
  today (the three reads of `renderer/src/lib/dynamo-customer-reads.ts`). A malformed email or id simply matches nothing, as today. PD-001's "validate on the
  normalized form" rule governs a format check where one exists; these reads have none today and get none.
- No length bound of its own. A key longer than DynamoDB accepts fails at DynamoDB, as today (a 500 inside the
  renderer's read today; a backend 500 that the renderer turns into the same failure after).
- Structure check only (`.strict()` zod schemas, shared): a JSON object with exactly the named fields, each a
  non-empty string. The renderer always sends that shape (it calls only when the values are present, as
  the two `getOrderForCustomer` calls of `SitePage` in `SitePage.tsx` do today), so a failure here is a renderer defect.

Shared schemas and types (`packages/shared/src/index.ts`):

```ts
export const CustomerSelfRequestSchema = z.object({ email: z.string().min(1) }).strict();
export const OrderLookupRequestSchema  = z.object({ orderId: z.string().min(1), email: z.string().min(1) }).strict(); // [L]

/** A stored attribute value exactly as the DynamoDB document client returns it and JSON carries it. */
export type StoredValue = string | number | boolean | null | StoredValue[] | { [key: string]: StoredValue };

export type OrderHistoryEntry = {      // D1: one CUSTORDER# item, mapped as getCustomerOrders (lib/dynamo-customer-reads.ts) does today
  orderId: string;                     // last '#' segment of SK
  orderNumber?: StoredValue; total?: StoredValue; status?: StoredValue; createdAt?: StoredValue;
};
export type CustomerProfileView = {    // D2: the GetItem Item, projection email, name, phone, birthday, defaultAddress
  email?: StoredValue; name?: StoredValue; phone?: StoredValue; birthday?: StoredValue; defaultAddress?: StoredValue;
};
export type OrderView = Partial<Record<OrderViewField, StoredValue>>;   // [L] D3
```

**Value rule (closes review-0 correction 4 as a class).** Every field of every answer is the stored attribute passed
through unchanged: no parse against `OrderSchema` / `CustomerSchema` (they do not describe the stored data — e.g.
`OrderSchema.total` is a string, `create.ts:347` stores a number), no default filled in, no `null` removed, no value
rejected. A field is absent in the answer exactly when the stored item lacks the attribute; `null` stays `null`. Typed
`StoredValue` on purpose: the writers below are the known shapes, not a closed list (two admin fields are stored
without validation). JSON carries every `StoredValue` unchanged (INFERRED: the document client returns numbers as
JavaScript numbers by default; no writer stores a set, binary or a number beyond 2^53 — OBSERVED in the writers
named below).

Shapes the current writers store (OBSERVED; the representative rows of T4 and T5 come from this table):

| Field | Writer and shape |
|---|---|
| `CUSTORDER#` `orderNumber` / `total` / `status` / `createdAt` | `create.ts:437-449`: string `PPB-NNNN` / number / `"placed"` (never updated afterwards, F-CMRC1-CUSTORDER-STATUS) / ISO string |
| `CUSTOMER#` `name` | `create.ts:461`: string (`if_not_exists`) |
| `CUSTOMER#` `phone` | `create.ts:478-480`: string or `null`; `public-update.ts:87-90`: string, `""` when cleared |
| `CUSTOMER#` `birthday` | `create.ts` (only when given): string; `public-update.ts:92-95`: string or `null` |
| `CUSTOMER#` `defaultAddress` | `create.ts:486`: shipping-address map or `null`; `public-update.ts:97-100`: any value or `null` |
| `CUSTOMER#` `email` | no checkout writer sets it (`create.ts:450-491`); absent on checkout-created records. A profile Item can then be `{}`; it is passed as `{}` (today `profile/route.ts:153` returns that `{}`, not `{ email }`) |
| `ORDER#` `id`, `orderNumber`, `createdAt`, `currency`, `customerName`, `status` | `create.ts:401-435`: strings |
| `ORDER#` `customerPhone`, `paymentMethod`, `shippingAddress` | `create.ts`: string or `null`; map or `null` |
| `ORDER#` `subtotal`, `shippingCost`, `total` | `create.ts:125`, `:211`, `:347`: numbers (the serving fixtures store strings, `fixtures.mjs:516-520`; both pass through) |
| `ORDER#` `items[]` | `create.ts:198-207`: map `{ productId, productTitle, quantity: number, unitPrice: string, totalPrice: number, selectedVariant: string \| null, personalizations: map[], imageLink: string \| null }` |
| `ORDER#` `statusHistory[]` | `create.ts:429`: `{ status, timestamp, note: string }`; `update-status.ts:57`: `note` string or `null` |
| `ORDER#` `trackingNumber` | absent; `update-status.ts:68-71`: string; `orders/update.ts:50-53`: any JSON value from the admin body |
| `ORDER#` `estimatedDeliveryDate` | absent, or any JSON value from the admin body (`orders/update.ts:50-53`) |
| `ORDER#` `discount` | no runtime writer (`create.ts` stores `couponDiscount`); present only in fixtures (F-CMRC1-CONFIRM-DISCOUNT) |

Backend order of checks for each route: role (`requireRole(auth, ["RENDERER"])` with no target tenant, as the
scheduling visitor routes, `backend/src/scheduling/visitor/common.ts:4-8`: `RENDERER` passes, `GLOBAL_ADMIN` passes by
`requireRole`'s first rule, `backend/src/auth/policy.ts:39`; every other role → 403) → `x-tenant-id` present → body
structure → `normalizeEmail(email)` → the read. (The role rule meets PD-002's "RENDERER, not anonymous or CUSTOMER";
the identity rule is stated per route in the table.)

| Id | Route | Request | Answer 200 | Read (all through § 5.5 references) | Identity |
|---|---|---|---|---|---|
| D1 | `POST /customer/order-history` | `{ email }` | `{ orders: OrderHistoryEntry[] }`, sorted as `getCustomerOrders` (`lib/dynamo-customer-reads.ts`) (newest `createdAt` first, stable) | Query `customerOrdersQuery`, all pages, projection `orderNumber, total, #s, createdAt, SK` — exactly the query of `getCustomerOrders` (`lib/dynamo-customer-reads.ts`) | session (PD-002) |
| D2 | `POST /customer/profile-read` | `{ email }` | `{ profile: CustomerProfileView \| null }` — the Item as returned, `null` when the response has no Item | GetItem `customerRef`, projection `email, #n, phone, birthday, defaultAddress` — exactly `getCustomerProfile` (`lib/dynamo-customer-reads.ts`) | session (PD-002) |
| D3 **[L]** | `POST /customer/order-lookup` | `{ orderId, email }` | `{ order: OrderView }` | GetItem `orderRef` with projection of the 17 `OrderViewField`s plus `customerEmail`; 404 unless `stored customerEmail === normalizeEmail(email)` — **exactly** the rule of `getOrderForCustomer` (`lib/dynamo-customer-reads.ts`), not the looser `public-get.ts:26` rule; `customerEmail` is removed from the answer | page address — **no PD-002 conformance claimed**; CMRC-ORDER-LOOKUP-AUTHORITY |

`OrderViewField` = `id, orderNumber, createdAt, currency, customerName, customerPhone, discount, estimatedDeliveryDate,
items, paymentMethod, shippingAddress, shippingCost, status, statusHistory, subtotal, total, trackingNumber`
(EXECUTED: `sed -n 1820,2060p renderer/src/components/SitePage.tsx | grep -o -E "order\??\.[a-zA-Z]+" | sort -u`; a
lower bound — a field read through destructuring would be missed; the T11 order-page comparison is the proof). Before,
the renderer received the whole item minus `internalNotes`; the views are server-only functions that pass no order
object to a client component (OBSERVED: no `order=` prop in `site-page/order-views.tsx`), so the narrower answer changes
no page (INFERRED; T11 proves it).

D3 carries the email in a POST body on the renderer → backend hop. On the browser → renderer hop the email stays in the
page address as today (`CheckoutPageView.tsx:401`, `AccountPageView.tsx:330`) — F-CMRC1-EMAIL-IN-PAGE-URL. D3 is
reached only on the dynamic twin, which answers `no-store`.

Renderer side (`renderer/src/lib/customer-api.ts`): each function makes one `callBackend` call and maps the answer.
Dependency failures stay distinct from "not found":

| Function | Backend 200 | Backend 404 `notFound` | 400, 403, 500, any other status, or `callBackend` returns `null` |
|---|---|---|---|
| `getCustomerOrders(tenantId, email)` | `orders` | — (not an answer of D1) | throws `CustomerApiError` → the route's existing `catch` answers 500 `{ error: "Failed to fetch orders" }` (today's body, `account/orders/route.ts:63-66`) |
| `getCustomerProfile(tenantId, email)` | `profile` (`null` when none; the route then answers `{ email }` as `profile/route.ts:153`) | — | throws → 500 `{ error: "Failed to fetch profile" }` (`profile/route.ts:154-157`) |
| **[L]** `getOrderForCustomer(tenantId, orderId, email)` | `order` | `null` → the page's "not found" state, as today | throws → the render fails, as a DynamoDB error does today (INFERRED: today an SDK error in `getOrderForCustomer` propagates out of `SitePage`) |

### 5.7 Error taxonomy

Backend (`self-service.ts`), one closed sum, one exhaustive `switch` to the HTTP answer, no `default` arm:

```ts
type SelfServiceRefusal =
  | { kind: "forbidden" }                              // 403 { code: "forbidden" } — requireRole refused the role
  | { kind: "missingTenant" }                          // 400 { code: "missingTenant" }
  | { kind: "malformedRequest"; issues: { path: string; message: string }[] }
                                                       // 400 { code: "malformedRequest", issues } — body not a JSON
                                                       //   object of exactly the named non-empty string fields; a
                                                       //   renderer defect by the input rule; never echoes a value
  | { kind: "notFound" };                              // [L] 404 { code: "notFound" } — D3 only: no such order, an
                                                       //   order of another tenant, an email that does not match
                                                       //   (malformed or not): one answer for all
```

D1 and D2 have no "not found" refusal: an unknown or malformed email answers `{ orders: [] }` / `{ profile: null }`,
as today's reads return `[]` / `null`. A DynamoDB or other unexpected failure is not a refusal: it throws, the outer
`catch` answers 500 `{ code: "internal" }` and logs the route name and the error name only (no email, no order id, no
body). The `issues` form is the scheduling one (`booking-proxy.ts:53-55`: path and message).

Renderer (`customer-api.ts`): `CustomerApiError` carries `{ route, status: number | "unreachable" }`, never the email.
`callBackend` keeps the scheduling contract: `null` when `API_URL` or the key is missing or the call fails
(`booking-proxy.ts:213-243`).

### 5.8 Infrastructure (needs the named gain of the standing directive, `docs/ROADMAP.md:11-15`)

Named gain: the routes remove the renderer's direct reads (C4) and the table is the destination that `cmrc-2`'s tool
is proven against on staging before any function depends on it. A stateful resource is reviewed alone in a diff that
cannot break a function.

- `infra/lib/database.ts`: `this.commerceTable = new dynamodb.Table(scope, 'CommerceTable', { tableName:
  \`AmodxCommerceTable${suffix}\`, partitionKey PK string, sortKey SK string, PAY_PER_REQUEST, RETAIN, PITR on })`.
  No GSI (§ 2.4), no stream, no TTL. Nothing receives it (not passed to any construct).
- `infra/lib/api-commerce.ts`: `NodejsFunction`s for D1, D2 (**[L]** D3) with `nodeProps` minus `EVENT_BUS_NAME`
  and minus the revalidation variables (they publish nothing, purge nothing), entry
  `backend/src/customers/self-service.ts`, handler names of § 5.4; `table.grantReadData` on each; routes with
  `authorizationType: 'CUSTOM'` on the commerce authorizer (not `noAuth`).
- The renderer function: no change to its role or variables.

### 5.9 Tests and gates

Named tests (all credential-free):

| Id | File | Proves |
|---|---|---|
| T1 | existing `backend/test/unit/pay-1.test.ts`, `coupon-fix-1.test.ts`, `order-checkout-1.test.ts`, `order-confirm-1.test.ts`, `order-price-1.test.ts`, `email-key-normalization.test.ts` — **kept, unedited** | Regression only, for what each already covers: order creation and the payment update (they mock `db.js`, OBSERVED `pay-1.test.ts:15`, `coupon-fix-1.test.ts:22`). They do **not** cover every S1-S15 path, and `email-key-normalization.test.ts` pins copied key expressions, not handler wiring (OBSERVED `:17-29`). They are not the C2 proof. |
| T1b | new `backend/test/unit/cmrc-1-command-trace.ts` (scenarios + recorder), `cmrc-1-command-trace.capture.test.ts` (skipped unless `CAPTURE_GOLDEN_TO` is set; the precedent `cat-import-profile-1-golden.capture.test.ts:1-20`), golden `backend/test/unit/fixtures/cmrc-1-command-trace.baseline.json`, comparison `cmrc-1-command-trace.test.ts` | **C2.** The recorder replaces `db.js` `send` (the same mock seam as T1), answers each command from the scenario's scripted responses, and records every command in order: class name and full input, including each `TransactItems` entry. Time and ids are fixed (`vi.useFakeTimers`, a seeded `randomUUID`). One scenario at least per path: S1-S4 create without coupon, with a per-customer-limited coupon, and with the coupon item cancelled (second pass); S5; S6 over two pages; S7 match and mismatch; S8 with and without tracking number; S9 field update and payment transition; S10; S11; S12; S13; S14 customer present and absent; S15 non-admin download. Recorded per scenario: the command list and the HTTP answer. The golden is captured on `5aee9cb` from a `git worktree` (procedure in the capture file's header, as the precedent), never from the changed code. Comparison: deep equality, order-sensitive. |
| T2 | new `backend/test/unit/cmrc-1-commerce-db.test.ts` | each reference yields exactly today's key and `TableName = TABLE_NAME` (one row per family); `COMMERCE_PRIVATE_PREFIXES` lists the four prefixes; `orderIdOfCustomerOrder` on a stored SK |
| T3 | new `backend/test/unit/cmrc-1-key-ownership.test.ts` | C1, by syntax tree, not by text: parses every `.ts`/`.tsx` file of `git ls-files backend/src renderer/src` with the TypeScript compiler API and walks string literals and template parts; fails if a literal contains `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER` or `ORDER#` not preceded by a capital letter, in any file other than `backend/src/lib/commerce-db.ts` — and, while part L is not built, the one `ORDER#` literal inside `getOrderForCustomer` of `renderer/src/lib/dynamo-customer-reads.ts` (a named, counted exception; **[L]** deletes it from the test). Comments are not literals. Self-test rows: a fixture literal is found; a comment is not. |
| T4 | new `backend/test/unit/cmrc-1-self-service.test.ts` | per route: roles `RENDERER` and `GLOBAL_ADMIN` pass; `TENANT_ADMIN`, `EDITOR`, `CUSTOMER`, `SERVICE` → 403 and no DynamoDB call; no `x-tenant-id` → 400 `missingTenant`; body absent / not JSON / extra field / field absent / field not a string / empty string → 400 `malformedRequest` with `path`, no value echoed, no DynamoDB call; fullwidth, upper-case and spaced forms of one address read the same key. Input rule rows: emails `an a@example.com`, `a#b@example.com`, a 1000-character string, an unknown valid address → D1 `{ orders: [] }`, D2 `{ profile: null }`, each after the same read as today (the command is asserted). D1 two pages, sort newest first, equal `createdAt` keep stored order. Value rule rows (§ 5.6 table): `CUSTORDER#` with numeric `total`; profile with `phone: null`, `birthday: null`, `defaultAddress: null`; profile Item `{}` → `profile: {}`; each passed unchanged. A DynamoDB error → 500 `internal`, the log line holds no email. **[L]** D3 rows: absent order, other tenant's order, email mismatch, malformed email, order id with `#`, stored non-normalized email (the four cases of `renderer/test/unit/order-email-1.test.ts:86-98`) → the same 404 body; an order whose `customerPhone`, `shippingAddress`, `paymentMethod`, `statusHistory[].note`, `items[].selectedVariant`, `items[].imageLink` are `null`, with numeric `subtotal`/`total`, without `trackingNumber`/`discount` → answered unchanged, absent stays absent; the answer has exactly the projected fields present on the item (no `PK`, `SK`, `internalNotes`, `billingDetails`, `customerEmail`). |
| T5 | new `renderer/test/unit/cmrc-1-customer-api.test.ts` | each function sends one POST to the right route with exactly the three headers and the body built from its arguments, through the real `callBackend` (credential setup as T10); the answer mapping of § 5.6, including 400/403/500/unreachable → `CustomerApiError` and **[L]** 404 → `null`; values with `null`, numbers and nested maps come back deep-equal; `/api/account/orders` and `/api/profile` GET: no session → 401 and no backend call; a browser `?email=`, body or `x-tenant-id` is not forwarded; answers keep today's shapes (`{ orders, email }`; profile, `{}` or `{ email }`) |
| T6 **[L]** | changed `renderer/test/unit/order-email-1.test.ts` | its normalized-email cases now target `getOrderForCustomer` of `@/lib/customer-api` with the backend mocked (forwarding only); the stored-form cases moved to T4. The file name stays (the order-email-1 rule is still what it proves). |
| T7 | changed `infra/test/amodx-stack.test.ts` | the commerce table exists with PK/SK, PAY_PER_REQUEST, PITR, Retain, no GSI, no TTL; no IAM statement in any role of any template names it; no function variable holds its name; the new routes exist with `CUSTOM` authorization; their functions have main-table read and no write, no SES, no `events:PutEvents`; the renderer function's role is unchanged |
| T8 **[L]** | changed renderer unit tests that reach the order pages (`cdl-2-site-page.test.ts:22`, `:75-78`, `:169`; `locale-1d-server-render.test.ts:30`, `:118`; any other a run of the suite names) | their `getOrderForCustomer` mock moves from `@/lib/dynamo` to `@/lib/customer-api`; assertions unchanged. Mock entries in tests that never reach the order pages may stay (an extra mock key is inert, INFERRED) or be removed; the builder records which. |
| T9 **[L]** | changed `renderer/test/serving-contract/harness.mjs` | a local HTTP stub answers `POST /customer/order-lookup` from the fixture items with the D3 projection, email rule and 404 answer; every other API path stays unreachable and fails the row (`harness.mjs:112`, `:244`). It proves the renderer side only; the backend rule is T4 and T1b. |
| T10 | changed `renderer/test/unit/sched-1g-proxy.test.ts:16` | the `@/lib/api-client` module mock is removed (it would also replace the moved `callBackend`; and replacing an export cannot reach the call `callBackend` makes to `getRendererKey` inside the same module). Credential-free setup instead: `beforeEach` sets `process.env.AMODX_API_KEY` to the test's key value (`""` for the no-key rows) and deletes `AMODX_API_KEY_SECRET`, so `getRendererKey` takes its environment path (`api-client.ts:22-26`) and never reaches Secrets Manager (`:29-58`); `afterEach` restores both variables. The env path does not set the module cache (`cachedKey` is written only on the Secrets Manager path, `:42-47`), so values do not leak between tests. `globalThis.fetch` stays stubbed as today. Assertions unchanged. No runtime abstraction is added for this test. |
| T11 **[L]** | new `renderer/test/serving-contract/cmrc-1-order-pages.mjs`, baseline `renderer/test/serving-contract/cmrc-1-order-pages/baseline/`, rows in `contract.test.mjs`, one fixture item in `fixtures.mjs` | The order-page comparison of G6 (below). |

**T11 — the order-page comparison (closes review-0 correction 5).** Existing rows do not give this guarantee:
`cm1-identity-*` do not request the order pages (`cm1-byte-identity.mjs:37-43`), and `loc1-order-pages`
(`contract.test.mjs:3498-3515`) checks status and selected texts only. T11 is new:

- Request list (module `cmrc-1-order-pages.mjs`), on the EN commerce fixture host and on its RO copy's host. Order
  shown: confirmation of the bank-transfer order and of the cash-on-delivery order, tracking of both
  (`locale-1/proof.mjs:70-82` paths). No order requested: the confirmation address with no query; with `?id=<id>&email=`
  (empty email). Not found: tracking and confirmation with another email; an absent order id; the id of an order
  stored under another tenant (one new fixture item `ORDER#cmrc1-other-tenant` under the RO commerce copy only,
  requested on the EN host); malformed email `an%20a%40serving-contract.test`; an id containing `%23`.
- Baseline: the renderer at `5aee9cb`, built and served from a `git worktree` with this candidate's `fixtures.mjs`,
  `ddb-stub.mjs`, `cm1-byte-identity.mjs` and `cmrc-1-order-pages.mjs` copied in (the procedure of
  `cm1-byte-identity/README.md`), reading orders through the DynamoDB stub. Captures committed under
  `cmrc-1-order-pages/baseline/<tenant>/<file>.body`, `index.json` (build id; per URL path, status, Content-Type),
  `client-modules.json` — the cm1 layout.
- Candidate: the tree under test, reading orders through the T9 backend stub, captured by the rows.
- Comparison: status and Content-Type equal; body equal after `maskBody` of `cm1-byte-identity.mjs:326` — the
  ratified CM1-A1 + CM1-A3 canonicalization (flight rows as a sorted set, client references by module path, footer
  year, asset paths, build id, bootstrap chunk names). This is **not** literal byte equality; it is the same rule the
  suite already uses for "identical".
- Rows: `cmrc1-order-pages-identity-en`, `cmrc1-order-pages-identity-ro`, and `cmrc1-order-pages-control` (the stub
  answers the bank order with another total; the comparison must turn red — the detector is proven to see a change).
- File changes: `contract.test.mjs` (three rows), `cmrc-1-order-pages.mjs` (new), `fixtures.mjs` (one item; any other
  row whose count moves because of it is named and updated by the builder), `harness.mjs` (T9), the baseline
  directory (new).

Gates, in order, against a fresh build:

| Gate | Command | Pass |
|---|---|---|
| G1 | `npm run build` | exit 0 |
| G2 | `npm run typecheck` | exit 0 |
| G3 | `cd backend && npm run test:unit` | all pass; T1b equal to the `5aee9cb` golden; T1 files unedited (`git diff --stat` on them is empty) |
| G4 | `cd renderer && npx vitest run` | all pass |
| G5 | `cd infra && npm test` | all pass |
| G6 | `cd renderer && npm run test:serving` and `npm run test:serving-bundle` | all rows pass; **[L]** rows `cmrc1-order-pages-*` (T11) pass |
| G7 | `cd tools/mcp-server && npm test` | pass; the new routes appear in the "no tool" report (they are renderer-only, not admin tools) |
| G8 | `git grep -n -E 'getOrderForCustomer\|getCustomerOrders\|getCustomerProfile' -- renderer/src` | part K: `getCustomerOrders`/`getCustomerProfile` only in `lib/customer-api.ts` and the two API routes; `getOrderForCustomer` still in `lib/dynamo-customer-reads.ts` (declaration), `lib/dynamo.ts` (re-export) and `SitePage.tsx`. **[L]**: `getOrderForCustomer` only in `lib/customer-api.ts` and `SitePage.tsx` |
| G9 | `cd infra && npx cdk diff` (operator, staging) | adds the table, the new functions with roles/policies, integrations/routes/permissions; no change to any other function's role; renderer function: code asset only |

### 5.10 Evidence taxonomy

Every gate and staging step is reported as **EXECUTED** (command and its result), **OBSERVED** (an artefact or a page
inspected), **INFERRED** (reasoned), or **NOT RUN** (with the reason). A count of passing tests is not evidence of a
product outcome by itself: G6 and the staging steps of § 5.13 are the product evidence.

### 5.11 Deploy order and rollback

One `cdk deploy`, backend and renderer together (the renderer calls routes that this deploy creates). The
deploy creates the routes before the renderer code is switched (INFERRED: the nested stack's routes and the renderer
function update in one CloudFormation update; for minutes during the update a new renderer may call a route that does
not yet answer; only commerce tenants' account and order pages are affected). To have no window, deploy in two
steps: (1) a commit with the backend, shared and infra changes and `renderer/src` unchanged, (2) the full commit. The
builder therefore makes the renderer change the last commit of the slice. The two-step order is the **recommended
production order**.

Rollback: redeploy the previous commit. Data: none moved, nothing to restore. The table is `RETAIN`: a rollback removes
it from the stack but does not delete it, so a later redeploy of `cmrc-1` would fail on the existing name (INFERRED from
CloudFormation's behaviour for a retained resource with a fixed name). After a rollback, the operator deletes the empty
`AmodxCommerceTable<suffix>` by hand (item count 0 checked first) before the next deploy.

### 5.12 What a live non-commerce tenant sees, before and after

The same pages, bytes and headers. Reason: the three changed renderer paths are reached only by a session on
`/api/account/orders`, `/api/profile`, and the order confirmation / tracking prefixes of `SitePage`
(`commerce.type === 'checkout-confirm' | 'checkout-track'`, `SitePage` in `SitePage.tsx`; **[L]**), which are matched only
on a tenant with commerce prefixes. Proof: G6 (the non-commerce rows of the serving suite unchanged) and the staging step 1
below. Production condition (NOT RUN): the 51 reference URLs of `next-patch-1` equal before and after.

### 5.13 Staging procedure (operator; staging only; no production call)

1. Before deploy: capture the 51 reference URLs (headers and words, the `next-patch-1` method).
2. Deploy (§ 5.11, two steps).
3. The 51 URLs: equal to step 1.
4. On the staging commerce test tenant: sign in with Google; the account page lists the same orders as before the
   deploy; the profile shows; the profile save works.
5. **[L]** Place one test order; open its confirmation link (`?id&email`): same page as before; change one letter of
   the email in the address: the "not found" view; put a space into the email: the "not found" view; open the tracking
   link: same page. (Part K only: the same links still work, through the unchanged S16 read.)
6. Call each route directly with a tenant-admin session token: 403; with no credential: refused by the authorizer
   (`EXECUTED` with `curl`; no token or key is printed).
7. CloudWatch logs of the new functions for steps 4-6: no email, no order id in any line.
8. DynamoDB console: `AmodxCommerceTable-staging` exists, item count 0.

### 5.14 Definition of done and exit criterion

Done: C1-C7 met (part K; **[L]** items when part L is built); G1-G8 EXECUTED and passing; G9 and § 5.13 OBSERVED on staging; documents updated (§ 5.4 last row);
`docs/TECH-DEBT.md` lists the findings of § 10.3 that stay open. Exit: a pickup writer can be written against the
references (§ 7). Storage of the moved kinds can move by changing one binding in `commerce-db.ts` plus infrastructure (`cmrc-4`) **only
when part L (or the token slice) has also shipped**: part K alone does not meet the cutover gate of § 6.

### 5.15 Size, stop conditions and a pre-agreed split

Size (INFERRED): 12 backend files changed mechanically, 2 new backend files, 6 renderer files, 2 infra files, about
14 test files plus two captured baselines (T1b golden, T11 baseline). Stop conditions for the builder: T1b differs
from the `5aee9cb` golden (a command or an answer changed); a T1 file needs an edit; a T11 row (**[L]**) differs from
its baseline; a site not in § 2.2 is found (report it; it is the lower-bound case); part L is reached while
CMRC-ORDER-LOOKUP-AUTHORITY is open. If the work does not fit one build run, split at this line and no other:
**`cmrc-1a`** = C1, C2 (data module, re-pointing, T1, T1b, T2, T3); **`cmrc-1b`** = C3-C6 part K (routes D1, D2,
renderer account routes, table, T4, T5, T7, T10); part L as its own build after the decision (D3, T4/T5 [L] rows,
T6, T8, T9, T11). `cmrc-1a` alone changes no behaviour and needs no infra.

## 6. `cmrc-2` … `cmrc-6` re-cut to today's code

**New writes land in the private table only after the storage cutover slice (`cmrc-4`).** Before it, every write
of every commerce-private kind goes to the main table, through `commerce-db.ts`.

**Cutover gate (closes review-1 correction 1 as a class).** Rule: the storage of a kind may move only when **every
runtime reader and writer of that kind reaches it through `commerce-db.ts`**; a site that names the main table
directly would keep reading or writing the old copy after the move. Check at the start of `cmrc-4`: T3 passes with
**no** exception (today's only exception is S16), the per-prefix `git grep` of § 2.2 is re-run and every hit is in
`commerce-db.ts` or in the operational tool S19, and any pickup writer (W6, § 7) uses the references. Instances today:
S16 (removed by part L under CMRC-ORDER-LOOKUP-AUTHORITY = A or B, or by the token slice under C). If the check fails,
`cmrc-4` does not start.

- **`cmrc-2` — the tool and the write freeze.** Scope: (1) extend `scripts/migrate-commerce-private-table.ts` (it
  exists, P11) instead of a new script: import `COMMERCE_PRIVATE_PREFIXES` from `commerce-db.ts` (one list of kinds);
  add `verify --strict` with **content** equality (every attribute of every item deep-equal, not only keys and
  counts — a stale value is a difference) that also writes the **verification manifest** (below), `verify
  --post-cutover`, and the two removal branches defined below
  (`purge-plan`/`purge`/`purge-verify` and `discard-plan`/`discard`/`discard-verify`); report per item any GSI attribute
  (§ 2.4) and any key not in `normalizeEmail()` form (F-FND2-1); write with conditional Puts (`attribute_not_exists(SK)`)
  instead of `BatchWrite`, so a second run cannot overwrite a newer destination item. (2) The write freeze guard below.
  Proof: unit tests against an in-memory table (the `backend/test/unit/memory-table.ts` pattern) for every mode and
  for the guard in each writer, then a staging run against the empty `AmodxCommerceTable-staging`. Depends:
  `cmrc-1`. If CMRC-TEST-ONLY = B: only the discard branch, the report and no guard.
- **`cmrc-3` — copy under the write freeze (operational).** Run order: freeze deploy → drain → `plan` → `migrate` →
  `verify --strict` (content) → `cmrc-4` cutover deploy (freeze kept) → pre-release checks P1-P3 → release deploy →
  post-release checks Q1-Q6 (all defined in "The write freeze" below). Proof: the tool's reports per tenant and
  prefix, the verification manifest, and the freeze record. Depends: `cmrc-2`. Skipped if CMRC-TEST-ONLY = B.
- **The write freeze (closes review-0 correction 7 as a class: every writer of a moved kind is frozen, not only the
  checkout).** Frozen writers — every runtime writer of the four kinds in § 2.2, re-checked by the same per-prefix
  `git grep` when `cmrc-2` is written (a lower bound; a new writer found then joins the list):
  W1 `orders/create.ts` (S1-S4, anonymous checkout); W2 `orders/update-status.ts` (S8, admin); W3 `orders/update.ts`
  (S9, admin fields and the `pay-1` payment transition); W4 `customers/update.ts` (S13, admin note); W5
  `customers/public-update.ts` (S14, customer profile through the renderer); W6 any pickup writer that exists by then
  (§ 7, condition 3). Mechanism (specified here, built in `cmrc-2`): one deploy-time variable
  `COMMERCE_WRITE_FREEZE_TENANTS` (comma list of tenant ids) on exactly the functions of W1-W6; each handler, before
  its first write (W1: before the order-counter UpdateItem), answers 503 `{ code: "commerceFrozen" }` for a listed
  tenant and writes nothing. Rejected: `commerceEnabled = false` alone — it stops only W1 (`create.ts:90-92`; W2-W5 do
  not read it, `orders/update.ts:23-44`, `customers/public-update.ts:28-44`) and it also hides the shop.
  Drain: after the freeze deploy reports complete, wait at least 60 s (twice the 29 s function timeout,
  `infra/lib/api-commerce.ts:65`) so that every invocation started on the old code has ended, then run the copy.
  `verify --strict` with content equality is the check that nothing changed after the copy. The freeze stays through
  the `cmrc-4` cutover deploy.

  **Release (closes review-1 correction 2 as a class).** Rule: a release condition may require only operations that
  the frozen state permits; every write check runs after the release, and the first accepted write is the rollback
  boundary. No bypass of the freeze exists (none is built). Order:
  1. **Pre-release checks, freeze on** (reads and refusals only):
     - P1 `verify --strict` (content) again, now with the cutover code live: every copied key is deep-equal in both
       tables. It writes the **verification manifest**: per key, tenant, SK, the SHA-256 of the item's canonical JSON
       (attributes sorted), the time of the run; the manifest file's own SHA-256 goes into the freeze record.
     - P2 each frozen writer W1-W5 (and W6 if it exists) answers 503 `commerceFrozen` for a listed tenant and writes
       nothing (one call each; P1 re-run after P2 shows no change).
     - P3 reads through the product on the new table show what they showed before the freeze (a capture made before
       the freeze deploy): account order list, profile read, confirmation and tracking pages of an existing order, admin
       order list and order, customer list and customer, reports summary, the download entitlement path.
     A P failure: keep the freeze; roll back by redeploying the pre-cutover commit with the freeze list kept; no write
     was accepted anywhere, so the main table is unchanged (P1 proves it) and no data is lost; the copy in the
     commerce table stays inert or is discarded. Then release the freeze on the old code.
  2. **Release deploy**: the same code with an empty freeze list. From the first write the commerce table accepts,
     this is the rollback boundary: a rollback after it needs a reverse copy of every item created or changed in the
     commerce table (the tool) or an accepted loss — the human's choice per tenant. This is **the rollback boundary
     rule** of the track; every rollback statement below refers to it.
  3. **Post-release checks** (writes): Q1 place an order with a coupon (W1); Q2 save a profile (W5); Q3 change an
     order's status with its mail (W2); Q4 a payment transition (W3); Q5 an admin customer note (W4); each read back
     through the product. Q6 `verify --post-cutover`: every manifest key exists in the commerce table; every key that
     exists only there was created after the release; the main table holds no key outside the manifest and every
     main-table item still hashes to its manifest value (no writer targets the main table). A Q failure: re-freeze at
     once (deploy with the list), then the human chooses fix-forward or a rollback across the boundary.
- **`cmrc-4` — storage cutover.** Scope: `COMMERCE_TABLE` = required `COMMERCE_TABLE_NAME` (no fallback);
  `COMMERCE_TABLE_NAME` and grants on the commerce table for exactly the functions that use it (create: read-write;
  admin order and customer writes: read-write; reads, reports, `GET /resources/{id}/download`, the `cmrc-1`
  routes: read), with a per-function access switch like `api-scheduling.ts:100-117`; the `create.ts` transaction
  becomes cross-table by construction (§ 5.5); `EMAILLIMIT#`/`COUPONUSE#` per CMRC-MAIN-KEYS (under B the mail
  counter of `create.ts:543-575` reads and writes `MAILRATE#<sha256>` instead of `EMAILLIMIT#<email>`). Proof: T1b against
  the `cmrc-1` golden with **exactly the differences listed for the chosen decision branch**, and no other (a command
  added, removed, reordered, or changed in any other field fails):
  - every branch: `TableName` of every command and transaction item that addresses a moved kind (`ORDER#`,
    `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER`) becomes the commerce table (under CMRC-TABLE = A, the scheduling
    table). Keys, expressions, values, conditions, call order and HTTP answers are unchanged;
  - CMRC-MAIN-KEYS = A: nothing more;
  - CMRC-MAIN-KEYS = B (and C, for the commands T1b covers): additionally, in the order-confirmation mail path of
    `create.ts:543-575`, the `Key.SK` of the mail-counter GetItem and UpdateItem changes from
    `EMAILLIMIT#<normalizedEmail>` to `MAILRATE#<sha256 hex of normalizedEmail>`; their table (main), `PK` (`SYSTEM`),
    expressions, values and place in the call order stay unchanged.
  The `cmrc-1` C2 obligation (no difference at all at `cmrc-1`) is not changed by this rule; staging order creation with a coupon; `verify --post-cutover`; the
  account, profile, confirmation and tracking pages; admin orders, customers, reports. Depends: the cutover gate
  above (part L of `cmrc-1` or the token slice shipped), and `cmrc-3` (or `cmrc-2` under CMRC-TEST-ONLY = B). Rollback: the rollback boundary rule
  of "The write freeze" (release step 2). Before the commerce table accepts its first write of **any** moved kind — a
  new order, a status or payment change of an existing order, a profile or note change, a counter increment — rollback
  is a redeploy of the previous commit and loses nothing. After it, rollback needs a reverse copy of every item of
  every moved kind created or changed in the commerce table (changed = content hash differs from the verification
  manifest; created = key not in the manifest; under CMRC-TEST-ONLY = B, with no manifest, every item in the commerce
  table) or an accepted loss — the human's choice per tenant.
- **`cmrc-5` — post-cutover validation and guard in CI.** Scope: T3 runs in the CI gate and also refuses
  `COMMERCE_TABLE_NAME` in `renderer/src`; decision on the anonymous `GET /public/orders/{id}`
  (F-CMRC1-PUBLIC-ORDER-GET); staging spot checks of § 5.13 repeated on the new table. Depends: `cmrc-4`. May merge
  into `cmrc-4` if the CI wiring is one line (decided when `cmrc-4` is written).
- **`cmrc-6` — remove the main-table items.** Only after this step is the security property true. Depends: `cmrc-5`
  and a validation window the human names. Two branches, never mixed in one run (closes review-0 correction 8 as a
  class: a deletion either proves a verified copy or carries an explicit authorization to lose the data; no third
  kind):
  - **Purge (verified copy; CMRC-TEST-ONLY = A).** Rule (closes review-1 correction 3 as a class): a purge proves
    that the **source is unchanged since verification** and that the **destination still exists**; it never requires
    the destination to stay equal (released writers change it legitimately — order status `update-status.ts:73-78`,
    payment status `orders/update.ts:154-160`, profiles `public-update.ts:107-112`), and it never writes the
    destination. The plan's guards stay (`plan-commerce-private-table.md` § Safety Rules): tenant allowlist; both
    table names; backup reference (on-demand backup ARN, or PITR + the exact UTC time recorded just before the run)
    and an NDJSON export of the candidates, both before the first delete. Input: the verification manifest of P1
    (its SHA-256 checked against the freeze record). Per candidate main-table key, with a consistent read just before
    its delete:
    - key in the manifest, source hash = manifest hash, destination item present (any content) → delete;
    - source hash ≠ manifest hash ("source changed after verification": a writer reached the main table) → refuse;
    - destination item absent → refuse;
    - key not in the manifest (created after verification) → refuse.
    A refused key is listed with its reason and stays; the run ends non-green; a refusal is a defect to investigate,
    never repaired by copying source over destination. Tests (built in `cmrc-2`): destination updated after release →
    deleted; destination unchanged → deleted; source changed → refused; destination missing → refused; key outside
    the manifest → refused; no command ever targets the destination table except reads. Residual race (stated): the
    read-then-delete pair is not one transaction; it is safe because after `cmrc-4` no runtime writer targets the main
    table for these kinds (cutover gate; Q6 proves it). Postcondition (`purge-verify`): every deleted key is absent in
    the main table and present in the commerce table; refused keys are reported.
  - **Discard (authorized loss; CMRC-TEST-ONLY = B, and the plain-text `EMAILLIMIT#` items under CMRC-MAIN-KEYS = B in
    either case).** A separate mode, `discard`; `purge` never runs without its destination guard. Changed guard: no
    destination check (there is no copy, by design). Rule (closes review-1 correction 4 as a class): **a discard
    selects only by an exact predicate that no live writer can produce**; a selector shared with live records is
    refused. The two predicates, and nothing else:
    - the four kinds: `PK = TENANT#<id>` for an allowlisted tenant and `begins_with(SK, p)` for `p` in
      `ORDER#`, `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER` — after `cmrc-4` and its drain no writer targets the main
      table for them (cutover gate; the `cmrc-4` T1b trace);
    - the old mail counters: `PK = SYSTEM` and `begins_with(SK, "EMAILLIMIT#")` — after `cmrc-4` the live counter is
      written under the **disjoint** prefix `MAILRATE#<sha256(normalizedEmail)>` (CMRC-MAIN-KEYS = B), so no live
      writer produces `EMAILLIMIT#`, and the predicate never reaches a `MAILRATE#` item or a `TENANT#` record of the
      `SYSTEM` partition.
    Added guards: an authorization record by the human (who, date, the tenant allowlist or the partition `SYSTEM`, the
    predicate) whose path the mode requires; the mode refuses any selector that is not one of the two predicates (no
    whole-partition delete); backup reference as for purge; each item is written to the NDJSON export before it is
    deleted, and the run refuses to finish green unless export count = deleted count. Postcondition
    (`discard-verify`): no item matching the predicate remains for the listed partitions; the export's line count and
    SHA-256 are written into the authorization record. Coexistence test (built in `cmrc-2`): the `SYSTEM` partition
    holds `EMAILLIMIT#ana@example.com`, `MAILRATE#<64 hex>` and `TENANT#t1` → discard removes only the first;
    `discard-verify` passes with the other two present. Why `EMAILLIMIT#` is discarded, not copied: it is an hourly
    mail counter (`create.ts:543-575`); after `cmrc-4` it has no reader or writer, and losing one resets one sender's
    count for at most the current hour.

## 7. The WooCommerce pickup seam (not built here)

What a later pickup writer does (INFERRED from the human's direction; its own specification decides the details):
reads paid WooCommerce orders with a read-only key stored in `TenantConfig` (Critical rule 8), and for each one
writes a **client** (`CUSTOMER#<normalizedEmail>`, the same Update with `if_not_exists` as `create.ts:450-491`, so a
later checkout by the same person meets the same record), an **order-like record** (for example `ORDER#<id>` with a
`source` naming WooCommerce and its order id, plus an idempotency item keyed by the WooCommerce order id so a second
run writes nothing new), and a **link to a booking** — on the booking side this already exists:
`BookingSource` `{ kind: "order", orderId, line }` (`packages/shared/src/scheduling.ts:263-268`).

Where it calls the data module: it builds every key and table through `commerce-db.ts` references; for a new kind
(the idempotency item) it adds a reference and its prefix to `COMMERCE_PRIVATE_PREFIXES` in the same slice. The
booking it creates goes through `scheduling-db.ts`.

What must be true so that the storage cutover moves those writes with no change in the pickup code:

1. The pickup code names no table and no key prefix (T3 enforces this for every file except `commerce-db.ts`).
2. Every kind it writes is in `COMMERCE_PRIVATE_PREFIXES`, which the copy tool imports (one list), so the one copy of
   `cmrc-3` moves its records too — not a second migration.
3. It can be paused per tenant, and it is paused during the `cmrc-3` freeze.
4. Its kinds use PK/SK only (no GSI attribute).
5. A write that spans the order record and the booking is a cross-table transaction already (scheduling table +
   main table before `cmrc-4`; scheduling table + commerce table after). The pickup code does not change.

**The simplest correct answer is: build the pickup after `cmrc-4`.** Then its personal data never sits in the
main table, there is nothing of it to copy or purge, and conditions 2 and 3 cost nothing. Cost in slices: the pickup
waits for `cmrc-1` with its part L, `cmrc-2`, `cmrc-3`, `cmrc-4` (four slices; two if CMRC-TEST-ONLY = B, because
`cmrc-3` falls away and `cmrc-2` shrinks to the discard branch, which can follow later; plus the token slice if
CMRC-ORDER-LOOKUP-AUTHORITY = C, because the cutover gate needs S16 gone). Built earlier, it works under conditions 1-5, but its
records are readable by the renderer until `cmrc-6`. Decision CMRC-WOO-SEQUENCE.

## 8. Decisions

DECISION_REQUIRED:
- ID: CMRC-ORDER-LOOKUP-AUTHORITY
  QUESTION: What authority lets a guest read the order confirmation and tracking pages, now that the read moves behind a backend route?
  PROBLEM: Today a buyer needs no account. After checkout the browser opens the confirmation page with the order id and the email in the page address (`CheckoutPageView.tsx:401`); the tracking page works the same way (`AccountPageView.tsx:330`). The renderer reads the order and shows it when the stored email equals the one in the address (`getOrderForCustomer` in `renderer/src/lib/dynamo-customer-reads.ts`, the `checkout-confirm` / `checkout-track` branches of `SitePage` in `SitePage.tsx`). There is no session check. PD-002 says the backend receives an email that the renderer took from a validated session, and that the browser never supplies the email as an authority; its token variant covers scheduling only. So today's read does not conform to PD-002. While the renderer reads DynamoDB itself the gap is hidden; a backend route that accepts a browser-supplied email makes it visible. The anonymous backend route `GET /public/orders/{id}?email=` (S7) uses the same proof. Facts: the order id is a random UUID (`create.ts:78`); the email travels in page addresses, browser history and (for the confirmation) the checkout redirect.
  OPTIONS:
  - A. Ratify a narrow commerce exception in PD-002: a read-only order view may be authorized by possession of the order id and an email equal to the stored normalized email, through the renderer with the renderer key, answering only the 17 `OrderView` fields. Reward: guest links and pages stay as they are; C5 holds; part L is built as written; no new mechanism. Risk: the proof stays as weak as today — whoever holds the link sees name, phone and address; this is recorded, not repaired. Consequence: the human amends PD-002 (as the 2026-11-21 booking-token amendment) before part L is built; the anonymous S7 route is then judged against the same text in `cmrc-5`.
  - B. Session-derived email only (PD-002 as written). Reward: no exception; the strongest rule without new mechanism. Risk: every guest buyer (checkout needs no account) loses the order details on the confirmation page and the tracking page; a tenant without Google sign-in configured loses them for everyone. Consequence: C5 is rewritten for the order pages and part L gets a guest design (what the page shows without a session) before it is built.
  - C. Token links in a prerequisite slice: each order gets an unguessable token stored as a hash (the scheduling `TOKEN#` pattern, PD-002 booking-token variant extended to commerce); the confirmation and tracking addresses carry the token instead of the email; D3 becomes a token lookup. Reward: a stronger proof; no email in page addresses (closes F-CMRC1-EMAIL-IN-PAGE-URL). Risk: new scope — token issue at checkout, links already in browsers and account pages, expiry, rollout of old links; one more slice before part L. Consequence: `cmrc-1` ships as part K; S16 stays in the renderer until the token slice; PD-002 gets a commerce token amendment; `cmrc-4` waits for the token slice (cutover gate, § 6).
  RECOMMENDED: A for this preservation slice (it changes no behaviour and records the gap), with C recorded as separate later work.
  BLOCKING_REASON: Blocks part L of `cmrc-1` (every item marked [L] in § 5) and, through the cutover gate (§ 6), `cmrc-4` and everything after it. Part K does not depend on it. The document claims no PD-002 conformance for the order-page read until this is decided.

DECISION_REQUIRED:
- ID: CMRC-TABLE
  QUESTION: Do commerce private records get their own table, or go into the existing scheduling private table?
  PROBLEM: Scheduling already has a private table that the renderer cannot read (`infra/lib/database.ts:60-72`). Commerce needs the same protection. One table means one more thing shared by two features; two tables means one more table to run.
  OPTIONS:
  - A. One table (the scheduling table). Reward: one backup, one alarm set, a booking and its order in one table. Risk: the table is named `AmodxSchedulingTable`, so commerce data would live in a table whose name says "scheduling" (a misleading name; a DynamoDB table cannot be renamed without replacement); that table has TTL on `ttl` (`database.ts:71`), so any commerce item that ever carries `ttl` (today `EMAILLIMIT#` does) is deleted by it; scheduling's ratified rules (sched-1 § 6.1: no TTL on customer data, its erasure § 14) would govern orders; every commerce function would get a grant on booking data. Consequence: `cmrc-1` creates no table; `cmrc-4` points `commerce-db.ts` at the scheduling table; sched-1 § 6 needs an amendment.
  - B. A second table, `AmodxCommerceTable` (same settings as the scheduling table, no TTL). Reward: each feature's functions get grants only on their own data; retention and erasure rules stay separate (orders may need a legal retention that bookings do not — to be checked, NOT verified here); the plan stands. Risk: one more table and backup; a booking created from an order is a cross-table write (DynamoDB supports it in one account and region; INFERRED from AWS documentation).
  RECOMMENDED: B.
  BLOCKING_REASON: Blocks only C6 (the table) of `cmrc-1`. Under `cmrc-1a`/`1b` (§ 5.15), `cmrc-1a` can start.

DECISION_REQUIRED:
- ID: CMRC-CLIENT
  QUESTION: Does a client become one record kind shared by orders and bookings, and where does it live?
  PROBLEM: Commerce keeps a client record `CUSTOMER#<email>` (profile, totals; `create.ts:450-491`). Scheduling keeps the person inside each booking and a keys-only list `CUST#<email>#<bookingId>`; it never creates `CUSTOMER#` (ratified, `docs/slices/sched-1.md:574`). The WooCommerce pickup will create both an order and bookings for one person.
  OPTIONS:
  - A. Keep two: `CUSTOMER#` in the commerce table; persons inside bookings. A "client view" in the admin joins by tenant + normalized email, which both already use as the key (PD-001). Reward: no change to ratified scheduling; each erasure stays in its own table. Risk: a phone change in one is not seen in the other; the join is code in the admin.
  - B. One client record kind, in the commerce table, referenced by bookings. Reward: one profile per person. Risk: reopens ratified sched-1 § 6 and its erasure (§ 14); every scheduling write gets a commerce dependency; a booking without any order would create a commerce customer.
  - C. One client record in a third "people" table. Reward: neutral owner. Risk: a third table, a third grant set, cross-table writes on every booking and order.
  RECOMMENDED: A, now; revisit only when a real screen needs one profile.
  BLOCKING_REASON: Does not block `cmrc-1`..`cmrc-6`. Blocks the pickup specification (§ 7).

DECISION_REQUIRED:
- ID: CMRC-MAIN-KEYS
  QUESTION: Which customer-linked items stay in the main table in this track?
  PROBLEM: The plan keeps `COUPON#`, `LEAD#`, `FORMSUB#`, `CONSENT#` (and `AUDIT#`, `SIGNAL#`) in the main table, which the renderer can read. Two items the plan does not name exist (§ 2.3): `EMAILLIMIT#<email>` holds buyers' emails in plain text and never expires (the main table has no TTL); `COUPONUSE#<couponId>#<sha256(email)>` holds a hash.
  OPTIONS:
  - A. The plan's set only. Reward: smallest track. Risk: every buyer's email stays readable in `EMAILLIMIT#` keys after the track claims "customer data out of renderer reach".
  - B. The plan's set + the order-mail counter moved in `cmrc-4` to a hash key under a **new, disjoint prefix** `MAILRATE#<sha256(normalizedEmail)>` (as scheduling's `LIMIT#EMAIL#<emailHash>`; disjoint so that the old items can be selected exactly), and the old plain-text `EMAILLIMIT#` items removed in `cmrc-6` by the **discard** branch (§ 6: exact predicate `PK = SYSTEM`, `begins_with(SK, "EMAILLIMIT#")`; authorization record, backup, export, no copy). `COUPONUSE#` stays in the main table with its coupon (same transaction; a hash). `LEAD#`, `FORMSUB#`, `CONSENT#` go to a named follow-up track, not `cmrc`. Reward: the track's claim becomes true for commerce. Risk: one more change in `cmrc-4`, and one discard run that needs the human's authorization record.
  - C. B + move `LEAD#`, `FORMSUB#`, `CONSENT#` now. Reward: broader least privilege. Risk: three more features (contact, forms, consent) and their renderer paths join the track; much larger.
  RECOMMENDED: B.
  BLOCKING_REASON: Does not block `cmrc-1`. Fixes the scope of `cmrc-4` and `cmrc-6`.

DECISION_REQUIRED:
- ID: CMRC-TEST-ONLY
  QUESTION: Is commerce data on production disposable, so that copy and cutover can be one operation (or no copy at all)?
  PROBLEM: The repository disagrees with itself. For "test-only": `docs/ROADMAP.md:18` (2026-08-07); the human on 2026-11-22 in `docs/slices/pay-2.md` § 1 item 3 ("No real shop tenant exists; a demo comes first. No migration of live orders."). Against: `docs/slices/cmrc-counties-1.md:231` calls `povesti-pe-biscuite` "the live RO commerce tenant"; `CURRENT_SLICE.md:15` lists "one real order with a price change in the cart" as a production step; the only recorded count of production orders (`cat-mode-1.md:340-342`) used `GSI_Type`, which cannot contain orders (§ 2.4), so it proves nothing. No AWS call was made here.
  CHECK (NOT RUN; the human, production, read-only): for each tenant with `commerceEnabled: true`, Query `PK = TENANT#<id>` with `begins_with(SK, "ORDER#")`, `Select: COUNT`; the same for `CUSTOMER#`; and say whether any of those orders is a real customer's.
  OPTIONS:
  - A. Keep the six slices (copy under freeze, strict verify, cutover, post-cutover verify, purge). Reward: correct for real orders; rehearses the machinery a future live shop will need. Risk: two more slices (`cmrc-2` full, `cmrc-3`).
  - B. Data is disposable: no copy. `cmrc-4` cuts over to an empty commerce table; `cmrc-6` removes the old items with the **discard** branch (§ 6), not with `purge`: there is no copy, so the purge guard "present in the destination" cannot hold and is not weakened — discard replaces it with the human's authorization record, a tenant and prefix allowlist, a backup reference and a per-item export. Reward: `cmrc-3` disappears and `cmrc-2` shrinks to the discard branch and the report; no freeze guard; the WooCommerce pickup is reachable two slices sooner. Risk: the old orders, customers and order counter are lost from the product (kept only in the backup and the export) — wrong if any order is real; the counter restarts, so numbers like `PPB-0001` repeat across the old and new sets; the authorization record is a human step.
  RECOMMENDED: Decide on the CHECK. Zero real orders → B. Any real order → A.
  BLOCKING_REASON: Does not block `cmrc-1`. Fixes the scope of `cmrc-2`/`cmrc-3`.

DECISION_REQUIRED:
- ID: CMRC-WOO-SEQUENCE
  QUESTION: Is the WooCommerce pickup built after the storage cutover (`cmrc-4`) or before it?
  PROBLEM: The pickup writes clients and orders. Before `cmrc-4` they land in the main table, readable by the renderer, and must be copied and purged with the rest.
  OPTIONS:
  - A. After `cmrc-4`. Reward: its data is born private; nothing of it to copy or purge; the five conditions of § 7 hold trivially. Risk: waits four slices (two under CMRC-TEST-ONLY = B; one more, the token slice, under CMRC-ORDER-LOOKUP-AUTHORITY = C).
  - B. Before, right after `cmrc-1`, under the five conditions of § 7. Reward: the school's people can be scheduled sooner. Risk: real persons' data in the main table until `cmrc-6`; the pickup must be paused in the freeze; `cmrc-3` then copies real data, so CMRC-TEST-ONLY = B is no longer possible.
  RECOMMENDED: A.
  BLOCKING_REASON: Does not block `cmrc-1`. Fixes the place of the pickup slice in the roadmap.

Not a decision here (settled by the code): whether the private table needs a GSI — no (§ 2.4), with one deployed-data
check in `cmrc-2`.

## 9. Abstractions

| Id | What | Current users | Axis of variation (and dispatch) | Simpler alternative rejected |
|---|---|---|---|---|
| A1 | `commerce-db.ts` located references (table + key in one value) and `COMMERCE_PRIVATE_PREFIXES` | the 15 backend sites S1-S15, the `cmrc-1` handlers (D1, D2, **[L]** D3), later the `cmrc-2` tool | the table that holds the four families — demonstrated by this track: main table in `cmrc-1`, commerce table in `cmrc-4` (a single binding, no dispatch) | (a) the plan's function per access: copies 20 command shapes into a second file; (b) keep keys in handlers: the cutover would touch 15 sites and the pickup would name keys |
| A2 | `SelfServiceRefusal` closed sum with exhaustive `switch` | the handlers of `self-service.ts` (D1, D2, **[L]** D3) | fixed variants (sum type): a new refusal must break the switch | per-handler ad hoc status codes, as `public-update.ts:33-80` |
| A3 | `callBackend` in `renderer/src/lib/api-client.ts` (the moved `forward`) | booking API handler, booking feed handler (`booking-proxy.ts:277`, `:305`), `customer-api.ts` (2 calls, **[L]** 3) | none — one function; a documented boundary (renderer → backend, PD-002) | a second copy in `customer-api.ts`, or importing commerce calls from a file named `booking-proxy` (a misleading name) |
| A4 | Three request schemas and three answer types in `packages/shared/src/index.ts` | backend handlers (parse) and `customer-api.ts` (types) | a documented boundary (renderer → backend DTOs, Critical rule 4) | types written twice |

No new package, no config layer, no repository interface, no port: nothing in this track has two implementations.

## 10. Non-scope of the track, deferred debt, findings

### 10.1 Non-scope of Track B

Customer sign-in by email and password (Track C). Online payment (`pay-2`). The WooCommerce pickup itself.
`LEAD#`, `FORMSUB#`, `CONSENT#`, `AUDIT#`, `SIGNAL#` least privilege (CMRC-MAIN-KEYS). Removing the renderer's
main-table grant (it still needs content, products, settings).

### 10.2 Deferred debt (recorded in `docs/TECH-DEBT.md` by `cmrc-1`)

- D1: the renderer keeps `grantReadData` on the whole main table; the property "customer data out of reach" is true
  only after `cmrc-6`.
- D2: `scripts/migrate-commerce-private-table.ts` has no tests and lacks the content-equality verify, the post-cutover
  verify and both removal branches until `cmrc-2`.
- D3: the order email stays in the browser URL of the confirmation and tracking pages (F-CMRC1-EMAIL-IN-PAGE-URL).
- D4: `authOptions` is built three times in the two renderer routes (`account/orders/route.ts:29-46`,
  `profile/route.ts:45-62`, `:121-138`); untouched by `cmrc-1`.
- D5: until part L ships, the order-page read S16 stays in the renderer (`getOrderForCustomer`, `renderer/src/lib/dynamo-customer-reads.ts`), as the one named
  exception of C1 and T3; it blocks `cmrc-4` (cutover gate, § 6).

### 10.3 Findings (OBSERVED unless marked; not fixed here)

- **F-CMRC1-PRESIGN-ENTITLEMENT** — `resources/presign.ts:38-55` decides "the customer bought this product" from
  `CUSTORDER#` items with projection `items`, but `CUSTORDER#` items have no `items` attribute (`create.ts:437-449`).
  For a non-admin the answer is always "not bought" (INFERRED from the two files). The query also reads one page only.
- **F-CMRC1-EMAILLIMIT-NO-TTL** — `EMAILLIMIT#<email>` items set `ttl`, but the main table has no TTL setting
  (§ 2.3); they accumulate with plain-text emails. CMRC-MAIN-KEYS.
- **F-CMRC1-GSI-EVIDENCE** — the production "no orders" count of `cat-mode-1.md:340-342` used `GSI_Type`, which
  cannot contain `ORDER#` items (§ 2.4).
- **F-CMRC1-PD001-STALE** — PD-001 "Conformance status — nothing conforms yet" is no longer true (P4).
  `docs/platform-decisions.md` is outside this slice's allocation: proposed text change for the human: replace the
  paragraph with "conformance: every key site uses `normalizeEmail()` since `fnd-2` (2026-08-07); the persisted-key
  backfill F-FND2-1 is open".
- **F-CMRC1-PUBLIC-ORDER-GET** — `GET /public/orders/{id}?email=` is anonymous (`api-commerce.ts:287`) and has no
  caller in `renderer/src`, `admin/src`, `tools/mcp-server/src` (EXECUTED: `git grep -n "public/orders"`; only the
  checkout's POST). It puts the email in a URL and uses the same possession proof as S16 (CMRC-ORDER-LOOKUP-AUTHORITY).
  Remove or keep: `cmrc-5`, judged against the answer to that decision (external callers unknown — the human).
- **F-CMRC1-CUSTORDER-STATUS** — the account order list shows `CUSTORDER#.status`, written once as `"placed"`
  (`create.ts:437-449`); `update-status.ts` and `orders/update.ts` write only `ORDER#` (`update-status.ts:50`, `:75`;
  `update.ts:81`, `:120`). A customer's account page therefore shows "placed" for every order whatever its real state
  (INFERRED from the writers). `cmrc-1` preserves this (value rule, § 5.6).
- **F-CMRC1-CONFIRM-DISCOUNT** — the confirmation view shows a discount only from `order.discount`
  (`ConfirmationPageView`, `site-page/order-views.tsx`); checkout stores `couponDiscount` and never `discount` (`create.ts:401-435`). A real
  order's coupon discount is therefore not shown on its confirmation (INFERRED). `cmrc-1` preserves this.
- **F-CMRC1-EMAIL-IN-PAGE-URL** — the confirmation and tracking page URLs carry `?email=`
  (`CheckoutPageView.tsx:401`, `AccountPageView.tsx:330`); `email` is in the CloudFront cache-key query allowlist
  (`renderer-hosting.ts:577`). The dynamic twin answers `no-store`, so no page is kept (INFERRED from the serving
  contract).
- **F-CMRC1-PROFILE-FIELDS** — the renderer profile POST forwards `phone, birthday, firstName, lastName`
  (`profile/route.ts:76-82`); the backend reads `phone, birthday, defaultAddress, defaultBillingDetails`
  (`public-update.ts:46`): names are ignored, the address can never be saved from the account page.
- **F-CMRC1-ORDER-PREFIX** — every tenant's order numbers start with `PPB-` (`create.ts:397`).
- **F-CMRC1-REQUIREROLE-NAME** — `requireRole(auth, roles)` admits `GLOBAL_ADMIN` whatever `roles` says
  (`backend/src/auth/policy.ts:38-39`), so a call such as `requireRole(auth, ["RENDERER"])` reads as "renderer only"
  and is not. Known and documented at one call site (`scheduling/visitor/common.ts:4-8`). A rename (for example to a
  name that states the admin bypass) touches every handler: not proposed for this track; recorded for the human.

## 11. References

`docs/plan-commerce-private-table.md`; `docs/platform-decisions.md` (PD-001, PD-002, PD-003); `docs/slices/sched-1.md`
§ 6, § 14, § 15 (SCHED-TABLE, SCHED-PAYMENT-PATH), § 17.2; `docs/slices/pay-2.md` § 1; `docs/slices/cat-mode-1.md`
§ 7.9; `docs/slices/cmrc-counties-1.md`; `docs/shipped/slices/fnd-1-normalize-email.md`; `docs/caching-architecture.md`
§ Serving contract; `renderer/test/serving-contract/`.

## 12. Revision 1 — closure record of review-0 (2026-11-22)

Each correction is closed as a class: the rule, then every instance found by a search of the whole document.

| # | Class and rule | Instances corrected |
|---|---|---|
| R1 | **A claim of PD-002 conformance must name where the identity comes from.** Rule: each customer-data route states its identity source; a route whose identity comes from the browser claims no conformance until a decision covers it. | P19 (§ 3); § 0 "What is open"; § 4 proxy row; § 5.2 part K / part L and C1, C3, C4, C5; § 5.3 boundaries; § 5.4 rows; § 5.6 identity column and body sources; S7 and S16 rows (§ 2.2); decision CMRC-ORDER-LOOKUP-AUTHORITY added (§ 8); F-CMRC1-PUBLIC-ORDER-GET tied to it. Searched: every "PD-002" and "session" occurrence. |
| R2 | **A preservation claim needs a proof that covers every path it names.** Rule: C2 is proven by a command trace captured on the start commit, one scenario at least per site; existing suites are regression only. | C2 (§ 5.2); T1 reworded, T1b added (§ 5.9); G3; § 5.15 stop conditions and split; `cmrc-4` proof (§ 6) now an explicit one-difference trace comparison. |
| R3 | **Every input gets today's answer** (§ 5.6 "Input rule"): a value that cannot match is "nothing found", errors only for dependency failures and renderer-defect structures. | Format checks removed from D1-D3; `invalid` → `malformedRequest` (structure only) in § 5.7; D1/D2 unknown or malformed email → empty answers; D3 → one 404; renderer mapping table keeps dependency failures distinct; T4 input rows; T11 malformed-link and not-found states. |
| R4 | **Boundary values pass through unchanged** (§ 5.6 "Value rule"): no schema parse, no default, no null removal; absent stays absent. | `StoredValue` type; `OrderHistoryEntry`, `CustomerProfileView`, `OrderView` redefined; writer-shape table; D2 `{}` Item case; T4 and T5 null/absent/number rows. |
| R5 | **A gate is credited only with what its rows compare.** Rule: name the row, baseline, captures, comparison and file changes; do not cite rows that do not request the pages. | G6 no longer credits `cm1-identity-*` or `loc1-order-pages`; T11 specified (request list incl. success, empty, not-found, malformed; baseline `5aee9cb`; cm1 layout; `maskBody` comparison stated as canonicalized, not literal bytes; control row). |
| R6 | **A test seam must reach the binding the code calls.** Rule: replace inputs the real function reads (environment), not module exports it calls internally. | T10 rewritten (environment path of `getRendererKey`, restoration, no module mock); T5 uses the same setup. Searched: every `vi.mock`/`importActual` mention — T10 was the only one. |
| R7 | **A write freeze covers every writer of a moved kind.** Rule: list writers from the per-prefix inventory; one enforced mechanism for all; drain; content-equality verify; release condition. | § 6 `cmrc-2` (guard + content verify), `cmrc-3` run order, "The write freeze" paragraph (W1-W6, mechanism, rejected alternative, drain, hold, release). Specification text only. |
| R8 | **A deletion either proves a verified copy or carries an explicit authorization to lose data.** Rule: two branches, never mixed; `purge` keeps its destination guard. | § 6 `cmrc-6` (purge and discard branches with guards and postconditions); `cmrc-2` modes; CMRC-TEST-ONLY option B; CMRC-MAIN-KEYS option B; § 7 cost sentence. Specification text only. |

Not changed by revision 1: the allocation (this file and the Track B rows of `docs/ROADMAP.md`);
`docs/platform-decisions.md` (not edited, per the operator ruling).

### Revision 2 — closure record of review-1 (2026-11-22)

| # | Class and rule | Instances corrected |
|---|---|---|
| V1 | **A storage move needs every runtime reader and writer of the kind behind `commerce-db.ts`** (cutover gate, § 6). | § 5.2 part K paragraph; C1; § 5.14 exit; § 6 gate paragraph and `cmrc-4` Depends; CMRC-ORDER-LOOKUP-AUTHORITY option C consequence and BLOCKING_REASON; § 7 cost; CMRC-WOO-SEQUENCE option A; D5; ROADMAP `cmrc-4` row. Searched: every "cutover", "`cmrc-4`", "S16" occurrence. |
| V2 | **A release condition may require only operations the frozen state permits; write checks follow the release; the first accepted write is the rollback boundary.** | § 6 `cmrc-3` run order; "The write freeze" release steps P1-P3, release deploy, Q1-Q6, failure responses on each side of the boundary. The old reference to § 5.13 (which includes writes) is removed from the release condition. |
| V3 | **A purge proves "source unchanged since verification" and "destination exists"; it never requires destination equality and never writes the destination.** | Verification manifest (P1, `cmrc-2` scope); purge branch per-key rules, refusal handling, five test cases, residual race; `purge-verify`. Searched: every "deep-equal" occurrence — the remaining ones are the pre-release copy checks, which run while frozen. |
| V4 | **A discard selects only by an exact predicate that no live writer can produce.** | Discard branch (two predicates, selector refusal, coexistence test); CMRC-MAIN-KEYS option B (disjoint `MAILRATE#` prefix); `cmrc-4` scope line. Searched: every "EMAILLIMIT" occurrence — § 2.3 and F-CMRC1-EMAILLIMIT-NO-TTL describe today's key and stay. |

### Revision 3 — closure record of review-2 (2026-11-22)

| # | Class and rule | Instances corrected |
|---|---|---|
| W1 | **The rollback boundary is the first write the commerce table accepts, of any moved kind; every rollback statement refers to that one rule.** | § 6 release step 2 (the rule, named); `cmrc-4` Rollback (stale "no order exists only in the new table" replaced, created and changed items of every moved kind, the B branch without manifest). Searched: every "rollback"/"roll back" — § 5.11 (`cmrc-1`, no data moved) and the P-failure step (before the boundary) are consistent. |
| W2 | **An acceptance rule for a planned change lists exactly the differences of that change, per decision branch; anything else fails.** | `cmrc-4` T1b rule per branch (all: `TableName` of moved kinds; MAIN-KEYS A: nothing more; B/C: the mail-counter `Key.SK` only). Same class: the "one binding" claims in § 0, § 5.5 and § 5.14 now name the mail-counter exception. `cmrc-1` C2 unchanged. |

## Appendix R. Decision review and operator record (2026-11-22)

Document review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), four cycles (review-0 escalated for
CMRC-ORDER-LOOKUP-AUTHORITY and asked eight corrections; review-1 and review-2 asked lifecycle corrections; review-3
approved). Decision review (reviewer challenges each recommendation against source, builder answers once): six
decisions, all converged. Four recommendations stand as written in § 8: CMRC-ORDER-LOOKUP-AUTHORITY = A (the exception
covers the 17-field view D3 only, not the wider answer of the anonymous `GET /public/orders/{id}`), CMRC-TABLE = B,
CMRC-CLIENT = A, CMRC-WOO-SEQUENCE = A. Two recommendations were challenged and the builder conceded; the corrected
cells below REPLACE the recommendation text of § 8 for those two decisions. Nothing here is ratified: the human decides.

### R.1 CMRC-MAIN-KEYS — corrected recommendation (revised B)

RESPONSE: concede

**What I checked:**
- OBSERVED: `COUPONUSE#` keys hold an unsalted SHA-256 of the normalized email (`backend/src/orders/create.ts:307`). They sit in the main table, which the renderer can read (`infra/lib/renderer-hosting.ts:272`). The spec itself already says "anyone who holds a candidate address can test it" (§ 2.3). PD-001 says an email hash of this kind gives no secrecy (`docs/platform-decisions.md`, Cognito username paragraph). So `COUPONUSE#` is customer-linked data. My option B kept it in the main table and still claimed "the track's claim becomes true for commerce". Those two statements contradict each other.
- OBSERVED: an order status change and a payment change each publish an audit event. The event holds the order UUID (`target.id`), the order number, the transition and a free-text `note` (`backend/src/orders/update-status.ts:81-87`, `backend/src/orders/update.ts:169-175`). The audit worker stores it as `AUDIT#…` in the main table with `entityId` = the order UUID (`backend/src/audit/worker.ts:23-43`). Under CMRC-ORDER-LOOKUP-AUTHORITY = A, the order UUID is half of the guest's proof (order id + email). The admin can type anything into `note`, including personal data (INFERRED). My matrix did not mention this exposure at all.
- OBSERVED: the only reader of `COUPONUSE#` is `create.ts:307-314`, and its only writer is the transaction item at `create.ts:510-520`. Section 5.5 already builds every transaction item with its own `TableName`. So moving the counter costs one reference in `commerce-db.ts`, and no coupon rule (`COUPON#`, `COUPONCODE#`) has to move.
- OBSERVED: the only reader of `AUDIT#` is `backend/src/audit/list.ts:24-31`. It is one Query on the main table, for every feature's audit entries. To move the commerce audit entries, that reader must read two tables and merge the results, or the audit contract must change. Neither design is specified yet.

**Corrected cell (option B, revised; still the recommendation):**
- **Mail counter:** unchanged from the current B. In `cmrc-4` it moves to the new prefix `MAILRATE#<sha256>`. In `cmrc-6` the old `EMAILLIMIT#` items are removed by the discard branch.
- **`COUPONUSE#` joins the moved kinds:**
  - It gets a `couponUseRef` in `commerce-db.ts`, and its prefix goes into `COMMERCE_PRIVATE_PREFIXES`.
  - In `cmrc-4` both the pre-read at `create.ts:309` and the transaction item at `create.ts:510-520` move to the commerce table.
  - `COUPON#` and `COUPONCODE#` stay in the main table, so the transaction becomes cross-table for this one item, the same as for the other moved kinds.
  - `cmrc-3` copies and verifies it, and `cmrc-6` purges it, the same way as the other kinds.
  - Ripple: the T1b "every branch" difference list of `cmrc-4` now includes the `TableName` of these two commands. Section 2.3, the CMRC-MAIN-KEYS problem text and the "four kinds" statements (C1, T3, cutover gate, discard predicate) must name `COUPONUSE#` as a fifth kind from `cmrc-4` on. Today's `cmrc-1` does not change: C2 still requires no difference at all.
- **Commerce audit detail is in the track's scope:**
  - It covers `UPDATE_ORDER_STATUS` and `UPDATE_ORDER_PAYMENT`, and any later audit event whose target is an order or a customer.
  - How it is stored is a sub-decision. It must be specified and decided before `cmrc-4` starts, and it is added to the cutover gate.
  - The two candidate designs are (i) commerce audit entries stored in the commerce table plus a two-table audit reader, and (ii) the main-table entry keeps only the action, the actor, the order number and the timestamp, and the order UUID and note move to a commerce-table item.
  - Existing `AUDIT#` items that hold order UUIDs or notes are part of the historical-copy scope of `cmrc-3`/`cmrc-6`.
- **Reward, corrected text:** after `cmrc-6`, no customer email, hash of an email, profile, order or order-audit detail is in the main table. Until the audit sub-decision ships, the claim says so: "commerce identity and order records are out of renderer reach; commerce audit residue is open."
- **Risk, added:** one more moved kind, and an audit storage design that touches a reader shared by all features.
- **Unchanged:** `LEAD#`, `FORMSUB#` and `CONSENT#` go to a named follow-up track. Option A's risk text must also name `COUPONUSE#` and the audit entries.

### R.2 CMRC-TEST-ONLY — corrected recommendation (A by default; B only under four conditions)

RESPONSE: concede

**What I checked:**
- OBSERVED: `create.ts:90-92` refuses a new order only while `commerceEnabled !== true`. Settings can switch `commerceEnabled` off on the merged record, and nothing in that path reads or deletes the commerce records (`backend/src/tenant/settings.ts`, the merge and the `PutCommand` in the settings update). So a tenant that has commerce switched off can still hold orders and profiles.
- OBSERVED: these writers do not check `commerceEnabled`: `backend/src/customers/update.ts:17-42` (admin note), and `orders/update.ts` and `customers/public-update.ts` (spec § 6, W3/W5).
- So my CHECK ("for each tenant with `commerceEnabled: true`") would miss records, and "zero real orders" from that CHECK cannot justify a discard. My option B also said "no freeze guard". That leaves a gap: an order placed between the inventory and the cutover would be in the main table, would not show after the cutover, and would then be discarded.
- OBSERVED: every tenant can be listed with no scan. The tenant registry Query is `PK = SYSTEM`, `begins_with(SK, "TENANT#")` (`backend/src/tenant/list.ts:17-22`).

**Corrected cell:**
- **CHECK (NOT RUN; production, read-only):**
  - For every tenant in the registry, whatever its `commerceEnabled` value, run a paginated Query for each moved kind (`ORDER#`, `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER`, plus `COUPONUSE#` under revised CMRC-MAIN-KEYS B).
  - The result is the exact key set, with the SHA-256 of each item's canonical JSON. A `Select: COUNT` is not enough.
  - The human classifies every order and profile as test or real.
- **RECOMMENDED:** A by default.
- **When B is allowed:** only if every one of these conditions holds:
  1. The inventory above has no real record.
  2. The human signs an authorization record that names each kind it covers: orders, customer profiles, the customer-order index, the coupon-use counters, and the order-number counter reset (so numbers like `PPB-0001` repeat). It lists the authorized key set and hashes.
  3. From the inventory until the cutover deploy has finished, every inventoried commerce tenant runs with `commerceEnabled = false`. This stops W1, and its cost is that the shop is hidden during that time.
  4. The `discard` mode refuses every key that is not in the authorized set and every item whose hash changed. Any write after the inventory (W2-W5, or a re-enabled shop) then shows up as a refusal, never as a silent loss. A refused key keeps B from finishing until the human decides: copy it (which needs the copy tool from option A) or authorize it again.
- This replaces the old line "Zero real orders → B" and the old B line "no freeze guard". Condition 3 is a manual step for the operator. Nothing new is built for it.
- **Ripple:** the § 6 discard branch for the four kinds gains the key-set + hash guard from condition 4. The `cmrc-2` scope under B becomes: the inventory report, plus discard with that guard. The `cmrc-4` rollback text under B ("every item in the commerce table") does not change.
- NOT RUN: the production inventory and the classification. This answer does not say the data is disposable.

### R.3 Operator note on CMRC-WOO-SEQUENCE (2026-11-22; not reviewed by the two agents)

§ 7 and CMRC-WOO-SEQUENCE assume that the WooCommerce pickup writes commerce records (`CUSTOMER#`, an order-like
record). The human's direction of 2026-11-22 is that WordPress keeps the shop and its orders, and AMODX schedules the
people. A smaller design satisfies that: the pickup writes ONLY bookings in the scheduling private table (person, the
WooCommerce order number, line, option value, quantity, language preference) and no commerce record. Then the pickup
does not depend on `cmrc-4`, and Track B keeps its own pace. Cost: AMODX holds no order list and no spend totals for
those sales (they stay in WooCommerce); `BookingSourceSchema` (`packages/shared/src/scheduling.ts:263-267`) needs a
variant for an external order (its `order` variant names an AMODX order id). This is put to the human with the six
decisions; if chosen, CMRC-WOO-SEQUENCE has no object and § 7 is replaced by the pickup specification.

### R.4 Human direction (2026-11-22, after the six decisions were put): the track waits

The human: Track B is the generic shop for physical products; digital products and scheduling are handled separately,
and scheduling has its own table. With WordPress keeping the school's orders, the premise "Track B before the school's
orders" (`docs/ROADMAP.md`, 2026-11-20) no longer applies. Consequences recorded by the operator:
- The WooCommerce pickup is specified on the scheduling private table only (R.3); it does not depend on this track.
- CMRC-ORDER-LOOKUP-AUTHORITY, CMRC-TABLE, CMRC-MAIN-KEYS and CMRC-TEST-ONLY are NOT asked now. They are asked when a
  shop for physical products is to go live on AMODX. This document stays a reviewed draft until then.
- CMRC-CLIENT is asked with the Clients page (the one screen that shows shop customers and booking persons together).
- Finding F-CMRC1-PRESIGN-ENTITLEMENT (the digital download check reads the shop's order index and cannot find a
  purchase) is independent of this track and stays open for the digital products work.
