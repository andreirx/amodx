# CMRC-2B — the commerce write freeze: listed tenants' commerce writers answer 503 and write nothing

- **Status:** IMPLEMENTED 2026-11-28 — built; revision 1 of the same day applies review-0 (three findings: § *Review-0:
  findings, classes and rules*); operator gates pending (§ *Operator procedure*).
- **Track:** B (commerce-private). Fifth build slice of the track: part (2) of the `cmrc-2` bullet of
  `docs/slices/cmrc-1.md` § 6 and its paragraph "The write freeze" (mechanism, frozen writers W1-W5, drain, check P2).
- **Depends:** `cmrc-1a` (every commerce-private key is built in `backend/src/lib/commerce-db.ts`), `cmrc-2a` (the tool
  that the freeze protects). Both on staging or built since 2026-11-28.
- **Source plan:** `docs/plan-commerce-private-table.md`; specification `docs/slices/cmrc-1.md` § 6 ("The write freeze",
  "Release", the `cmrc-3` bullet).
- **Maturity:** PROTOTYPE until the operator's staging procedure passes; MATURE when `cmrc-3` has run on staging under it.
- **Baseline:** `404927e` (HEAD at the start of the slice; the working tree was clean).

Evidence labels: **OBSERVED** — read in the file at `404927e`; **EXECUTED** — a command run in this slice (command
given); **INFERRED** — reasoned, not seen; **NOT RUN** — needs AWS, a deployment or the operator. **No AWS call was
made in this slice.**

## Guarantee scope (what is true after this slice, and what is not)

| Part | Statement | Basis |
|---|---|---|
| **True** | With `COMMERCE_WRITE_FREEZE_TENANTS` naming a tenant, each of the five runtime writers of the four commerce-private kinds answers 503 `{ code: "commerceFrozen", error: … }` for that tenant and causes NO effect of any kind: no DynamoDB command (read or write), no origin check, no reCAPTCHA, no audit event, no mail | test "W* frozen" rows, § *Proofs* |
| **True** | With the variable absent, empty, or naming other tenants only, every command, audit event, mail and HTTP answer of the twelve handler files is the `cmrc-1a` golden, byte for byte | T1b unchanged; test "unlisted" |
| **True** | Readers are not frozen: the seven reader handlers and the three `/customer/*` routes answer a listed tenant as before | tests "readers" |
| **True** | The variable is on exactly the five writer functions; with no deploy input its value is empty | infra test `(cmrc2b-1)`, `(cmrc2b-2)` |
| **Not claimed** | That a well-formed but WRONG tenant id freezes the intended shop. It freezes nothing for that shop. The operator's check P2 finds it (§ *Operator procedure*) | D3 |
| **Not claimed** | That the freeze works on AWS. The first proof is the operator's staging procedure | § *Evidence required* |
| **Not claimed** | Guarantee 2 of `docs/VISION.md`. Nothing has moved; this slice only makes a provably equal copy possible | — |

## Purpose / risk retired

A copy of the four kinds into `AmodxCommerceTable` is provably equal only if nothing writes them between the copy and
the cutover (`cmrc-1.md` § 6). The risk retired: **a write that lands in the main table after the copy and is then
lost at the cutover** — an order, a status change, a payment change, a note or a profile change that the customer or
the owner believes is saved. This slice builds the deploy-time switch that refuses every such write for the shops
being copied, before the first effect of the request, and changes nothing for any other shop.

