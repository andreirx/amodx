# SETTINGS-KEYS-1 — `PUT /settings` let the request body choose the item it wrote; the handler now names the item

Status: **STAGING VERIFIED 2026-10-28 (§ 11)** — review approved (cycle 1), D-SK-1 ratified A (§ 7), operator gates green, staging deploy 11:32:55Z, live before/after witnesses recorded (§ 11); **prod on the human's word, not on prod.** Previous line: "Status: **IMPLEMENTED 2026-10-28** — code complete, unit oracles exit 0 (§ 5). Review, staging deploy and the live after-witness (§ 3.2) are pending. Not on prod. Track: F (security fix-first slice, found during the `catalog-mode-1` review; `docs/ROADMAP.md` Track F — the operator adds the row). Depends: none. `requireRole` (`backend/src/auth/policy.ts`) and the secret deep-merge are used as they are. Source plan: none — the operator's builder packet of 2026-10-28 is the plan. Maturity target: the handler keeps its current maturity. The slice removes a defect and changes no feature."

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
