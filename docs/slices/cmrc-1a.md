# CMRC-1A — one backend module names the commerce-private keys and their table for the backend handlers (no behaviour change)

- **Status:** IMPLEMENTED 2026-11-28 — built, operator gates pending (staging diff holds rebuilt function code only;
  staging deploy; the admin routes of the test shops against the real table: order list, order detail, customers,
  reports).
- **Track:** B (commerce-private). First build slice of the track.
- **Depends:** `fnd-1`, `fnd-2` (shipped: every email key is normalized). The five refactor slices of the order of
  work of 2026-11-27 are done (`81789e0`, `f649b6a`, `00535d9`, `bd64341`, `760df57`). No open decision of
  `docs/slices/cmrc-1.md` § 8 is needed. No infrastructure.
- **Source plan:** `docs/plan-commerce-private-table.md`; specification `docs/slices/cmrc-1.md` (reviewed draft,
  revision 3). This slice is the pre-agreed split `cmrc-1a` of its § 5.15: requirements **C1 and C2 only** — C1 for
  the backend sites; its renderer part stays open (§ *Guarantee scope*).
- **Maturity:** `backend/src/lib/commerce-db.ts` is PROTOTYPE until the operator's staging run passes; the twelve
  handler files keep their maturity (their commands do not change).
- **Baseline:** `a78c00607380f9d3741a8d0e8d580376afd63261` (HEAD at the start of the slice; the working tree was
  clean). The T1b golden is the behaviour of this commit.

## Guarantee scope (what is true after this slice, and what is not)

Every statement of the ownership guarantee in this slice's files (module header, test header, `CLAUDE.md` rule 10,
`backend/ARCHITECTURE.md`, `CURRENT_SLICE.md`, the ROADMAP row, `docs/slices/cmrc-1.md` § 2.2) follows this one text:

| Part | Statement | Basis |
|---|---|---|
| **True, exclusive** | Within `backend/src`, `lib/commerce-db.ts` is the only code that writes a commerce-private key prefix and that chooses the table of those items. The 15 backend sites S1-S15 take both from it | T3 (prefixes, by syntax tree); the table follows because a reference carries table and key together; T1b shows the commands are the same |
| **Retained exception: the public renderer** | S16 `getOrderForCustomer`, S17 `getCustomerOrders`, S18 `getCustomerProfile` in `renderer/src/lib/dynamo-customer-reads.ts` still build `ORDER#`, `CUSTORDER#`, `CUSTOMER#` keys and take their table from the renderer's own `TABLE_NAME` (`requireTableName()`, `renderer/src/lib/dynamo-client.ts`). Not changed by this slice. `cmrc-1b` removes S17 and S18; part L of `cmrc-1` removes S16 | OBSERVED in the file; T3 lists exactly these three and permits them |
| **Retained, operational** | S19 `scripts/migrate-commerce-private-table.ts` keeps its own copy of the four prefixes (`MOVED_PREFIXES`, line 8) and takes both table names from its arguments (`--source-table`, `--destination-table`). It is a tool an operator runs, not code a request reaches. `cmrc-2` makes it import the module's list | OBSERVED in the file; T3 does not read `scripts/` |
| **What the guard reads** | T3 parses the source files under `backend/src`, `renderer/src` and `packages/<name>/src`: string literals and template text. It permits the module and exactly the three renderer reads. It does not read `scripts/`, tests, `admin/`, `tools/`, `infra/`; it cannot see a prefix joined from parts at run time | the test file |
| **Not claimed** | Repository-wide ownership. Requirement C1 of `docs/slices/cmrc-1.md` § 5.2 names the backend AND the renderer: its backend part is met, its renderer part is open. `docs/VISION.md` guarantee 2 is NOT met: the renderer function still has read access to the whole main table and still reads three of the four families. Storage cannot move (`cmrc-4`) while S16-S18 exist (cutover gate, `docs/slices/cmrc-1.md` § 6) | — |

## Purpose / risk retired