Link to the vision: guarantee 2 (customer-private data outside the public renderer's reach) needs the move of
`cmrc-3`/`cmrc-4`; the move needs this freeze.

What an owner or buyer of a frozen shop sees, for the minutes of a copy: placing an order, changing an order's status
or payment, saving a customer note or a profile is refused with "Orders are paused for a short maintenance. Try again
in a few minutes."; every read keeps working (§ *Callers*).

## Item 1 — the writer list, re-derived on `404927e` before any edit

**Basis (EXECUTED).** Since `cmrc-1a` every commerce-private key in `backend/src` is built by a reference function of
`backend/src/lib/commerce-db.ts`, and the key-ownership test refuses the prefixes as text in every other file of
`backend/src`, `renderer/src`, `packages/*/src` (`backend/test/unit/cmrc-1-key-ownership.test.ts`; it cannot see a
prefix joined from parts at run time). So the importers of the module are a complete list of the runtime sites, under
that test's limit:

```
git grep -n -E 'from "(\.\./)+lib/commerce-db\.js"|from "\./commerce-db\.js"' -- backend/src renderer/src 'packages/*/src' scripts
```

13 importers, all in `backend/src`. Per importer, the command classes it sends (EXECUTED: `grep -o -E "new (Get|Put|
Update|Delete|Query|TransactWrite|…)Command|(Put|Update|Delete|ConditionCheck): \{|SendEmailCommand|publishAudit"`
per file):

| File | Commands | Writes a commerce-private item? |
|---|---|---|
| `orders/create.ts` | Get ×7, Update ×2, TransactWrite (Put ×2, Update ×3), SES | **yes — W1** (counter Update; order Put, index Put, customer Update in the transaction) |
| `orders/update-status.ts` | Get ×2, Update, audit, SES | **yes — W2** (order Update) |
| `orders/update.ts` | Get ×2, Update ×2, audit, SES | **yes — W3** (order Update: field patch; payment transition) |
| `customers/update.ts` | Update | **yes — W4** (customer Update) |
| `customers/public-update.ts` | Get, Update | **yes — W5** (customer Update) |
| `orders/get.ts`, `orders/list.ts`, `orders/public-get.ts` | Get / Query | no — readers |
| `customers/get.ts`, `customers/list.ts` | Get, Query / Query | no — readers |
| `reports/summary.ts` | Query | no — reader |
| `resources/presign.ts` | Query, Get; its Put writes `RESOURCE#` (upload handler), not a commerce-private kind | no — reader of `CUSTORDER#` |
| `customers/self-service.ts` | Query, Get ×2 | no — readers (the three `/customer/*` routes) |

**Result:** exactly W1-W5 of the specification. No writer the specification does not name. W6 (a pickup writer, § 7
of the spec) does not exist (OBSERVED: no other importer). The operational tool S19 is not a runtime writer.

**Other writes of the same requests** (each is refused with the request, because the guard precedes the first effect
of ANY kind):

| Writer | Writes and effects of other kinds in the same request (OBSERVED) |
|---|---|
| W1 `orders/create.ts` | origin check Query (`lib/tenant-verify.ts`, GSI_Domain); reCAPTCHA call (`lib/recaptcha.ts`, a paid external call); coupon use: `COUPON#` Update and `COUPONUSE#` Update in the transaction; the mail counter `SYSTEM`/`EMAILLIMIT#` Get + Update; SES mails. No product stock write exists |
| W2 `orders/update-status.ts` | audit event (`publishAudit`, EventBridge); tenant Get; SES mail |
| W3 `orders/update.ts` | payment branch: audit event; tenant Get; SES "paid" mail |
| W4 `customers/update.ts` | none |
| W5 `customers/public-update.ts` | none |

## Item 2 — the mechanism

**One variable:** `COMMERCE_WRITE_FREEZE_TENANTS`, on exactly the five writer functions. Comma list of tenant ids.

**One module:** `backend/src/lib/commerce-freeze.ts` (new), a sibling of `commerce-db.ts`:

- `parseCommerceWriteFreeze(listText: string | undefined): CommerceWriteFreeze` — pure. The closed sum
  `{ kind: "none" } | { kind: "tenants"; tenantIds: ReadonlySet<string> } | { kind: "unreadable"; entries: string[] }`.
- `commerceWriteFreezeRefusal(tenantId: string, listText = process.env.COMMERCE_WRITE_FREEZE_TENANTS)` — the 503 answer
  when the tenant's commerce writes are frozen, else `undefined`. It reads the variable at each call (a default
  parameter), switches over the sum with no `default` arm and a `never` check after it (a new state does not compile;
  at run time an unhandled state refuses), and logs one warning line with the reason when it refuses.
- `COMMERCE_FROZEN_TEXT` — the English text of the answer.

Where (decided): a sibling module, not `commerce-db.ts`. `commerce-db.ts` states "No I/O. Every function is pure:
strings in, a plain object out"; reading the environment and logging there would break its rule, and the freeze is a
different concern (an operational switch, not a key layout). Rejected: the parser inside each handler (five copies of
the parsing rules — the malformed-list rule would drift); the parser in `packages/shared` (no second package uses it).

**Parsing rules** (tested, `cmrc-2b-commerce-freeze.test.ts`):

1. Absent (`undefined`) or empty → `none`: no tenant frozen.
2. Split on `,`; trim spaces and tabs around each entry; drop empty entries (`"a,,b,"` = `a`, `b`). Only separators and
   spaces → `none`.
3. Comparison is exact: case-sensitive, no normalization. Tenant ids are partition keys (`TENANT#<id>`), so `Shop` and
   `shop` are two tenants.
4. An entry that, after the trim, still contains whitespace, `;`, `"`, `'` or `` ` `` is **unreadable**: these are the
   signs of a wrong separator or of a quoting mistake in the shell (`"a b"`, `a;b`, `'"a,b"'`). Then the whole
   variable is `unreadable`, and **every tenant is frozen** (D3).

**Guard position** — the rule: *the guard is the first statement after the handler's checks that need neither I/O
nor the request body's content — the tenant header, the presence checks before it, and the role check where the
handler has one — and it precedes the first I/O call of any kind.* One call per handler; in W3 it precedes the split
into the field patch and the payment transition, so one call covers both branches.

| Writer | Position (line numbers of `404927e`) | Before it (unchanged answers for a frozen tenant) | First effect it now precedes |
|---|---|---|---|
| W1 `orders/create.ts` | after `if (!event.body)` (line 33), before `verifyTenantFromOrigin` (line 36) | 400 missing tenant, 400 missing body | the origin check Query; then the tenant Get, reCAPTCHA, product Gets, coupon Gets, the counter Update (line 386), the transaction, the mail counter, mails |
| W2 `orders/update-status.ts` | after the role check (line 34), before `JSON.parse` (line 36) | 400 missing tenant / id / body; 403 role | the order Get (line 49), the Update, the audit event, the mail |
| W3 `orders/update.ts` | after the role check (line 39), before `JSON.parse` (line 41) | 400 missing tenant / id / body; 403 role | both branches: the field patch Update (line 78); the payment Get (line 118), Update, audit event, mail |
| W4 `customers/update.ts` | after the role check (line 26), before `JSON.parse` (line 28) | 400 missing data; 403 role | the customer Update (line 35) |
| W5 `customers/public-update.ts` | after the role check (line 42), before the body check (line 44) | 400 missing tenant; 403 role | the customer Get (line 74), the Update |

Why W1 precedes its origin check: the origin check sends a DynamoDB Query (`lib/tenant-verify.ts`). A refusal that
needs no read is the smallest and proves "no command of any kind". Its cost: a request from a wrong origin for a
frozen tenant gets 503 instead of 403. It learns only that the shop is paused; it can write nothing, because the
writes address the tenant of the same header the guard checked. Why the admin writers check the role first: the role
check is pure (it reads the authorizer's context), and a caller without the right learns nothing about the freeze.

**Answer.** `503`, body `{ "code": "commerceFrozen", "error": "Orders are paused for a short maintenance. Try again
in a few minutes." }`, no headers. Envelope: all five handlers refuse with `{ error: <text> }` (OBSERVED); W1's
`price-changed` answer adds `code` to the same envelope — so the freeze answer is that envelope plus `code`, the same
in all five. **No `Retry-After`:** the API's other 503 answers set none (revised after review-0, finding R2; the first
version searched only the literal `statusCode: 503` and wrongly said there was no other 503). Basis (EXECUTED):
`git grep -n -P "(?<![0-9])503(?![0-9])" -- 'backend/src/*.ts'` lists every literal 503 of the backend, including
the ones built by a helper; then each helper was read (OBSERVED):

