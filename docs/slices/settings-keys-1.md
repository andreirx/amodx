# SETTINGS-KEYS-1 — `PUT /settings` let the request body choose the item it wrote; the handler now names the item

Status: **STAGING VERIFIED 2026-10-28 — SETTINGS-KEYS-1 (§ 11) + SETTINGS-KEYS-1B (§ 12.9)**; both reviewed and approved, operator gates green, staging deploys 11:32:55Z and 12:13:50Z, live before/after witnesses for the key, index-key and hostname vectors; **prod on the human's word, not on prod.** Previous line: "Status: **STAGING VERIFIED 2026-10-28 (§ 11)** — review approved (cycle 1), D-SK-1 ratified A (§ 7), operator gates green, staging deploy 11:32:55Z, live before/after witnesses recorded (§ 11); **prod on the human's word, not on prod.** Previous line: 'Status: **IMPLEMENTED 2026-10-28** — code complete, unit oracles exit 0 (§ 5). Review, staging deploy and the live after-witness (§ 3.2) are pending. Not on prod. Track: F (security fix-first slice, found during the `catalog-mode-1` review; `docs/ROADMAP.md` Track F — the operator adds the row). Depends: none. `requireRole` (`backend/src/auth/policy.ts`) and the secret deep-merge are used as they are. Source plan: none — the operator's builder packet of 2026-10-28 is the plan. Maturity target: the handler keeps its current maturity. The slice removes a defect and changes no feature.'"

## 1. The defect

`backend/src/tenant/settings.ts` `_updateHandler` (HEAD `59ad9aa`) bound the caller to the tenant correctly
(`requireRole(auth, ["TENANT_ADMIN", "GLOBAL_ADMIN"], tenantId)`), but then let the request body choose the item it
wrote:

- `const body = JSON.parse(event.body)` — no schema, no key removed;
- `const merged = { ...current, ...body }`;
- `Item: { PK: "SYSTEM", SK: \`TENANT#${tenantId}\`, ...merged }`.

In an object literal, a later spread wins. A body that carried `PK` or `SK` therefore selected **which item of the
single table was written**. A body `id` relabelled the tenant record (the renderer's `mapTenant`,
`renderer/src/lib/dynamo.ts:141`, copies `item.id` as the tenant id). `Domain` is derived from `domain` by the handler.

Effects, with the role check passed:

| Body | Item written before this slice |
|---|---|
| `{ SK: "TENANT#B", ... }` from a TENANT_ADMIN of A | B's tenant record (`SYSTEM`/`TENANT#B`) — cross-tenant overwrite |
| `{ PK: "TENANT#A", SK: "PRODUCT#x", price: "999" }` | a product item in A's partition, with a price, written outside the product handlers |
| `{ PK: "SYSTEM", SK: "TENANT#new", id: "new", domain: "new.invalid" }` | a NEW tenant record — tenant creation is a GLOBAL_ADMIN-only route (`tenant/create.ts`) |
| `{ id: "B" }` | A's record, now carrying B's id |