The risk retired: **in the backend, the storage location of the four commerce-private key families is written in
twelve handler files (15 sites, 20 commands).** A later move of that storage (`cmrc-4`) would have to change every
site, and a site that is missed would continue to read or write the old copy. After this slice, one backend file
binds the table and writes the keys for all backend sites. `docs/VISION.md` guarantee 2 (customer-private data out
of the renderer's IAM reach) needs that move; this slice makes the backend's part of the move a change of one
binding. It does not make the guarantee true, and it does not touch the three renderer reads that must go first
(§ *Guarantee scope*).

The property this slice must not break: today's behaviour. Each DynamoDB command and each HTTP answer of the twelve
handler files is the same as on the baseline. Live tenants are served by this code, so the change is
production-impacting even though no user and no database can observe it.

## Scope

1. `backend/src/lib/commerce-db.ts` (new): located references (table + key) for `ORDER#`, `CUSTORDER#`, `CUSTOMER#`,
   `COUNTER#ORDER` (§ *The data module*).
2. The twelve handler files of § *Site inventory* take the key and the `TableName` of every commerce-private command
   from that module (requirement C2).
3. Tests: T1b (command trace + golden, captured on the baseline before the first handler edit), T2 (the module), T3
   (key ownership by syntax tree: requirement C1 for the backend, with the three renderer reads as named
   exceptions). T1 = the existing suites, not edited.
4. Docs: this file; `backend/ARCHITECTURE.md`; the root `CLAUDE.md` critical-rules list (one line);
   `docs/slices/cmrc-1.md` (§ 2.2 citations corrected to HEAD, a dated "Build status" line); `docs/ROADMAP.md` row
   `cmrc-1a`; `CURRENT_SLICE.md`.

## Non-scope

- No route, no renderer edit, no infrastructure, no shared-schema change, no `COMMERCE_TABLE_NAME` variable.
- No change to `EMAILLIMIT#` or `COUPONUSE#` (decision CMRC-MAIN-KEYS; they move in `cmrc-4`).
- No fix of a finding of `docs/slices/cmrc-1.md` § 10.3 or of § *Findings, not fixed* below.
  F-CMRC1-PRESIGN-ENTITLEMENT stays open.
- No interface, no repository class, no layer shared with scheduling, no configuration layer.
- `scripts/migrate-commerce-private-table.ts` (S19) keeps its own prefix list; `cmrc-2` changes it.
- The three renderer reads S16-S18 stay (`cmrc-1b` removes S17 and S18; part L removes S16).

## Architectural boundaries

- **Tenant isolation:** every reference is built from the tenant id the handler already validated; the partition key
  stays `TENANT#<tenantId>`. No reference takes a table or a key from a request.
- **No scan:** the module builds `Key` values and `PK = :pk AND begins_with(SK, :sk)` key conditions only.
- **Dependency direction:** handlers → `lib/commerce-db.ts` → `lib/db.ts`. `commerce-db.ts` imports nothing else. It
  does no I/O: it reads the constant `TABLE_NAME` and returns plain objects. The import graph stays a DAG (no file
  imports a handler).
- **Data across the boundary:** the references are raw objects of strings (`{ TableName, Key: { PK, SK } }`), not SDK
  command objects.
- **Scheduling:** `commerce-db.ts` and `scheduling-db.ts` do not import each other (two release paths,
  `docs/slices/cmrc-1.md` § 4).

## Site inventory (packet item 1; EXECUTED on the baseline, before any edit)

### Basis of the search

Commands, repository root, 2026-11-28:

```bash
git grep -n -F 'ORDER#'        -- backend/src renderer/src tools scripts ':!*.md'
git grep -n -F 'CUSTORDER#'    -- backend/src renderer/src tools scripts ':!*.md'
git grep -n -F 'CUSTOMER#'     -- backend/src renderer/src tools scripts ':!*.md'
git grep -n -F 'COUNTER#ORDER' -- backend/src renderer/src tools scripts ':!*.md'
git grep -n -F 'COUNTER#'      -- backend/src renderer/src tools scripts ':!*.md'
git grep -l -E 'ORDER#|CUSTOMER#|CUSTORDER#' -- ':!*.md' ':!docs'      # every tracked non-document file
```

A text search is a lower bound: it finds a key that is written as one literal. Seven more searches look for a key
that is built from parts or that reaches a command through a variable. They were run on the baseline tree
(`git grep … a78c006 -- <paths>`). Each hit was read in its file.

| Search (EXECUTED on `a78c006`) | What it looks for | Result |
|---|---|---|
| `git grep -n -E "[\"'\`](CUST\|ORD\|COUNTER)[A-Z#]*[\"'\`\$]" -- backend/src renderer/src` | a quoted fragment that can start one of the prefixes | the S1-S18 sites; the scheduling `CUST#` (`backend/src/lib/scheduling-db.ts:175`, `:733`: another family in another table); the role literal `"CUSTOMER"` (`backend/src/auth/authorizer.ts:313`, and three comment lines there); the words `"COUNTER"`, `"ORDER"`, `"ORDINALITY"` of `dynamo-reserved-words.ts` |
| `git grep -n -i -E "(ORDER\|CUSTOMER\|CUSTORDER\|COUNTER)_?(PREFIX\|SK\|KEY)\|orderKey\|customerKey\|orderSk\|customerSk\|custOrder" -- backend/src renderer/src` | a constant or a helper that holds a prefix | 8 lines, all at listed sites (S3, S11, S15, S17 and four comment lines); no constant, no helper |
| `git grep -n -E '[^a-zA-Z]SK *: *[a-zA-Z_][a-zA-Z_.]*[,} ]' -- backend/src` | a sort key that comes from a variable | 31 lines. Each variable was traced to its assignment: `forms/update.ts:68` (a `FORM#` item read before); `import/glam-pricelist.ts:447` (`IMPORTLOCK#glam`), `:1030` (a destructuring); `import/reviews.ts:372` and six lines of `reviews/update.ts` (`REVIEW#`, `SITEREVIEW#`); the `CDN_*` constants of `lib/invalidate-cdn.ts`, `scheduled/debounce-flush.ts`, `system/invalidation.ts` (`PK = SYSTEM`); `lib/scheduling-db.ts:188-189` (another table); `orders/create.ts:311`, `:514` (`COUPONUSE#`), `:548`, `:566` (`EMAILLIMIT#`). None holds one of the four prefixes |
| `git grep -n -E '[^a-zA-Z]Key *: *[a-zA-Z_]+[,} ]' -- backend/src` | a whole key that comes from a variable | 25 lines. One commerce-private variable: `orders/update.ts:122` and `:156` (`key`, assigned at `:120` — site S9). The others: S3 object keys (`assets/create.ts`, `lib/review-media.ts`, `resources/presign.ts:76`, `reviews/update.ts:554`), `COMMENT#` (`comments/moderate.ts:25-27`), `LEAD#` (`leads/delete.ts:33`), `NEWSLETTER#` (`leads/newsletter.ts`, `leads/push.ts`), `CATPROD#` (`lib/catprod.ts:84-86`), `ROUTE#` (`redirects/delete.ts:39`), `SYSTEM` / `CDN_DEFERRED_FLUSH` (`tenant/settings.ts:356`), the scheduling table |
| `git grep -n -E '":sk" *: *[a-zA-Z]' -- backend/src` | a key-condition prefix that comes from a variable | 4 lines: `comments/list.ts:32` (`COMMENT#`), `content/update.ts:72` (`TRANSLATION#`), `content/update.ts:376` (an update value named `:sk`, not a key), `reviews/list.ts:40` (`REVIEW#`, `SITEREVIEW#`; its three callers at `:72-76`) |
| `git grep -h -o -E 'KeyConditionExpression: *[^,]*' -- backend/src`, counted | a query that is not `PK` + `SK` prefix (it could read the four families with another condition) | 45 × `PK = :pk AND begins_with(SK, …)` (their `:sk` values are the literals of the per-prefix searches and the four lines of the row above); 1 × `PK = :pk AND SK = :sk` (`import/wordpress.ts:29`, `ROUTE#`); 6 index queries (`TenantSlug`, `Domain`); 1 × `condition` (`lib/scheduling-db.ts:295`, another table). No query on a whole tenant partition |
| `git grep -n 'ScanCommand' -- backend/src` | a scan (it would read every item) | no hit |

What these searches cannot see: a prefix assembled at run time from pieces that none of the patterns names (for
example a prefix received from a request, or two string fragments joined far from the command). No handler of the
inventory takes a key prefix from a request (each file was read in full). Two more checks close the gap from the
other side. T1b records the key of every command the twelve handler files send, on every branch it reaches. And T3,
run on the baseline in a separate worktree (control B, § *Build record*), found by syntax tree exactly 22 literals
outside `commerce-db.ts`: 19 in the twelve handler files, at the S1-S15 sites, and the 3 renderer literals — the same
sites as the text search.

### Sites on the baseline `a78c006`

| # | Site | Key | Command | Reached by | Change in this slice |
|---|---|---|---|---|---|
| S1 | `backend/src/orders/create.ts:385-394` | `COUNTER#ORDER` | UpdateItem (`if_not_exists + 1`), before the transaction, once per order | `POST /public/orders` (anonymous) | `orderCounterRef` |
| S2 | `backend/src/orders/create.ts:403-435` | `ORDER#<orderId>` | Put in the transaction | same | `orderRef` |
| S3 | `backend/src/orders/create.ts:437-450` | `CUSTORDER#<email>#<orderId>` | Put in the transaction | same | `customerOrderRef` |
| S4 | `backend/src/orders/create.ts:452-492` | `CUSTOMER#<email>` | Update in the transaction | same | `customerRef` |
| S5 | `backend/src/orders/get.ts:25-28` | `ORDER#` | GetItem | `GET /orders/{id}` (admin) | `orderRef` |
| S6 | `backend/src/orders/list.ts:28-31`, `:50-57` | `ORDER#` prefix | Query, projection, optional filter | `GET /orders` (admin) | `ordersQuery` |
| S7 | `backend/src/orders/public-get.ts:16-19` | `ORDER#` | GetItem | `GET /public/orders/{id}?email=` (anonymous) | `orderRef` |
| S8 | `backend/src/orders/update-status.ts:48-51`, `:73-79` | `ORDER#` | GetItem, UpdateItem | `PUT /orders/{id}/status` (admin) | `orderRef`, one call per command |
| S9 | `backend/src/orders/update.ts:77-87`; `:120`, `:122`, `:154-161` | `ORDER#` | UpdateItem (field patch); GetItem and conditional UpdateItem (payment transition) | `PUT /orders/{id}` (admin) | `orderRef`, one call per command |
| S10 | `backend/src/reports/summary.ts:23-33` | `ORDER#` prefix | Query, projection | `GET /reports/summary` (admin) | `ordersQuery` |
| S11 | `backend/src/customers/get.ts:28-31`, `:36-43` | `CUSTOMER#`, `CUSTORDER#<email>#` | GetItem, Query | `GET /customers/{email}` (admin) | `customerRef`, `customerOrdersQuery` |
| S12 | `backend/src/customers/list.ts:17-26` | `CUSTOMER#` prefix | Query, projection | `GET /customers` (admin) | `customersQuery` |
| S13 | `backend/src/customers/update.ts:34-44` | `CUSTOMER#` | UpdateItem, conditional | `PUT /customers/{email}` (admin) | `customerRef` |
| S14 | `backend/src/customers/public-update.ts:73-77`, `:107-113` | `CUSTOMER#` | GetItem (projection), UpdateItem | `POST /public/customers/profile` (renderer key) | `customerRef`, one call per command |
| S15 | `backend/src/resources/presign.ts:40-50` | `CUSTORDER#<email>#` | Query, projection `#items` | `GET /resources/{id}/download` | `customerOrdersQuery` |
| S16 | `renderer/src/lib/dynamo-customer-reads.ts:9-12` (`getOrderForCustomer`) | `ORDER#` | GetItem | the order confirmation and tracking pages | **not changed** (part L) |
| S17 | `renderer/src/lib/dynamo-customer-reads.ts:31-41` (`getCustomerOrders`) | `CUSTORDER#<email>#` | Query, paginated | `renderer/src/app/api/account/orders/route.ts` | **not changed** (`cmrc-1b`) |
| S18 | `renderer/src/lib/dynamo-customer-reads.ts:61-66` (`getCustomerProfile`) | `CUSTOMER#<email>` | GetItem | `renderer/src/app/api/profile/route.ts` | **not changed** (`cmrc-1b`) |
| S19 | `scripts/migrate-commerce-private-table.ts:8` | all four | Query + BatchWrite (operational tool) | `npm run migrate-commerce-private-table` | **not changed** (`cmrc-2`) |

Count: 15 backend sites in 12 files send 20 commerce-private commands (S1: 1; S2-S4: 3 transaction items; S5: 1;
S6: 1; S7: 1; S8: 2; S9: 3; S10: 1; S11: 2; S12: 1; S13: 1; S14: 2; S15: 1).

Other tracked files with a hit are not runtime sites: `backend/test/unit/digital-file-guard-1.test.ts`,
`email-key-normalization.test.ts`, `pay-1.test.ts`, `projection-reserved-1.test.ts`;
`packages/shared/src/normalizeEmail.ts` (comment text only) and `packages/shared/test/normalizeEmail.test.ts`;
`renderer/test/serving-contract/fixtures.mjs`, `renderer/test/serving-contract/locale-1/proof.mjs`,
`renderer/test/unit/order-email-1.test.ts`. `tools/` and `admin/src` have no hit.

### Comparison with `docs/slices/cmrc-1.md` § 2.2 (baseline `5aee9cb`)

- **No new site and no site gone.** S1-S19 are the same 19 sites. The "lower-bound case" (a site the specification
  does not name) did not occur.
- **Citations** (the specification's § 2.2 table now holds the values above). Of the cited files, four changed
  between `5aee9cb` and `a78c006` (EXECUTED: `git diff --stat 5aee9cb a78c006 -- backend/src/orders
  backend/src/customers backend/src/reports backend/src/resources/presign.ts backend/src/lib/scheduling-db.ts`):
  `orders/list.ts`, `reports/summary.ts`, `resources/presign.ts` and `lib/scheduling-db.ts`. Their citations moved:
  S6 `:50-55` → `:50-57`, S10 `:10, :28` → `:23-33`, S15 `:38-47` → `:40-50`, the scheduling `CUST#` lines
  `:181, :809` → `:175, :733`. The other rows cite the same unchanged code; each row now gives the full range of the
  command (for example S5 `:27` → `:25-28`, S2 `401-435` → `403-435`).
- **S9 is three commands, not two.** The specification's row says "GetItem, UpdateItem". The file sends one
  UpdateItem on the field-patch path (`:77-87`) and a GetItem plus a conditional UpdateItem on the payment path
  (`:122`, `:154-161`). All three are re-pointed. The count "20 command shapes" of § 5.5 already agrees.
- **S6, S10, S11, S12, S15 read one page.** § 5.9 asks for "S6 over two pages". `orders/list.ts` sends one Query and
  does not read `LastEvaluatedKey`; a second page is never requested. The T1b scenario answers the Query with a
  `LastEvaluatedKey` and records that no second Query follows (finding F-CMRC1A-ONE-PAGE).

## The data module (`backend/src/lib/commerce-db.ts`)

```ts
const COMMERCE_TABLE = TABLE_NAME;      // the ONE binding; cmrc-4 replaces it with a required COMMERCE_TABLE_NAME

export const COMMERCE_PRIVATE_PREFIXES  // ["ORDER#", "CUSTORDER#", "CUSTOMER#", "COUNTER#ORDER"]
export const orderRef            = (tenantId, orderId)                  // { TableName, Key: { PK, SK: "ORDER#<orderId>" } }
export const customerRef         = (tenantId, normalizedEmail)          // SK "CUSTOMER#<email>"
export const customerOrderRef    = (tenantId, normalizedEmail, orderId) // SK "CUSTORDER#<email>#<orderId>"
export const orderCounterRef     = (tenantId)                           // SK "COUNTER#ORDER"
export const ordersQuery         = (tenantId)                           // PK = :pk AND begins_with(SK, "ORDER#")
export const customersQuery      = (tenantId)                           // … "CUSTOMER#"
export const customerOrdersQuery = (tenantId, normalizedEmail)          // … "CUSTORDER#<email>#"
```

How a handler uses it. A reference carries the table and the key in one value, so a caller cannot name a key
without its table. The handler still builds its command and spreads the reference into it:

- GetItem / UpdateItem: `new GetCommand(orderRef(t, id))`, `new UpdateCommand({ ...orderRef(t, id), UpdateExpression, … })`.
- Put (the two transaction Puts of S2, S3): `Put: { TableName: ref.TableName, Item: { ...ref.Key, …attributes } }`.
- Query: `new QueryCommand({ ...ordersQuery(t), ProjectionExpression, … })`; a handler that adds its own values
  merges them after the reference's: `ExpressionAttributeValues: { ...query.ExpressionAttributeValues, ":x": v }`.

Rules: inputs are used as given (callers pass `normalizeEmail()` output, as before; the module does not normalize a
second time). No function returns a `Result`: a reference cannot fail. Reads, writes and error handling stay in the
handlers.

### Abstraction record

| What | Concrete current users | Named axis of variation (dispatch) | Simpler alternative rejected |
|---|---|---|---|
| `commerce-db.ts`: seven functions that return a located reference (table + key, or table + key condition) | the 15 sites S1-S15 in 12 handler files | the storage table of the commerce-private families: the main table now, `AmodxCommerceTable` from `cmrc-4` (a ratified track; one binding, no dispatch, no second implementation) | a table constant per handler: 15 edits at cutover and no single point to verify; a function per access: 20 command shapes copied into a second file |
| `COMMERCE_PRIVATE_PREFIXES`: the list of the four prefixes | the module itself (the list is made of the four constants from which the seven functions build every key) and T3 (the prefixes it refuses outside the module) | the set of moved kinds: `COUPONUSE#` joins in `cmrc-4` (CMRC-MAIN-KEYS, revised B); the `cmrc-2` tool imports the same list | a second copy of the four strings in T3: a new kind would need two edits, and the guard would not see the new kind until the second edit |

### Left out of `docs/slices/cmrc-1.md` § 5.5, and why

- `orderIdOfCustomerOrder(sk)`: no caller exists in this slice. Its first user is the order-history route D1 of
  `cmrc-1b`, which adds it with its test. T2's "`orderIdOfCustomerOrder` on a stored SK" row moves with it.
- The exported `Ref` and `PrefixQuery` type names: the two shapes are declared in the module and not exported; no
  caller names them.

## Proofs

| Id | File | Proves | What it cannot see |
|---|---|---|---|
| T1 | existing `backend/test/unit/*.test.ts`, not edited | regression of what each already covers | not the C2 proof (`docs/slices/cmrc-1.md` § 5.9) |
| T1b | `backend/test/unit/cmrc-1-command-trace.ts` (recorder + scenarios), `cmrc-1-command-trace.capture.test.ts` (writes the golden; skipped unless `CAPTURE_GOLDEN_TO` is set), `cmrc-1-command-trace.test.ts` (comparison), golden `backend/test/unit/fixtures/cmrc-1-command-trace.baseline.json` | **C2.** For each scenario: every effect the handler causes, in order (each DynamoDB command with its class name and full input; each audit event; each mail), and the HTTP answer with its body as the exact string | a branch no scenario reaches (§ *Coverage of T1b*); object key order inside a command input (not observable by DynamoDB); the origin check and reCAPTCHA of `orders/create.ts` (replaced by test doubles; their files are not changed) |
| T2 | `backend/test/unit/cmrc-1-commerce-db.test.ts` | each reference yields exactly today's key and `TableName = TABLE_NAME`; the prefix list is the four prefixes | — |
| T3 | `backend/test/unit/cmrc-1-key-ownership.test.ts` | **C1, backend part.** A passing run means "backend: one file; renderer: exactly the three known reads", not "renderer: none". By syntax tree: no string literal and no template text of a source file under `backend/src`, `renderer/src` or `packages/*/src` contains one of the four prefixes, except `commerce-db.ts` and the three named renderer literals S16-S18. Self-test rows: a literal and each template part are found; a comment is not; `CUSTORDER#` is not counted as `ORDER#` | a prefix built at run time from parts (for example `"ORD" + "ER#"`) or received in a request; a prefix in a regular-expression literal; a file outside the scanned directories (`scripts/`, tests, `admin/`, `tools/`, `infra/`). § *Site inventory* covers the first gap for the baseline by the seven widening searches, and T1b covers it for the twelve handler files by recording the keys they send |

### Coverage of T1b

83 scenarios, all captured on the baseline before the first handler edit. Per site:

| Site | Scenarios (the command shapes they reach) |
|---|---|
| S1-S4 `orders/create.ts` | 13: no tenant header; invalid input; commerce switched off; product not found; smallest request (counter answers no value → `PPB-0001`); every optional field with delivery cost and an equal `expectedTotal` (the customer update with the birthday and company parts); `expectedTotal` differs (409 before the first write); coupon with a per-customer limit (five transaction items); coupon without limits (four); coupon item cancelled → second pass, same order number; coupon item cancelled and 409 on the second pass (the counter is used, no order); the transaction fails for another reason (500); mail counter at the limit |
| S5 `orders/get.ts` | 4: found; absent; admin of another tenant; no tenant header |
| S6 `orders/list.ts` | 3: no filter (the answer carries a `LastEvaluatedKey`; one Query); status + dates + search; admin of another tenant |
| S7 `orders/public-get.ts` | 4: email matches in another letter case; no match; absent; no email |
| S8 `orders/update-status.ts` | 7: with tracking number; without tracking number and note; the same status (no mail); stored order without `statusHistory`; absent; unknown status; admin of another tenant |
| S9 `orders/update.ts` | 12: field patch (three fields; absent; no known field); payment pending → paid with note; no stored state → paid; paid → refunded; refused; no-op; stored state outside the enum; absent; state changed between read and write; another field in the request |
| S10 `reports/summary.ts` | 3: three orders (`LastEvaluatedKey` answered; one Query); no order; admin of another tenant |
| S11 `customers/get.ts` | 3: found (GetItem then Query); absent (no Query); admin of another tenant (500, finding F-CMRC1A-ROLE-500) |
| S12 `customers/list.ts` | 2: three customers; admin of another tenant (500) |
| S13 `customers/update.ts` | 5: note; no `notes` field; absent; admin of another tenant; no body |
| S14 `customers/public-update.ts` | 8: four fields; fields cleared; no field; absent; tenant admin (403); no email; malformed email; malformed birthday |
| S15 `resources/presign.ts` (download) | 7: a row lists the product; rows without `items` (today's stored shape → 403, F-CMRC1-PRESIGN-ENTITLEMENT); two products, the second bought (two queries); caller without email; resource linked to no product; tenant admin; resource absent |
| every handler | 12: DynamoDB fails at the first command → the handler's 500 answer |

What the trace does **not** cover, and why that is acceptable for C2:

1. **Answers that send no command and that no scenario requests:** missing order id or body (`orders/get.ts`,
   `update-status.ts`, `update.ts`), `note` longer than 500 characters and an unknown `paymentStatus` value
   (`update.ts`), missing parameters (`customers/get.ts`), missing tenant or resource id (download). The lines that
   produce them are not in the diff.
2. **Branches of `orders/create.ts` that end or compute before the first commerce-private command:** the origin
   refusal and reCAPTCHA (replaced by test doubles), the delivery-zone refusals, a variant label that matches no
   option, a price that does not parse, personalization and volume prices. They change values inside the order item,
   never the key or the table. The T1 suites cover them (`order-price-1`, `order-checkout-1`, `order-confirm-1`,
   `catalog-mode`, `price-locale-1`, `coupon-fix-1`) and pass unedited.
3. **Optional parts in other combinations:** the customer update with only the birthday part or only the company
   part; the order list with one filter alone. Each part is added by its own condition, away from the reference.
4. **Mail paths:** an SES failure (logged, the answer does not change), a tenant's own mail templates.
5. **Other roles with the same commands** (`GLOBAL_ADMIN`, `EDITOR`), and a failure at a later command than the
   first, except the ones listed (payment condition, patch on an absent order, the transaction).
6. **Code with no commerce-private key:** the upload handler of `resources/presign.ts`; the index Query of
   `lib/tenant-verify.ts`.
7. **A real table.** The trace proves the command inputs the handlers build. It does not prove what DynamoDB answers,
   and `db.send` is replaced, so it does not run the document client. The operator's staging run is that evidence.
   One assumption of a scenario is INFERRED, not observed: that a GetItem with `ProjectionExpression: "email"` on an
   existing customer item without `email` answers an empty `Item` (the "profile update: customer present" rows).

## Findings, not fixed

- **F-CMRC1A-ONE-PAGE** (OBSERVED in the five files; characterised by T1b) — `orders/list.ts`, `reports/summary.ts`,
  `customers/get.ts` (the order rows), `customers/list.ts` and `resources/presign.ts` send one Query and do not read
  `LastEvaluatedKey`. A tenant whose orders or customers exceed one 1 MB page gets a partial list, partial report
  totals, or a missed purchase, with no sign. Fix: a pagination loop per site — a changed command sequence, so not in
  this slice. `docs/slices/cmrc-1.md` § 5.9 expected "S6 over two pages"; the handler never asks for a second page.
- **F-CMRC1A-ROLE-500** (EXECUTED: two T1b scenarios) — `customers/get.ts` and `customers/list.ts` call
  `requireRole` outside a `try` that answers 403. A refused caller gets HTTP 500 with the refusal text in `error`.
  The other ten handlers answer 403. Fix: the 403 wrapper the other handlers use (a changed answer; not this slice).
- **F-CMRC1A-ERROR-TEXT** (EXECUTED: the twelve "outage" scenarios) — nine of the twelve handlers put the text of
  the DynamoDB error into the 500 answer (`error: e.message`); `orders/create.ts`, `orders/public-get.ts` and
  `orders/update.ts` answer `Internal error`. One of the nine, `customers/public-update.ts`, answers the renderer.
  `public-harden-1` set the rule for anonymous routes only. Recorded for the human; no change here.
- **F-CMRC1A-COMMENT-HITS** (EXECUTED: the per-prefix `git grep` on the changed tree) — five comment lines in
  `backend/src` still name a prefix (`customers/get.ts:25`, `customers/public-update.ts:56`, `customers/update.ts:31`,
  `orders/create.ts:72`, `resources/presign.ts:39`). They are true descriptions and T3 ignores comments. The cutover
  gate of `docs/slices/cmrc-1.md` § 6 re-runs that text search and says "every hit is in `commerce-db.ts` or in the
  operational tool": at `cmrc-4` these five lines are expected hits, or the gate text is changed to "every hit that
  is not a comment".
- **F-CMRC1-PRESIGN-ENTITLEMENT** stays open (`docs/slices/cmrc-1.md` § 10.3): the T1b scenario "the rows hold no
  items (today's stored shape) → 403" shows the answer a real buyer gets.
- `docs/TECH-DEBT.md` is not in the packet's document list and is not changed. The operator decides at closeout
  whether the first three findings get rows there.

## Deviations and local decisions

| # | What | Why |
|---|---|---|
| 1 | The T1b baseline is `a78c006`, not `5aee9cb` | the packet (item 2): the baseline is HEAD at the start of the slice |
| 2 | T1b also records audit events and mails, in one ordered list with the DynamoDB commands | the order between a write, its audit event and its mail is part of today's behaviour; the cost is two replaced modules |
| 3 | The golden is canonical JSON: object keys sorted, arrays in order, `undefined` written as `"<undefined>"` | a stable file that can be compared byte for byte. The order of keys inside one object is not compared (DynamoDB does not see it). HTTP bodies are kept as the exact string |
| 4 | "S6 over two pages" became "the answer carries a `LastEvaluatedKey` and one Query is recorded" | the handler reads one page (F-CMRC1A-ONE-PAGE) |
| 5 | `orderIdOfCustomerOrder` and the exported type names of § 5.5 are left out | no caller in this slice (§ *The data module*) |
| 6 | T3 reads the files from the working tree, not from `git ls-files`, and also scans `packages/*/src` | a new file is checked before it is added to git (at the time of the build `commerce-db.ts` itself was untracked); a constant in a workspace package that the backend or the renderer bundles would escape a scan of the two directories only |
| 7 | T3 has three renderer exceptions (S16, S17, S18), not one | this slice does not touch the renderer; `cmrc-1b` removes S17 and S18 from the code and from the list, part L removes S16. The list is compared for equality, so a removed read must be removed from the list |
| 8 | T3 takes the prefixes from `COMMERCE_PRIVATE_PREFIXES`; T2 pins that list to its four literal values | one list; a kind added to the module is guarded with no edit of T3 |
| 9 | A handler builds one reference per command; no reference object is given to two commands | `db.send` is replaced in the trace, so the trace cannot show what the real document client does to an input object. First version: one reference for the GetItem and the UpdateItem of S8, S9, S14. Corrected before the gates. Probe (EXECUTED, file not kept): the real `DynamoDBDocumentClient` with a stub transport left the input of a GetCommand, an UpdateCommand and a QueryCommand unchanged — so the first version worked too; the per-command form needs no such fact |
| 10 | The test files are named `cmrc-1-*`, the slice is `cmrc-1a` | the names of `docs/slices/cmrc-1.md` § 5.9; `cmrc-4` reuses the golden under that name |
| 11 | The five comment lines that name a prefix are not edited | not required by C1 (T3 reads literals); no adjacent cleanup |

## Build record (2026-11-28, builder `claude-fable-5-2`)

Baseline `a78c00607380f9d3741a8d0e8d580376afd63261`; working tree clean at the start (EXECUTED: `git status --short`
→ empty). Nothing committed.

**Order of the round.** (1) This document with the inventory. (2) The trace module, the capture and the golden on
the untouched handlers (`git status --short -- backend/src` empty at capture time); the scenarios for the branches
found missing (the twelve outage rows, the order without `statusHistory`) were added and captured before the first
handler edit. (3) `commerce-db.ts` and T2. (4) The twelve handler files, one at a time for the first six, the last
six in one edit; after each step `tsc --noEmit`, the trace test and that file's existing tests. (5) T3. (6) Docs.
(7) Gates. The per-file checkpoints that this first run did not record one by one (the last six files, and the later
correction of three files) are supplied by the verification replay of § *Revision 1*.

**Changed paths.**

| Path | For | Serves |
|---|---|---|
| `backend/src/lib/commerce-db.ts` (new) | the located references and the prefix list | C1, C2 |
| `backend/src/orders/create.ts`, `get.ts`, `list.ts`, `public-get.ts`, `update.ts`, `update-status.ts` | key and `TableName` of S1-S9 from the module | C2 |
| `backend/src/customers/get.ts`, `list.ts`, `update.ts`, `public-update.ts` | the same for S11-S14 | C2 |
| `backend/src/reports/summary.ts`, `backend/src/resources/presign.ts` | the same for S10, S15 | C2 |
| `backend/test/unit/cmrc-1-command-trace.ts`, `.capture.test.ts`, `.test.ts`, `fixtures/cmrc-1-command-trace.baseline.json` (new) | T1b | C2 |
| `backend/test/unit/cmrc-1-commerce-db.test.ts` (new) | T2 | C1, C2 |
| `backend/test/unit/cmrc-1-key-ownership.test.ts` (new) | T3 | C1 (backend part) |
| `docs/slices/cmrc-1a.md` (new), `backend/ARCHITECTURE.md`, `CLAUDE.md` (rule 10), `docs/slices/cmrc-1.md` (Build status line, § 2.2 lines), `docs/ROADMAP.md` (row `cmrc-1a`), `CURRENT_SLICE.md` | documents | packet item 6 |

The diff of the twelve handler files: 49 lines added, 86 removed (EXECUTED: `git diff --stat -- backend/src`). Eight
files no longer import `TABLE_NAME` (they name no other item: `orders/get.ts`, `list.ts`, `public-get.ts`, the four
`customers/` files, `reports/summary.ts`). `orders/create.ts`, `orders/update.ts`,
`orders/update-status.ts` and `resources/presign.ts` keep it for the tenant record, `PRODUCT#`, `DELIVERYCONFIG#`,
`COUPON#`, `COUPONCODE#`, `COUPONUSE#`, `EMAILLIMIT#` and `RESOURCE#` (each remaining use was read).

**Proof runs (EXECUTED).**

| Check | Command | Result |
|---|---|---|
| Golden is deterministic | the capture run twice, `cmp` | identical |
| Golden is the baseline behaviour (first capture) | `git worktree add --detach /tmp/CMRC-1A-baseline a78c006…`; the trace module and the capture test copied in; `node_modules` linked; `CAPTURE_GOLDEN_TO=… npx vitest run --config vitest.unit.config.ts test/unit/cmrc-1-command-trace.capture.test.ts`; `cmp` with the capture made in the working tree before the first handler edit | exit 0; sha256 of both `581020517aacb5ab86a87547e5f569a4842cee79f820d87987c59bbfc5033d37` |
| Golden in the tree (final) | one scenario had a name that did not match its data ("two customers", three in the script); it was renamed after the handler edits. The golden was therefore captured again **from a new worktree of `a78c006`** (same procedure), never from the changed code | the new capture differs from the first in that one scenario name and in nothing else (EXECUTED: `diff` → one line; a per-scenario comparison of the two files → the renamed scenario's content equal, the 82 others equal). sha256 of the golden in the tree: `77b9823d335c0e58b00b47e6750eee0ee838f06fb9e26ed43018a8eab318068e` |
| Control A0 (run with the first capture): the comparison on the untouched baseline (same worktree) | `npx vitest run --config vitest.unit.config.ts test/unit/cmrc-1-command-trace.test.ts` | exit 0, 85 passed |
| Control A1: the comparison sees a changed key — worktree copy of `orders/get.ts`, `ORDER#` → `ORDERX#` | same | exit 1, 4 failed: the two order-get rows that send the command, the outage row, the whole-trace row |
| Control A2: the comparison sees a changed table — worktree copy of `orders/list.ts`, `TABLE_NAME + "-other"` | same | exit 1, 4 failed: the two order-list rows, the outage row, the whole-trace row |
| Control B: T3 sees the baseline's sites — `commerce-db.ts` and T3 copied into the worktree | `npx vitest run --config vitest.unit.config.ts test/unit/cmrc-1-key-ownership.test.ts` | exit 1; 22 literals outside the module: 19 in the twelve handler files (S1-S15), 3 in the renderer |
| The worktree is removed | `git worktree remove --force /tmp/CMRC-1A-baseline`; `git worktree list` | only the two worktrees that existed before |
| C2 on the changed tree | `cd backend && npx vitest run --config vitest.unit.config.ts test/unit/cmrc-1-command-trace.test.ts` | 85 passed against the final golden (and 85 passed against the first capture, before the rename) |
| No T1 file edited | `git status --short -- backend/test` | only the six new `cmrc-1-*` files |
| Per-prefix text search on the changed tree | the four `git grep -n -F` commands of § *Site inventory* | in `backend/src`: `lib/commerce-db.ts` and the five comment lines of F-CMRC1A-COMMENT-HITS; `renderer/src`: S16-S18; `scripts/`: S19 |

**Gates (EXECUTED, in this order, on the fresh build).**

| Gate | Command | Exit | Observed |
|---|---|---|---|
| G1 | `npm run build` | 0 | all eight workspaces built |
| G2 | `npm run typecheck` | 0 | |
| G3 | `npm --prefix backend run test:unit` | 0 | 98 files passed, 3 skipped (the three golden-capture files); 2585 tests passed, 3 skipped. Run again after the scenario rename and the final golden: the same result |
| G4 | `cd infra && npm test` | 0 | 94 passed |
| G5 | `cd tools/mcp-server && npm test` | 0 | route coverage PASS; 23 passed (no route changed; `routes.json` not modified) |
| G6 | `git diff --check` | 0 | no output |
| G6 | `git diff --no-index --check /dev/null <file>` for each of the 8 new files | 1 each | no output. Exit 1 is the status of `--no-index` for "the files differ". Control (EXECUTED): a clean file gives exit 1 and no output; a file with trailing spaces gives a `trailing whitespace` line and exit 3 |

**NOT RUN, with the reason.** `cd backend && npm test` (writes to the live staging database; forbidden by the
packet). `cd renderer && npx vitest run`, `npm run test:serving` (no file under `renderer/` changed; not in the
packet's gate list). Any AWS call, `cdk diff`, staging deploy (operator, at closeout).

**End-to-end coverage.** The changed surface has no end-to-end run in this build: the handlers were exercised as real
code against a replaced `db.send`, not against a table. The operator's staging run (order list, order detail,
customers, reports on the test shops) is the end-to-end evidence. A permanent end-to-end test is not proposed: the
integration suite `cd backend && npm test` writes to staging and is the operator's tool.

### Revision 1 (2026-11-28, after review-0: two findings, both corrected)

**R1 — the ownership guarantee was stated wider than what is true.** Class: *a guarantee written without its scope
and its exceptions* — the text said "the only runtime code", while three renderer reads and the copy tool still write
the keys, and the guard permits the three reads. Rule that closes the class: **every statement of the guarantee
names (a) where it is exclusive — `backend/src`, sites S1-S15; (b) what is retained outside it — the renderer reads
S16-S18 and the operational tool S19, each with the slice that removes it; (c) what the guard reads and what it
permits.** The one text is § *Guarantee scope*. Instances corrected (found by a search of every changed and new file
for `only`, `one file`, `one binding`, `no other`; each hit read):

| File | Place |
|---|---|
| `backend/src/lib/commerce-db.ts` | header comment (scope, the two retained groups, the guard's scope); the comment of the binding. Comment text only: no code line changed |
| `backend/test/unit/cmrc-1-key-ownership.test.ts` | header (what a passing run proves and does not prove); the titles of the `describe` and of the ownership row. No assertion changed |
| `CLAUDE.md` | rule 10 |
| `backend/ARCHITECTURE.md` | the `lib/` tree entry, the note under the key table, § Key Patterns, the T3 bullet of § Testing |
| `CURRENT_SLICE.md`, `docs/ROADMAP.md` (row `cmrc-1a`) | the summary sentences |
| `docs/slices/cmrc-1.md` | the Build status line and the paragraph above the § 2.2 table (no requirement or decision text changed) |
| this document | title, header, § *Guarantee scope* (new), § *Purpose*, § *Scope* item 3, the T3 row of § *Proofs*, § *Definition of Done*, § *Exit criterion* |

No renderer file, no test assertion and no handler code changed for R1.

**R2 — the per-file checkpoints of the packet's step 4 were not all recorded.** What happened in the first run
(unchanged chronology): the first six handler files were checked one at a time; the last six were edited and checked
together; a later correction (one reference call per command) changed three files and was checked once. Class: *a
prescribed per-step checkpoint reported in aggregate*. Rule: **each prescribed checkpoint has its own recorded
result; where the original order cannot be run again, a replay labelled as such supplies it.**

**Verification replay** (EXECUTED 2026-11-28; this is a replay, not the original chronology). A disposable worktree
of `a78c006` (`/tmp/CMRC-1A-replay`, removed by a `trap`). Copied in as the harness: `lib/commerce-db.ts` (the module
present from step 0), the trace module, the comparison test, T3, and the golden (`cmp` with the tree's golden: exit
0 — the golden was not replaced). No existing test file was copied or edited (`git status` of the worktree: 0). Then
the twelve FINAL handler files of the working tree, one per step, cumulative, in the order of the first run. After
each step, in `backend/` of the worktree:

- (a) `npx tsc --noEmit -p .`
- (b) `npx vitest run --config vitest.unit.config.ts test/unit/cmrc-1-command-trace.test.ts`
- (c) `npx vitest run --config vitest.unit.config.ts test/unit/projection-reserved-1.test.ts <the existing test files
  that import this handler>` — the files are found at run time by `git grep -l "src/<handler>.js" -- backend/test/unit`.
  `projection-reserved-1` runs at every step because its lint reads every backend source file. Six handlers have no
  existing test file that imports them (`orders/get.ts`, `orders/update-status.ts`, the four `customers/` files): for
  them (c) is that lint alone, and the trace is the only behaviour check.
- (d) informational: the number of prefix literals T3 still finds outside the module.

| Step | File applied | Handler files changed so far | (a) tsc exit | (b) trace exit, tests | (c) exit, tests | (c) existing test files that import the handler | (d) literals outside the module |
|---|---|---|---|---|---|---|---|
| 00 | — (module present, no handler changed) | 0 | 0 | 0, 85 passed | 0, 30 passed | — | 22 |
| 01 | `orders/get.ts` | 1 | 0 | 0, 85 passed | 0, 30 passed | none | 21 |
| 02 | `orders/list.ts` | 2 | 0 | 0, 85 passed | 0, 30 passed | `projection-reserved-1` | 20 |
| 03 | `orders/public-get.ts` | 3 | 0 | 0, 85 passed | 0, 45 passed | `public-harden-1-errors` | 19 |
| 04 | `orders/update-status.ts` | 4 | 0 | 0, 85 passed | 0, 30 passed | none | 17 |
| 05 | `orders/update.ts` | 5 | 0 | 0, 85 passed | 0, 61 passed | `pay-1` | 15 |
| 06 | `orders/create.ts` | 6 | 0 | 0, 85 passed | 0, 183 passed | `catalog-mode`, `coupon-fix-1`, `order-checkout-1`, `order-confirm-1`, `order-price-1`, `price-locale-1`, `public-harden-1-errors` | 11 |
| 07 | `customers/get.ts` | 7 | 0 | 0, 85 passed | 0, 30 passed | none | 9 |
| 08 | `customers/list.ts` | 8 | 0 | 0, 85 passed | 0, 30 passed | none | 8 |
| 09 | `customers/update.ts` | 9 | 0 | 0, 85 passed | 0, 30 passed | none | 7 |
| 10 | `customers/public-update.ts` | 10 | 0 | 0, 85 passed | 0, 30 passed | none | 5 |
| 11 | `reports/summary.ts` | 11 | 0 | 0, 85 passed | 0, 30 passed | `projection-reserved-1` | 4 |
| 12 | `resources/presign.ts` | 12 | 0 | 0, 85 passed | 0, 45 passed | `digital-file-guard-1`, `projection-reserved-1` | 3 (T3 passes) |

End checks (EXECUTED): `git diff -- backend/src` of the worktree is byte-identical to that of the working tree
(`cmp` exit 0), so the replay ended on exactly the reviewed handler code; the module is identical; no existing test
file changed. Column (d) falls at each step by the number of literals that file held on the baseline (control B),
so each step removed that file's keys and no other. `email-key-normalization.test.ts` (a T1 file of the
specification) imports no handler — it pins copied key expressions — so it is in no row; it passes in G3.
Script and logs: `.agent-manager/slices/CMRC-1A/evidence/replay/` (`replay.sh`, `results.tsv`, four logs per step).

**Gates on the revised tree (EXECUTED after R1, in the packet's order).**

| Gate | Command | Exit | Observed |
|---|---|---|---|
| G1 | `npm run build` | 0 | |
| G2 | `npm run typecheck` | 0 | |
| G3 | `npm --prefix backend run test:unit` | 0 | 98 files passed, 3 skipped; 2585 tests passed, 3 skipped |
| G4 | `cd infra && npm test` | 0 | 94 passed |
| G5 | `cd tools/mcp-server && npm test` | 0 | route coverage PASS; 23 passed |
| G6 | `git diff --check`; `git diff --no-index --check /dev/null <file>` for each of the 8 new files | 0; 1 each | no output in either (exit 1 = "the files differ", as the control of the first run showed) |

The golden was not touched in revision 1 (sha256 `77b9823d335c0e58b00b47e6750eee0ee838f06fb9e26ed43018a8eab318068e`).

## Migration / deployment notes

- **Data migration:** none. No item is read, written or moved differently.
- **Deploy:** one backend deploy (`cdk deploy`). The diff must hold rebuilt function code only: no new resource, no
  IAM change, no environment variable. The operator proves that at closeout from the staging diff. Thirteen
  functions are built from the changed files (OBSERVED: the `entry` lines of `infra/lib/api-commerce.ts` and
  `infra/lib/api.ts`): eleven in the commerce nested stack (six `orders/`, four `customers/`, `reports/summary.ts`)
  and two in the parent stack (`resources/presign.ts` holds the upload and the download handler). No other file
  imports one of the twelve handler files or `lib/commerce-db.ts` (EXECUTED: `git grep` for the import paths).
  Each function sends the same command types to the same table as before, so no grant is missing (INFERRED from
  the equal trace; the staging run is the proof).
- **Order with other slices:** independent. No renderer or admin change.
- **Rollback:** redeploy the previous commit. Nothing to restore.
- **Production sensitivity:** the order, customer and report functions serve the shop screens and the checkout; the
  two resource functions serve the upload and the download of a digital file. All are live code on production.

## Definition of Done

- [x] C1, backend part: T3 passes; `backend/src` holds the prefixes in `lib/commerce-db.ts` only. The renderer part
      of C1 is NOT done: S16-S18 remain as the three listed exceptions (not touched by this slice; `cmrc-1b`, part L).
- [x] C2: T1b passes; the golden is byte-identical to a capture made from a worktree of the baseline commit; no T1
      file edited.
- [x] T2 passes.
- [x] Gates of § *Build record* executed, each exit status recorded.
- [x] Docs updated (§ *Scope* item 4).
- [ ] Operator gates (§ *Evidence required*).

## Evidence required

- EXECUTED by the builder: the gates of § *Build record*; the golden re-captured from a separate worktree of the
  baseline commit and compared byte for byte.
- EXECUTED / OBSERVED by the operator at closeout: the staging `cdk diff` holds rebuilt function code only; staging
  deploy; on the test shops, against the real table: order list, order detail, customers, reports.
- NOT RUN by the builder: `cd backend && npm test` (it writes to the live staging database; forbidden by the packet);
  any AWS call.

## Exit criterion

`cmrc-1b` can add the renderer-key routes on the references. For the backend, `cmrc-4` can move the storage of the
four families by changing the one binding `COMMERCE_TABLE` in `commerce-db.ts` (plus infrastructure) — but only when
the cutover gate of `docs/slices/cmrc-1.md` § 6 also holds: S16-S18 gone from the renderer (`cmrc-1b`, part L). The
copy tool S19 is not a condition of that gate; `cmrc-2` puts it on the module's prefix list. This slice alone does
not make the storage movable.

## References

`docs/slices/cmrc-1.md` § 2.2, § 5.2 (C1, C2), § 5.4, § 5.5, § 5.9 (T1, T1b, T2, T3), § 5.10, § 5.15, § 6 (cutover
gate), § 9 A1; `docs/plan-commerce-private-table.md`; `docs/platform-decisions.md` PD-001, PD-002; `docs/VISION.md`
guarantee 2; `docs/testing-strategy.md`; precedents `backend/test/unit/cat-import-profile-1-golden.capture.test.ts`,
`backend/src/lib/scheduling-db.ts` (the rule "one module names the table", not its size).

## Closeout (operator, 2026-11-28)

- Relay: builder `claude-fable-5-2`, reviewer `gpt-6.1-sol`, two cycles; review-0 `revise` (R1: claims of exclusive
  ownership wider than the backend; R2: the per-handler checkpoint record), review-1 `approved`. The reviewer reran
  the command trace on the candidate and on the twelve handlers of the baseline `a78c006`: unchanged golden,
  SHA-256 `77b9823d335c0e58b00b47e6750eee0ee838f06fb9e26ed43018a8eab318068e`.
- Operator gates on the approved tree, each exit 0: build, typecheck, shared, plugins, renderer, serving,
  serving-bundle, admin unit, backend unit, infra, mcp, `git diff --check`; no change under `backend/src/auth`,
  `infra`, `packages`, `renderer`, `admin`, `tools`, `scripts`, a manifest or a lockfile.
- Staging diff (read before the deploy): 0 resources added, 0 removed, no IAM change; modified: the eleven commerce
  functions of the re-pointed handlers (create, list, get, update, update-status and public-get order; list, get,
  update and public-update customer; reports summary), the two resource functions (`presign.ts`), and the
  renderer rebuilt. Deploy: `AmodxStack-staging` succeeded.
- Staging proof, real table:
  - the three test sites: `GET /orders`, `GET /customers`, `GET /reports/summary` answer 200 (the sites hold no
    order); the general smoke passes;
  - seeded read proof on `cm1-commerce`: three synthetic items (an order, its `CUSTORDER#` row, a `CUSTOMER#`
    profile; an address under `example.invalid`) put into `AmodxTable-staging` by the operator, then `GET /orders`
    lists the order with its total and status, `GET /orders/{id}` answers it with its items, `GET /customers` lists
    the customer, `GET /customers/{email}` answers the customer and the one indexed order, `GET /reports/summary`
    answers 200; the three keys deleted, the lists as before the run.
- NOT proven on staging: the WRITE paths against the real table (order creation, status and payment updates, the
  customer updates). Order creation refuses a scripted request on staging (reCAPTCHA), and a status update sends a
  customer mail. Basis for these: the command trace (every command of every listed branch byte-identical to the
  baseline) and the unit suites.