| 503 answers | Helper | Headers the helper sets |
|---|---|---|
| `interest/public.ts:249`, `:343` (`retryable`) | local `json` (`:87`) | `Cache-Control: no-store` |
| `import/glam-pricelist.ts:396` | local `json` (`:124`) | none |
| `leads/newsletter.ts:165` | local `json` (`:54`) | none |
| scheduling: `admin/appt-appointments-list.ts:46`, `admin/appt-common.ts:169`, `admin/appt-week.ts:75`, `admin/bookings-cancel.ts:39`, `admin/customers-erase.ts:24`, `admin/resources-delete.ts:20`, `visitor/common.ts:153`, `visitor/feed.ts:189`, `visitor/holds.ts:45`, `:101`, `:123`, `visitor/slots.ts:72` | `refusal` → `answer` (`scheduling/common.ts:36`) | `Content-Type`, plus only the headers the caller passes; no 503 call passes one |

`git grep -n -i "retry-after" -- 'backend/src/*.ts'` finds exactly two uses, both on the scheduling 429s
(`visitor/common.ts:135`, `:137`). So no 503 of the API sets `Retry-After`, and the freeze answer sets none either.
Limit of the basis: a status code computed at run time (not written as `503`) is not found; none was seen in the
helpers read. **No refusal sum extended:**
none of the five handlers has a typed refusal sum (they return literal objects; OBSERVED); adding one for one variant
is not earned. The freeze decision itself is the closed sum `CommerceWriteFreeze`, matched with no `default` arm and
closed by a `never` check after the `switch` (revised after review-0, finding R1: without it a new variant compiled
clean and fell through to `undefined`, i.e. "not frozen").

### D3 — a present but unreadable list freezes every tenant (decided)

The problem: the list is typed by the operator into a shell at deploy time. A wrong separator or a quoting mistake
gives a text whose entries are not the intended tenant ids. Two answers:

| Option | Reward | Risk |
|---|---|---|
| A: an unreadable entry freezes nothing and logs | a typo never stops other shops | the intended shop is NOT frozen and the copy can run against a live writer: a write after the copy is lost at the cutover (silent data loss) |
| **B: a present but unreadable variable freezes every tenant** (chosen) | a separator or quoting mistake can never leave the intended shop unfrozen | every shop's commerce writes are refused until a redeploy with a correct list: an availability loss across commerce tenants for minutes, with no data loss; one warning line per refused request names the reason |