**Live witness (operator, staging, 2026-10-28 11:08:57Z):** `PUT /settings` with `x-tenant-id: cache-probe-2026` and
body `{ PK: "SYSTEM", SK: "TENANT#settings-keys-1-witness", id: "settings-keys-1-witness",
domain: "settings-keys-1-witness.invalid", name: "SETTINGS-KEYS-1 witness" }` answered **200 "Settings Saved"**.
`get-item` on `AmodxTable-staging` returned that new item (`updatedBy` = the caller's sub). The caller's own record was
not changed. The item was deleted at 11:09:40Z. Prod runs the same handler.

**In-memory reproduction (reviewer gpt-6.1-sol, CATALOG-MODE-1 review-3; real handler and `requireRole`, I/O mocked):**
TENANT_ADMIN of A with `SK: TENANT#B` → 200, write targets B; `PK: TENANT#A, SK: PRODUCT#x, price: "999"` → 200, a
priced product item is written; `id: B` → 200, A's record carries B's id.

**Class sweep (operator):** a grep of every bare spread inside a written item in `backend/src`, with the origin of each
spread read per site. This is the only site. Every other handler spreads a zod-parsed `input` (zod 4.6.7 objects strip
unknown keys) or sets its keys again after the spread (`forms/update.ts:57-64`, "Preserve immutable fields"). Basis: a
text search plus a per-site reading, not a compiler query — a spread built through an intermediate variable with
another name would be found only if that variable was read.

## 2. The fix — the rule

**The body never names the item; the handler does.** Two parts, each enough for the key binding alone, kept together
because each covers a different field set:

1. **Server-owned fields are removed from the body before the merge.** One named constant,
   `SERVER_OWNED_FIELDS = ["PK", "SK", "id", "Domain", "createdAt", "createdBy"]` (`settings.ts:20`, with the reason in
   its comment, `:11-19`). These are the fields that `tenant/create.ts` sets and no client may set. The removal is at
   `settings.ts:102-103`. So `createdAt`/`createdBy` come from the stored record through the merge, and `Domain` stays
   derived from `merged.domain` (`:137-139`) as before.
2. **The written item sets its keys last** (`settings.ts:144-149`):
   `Item: { ...merged, PK: "SYSTEM", SK: \`TENANT#${tenantId}\`, id: tenantId }`. The record's `id` equals the SK suffix
   (`tenant/create.ts:29,35,147`), so binding `id` changes nothing for an honest caller. `tenantId` is the `x-tenant-id`
   value that `requireRole` has just checked against the caller's token.

**Audit trace.** When the body carried any server-owned field, the existing `UPDATE_SETTINGS` audit row's `details`
gains `rejectedFields: [<names>]` (`settings.ts:157-161`). `updatedFields` is still `Object.keys(body)`, now read after
the removal, so it lists only the fields that were applied; a removed name appears in `rejectedFields` and not in
`updatedFields`. This is a change to the audit content for any body that carried a server-owned field (see § 7, D-SK-1).

Unchanged: status codes; the role list; the secret deep-merge (`settings.ts:113-131`); `GET /settings`; no schema
validation of the config content (`catalog-mode-1` adds a narrow one later).

## 3. Proof

### 3.1 Unit rows — `backend/test/unit/settings-keys.test.ts`

House style of `service-key-handlers.test.ts`: the real `updateHandler` and real `requireRole`; only `db.js` (`send`)
and `events.js` (`publishAudit`) are mocked; the `@aws-sdk/lib-dynamodb` command classes are real, so each row reads
the exact `PutCommand` input. `withInvalidation` is real too: after a 2xx it writes the cache markers
`SYSTEM/CDN_PENDING` (Update) and `SYSTEM/CDN_LAST_CHANGE` (Put) through the mocked `db`. The mocked `GetCommand`
answer for `current` is a record with `PK`, `SK`, `id`, `domain`, `Domain`, `createdAt`, `createdBy` and two secrets.
"No second item written" is asserted exactly: the sorted list of keys of every write command must equal
`[SYSTEM/CDN_LAST_CHANGE, SYSTEM/CDN_PENDING, SYSTEM/TENANT#t1]`.

| Row | Body (TENANT_ADMIN of `t1` unless stated) | Asserted |
|---|---|---|
| (a) | `{ SK: "TENANT#t2", name: "x" }` | 200; Get `Key` and Put `Item.PK`/`Item.SK` are `SYSTEM`/`TENANT#t1`; `Item.id === "t1"`; `createdAt`/`createdBy` from the record; only the expected writes; audit `{ updatedFields: ["name"], rejectedFields: ["SK"] }` |
| (b) | `{ PK: "TENANT#t1", SK: "PRODUCT#p", price: "999" }` | 200; Put targets `SYSTEM`/`TENANT#t1`; `Item.price === "999"` only as an ordinary config field on the tenant record (the test name states that config content is not validated here); audit `rejectedFields: ["PK", "SK"]` |
| (c) | `{ id: "t2" }` | 200; `Item.id === "t1"`; audit `{ updatedFields: [], rejectedFields: ["id"] }` |
| (d) | `{ name: "New", recaptcha: { siteKey: "s" } }` | 200; `Item.recaptcha` is `{ siteKey: "s", secretKey: "RC_SECRET" }`; `integrations.google.clientSecret` kept; audit has no `rejectedFields` |
| (e) | EDITOR of `t1`, `{ SK: "TENANT#t2", name: "x" }` | 403; no DynamoDB call; no audit |
| (f) | the `admin/src/pages/Settings.tsx` echo: the whole record minus secrets, `name` changed | 200; `Item` equals the stored record with the new name, `updatedBy`, `updatedAt` (keys and secrets kept); audit `rejectedFields` lists all six names — this pins the main honest caller (preservation) and the audit consequence of § 7 |

Row (f) is beyond the packet's five rows. It is preservation work: `Settings.tsx` is the main caller and its body
always carries the server-owned fields (§ 6).

**The rows detect the defect** (EXECUTED 2026-10-28): the same test file was run against the unchanged handler at HEAD
`59ad9aa`, in a temporary worktree (`/tmp/SETTINGS-KEYS-1-baseline`, removed after). Result: 4 failed, 2 passed.

| Row | Baseline result | First failing assertion |
|---|---|---|
| (a) | failed | `expected 'TENANT#t2' to be 'TENANT#t1'` — the write targeted t2 |
| (b) | failed | `expected 'TENANT#t1' to be 'SYSTEM'` — the write was the product-shaped item |
| (c) | failed | `expected 't2' to be 't1'` — the record was relabelled |
| (f) | failed | audit only (test line 173); the item assertion passed — the echo names the caller's own keys, so the baseline write was already correct |
| (d), (e) | passed | — the behaviour this slice must not change |

### 3.2 Live witness on staging (operator)

- **Before:** § 1 (2026-10-28 11:08:57Z): the new item `SYSTEM`/`TENANT#settings-keys-1-witness` was created.
- **After (to run after the staging deploy):** the same call, `PUT /settings` with `x-tenant-id: cache-probe-2026` and
  body `{ PK: "SYSTEM", SK: "TENANT#settings-keys-1-witness" }`. Expected: 200; `get-item` for
  `SYSTEM`/`TENANT#settings-keys-1-witness` returns no item; the caller's own record `SYSTEM`/`TENANT#cache-probe-2026`
  carries the new `updatedAt`/`updatedBy` and still has `id: "cache-probe-2026"`; the audit row of the call carries
  `rejectedFields: ["PK", "SK"]`. Status: NOT RUN (operator's step).

## 4. Non-scope

No config validation. No other handler. No infra/CDK. No admin, renderer or MCP change. No renaming. No deploy.
Things noticed and not fixed are in § 8.

## 5. Implementation record (builder, 2026-10-28)

| # | Oracle / check | Result (last lines) | Label |
|---|---|---|---|
| 1 | `cd backend && npm run test:unit` | exit 0; `Test Files 31 passed (31)`, `Tests 399 passed (399)`; the six `settings-keys.test.ts` rows listed as passing | EXECUTED |
| 2 | `npm run typecheck` (root) | first run exit 2 — `packages/effects`: `Cannot find module '@amodx/shared'` (fresh worktree, no `packages/*/dist`; `CLAUDE.md` says typecheck needs a build first). After the builds below: exit 0, zero `error TS`; last output `> infra@0.1.0 typecheck` / `> tsc --noEmit` | EXECUTED |
| 3 | `git status --porcelain` | ` M backend/src/tenant/settings.ts`, `?? backend/test/unit/settings-keys.test.ts`, `?? docs/slices/settings-keys-1.md` | EXECUTED |
| 4 | `sed -n '/new PutCommand/,/}));/p' backend/src/tenant/settings.ts \| grep -n '\.\.\.merged,\|PK: "SYSTEM",\|id: tenantId'` | `4: ...merged,` / `5: PK: "SYSTEM",` / `7: id: tenantId,` — the keys come after the spread | EXECUTED |
| 5 | `git diff --check` | exit 0 | EXECUTED |

Repository Definition-of-Done builds, root order, `npm run build -w <workspace>`: `packages/shared`,
`packages/effects`, `packages/plugins`, `backend` — each exit 0, last line `> tsc`; `renderer` — exit 0, last output
the `next build` route legend. `cd tools/mcp-server && npm test` — exit 0, `PASS: every call targets a live route;
ARCHITECTURE.md tool count matches.` (no route changed; `routes.json` needs no refresh). Coverage note:
`backend/tsconfig.json` excludes `**/*.test.ts`, so oracle 2 does not type-check the test file; it was type-checked
separately with a temporary config that extends `backend/tsconfig.json` (strict) and includes only the test file —
exit 0. `backend/ARCHITECTURE.md`: not changed — it lists `settings.ts` only as a file-tree entry and does not describe
`PUT /settings` (packet item 4).

## 6. Callers (unaffected in what they save)

| Caller | What it sends | Effect of this slice |
|---|---|---|
| `admin/src/pages/Settings.tsx` `save()` (`:126-133`) | the whole `GET /settings` response (`load()`, `:89`), which is the stored item minus secrets — so it always carries `PK`, `SK`, `id`, `Domain`, `createdAt` (and `createdBy` if the record has one) | the echoed values are removed and set again by the server to the same values; the saved item is the same (row (f)); the audit row now lists them as `rejectedFields` |
| `admin/src/pages/OrderEmails.tsx` (`:133`) | `{ orderEmailConfig }` | none |
| `admin/src/pages/Labels.tsx` (`:66`) | `{ commerceStrings }` | none |
| `tools/mcp-server/src/index.ts` apply_theme (`:1940`) | `{ theme }` or `{ darkTheme }` | none |

Basis: a literal-string grep for `/settings` over `admin/src`, `renderer/src` and `tools/mcp-server/src`
(2026-10-28). A URL built at runtime from parts would not match, so the list is a verified subset, not a proof of
completeness.

Record shape (OBSERVED): `tenant/create.ts` passes the record through `TenantConfigSchema.parse` (zod strip mode). The
schema has `createdAt` (`packages/shared/src/index.ts:876`) but no `createdBy` or `ownerId`, so a record made by
`create.ts` has no `createdBy`. Keeping `createdBy` in the list costs nothing and protects it if another writer set it.

## 7. Decision for the operator — D-SK-1, the audit signal is noisy

**The problem.** The packet asks that "an attempt leaves a trace": `rejectedFields` is added when the body carried a
server-owned field. But the main honest caller (`Settings.tsx`, § 6) always sends those fields back. So every honest
full-page save writes `rejectedFields: ["PK", "SK", "id", "Domain", "createdAt", ...]`. An attack and an honest save
then look the same in the audit log, unless the reader compares the values, and the audit row does not carry the
values. Packet row (d) ("honest save → no `rejectedFields`") is true only for partial bodies such as `OrderEmails.tsx`,
`Labels.tsx` and the MCP server. The key binding (the security fix) is correct in all options below.

| Option | Risk | Reward |
|---|---|---|
| **A — keep as built** (record every server-owned name that was present) | the trace has no signal for `Settings.tsx` saves; a reviewer of the audit log must ignore it or compare by hand | exactly what the packet states; simplest; no value comparison |
| **B — record a name only when its body value differs from the value the server writes** (`PK` vs `"SYSTEM"`, `SK` vs `TENANT#<t>`, `id` vs `<t>`, the others vs `current`) | about five more lines; a "differs" rule for objects needs a defined comparison (all six fields are strings in practice) | an honest echo leaves no trace; an attempt does; row (f) changes to "no `rejectedFields`" |
| **C — stop the echo in the client** (`Settings.tsx` removes the six fields before `PUT`) | an admin change, out of this slice's scope; other clients could still echo | the server stays as built and the trace becomes meaningful for the admin |

Recommended: **B**, in a follow-up cycle of this slice, because it makes the trace mean what the packet wants without a
client change. Not blocking: the key binding does not depend on it.

**Ratified (operator, 2026-10-28, after the decision-review: challenge → concede, converged).** **A, as built**, ships in
this hotfix. Correction to A's risk cell: the trace is noise for `Settings.tsx` full-page saves, and B as written would
not separate honest saves from attempts either — a value mismatch is evidence, not intent (two admin tabs echo a stale
`Domain`). B is replaced by **B′** (the review's mismatch policy; `.agent-manager/…/ratification-packet.md`, builder
rebuttal), recorded as follow-up **SETTINGS-KEYS-2**, not scheduled: removal of every present server-owned field stays
unconditional; the logged list is built by comparison (`PK`/`SK`/`id` against the handler-bound values; `Domain`,
`createdAt`, `createdBy` against the stored record, absent-stored counts as mismatch); the audit field is named for what
it records (e.g. `mismatchedServerFields`); four new test rows (honest domain change not flagged; differing `Domain`
flagged and not written; absent stored `createdBy` flagged; matching echo leaves no field and is not written); row (f)
becomes "no mismatch field". C stays rejected: other clients could still echo.

## 8. Follow-ups (recorded, not done here)

- (a) **D-SK-1** (§ 7).
- (b) **`backend/ARCHITECTURE.md:115` route path is wrong.** The file-tree entry says `GET/PUT /tenant/settings`; the
  routes are `GET /settings` and `PUT /settings` (`infra/lib/api.ts:273,278`). Documentation fix only.
- (c) **No config validation on `PUT /settings`.** Any other field still passes through (row (b): `price` lands on the
  tenant record). `catalog-mode-1` plans a narrow schema.
- (d) **Malformed JSON body → 500.** `JSON.parse` is inside the outer try/catch, so a malformed body is answered with
  500, not 400. Behaviour before and after this slice is the same.
- (e) **Class guard.** A CI check that no written item spreads an unparsed request body before its keys. Not built.

## 9. Architectural boundaries, migration, exit

- Boundaries: tenant isolation (`CLAUDE.md` Critical Rule 3) — the written key now always comes from the checked
  `x-tenant-id`. No new abstraction: one constant and the "Preserve immutable fields" shape of `forms/update.ts`. No
  scan, no new DB operation (the Get and Put are the same commands with the same keys).
- Migration / deployment: no data migration, no infra change. Deploy is the operator's job (staging, then § 3.2, then
  prod on the human's word). Expected `cdk diff`: the settings update Lambda plus the per-deploy renderer/admin assets.
  Rollback: revert the `settings.ts` hunks.
- Exit criterion: no `PUT /settings` body can write an item other than the caller's own tenant record, or change that
  record's `id`, `createdAt`, `createdBy` or derived `Domain`.

## 10. References

`backend/src/tenant/settings.ts`, `backend/src/tenant/create.ts`, `backend/src/forms/update.ts:57-64`,
`backend/src/auth/policy.ts`, `backend/test/unit/service-key-handlers.test.ts` (test style),
`docs/slices/tenant-bind-1.md` (previous fix-first security slice), `docs/slices/catalog-mode-1.md`.

## 11. Operator record (2026-10-28) — review, gates, staging deploy, live witnesses

- **Review:** `gpt-6.1-sol`, cycle 1 `approved` (no blocking findings; the live after-witness assigned to the operator).
  Decision-review on D-SK-1: challenge → concede, converged; ratified above (§ 7): A as built, B′ as follow-up
  SETTINGS-KEYS-2. Builder `claude-opus-5-5`. Relay trail under `.agent-manager/slices/SETTINGS-KEYS-1/` (local).
- **Operator gates on the approved tree** (worktree `amodx-hotfix`, branch `settings-keys-1`; log `sk1-gates.log`):
  `npm run test:unit` exit 0 — 31 files, 399 tests (the six new rows among them); root `npm run typecheck` exit 0;
  `git diff --check` exit 0; oracle 4 prints `...merged,` (4), `PK: "SYSTEM",` (5), `id: tenantId,` (7); porcelain
  exactly the three paths; MCP `npm test` exit 0 (no route changed).
- **Staging `cdk diff`** (`AmodxStack-staging`): code change on `Api/GetSettingsFunc` and `Api/UpdateSettingsFunc` (they
  share the handler bundle); the renderer/admin bundle hashes also changed because this is a fresh worktree build (new
  build id), and three nested-stack *descriptions* changed from a mojibake `?` to `—` (cosmetic). No resource added or
  removed.
- **Staging deploy:** exit 0, `UPDATE_COMPLETE` 11:34:33 local; both settings functions `LastModified`
  2026-10-28T11:32:55Z.
- **Live witnesses on staging** (`AmodxTable-staging`, tenant `cache-probe-2026`, the mandated staging admin):
  - BEFORE the fix (11:08:57Z): `PUT /settings` with body `PK/SK/id/domain/name` naming `TENANT#settings-keys-1-witness`
    → 200; `get-item` on that key returned a new item (`name`, `domain`, `id`, `updatedBy` = the caller); the caller's own
    record untouched. Item deleted 11:09:40Z. The audit row for that save lists `updatedFields: ["PK","SK","id","domain","name"]`
    and no `rejectedFields`.
  - AFTER the fix (11:35:06Z): the same call with body `{ PK, SK, id }` only → 200; `get-item` on the witness key:
    **absent**; the caller's own record keeps `id`, `name`, `domain`; the audit row: `updatedFields: []`,
    `rejectedFields: ["PK","SK","id"]`.
- **Not proven on prod** (prod on the human's word): the same read-only checks are run after the prod deploy
  (`LastModified` of the two functions, bundle grep for `SERVER_OWNED_FIELDS`, CloudWatch errors, one GLOBAL_ADMIN
  `GET /settings`).

## 12. SETTINGS-KEYS-1B — index keys and hostnames

Builder packet (operator, 2026-10-28). Same rule as §§ 1–2, two more vectors. The two public readers are on the
CommerceApi (`infra/lib/api-commerce.ts:187,201`): this is the third named exception to the commerce freeze (security,
ruled by the human 2026-10-28).

### 12.1 The defects

- **Vector 1 — index-key impersonation.** §§ 1–2 removed `PK, SK, id, Domain, createdAt, createdBy` from the body, but
  the table has four GSIs (`infra/lib/database.ts:27-51`) whose key attributes stayed writable through `PUT /settings`:
  `GSI_Domain` (`Domain`/`PK`), `GSI_Type` (`Type`/`CreatedAt`), `GSI_Status` (`Status`/`ScheduledFor`), `GSI_Slug`
  (`TenantSlug`, projection ALL). `GET /public/products/{slug}` and `GET /public/categories/{slug}` query `GSI_Slug` by
  `<tenantId>#<slug>`, filter on `Type`, and took `Items[0]` without a check that the hit is in that tenant's partition
  or is a product/category item. Witness (reviewer `gpt-6.1-sol`, real handlers, I/O mocked): a tenant-A admin saved
  `{ TenantSlug: "<B>#probe", Type: "Product", status: "active", price: "999" }`; A's settings record — secrets
  included — became the public answer for tenant B's slug `probe`. The category variant likewise. The builder
  reproduced it: the new rows (f)/(h-f) run against the HEAD handlers return **200 with the tenant record** (§ 12.6).
  Staging holds no poisoned record (operator: 482 tenant records, none with `TenantSlug`/`Type`/`Status`); prod is
  unchecked.
- **Vector 2 — hostname claim.** `domain` is a legitimate settings field, but nothing checked that the hostname is free
  (`tenant/create.ts` checks only the tenant id). Three functions read `GSI_Domain` by host; two of them resolve a
  tenant identity and take the first hit, one only tests existence:
  - `renderer/src/lib/dynamo.ts:98-106` `getTenantConfig` — identity resolver: `FilterExpression begins_with(SK,
    "TENANT#")`, then `mapTenant(Items[0])`.
  - `backend/src/lib/tenant-verify.ts:38` `getTenantByDomain` (origin verification for public forms) — identity
    resolver: no `TENANT#` filter, `ProjectionExpression: "id"`, then `Items[0].id`.
  - `renderer/src/lib/tenant-directory.ts:95` `isWiredTenantHost` — existence check, not a resolver: same key and
    filter as `getTenantConfig`, but `Select: "COUNT"`; it returns `Count > 0` and never chooses a tenant. A duplicate
    hostname does not change its answer.

  Witness (operator, staging, two throwaway tenants, deleted after): `PUT /settings` for X with `{ domain: "<Y's
  hostname>" }` → 200; the `getTenantConfig` query for Y's hostname then returned **2** tenant records. The index sort
  key is `PK` (= `SYSTEM` for both), so which record the two identity resolvers take first is undefined.

### 12.2 The rule

**No request field may name a key of the table or of any GSI.** `SERVER_OWNED_FIELDS` (`backend/src/tenant/settings.ts:26-29`)
now holds eleven names: the six of § 2 plus `Type`, `CreatedAt`, `Status`, `ScheduledFor`, `TenantSlug`. They are
removed from the body before the merge and listed in the audit `rejectedFields`, as in § 2. Lower-case `status`,
`price` etc. are not key names and still pass through as config (§ 8 (c), no config validation).

### 12.3 The readers' check

`backend/src/products/public-get.ts:28-30` and `backend/src/categories/public-get.ts:29-31` accept an index hit only if
`hit.PK === "TENANT#<tenantId>"` and `hit.SK` starts with `PRODUCT#` / `CATEGORY#` (`Items.find(...)`, the shape of
`renderer/src/lib/dynamo.ts:241,258` and `import/woocommerce.ts:19`). Otherwise the answer is the existing 404 ("Product
not found" / "Category not found"). The `Type` filter stays. The response shape is unchanged. Basis: `products/create.ts:55-57`
and `categories/create.ts:52-54` write these items with exactly `PK: TENANT#<tenantId>`, `SK: PRODUCT#<id>` /
`CATEGORY#<id>`, `TenantSlug: <tenantId>#<slug>`. The reader check is defence in depth: it also neutralises a record
poisoned before this fix (prod is unchecked), which the write rule alone cannot do.

### 12.4 The hostname rule and its named windows

**Guarantee scope: best-effort.** The rule rejects a hostname claim when another tenant's record is *visible in
`GSI_Domain` at the time of the check*. It does not guarantee that a hostname belongs to at most one tenant. § 12.7 (a)
is the item that would give that guarantee.

`backend/src/tenant/settings.ts:142-164`: when the merged `domain` is non-empty and differs from `current.domain`, the
handler queries `GSI_Domain` with `Domain = <new>` and `FilterExpression begins_with(SK, "TENANT#")` (the query of
`getTenantConfig`). If any hit has `SK !== "TENANT#<tenantId>"`, it answers **409** `{ error: "The domain \"<host>\"
is already used by another site." }` and returns before the Put, the audit and the CDN markers (`withInvalidation`
runs only after a 2xx). The admin Settings page shows the message: `apiRequest` throws `API Error (409): <error>` and
`save()` puts it in `setError` (`admin/src/lib/api.ts:37-53`, `admin/src/pages/Settings.tsx:126-140`; OBSERVED in code,
not exercised in a browser).

- An unchanged `domain` sends no query (row (e)). A tenant that already shares a hostname (possible before this fix)
  can still save its other settings; the duplicate is not resolved here.
- IAM: `UpdateSettingsFunc` has `grantReadWriteData` (`infra/lib/api.ts:270`); CDK adds `<table>/index/*` to table
  grants when the table has GSIs (OBSERVED in `node_modules/aws-cdk-lib/aws-dynamodb/lib/table.js`). No infra change.
- One Query page (≤ 1 MB) is read, as the three `GSI_Domain` readers do. The `localhost` partition also holds `ROUTE#` items
  (`content/create.ts:121` writes `Domain: "localhost"`), but the index sorts by `PK` and `SYSTEM` sorts before `TENANT#`
  (byte order `S` < `T`), so the tenant records are on the first page (INFERRED from DynamoDB sort-key ordering).
- **Named windows (not excluded).** Two tenants can both store the same new hostname in two ways:
  1. *Overlapping requests (check-then-write).* Both requests run their Query before either Put lands. Each sees no
     other holder and writes.
  2. *Index propagation lag — also for sequential requests.* `GSI_Domain` is a global secondary index, and GSIs support
     only eventually consistent reads (`@aws-sdk/client-dynamodb` `QueryCommand.d.ts:75-80`, OBSERVED). After the
     first tenant's Put has completed and returned 200, the item can still be absent from the index for a short time.
     A second request that starts after the first has finished, but inside this lag, also sees no holder and writes.
     Reviewer-EXECUTED (review-0, real handlers, stale index simulated): two sequential, non-overlapping requests both
     returned 200 and both stored `Domain: "new.example"`. The length of the lag in production is not determined here.

  Follow-up 12.7 (a) closes both windows; it is not built here.

### 12.5 Test rows — `backend/test/unit/settings-keys-1b.test.ts`

Same style as § 3.1: real handlers, real `requireRole`, `withInvalidation`, `catprod.ts`, `availability.ts`; only
`db.js` `send` and `events.js` `publishAudit` mocked.

| Row | Input | Expected |
|-----|-------|----------|
| (a) | body `{ TenantSlug: "t2#probe", Type: "Product", status: "active", price: "999" }` | 200; the Put has none of the five index names; audit `rejectedFields: ["Type","TenantSlug"]` |
| (a′) | body naming all five index names + `name` | 200; none written; `rejectedFields` lists all five |
| (b) | `{ domain: "taken.example" }`, `GSI_Domain` hit `SK: TENANT#t2` | 409 with `error`; the Query has the `getTenantConfig` shape; no write, no audit |
| (c) | same, only hit `SK: TENANT#t1` (own record) | 200; `Domain` written |
| (d) | `{ domain: "free.example" }`, no hit | 200; `Domain` written |
| (e) | unchanged `domain` | 200; no `GSI_Domain` query |
| (f) | products: only `GSI_Slug` hit `{ PK: "SYSTEM", SK: "TENANT#t1", Type: "Product", status: "active", price: "999", recaptcha: { secretKey: "S" } }` | 404 "Product not found"; body without `secretKey` |
| (g) | products: poisoned hit, then a real `TENANT#t2`/`PRODUCT#p1` hit | 200 with the product |
| (h-f) / (h-g) | categories: mirror of (f) / (g) | 404 "Category not found" / 200 with `category` |

Row (a′) is one row beyond the packet: with the packet body, `CreatedAt`/`Status`/`ScheduledFor` are absent from the
Put trivially; (a′) proves all five are stripped.

### 12.6 Implementation record (builder `claude-opus-5-5`, 2026-10-28)

Worktree `amodx-hotfix`, branch `settings-keys-1`, base `a1fbacf`. Uncommitted.

- `cd backend && npm run test:unit` → EXECUTED, exit 0: `Test Files  32 passed (32)`, `Tests  409 passed (409)` (the
  ten § 12.5 rows and the six § 3.1 rows among them).
- Negative control → EXECUTED: the new test file run against the HEAD source (temporary worktree
  `/tmp/SETTINGS-KEYS-1B-baseline`, removed): `Tests  9 failed | 1 passed (10)`. (f) and (h-f) fail with `expected 200
  to be 404` — the vector reproduced. (e) passes on HEAD by design: it guards against a query on every save.
- Root `npm run typecheck` → EXECUTED, exit 0, no `error TS`.
- `git diff --check` → EXECUTED, exit 0. Porcelain: the three source files, this doc, the new test file.
- NOT RUN: staging deploy and live witnesses (operator's job, as § 11), MCP `npm test` (no route changed).
- **Revision 1 (review-0, `revise`, documentation accuracy only).** (1) The hostname rule is restated as a best-effort
  check of GSI-visible holders, with both windows (overlapping requests; GSI propagation lag, also for sequential
  requests) in § 12.4 and in the `settings.ts` comment. (2) § 12.1 separates the two identity resolvers from the
  `isWiredTenantHost` existence check; § 12.7 (f) is qualified as a literal-reference search; § 12.7 (g) added. No
  behaviour change; the gates were re-run on the revised tree (results in the build report).
- **Revision 2 (review-1, `revise`, one evidence statement).** § 12.7 (f) reported "no reference" from a search run
  before this slice's own comment added two matches; it now quotes the final-tree output. Every `file:line` citation
  in § 12 was re-checked against the final tree. No behaviour change.

### 12.7 Follow-ups (recorded, not done here)

- (a) **Hostname uniqueness item.** A `DOMAIN#<host>` item written in the same `TransactWriteCommand` as the settings
  Put with `attribute_not_exists` (and released on change) closes both windows of § 12.4: the condition is evaluated
  on the base table, which is strongly consistent and serialised per item. It also needs `tenant/create.ts`
  to claim the item and a backfill for existing records.
- (b) **Prod check for poisoned records.** Read-only: query the `SYSTEM` partition with a projection of
  `TenantSlug, Type, Status, CreatedAt, ScheduledFor`, as the operator did on staging. A stored record that already
  carries these keys keeps them after each save (`{ ...current, ...body }` copies them from `current`); the reader check
  of § 12.3 hides it from the two public routes, but the record stays in the index.
- (c) **Existing duplicate hostnames.** § 12.4 does not resolve hostnames already shared; a read-only pass over the
  `SYSTEM` tenant records (staging and prod) grouped by `Domain` would list them.
- (d) **Hostname normalisation.** The check compares the exact string. `Taken.Example` and `taken.example` are
  different index keys; whether a resolver can reach a differently-cased record depends on the host header the
  resolver receives. Not determined here.
- (e) **Renderer slug readers check `SK` only** (`renderer/src/lib/dynamo.ts:241,258`), not `PK`. They are not
  exploitable by the vector of § 12.1 (a tenant record's `SK` is `TENANT#…`), and the renderer is out of scope.
- (f) `GSI_Type` and `GSI_Status`: a literal search (`grep -rn "GSI_Type\|GSI_Status"` over `backend/src`,
  `renderer/src`, `tools/mcp-server/src`) returns only two comment lines, `backend/src/tenant/settings.ts:20-21` (the
  `SERVER_OWNED_FIELDS` comment of this slice); no executable index-reader reference was found (EXECUTED on the final
  tree). This is a literal-reference
  result only: it does not exclude a reader that builds the index name at runtime, or one outside these three trees.
  Their keys are stripped by the same rule either way.
- (g) **`tenant-verify.ts` `getTenantByDomain` has no `TENANT#` filter** (§ 12.1). It takes `Items[0].id` of any item
  in the hostname's partition. For `localhost`, `ROUTE#` items share the partition; `SYSTEM` sorts first, so a tenant
  record is taken when one exists (INFERRED, § 12.4). Out of scope here; recorded.

### 12.9 Operator record for SETTINGS-KEYS-1B (2026-10-28) — review, gates, staging deploy, live witnesses

- **Review:** `gpt-6.1-sol`, three cycles: `revise` (state the full hostname race; correct the resolver description),
  `revise` (one literal-search statement), `approved`. No decision-review (no decision surfaced). Builder
  `claude-opus-5-5`. Relay trail under `.agent-manager/slices/SETTINGS-KEYS-1B/` (local).
- **Operator gates on the approved tree** (log `sk1b-gates.log`): `npm run test:unit` exit 0 — 32 files, 409 tests
  (ten new rows); root `npm run typecheck` exit 0; `git diff --check` exit 0; oracle 4: the constant names the five
  index keys, both readers carry `item.PK === \`TENANT#${tenantId}\` && item.SK?.startsWith("PRODUCT#"|"CATEGORY#")`;
  porcelain exactly the five paths; MCP `npm test` exit 0.
- **Staging `cdk diff`** (`AmodxStack-staging`): code change on `Api/GetSettingsFunc`, `Api/UpdateSettingsFunc`,
  `CommerceApi/PublicGetProductFunc`, `CommerceApi/PublicGetCategoryFunc`; renderer/admin bundle hashes (fresh-build
  noise) and the nested-stack description mojibake as in § 11. 0 added, 0 removed.
- **Staging deploy:** exit 0; `UpdateSettingsFunc` `LastModified` 2026-10-28T12:13:50Z, both public readers
  12:14:04Z.
- **Live witnesses on staging** (`AmodxTable-staging`; log `sk1b-witness-after.log`):
  - Vector 1: `PUT /settings` for `cache-probe-2026` with `{ TenantSlug: "opn1-iso-b#sk1b-probe", Type: "Product",
    status: "active", price: "999" }` → 200; `GET /public/products/sk1b-probe` with `x-tenant-id: opn1-iso-b` → **404**
    `{"error":"Product not found"}` (no settings record, no secrets); the stored record carries no `TenantSlug`,
    `Type` or `Status` (projection read). The body's `price` and `status` landed as ordinary content — follow-up (c)
    of § 8 shown live — and were removed by the operator afterwards (`price` removed; `status` restored to `LIVE`
    under a condition on the witness value). Lesson recorded: a witness body must not carry real config field names.
  - Vector 2 (two throwaway tenants `sk1b-dom-x`/`sk1b-dom-y`, deleted after): X claims Y's hostname → **409**
    `The domain "sk1b-y.invalid" is already used by another site.`; X claims a free hostname → 200; Y re-saves its own
    hostname → 200; `GSI_Domain` count for Y's hostname = 1 (before the fix, § 12.1 witness: 2). After deletion all
    three hostnames count 0.
- **Not proven on prod** (prod on the human's word): `LastModified` of the four functions, bundle grep for
  `SERVER_OWNED_FIELDS` and `startsWith("PRODUCT#")`, CloudWatch errors, GLOBAL_ADMIN `GET /settings` 200. The
  prod table was NOT scanned for already-stored index attributes (production reads are denied to the operator's
  session); the readers' partition check makes such a record unreachable through the public routes regardless.

## 13. Prod record (operator, 2026-10-28) — SHIPPED (SETTINGS-KEYS-1 + 1B)

Prod deploy by the human (worktree `amodx-hotfix` at `7d0b522`). Read-only checks (`sk1-prod-check.sh`): `GetSettingsFunc`
and `UpdateSettingsFunc` `LastModified` 2026-10-28T13:59:48Z, `PublicGetProductFunc`/`PublicGetCategoryFunc` 14:00:32Z;
bundle literals present in both settings bundles — the strip list (`"TenantSlug"`, `"ScheduledFor"`, `"createdBy"`),
the key order `PK:"SYSTEM"` after the spread, `rejectedFields`, the 409 hostname message — and `startsWith("PRODUCT#")`
/ `startsWith("CATEGORY#")` in the two readers; CloudWatch Errors 0 on all four; GLOBAL_ADMIN `GET /settings` → 200.
Two of the script's original tokens (an identifier and a spaced literal) do not survive minification and were replaced
by string literals before this record — a grep that prints nothing is a failed check, not evidence. Prod poison scan
(the human, projection of attribute names on the `SYSTEM` partition): 4 tenant records, none carrying `TenantSlug`,
`Type` or `Status`. Nothing to clean.