B is taken: it is the one that cannot let a copy run against an unfrozen shop. Its own failure (everyone frozen) is
found by the operator's unlisted probe (§ *Operator procedure*, step 7): a writer probe for one tenant NOT in the list
must answer its normal refusal (a 4xx, or 500 for W4's non-JSON body), and under B it answers 503. The case NEITHER option can catch — a well-formed but wrong id
(`cm1-comerce`) — freezes nothing for the intended shop; P2 (step 6) finds it, because the intended shop's probe
answers its normal refusal instead of 503. Both probes write nothing in either outcome.

## Scope

1. `backend/src/lib/commerce-freeze.ts` (new): the parser, the refusal, the text.
2. The five writers W1-W5: one guard call each, at the position of the table above.
3. `infra/lib/api-commerce.ts`: the variable on exactly the five writer functions, value from the prop
   `commerceWriteFreezeTenants`; `infra/lib/amodx-stack.ts`: the prop from the CDK context `commerceWriteFreezeTenants`
   (default empty; a non-text value stops the synth); `infra/deploy.sh`: the operator's environment variable
   `COMMERCE_WRITE_FREEZE_TENANTS` becomes that context, and the script prints the list before the diff.
4. Tests (§ *Proofs*) and documents.

## Non-scope

Any use of the commerce table; `COMMERCE_TABLE_NAME`; the copy; a bypass of the freeze (none exists); freezing
readers; a UI to set the list; a renderer change (§ *Callers*: none is needed); a `packages/shared` change; an admin
code change (§ *Callers*: none is needed); an MCP change (§ *Callers*: finding F-CMRC2B-MCP-REASON).

## Architectural boundaries

- Tenant isolation: the guard compares the request's `x-tenant-id` — the tenant every write of the request addresses —
  with the list; it reads nothing of another tenant.
- No DynamoDB access added; no scan.
- Critical rule 10: no commerce-private key or table is named outside `commerce-db.ts`; `commerce-freeze.ts` names
  none (the key-ownership test still passes).
- `commerce-db.ts` stays pure; `commerce-freeze.ts` and `commerce-db.ts` do not import each other.
- Infra: no IAM change, no new resource; the composition root (`amodx-stack.ts`) is the one place that reads the
  deploy input.

## Callers (item 4)

| Caller | What it shows for 503 `commerceFrozen` (OBSERVED in the code) | Change |
|---|---|---|
| Admin order status (`admin/src/pages/OrderDetail.tsx:129`) | `apiRequest` (`admin/src/lib/api.ts:54-71`) signs out only on 401/403; other non-OK → `ApiError` with message `API Error (503): <body.error>`. The page alerts "Failed to update status: API Error (503): Orders are paused for a short maintenance. Try again in a few minutes." | none; one admin unit test pins it |
| Admin order edit (tracking, `OrderDetail.tsx:160`; payment, `paymentErrorText` `:70-76`, maps only 409) | "Failed to save tracking: API Error (503): Orders are paused…" / "Failed to update payment: API Error (503): Orders are paused…" | none |
| Admin customer note (`admin/src/pages/CustomerDetail.tsx:64`) | "Failed to save notes: API Error (503): Orders are paused…" | none |
| Public checkout (`renderer/src/components/CheckoutPageView.tsx:375-390`) | maps one code (`price-changed`, whose localized text the SERVER sends); for any other non-OK JSON answer it shows the server's `error` text as sent. The visitor sees "Orders are paused for a short maintenance. Try again in a few minutes." in English on every shop, as for the other refusals of this route ("Delivery not available", "Verification failed. Please try again.") | none; finding F-CMRC2B-CHECKOUT-TEXT |
| Renderer profile save (W5 through `renderer/src/app/api/profile/route.ts:96-104` → `AccountPageView.tsx:197-215`) | the proxy passes status and body through; the page does nothing on a non-OK answer: the form stays open with the visitor's input, no message (as for every failure today) | none; finding F-CMRC2B-PROFILE-SILENT |
| MCP `update_order_status` (`tools/mcp-server/src/tools/orders-customers.ts:57-60`) — the only MCP tool that calls a frozen route (EXECUTED: `grep` of `/orders` and `/customers` in `tools/mcp-server/src`) | `isError: true`, text `Error: Request failed with status code 503` (axios's message). The failure passes through; the server's reason does not | none; finding F-CMRC2B-MCP-REASON |

## Proofs

| Test (file › row) | Proves | Red before the guard? |
|---|---|---|
| `backend/test/unit/cmrc-2b-write-freeze.test.ts` › "%s → no effect; 503 commerceFrozen unless refused before the guard" (one row per writer scenario of the `cmrc-1a` trace, 50 rows) | listed tenant `t1`: no DynamoDB command, audit event or mail; answer 503 `commerceFrozen`; the five scenarios of `KEPT_BEFORE_GUARD` keep their golden answer (pins each guard position) | yes (EXECUTED: 51 failed before any guard) |
| same file › "%s: at least one of its golden scenarios writes, and under the freeze it does not" (5 rows, one per writer) | each writer has writing scenarios and all of them are refused | yes |
| same file › "W1: no origin check and no reCAPTCHA decision …" | the guard of W1 precedes `verifyTenantFromOrigin` and `resolveRecaptchaConfig`; the unlisted run reaches both (control) | yes; mutation control: the guard moved after the origin check → this row red (EXECUTED), restored |
| same file › "unreadable list (fail closed): %s …" (50 rows) | `t9;t8` freezes `t1` exactly as a listed id does (D3) | passes trivially before the guards (both runs equal), meaningful after |
| same file › "listed tenant: %s equals the golden" (every reader scenario) and "%s has scenarios in the trace" (7 reader handlers) | order get, order list, public order GET, reports, customer get, customer list, download: unchanged for a listed tenant | green before and after (readers have no guard) |
| same file › "the list names other tenants only (t9, other-shop, T1 …)", "the variable is empty", "the variable is absent" | the whole trace serializes to the `cmrc-1a` golden byte for byte; the golden is not captured again | green before and after |
| `backend/test/unit/cmrc-1-command-trace.test.ts` (T1b, unchanged) | the trace with the variable absent equals the golden | green after each guard |
| `backend/test/unit/cmrc-2b-commerce-freeze.test.ts` (22 rows) | parsing rules 1-4; exact comparison; unreadable → every tenant; the default is the variable, read at each call | new module |
| `backend/test/unit/cmrc-2b-self-service-readers.test.ts` (4 rows) | `/customer/order-history`, `/customer/profile-read`, `/customer/order-lookup` read and answer 200 for a listed tenant | green (no guard) |
| `admin/src/lib/api.test.ts` › "CMRC-2B — a 503 commerceFrozen answer …" | the admin gets `ApiError(503)` with message `API Error (503): Orders are paused …`; no sign-out | characterization (no admin change) |
| `infra/test/amodx-stack.test.ts` › `(cmrc2b-1)`, `(cmrc2b-2)` | the variable on exactly the five writer functions, all in `CommerceApi`; value `""` with no context | new |

## Operator procedure (for the staging run of this slice, and for `cmrc-3`)

Revised after review-0 (finding R3): the first version checked "no change" only through product reads, which project
some fields and do not show the order counter or the email → order index. The procedure now has two separate checks:
**product reads** (do readers still answer?) and **content equality** (did any item of the four kinds change?). The
content check reuses the `cmrc-2a` tool's read-only `plan` mode, which writes nothing to a table: its
`--inventory-out` file lists every key of the four kinds (`COMMERCE_PRIVATE_PREFIXES`: orders, the email → order
index, customer profiles, the order counter) of the named tenants, with the SHA-256 of the whole item (every
attribute, every depth; `docs/slices/cmrc-2a.md` § *Canonical form and hash*). Two inventories, taken before and after
the probes, are compared key by key.

Placeholders (never printed): `$API` = the staging API address (the `ApiApiUrl…` output of `AmodxStack-staging`);
`$MASTER_KEY` = the master key (the `x-api-key` of the MCP server; role `GLOBAL_ADMIN`). `T` = the listed tenant;
`U` = one commerce tenant NOT listed; `ORDER` = an existing order id of `T`; `EMAIL` = an existing customer email of
`T`; `OUT` = a new directory OUTSIDE the repository (the tool refuses one inside; its files hold email keys: personal
data). Every probe writes nothing in either outcome: the frozen answer comes before the first command; the unfrozen
answer is a refusal by a check that sends no write.

```bash
# Run from the repository root after `npm run build` (the tool loads packages/shared/dist).
cmrc() { npm run migrate-commerce-private-table -- --source-table AmodxTable-staging --destination-table AmodxCommerceTable-staging "$@"; }
probe() { curl -s -o /dev/stderr -w ' → %{http_code}\n' "$@"; }
T=cm1-commerce; U=<a commerce tenant not in the list>; OUT=~/cmrc-2b-run/<date>; mkdir -p "$OUT"

# 1. The shipped state: an empty list. Read the diff before typing the stage name: the five writer functions show the
#    new variable COMMERCE_WRITE_FREEZE_TENANTS with an empty value and new code; no IAM change, no other function.
(cd infra && ./deploy.sh staging)
#    Then the usual commerce read and order page checks.
#    Precondition of a meaningful content check: T holds at least one item of each of the four kinds. If step 4 prints
#    a kind with 0 items, place one normal order on T's shop NOW (one checkout writes an order, an index row, a profile
#    and the counter), before step 2.

# 2. The freeze deploy. The script prints the list before the diff; check it.
(cd infra && COMMERCE_WRITE_FREEZE_TENANTS=$T ./deploy.sh staging)
# 3. Drain: after the deploy reports complete, wait at least 60 s (twice the 29 s function timeout,
#    infra/lib/api-commerce.ts:65), so that every invocation started on the old configuration has ended.
sleep 60

# 4. Content BEFORE the probes (read-only; RESULT: GREEN and status 0 required).
cmrc --mode plan --tenants "$T,$U" --inventory-out "$OUT/inventory-before.json"; echo "status: $?"

# 5. Product reads of T (separate from content equality): each answers 200.
probe -H "x-api-key: $MASTER_KEY" -H "x-tenant-id: $T" "$API/orders"
probe -H "x-api-key: $MASTER_KEY" -H "x-tenant-id: $T" "$API/orders/$ORDER"
probe -H "x-api-key: $MASTER_KEY" -H "x-tenant-id: $T" "$API/customers"
probe -H "x-api-key: $MASTER_KEY" -H "x-tenant-id: $T" "$API/reports/summary"

# 6. P2 — each writer of T answers 503 {"code":"commerceFrozen",…}:
probe -X POST -H "x-tenant-id: $T" -H 'content-type: application/json' -d '{}' "$API/public/orders"                                                        # W1
probe -X PUT  -H "x-api-key: $MASTER_KEY" -H "x-tenant-id: $T" -H 'content-type: application/json' -d '{"status":"no-such-status"}' "$API/orders/$ORDER/status"   # W2
probe -X PUT  -H "x-api-key: $MASTER_KEY" -H "x-tenant-id: $T" -H 'content-type: application/json' -d '{"paymentStatus":"no-such-state"}' "$API/orders/$ORDER"   # W3
probe -X PUT  -H "x-api-key: $MASTER_KEY" -H "x-tenant-id: $T" -H 'content-type: application/json' -d 'not-json' "$API/customers/$EMAIL"                         # W4
probe -X POST -H "x-api-key: $MASTER_KEY" -H "x-tenant-id: $T" -H 'content-type: application/json' -d '{}' "$API/public/customers/profile"                     # W5

# 7. The same five probes with x-tenant-id: $U answer their NORMAL refusal, not 503:
#    W1 403 (no Origin header); W2 400 invalid status; W3 400 paymentStatus; W4 500 (the body is not JSON); W5 400
#    email required. A 503 here means the list is unreadable (D3: every tenant frozen): redeploy with a correct list.
#    A non-503 answer for T in step 6 means T is not frozen (a wrong id): stop, do not copy.

# 8. Content AFTER the probes, and the comparison.
cmrc --mode plan --tenants "$T,$U" --inventory-out "$OUT/inventory-after.json"; echo "status: $?"
node -e 'const fs=require("fs");const load=p=>JSON.parse(fs.readFileSync(p,"utf8"));const [a,b]=process.argv.slice(1).map(load);if(a.record!=="amodx-commerce-private/inventory/1"||b.record!==a.record){console.log("NOT INVENTORIES");process.exit(2)}const id=e=>e.pk+" "+e.sk;const ma=new Map(a.entries.map(e=>[id(e),e.sha256])),mb=new Map(b.entries.map(e=>[id(e),e.sha256]));const diff=[...new Set([...ma.keys(),...mb.keys()])].filter(k=>ma.get(k)!==mb.get(k));const kinds={};for(const e of a.entries){const k=e.sk.replace(/[#].*$/,"#");kinds[k]=(kinds[k]||0)+1}console.log("items before:",a.entries.length,"after:",b.entries.length,"per kind before:",JSON.stringify(kinds));for(const k of diff)console.log("CHANGED:",k,ma.get(k)??"absent","->",mb.get(k)??"absent");console.log(diff.length===0?"CONTENT EQUAL":"CONTENT CHANGED");process.exit(diff.length===0?0:1)' "$OUT/inventory-before.json" "$OUT/inventory-after.json"; echo "status: $?"

# 9. Release: the empty list again; the diff shows the five variables back to empty.
(cd infra && ./deploy.sh staging)
```

**Pass condition of the staging run** (all of them):

1. Steps 4 and 8: each ends `RESULT: GREEN` with status 0.
2. Step 8's comparison prints `CONTENT EQUAL` with status 0. It prints the item count per kind of the BEFORE inventory
   (the counter appears as `COUNTER#`): each of the four kinds of `T` must be at least 1, else the run proves nothing
   for that kind (precondition of step 1). A `CHANGED:` line names the key and its two hashes (`absent` for a key on
   one side only).
3. Step 5: four times 200. Step 6: five times 503 with the body `{"code":"commerceFrozen",…}`. Step 7: five times the
   normal refusal named there, never 503.

What it does not cover: items of other kinds that the writers touch in a normal request (the coupon counters, the
mail counter `EMAILLIMIT#`, audit events). That none of them happens for a frozen tenant is proven by the unit tests
(no command, no audit event, no mail; § *Proofs*); the probes are also chosen so that even an unfrozen writer reaches
none of them. The comparison script, extracted from this document, was run by the builder on synthetic inventory files of
the four kinds (EXECUTED): the same entries in another order → `CONTENT EQUAL`, status 0; one key removed → `CHANGED:
TENANT#t ORDER#o1 dd -> absent`, `CONTENT CHANGED`, status 1; a file that is not an inventory → `NOT INVENTORIES`,
status 2. Against real inventories it is NOT RUN (the operator's).

**For `cmrc-3`**, the same order with the copy: freeze deploy → drain → step 4 → `migrate` → `verify --strict` (P1,
content equality of the two tables, the manifest) → steps 5-8 (P2; then P1 again) → `cmrc-4`. The freeze record
(`cmrc-1.md` § 6, Q6 note) is: the time of the freeze deploy's completion, the end of the drain, the outputs of steps
6-8 and their inventories' SHA-256 lines, and the time of the release deploy.

## Migration / deployment notes

- No data migration. No IAM change. The staging diff shows, in the `CommerceApi` nested stack only: five
  `AWS::Lambda::Function` resources (`CreateOrderFunc…`, `UpdateOrderStatusFunc…`, `UpdateOrderFunc…`,
  `UpdateCustomerFunc…`, `PublicUpdateCustomerFunc…`) with a new `Environment.Variables.COMMERCE_WRITE_FREEZE_TENANTS`
  (`""`) and a new code asset (the guard). INFERRED from the template test; the real diff is the operator's to read.
- The shipped state is the empty list: no tenant is frozen, every answer is the golden's.
- Rollback: redeploy the previous commit (the variable and the guard go; nothing was written by them). A freeze is
  released by a deploy with an empty list.
- Production: the same `./deploy.sh prod` with no variable set — the shipped state. A production freeze is a step of
  `cmrc-3`, not of this slice.

## Definition of Done

- [x] Writer list re-derived; position table; D3 decided and recorded.
- [x] Parser and refusal in one module, tested.
- [x] Each writer: test red before the guard, green after; T1b unchanged.
- [x] Readers' tests; callers recorded; admin test.
- [x] Infra variable on exactly the five writer functions; template test.
- [x] Docs: this file, `backend/ARCHITECTURE.md`, `infra/ARCHITECTURE.md`, `docs/commerce.md`, `docs/slices/cmrc-1.md`,
      `docs/ROADMAP.md`, `CURRENT_SLICE.md`.
- [x] Gates of § *Build record*.
- [ ] Operator staging procedure steps 1-9 and its pass condition. NOT RUN by the builder.

## Evidence required

- EXECUTED by the builder: the gates of § *Build record*.
- NOT RUN, the operator's: the staging procedure — the first proof against AWS that the variable reaches the five
  functions from `./deploy.sh`, that Lambda accepts the empty value, and that the probes answer as stated.

## Exit criterion

`cmrc-3` (copy under the freeze) can run on staging: freeze deploy → drain → copy → `verify --strict` → (`cmrc-4`) →
release.

## Deviations and local decisions

- **W1's guard precedes its origin check**, not only the order-counter UpdateItem that § 6 names: the origin check
  sends a DynamoDB Query, and the packet asks for no command of any kind. Recorded with its cost in § *Item 2*.
- **The guard is one rule, not five positions**: after the tenant header, the presence checks before it and the role
  check; before the first I/O call. So W2-W5 refuse before parsing the body: a frozen tenant's malformed request gets
  503, not 400. Harmless; it makes the probes of § *Operator procedure* possible.
- **`(cmrc1b-2)` changed (`infra/test/amodx-stack.test.ts`)**: its rule "no function variable whose name matches
  `/COMMERCE/i`" was written to refuse the variable `cmrc-4` will add (`COMMERCE_TABLE_NAME`); it also refused
  `COMMERCE_WRITE_FREEZE_TENANTS`, whose name § 6 fixes and which names no table. Class: a name filter wider than the
  claim it guards. Rule now: no variable whose name speaks of a commerce TABLE (`/COMMERCE.*TABLE|TABLE.*COMMERCE/i`),
  with two controls (it matches `COMMERCE_TABLE_NAME`, `COMMERCE_TABLE`, `TABLE_NAME_COMMERCE`; it does not match the
  freeze variable or `TABLE_NAME`). The value check (no value names `AmodxCommerceTable`) is unchanged. The test's
  name still says what it proves.
- **`infra/deploy.sh` changed** (three lines and the usage text): without it the operator could set the list only by
  calling `npx cdk deploy` directly, which skips the three public renderer variables the script exists for (a broken
  renderer). The script now always passes `-c commerceWriteFreezeTenants=<value or empty>` and prints the list.
  Precedent for an operator environment variable in the script: `AWS_REGION`. The CDK CLI parses `key=` as the empty
  text (OBSERVED: `node_modules/aws-cdk/lib/cli/user-configuration.js:284`, `split(/=(.*)/, 2)`).
- **Order of the round**: W3 and W4 got their guards in one edit, then the tests ran (W1, W2 and W5 one at a time).
- **`docs/TECH-DEBT.md`** got § *CMRC-2B residuals* (`docs/documentation.md` reconciliation rule 4); not in the
  packet's list of documents.
- **Not done, surfaced:** F-CMRC2A-STALE-COMMENT (a stale sentence in the header of `commerce-db.ts`) is recorded in
  `docs/TECH-DEBT.md` as "correct it in `cmrc-2b`", but this slice's packet does not allocate `commerce-db.ts`. Left
  open.

## Review-0: findings, classes and rules (revision 1, 2026-11-28)

| Finding | Class of defect | Rule now | Proof |
|---|---|---|---|
| R1: the `switch` over `CommerceWriteFreeze` was claimed exhaustive, but the function returns `… \| undefined` and the backend compiles without `noImplicitReturns`: a fourth variant compiled clean and fell through to `undefined` ("not frozen") | an exhaustiveness claim that rests on a compiler option the package does not set | every `switch` over a domain sum that this slice adds ends with `const unhandled: never = <value>`; the unreachable path refuses (fail closed). It does not depend on `noImplicitReturns`. The slice adds one such `switch`; the `cmrc-2a` tool's own `tsconfig.json` sets `noImplicitReturns` (OBSERVED), so its claim is not an instance. Enabling `noImplicitReturns` for the whole backend is a package-wide change outside this slice (finding F-CMRC2B-NO-IMPLICIT-RETURNS) | EXECUTED in a temporary directory `backend/CMRC-2B-mutation` (removed) with the backend's `tsconfig.json`: the module as is → exit 0; the module with a fourth variant `{ kind: "newState" }` → exit 2, `error TS2322: Type '{ kind: "newState"; }' is not assignable to type 'never'`; control, the same mutant without the check → exit 0 |
| R2: "the API has no other 503 answer" was false; the search matched only the literal `statusCode: 503` | an inventory search that matched one spelling of the thing and was reported as complete | an inventory of answers searches the status number in every form (`(?<![0-9])503(?![0-9])`), then reads each helper that builds them, and states the search's limit | § *Item 2*, "No `Retry-After`" (table of the 16 answers and their helpers) |
| R3: the staging "no change" check was product reads, which do not show the order counter, the index or unprojected fields | an equality claim checked through a view that shows less than the claim covers | content equality is checked over the stored items of all four kinds (key set + SHA-256 of each whole item), before and after, by the `cmrc-2a` tool's read-only `plan` mode; product reads stay a separate check | § *Operator procedure*, steps 4 and 8 and the pass condition |

## Abstraction record

| What | Concrete users | Axis | Simpler alternative rejected |
|---|---|---|---|
| `backend/src/lib/commerce-freeze.ts` (module) | W1-W5 (five handlers) | one freeze rule shared by five writers; the malformed-list rule D3 must not drift | the parsing inline in each handler (five copies of D3) |
| `CommerceWriteFreeze` (closed sum, matched with no `default` arm) | `commerceWriteFreezeRefusal`, the parser tests | variants fixed (none / tenants / unreadable), operations may grow | a boolean (the log could not say WHY a tenant is frozen; an unreadable list would look like a listed one) |
| `CommerceApi` prop `commerceWriteFreezeTenants` | `amodx-stack.ts` (composition root) | a per-deploy input, as the stage | reading the context inside the nested stack (a hidden input) |

## Build record

Builder `claude-opus-5-5`, 2026-11-28, baseline `404927e`. Not committed.

**Files**

| Path | Why (item) |
|---|---|
| `backend/src/lib/commerce-freeze.ts` (new) | item 2: parser, refusal, text |
| `backend/src/orders/create.ts`, `orders/update-status.ts`, `orders/update.ts`, `customers/update.ts`, `customers/public-update.ts` | item 2: one import, one guard each (5-6 lines) |
| `backend/test/unit/cmrc-2b-write-freeze.test.ts`, `cmrc-2b-commerce-freeze.test.ts`, `cmrc-2b-self-service-readers.test.ts` (new) | items 3 and 7 |
| `admin/src/lib/api.test.ts` | item 4: the admin's answer to the 503 |
| `infra/lib/api-commerce.ts`, `infra/lib/amodx-stack.ts`, `infra/deploy.sh` | item 5 |
| `infra/test/amodx-stack.test.ts` | item 5: `(cmrc2b-1)`, `(cmrc2b-2)`; `(cmrc1b-2)` rule (§ *Deviations*) |
| this file, `backend/ARCHITECTURE.md`, `infra/ARCHITECTURE.md`, `docs/commerce.md`, `docs/slices/cmrc-1.md`, `docs/ROADMAP.md`, `CURRENT_SLICE.md`, `docs/TECH-DEBT.md` | item 9 |

Not changed: `renderer/`, `packages/`, `tools/`, `backend/test/unit/fixtures/` (the golden), the serving captures,
`tools/mcp-server/routes.json` (no route changed).

**Gates** (EXECUTED, 2026-11-28, in this order, on the changed tree):

| Command | Exit | Result |
|---|---|---|
| `npm run build` | 0 | all workspaces |
| `npm run typecheck` | 0 | all steps |
| `npm --prefix backend run test:unit` | 0 | 109 files passed, 3 skipped; 3073 tests passed, 3 skipped |
| `cd admin && npm run test:unit` | 0 | 33 files, 513 tests |
| `cd renderer && npm test` | 0 | 69 files, 1150 tests |
| `cd renderer && npm run test:serving` | 0 | 176 pass, 0 fail |
| `cd renderer && npm run test:serving-bundle` | 0 | 61 pass, 0 fail; no capture changed (`git status` shows no file under `renderer/`) |
| `cd infra && npm test` | 1, then 0 | first run: `(cmrc1b-2)` failed on the variable name (§ *Deviations*); after the rule change 101 passed. Counts unchanged: parent 413 / 53 functions, `CommerceApi` 239 / 39 |
| `cd tools/mcp-server && npm test` | 0 | 23 pass |
| `git add -N <5 new files> && git diff --check`, index restored | 0 | no whitespace error |

Red before the guards (EXECUTED): `npx vitest run --config vitest.unit.config.ts test/unit/cmrc-2b-write-freeze.test.ts`
→ 51 failed, 99 passed (150). After W1: 36 failed; after W2: 28; after W3 + W4: 9; after W5: 0. T1b
(`cmrc-1-command-trace.test.ts`) passed in each of these runs.

**Revision 1 (after review-0), EXECUTED on the revised tree, same order:** `npm run build` 0; `npm run typecheck` 0;
`npm --prefix backend run test:unit` 0 (3073 passed, 3 skipped); `cd admin && npm run test:unit` 0 (513);
`cd renderer && npm test` 0 (1150); `npm run test:serving` 0 (176 pass); `npm run test:serving-bundle` 0 (61 pass; no
file under `renderer/` changed); `cd infra && npm test` 0 (101 passed); `cd tools/mcp-server && npm test` 0 (23 pass);
`git add -N <5 new files> && git diff --check` 0, index restored (0 staged paths). Plus the R1 compile-negative
mutation and the R3 comparison-script runs of § *Review-0*. The only code change of the revision is the `never` check
in `backend/src/lib/commerce-freeze.ts`.

**Not run:** the operator's staging procedure (needs AWS). `cd backend && npm test` (writes to the staging database;
forbidden by the packet). No end-to-end test runs a deployed function: the guard's end-to-end proof is P2 on staging.

## References

`docs/slices/cmrc-1.md` § 6; `docs/slices/cmrc-1a.md` (the module and T1b); `docs/slices/cmrc-2a.md` (the tool);
`docs/platform-decisions.md` (PD-001, PD-002); `CLAUDE.md` critical rules 2, 3, 10.

## Closeout (operator, 2026-11-28)

- Relay: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, two cycles; review-0 `revise` (R1 exhaustiveness, R2 the
  503 inventory, R3 content preservation in the operator procedure), review-1 `approved`.
- Operator gates on the approved tree, each exit 0: build, typecheck, shared, plugins, renderer, serving (176),
  serving-bundle (61), admin unit, backend unit, infra, mcp, `git diff --check`; no change under `backend/src/auth`,
  `backend/src/lib/commerce-db.ts`, the trace golden, `renderer`, `packages`, `tools`, `scripts`, a manifest or a
  lockfile.
- Staging diff (read before the deploy): 0 resources added, 0 removed, no IAM change; `COMMERCE_WRITE_FREEZE_TENANTS`
  added, with an empty value, to exactly five functions: `CreateOrderFunc`, `UpdateOrderStatusFunc`,
  `UpdateOrderFunc`, `UpdateCustomerFunc`, `PublicUpdateCustomerFunc`.
- Staging procedure, run by the operator with the staging test admin (`GLOBAL_ADMIN`) in place of the master key,
  `T` = `cm1-commerce`, `U` = `cm1-catalog`, four synthetic items of `T` seeded in `AmodxTable-staging` (an order,
  its index row, a profile, the order counter — the shop had none) and deleted after:
  1. deploy with an empty list: succeeded;
  2. deploy with `COMMERCE_WRITE_FREEZE_TENANTS=cm1-commerce`: succeeded (the script printed the list); 60 s drain;
  3. inventory before (the `cmrc-2a` tool, `plan`, read-only): GREEN, 4 items, one of each kind;
  4. reads of the frozen shop: `GET /orders`, `/orders/{id}`, `/customers`, `/customers/{email}`,
     `/reports/summary` and the three `POST /customer/*` routes answer 200;
  5. the five writers of the frozen shop answer 503 `commerceFrozen`;
  6. the same five probes for `cm1-catalog` answer their normal refusals (403, 400, 400, 500, 400), never 503;
  7. inventory after: GREEN; key by key the same hashes as before: CONTENT EQUAL;
  8. release deploy (empty list): succeeded; the five probes for `cm1-commerce` answer their normal refusals again;
  9. the seeds are deleted; the general smoke and the order page check pass on the released stage.
- NOT proven on staging: a frozen checkout as a visitor sees it, and the frozen profile save through the renderer
  (the public routes refuse a scripted request before the form is reached; W1 and W5 were probed at the API).
- Findings kept open (recorded by the build): F-CMRC2B-CHECKOUT-TEXT (the visitor of a frozen shop sees the English
  sentence, as for the other refusals of the checkout route), F-CMRC2B-PROFILE-SILENT, F-CMRC2B-MCP-REASON.
