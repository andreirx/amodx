# THEME-ROLES-1 — who may write the shared theme library

- **Status:** IMPLEMENTED 2026-11-28 — built, operator gates pending (§ *Migration / deployment notes*). This spec
  (§ *The rule*, § *What `requireRole` does per caller*, § *Expected capture changes*) was written before the first
  code change.
- **Track:** maintenance (order of work from 2026-11-27, `docs/ROADMAP.md` row `theme-roles-1`: after `ci-lockfile-1`,
  before `cmrc-1`)
- **Depends:** `settings-findings-1` (its finding F-SF1-THEME-WRITE-ROLES, its decision SF1-THEME-WRITE-ROLES, its
  finding F-SF1-DELETE-THEME-UNCAUGHT); `refactor-settings-1` (the Settings captures)
- **Source plan:** none. Operator ruling SF1-THEME-WRITE-ROLES = B (`docs/slices/settings-findings-1.md` § *Closeout*,
  2026-11-28; the human's standing rule of 2026-11-27: the operator applies its recommendation and records it; the
  human was told and may overrule). This slice surfaces no ratification-class decision: the decision is made there.
- **Maturity:** the theme library (backend `themes/manage.ts`, the Settings theme card) stays at its current maturity.

## Purpose / risk retired

The saved themes are ONE library for all sites of the deployment (`PK: "SYSTEM"`, `SK: THEME#<id>`). That sharing is a
documented contract: `tools/mcp-server/ARCHITECTURE.md` § *Themes* ("themes are global, not per tenant"),
`docs/slices/mcp-sync-1.md`, and the `delete_theme` tool description ("Themes are SHARED by all tenants").

Before this slice, `POST /themes` and `DELETE /themes/{id}` (`backend/src/themes/manage.ts`) checked no role. Any
caller that the Lambda authorizer lets through could add an entry that every site then lists, or delete an entry that
another site's owner saved: an `EDITOR` of any site, the renderer key, and a signed-in shop customer (public pool,
role `CUSTOMER`) too. The risk retired: a person with no authority over other sites removes or pollutes what those
sites see. After this slice only the agency (`GLOBAL_ADMIN`) deletes, only the agency and site admins save, and the
Settings screen shows each role only what it may do.

VISION tie-in (`docs/VISION.md` § *Core product guarantees* 1, "no cross-tenant read or write"): the shared library is
the one documented place where one site's action is visible to all sites. This slice does not remove the sharing (the
ruling keeps it), but it limits the cross-site write to the roles that the ruling names, and it limits the
destructive cross-site write to the agency.

## The rule (binding, from the ruling)

| Operation | Allowed roles | Others |
|---|---|---|
| `GET /themes` (list) | every caller the authorizer admits, as today (no change) | — |
| `POST /themes` (save) | `GLOBAL_ADMIN`, `TENANT_ADMIN` | 403, nothing written |
| `DELETE /themes/{id}` | `GLOBAL_ADMIN` | 403, nothing deleted |

The library stays shared: no ownership change, no new key, no migration, no per-tenant filter.

## What `requireRole` does per caller (evidence: code read, OBSERVED)

The three routes use the API's default Lambda authorizer (`infra/lib/api.ts`: `defaultAuthorizer: authorizer`; the
routes `/themes` and `/themes/{id}` set no other authorizer). The authorizer (`backend/src/auth/authorizer.ts`) gives
the handler this context per caller:

| Caller | Context from the authorizer | Reaches the handler? |
|---|---|---|
| Admin user, `custom:role` = `GLOBAL_ADMIN` | `role: "GLOBAL_ADMIN"`, `tenantId` = `custom:tenantId` or `""` | yes |
| MCP server (master key, `x-api-key` = the master secret) | `sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL"` | yes |
| Admin user, `TENANT_ADMIN` | `role: "TENANT_ADMIN"`, `tenantId` = the user's tenant | yes |
| Admin user, `EDITOR` or no `custom:role` | `role: "EDITOR"` (the authorizer's default) | yes |
| Renderer key | `role: "RENDERER", tenantId: "ALL"` | yes |
| Public-pool customer (when the public pool is configured) | `role: "CUSTOMER"`, its tenant | yes |
| Service key (`amx_sk_…`) | — | **no**: the route keys `POST /themes`, `DELETE /themes/{id}`, `GET /themes` are not in `SERVICE_ROUTE_SCOPES` (`policy.ts`), so the authorizer answers "not authorized" before any Lambda runs |

`requireRole(auth, allowedRoles, targetTenantId?, serviceScope?)` (`backend/src/auth/policy.ts`), read step by step:
(0) no context → throws; (1) `GLOBAL_ADMIN` → returns `true` at once (no list check, no tenant check); (1b) `SERVICE` →
throws unless the handler declares a scope (these handlers declare none); (2) the role (`EDITOR` when absent) must be in
`allowedRoles`, else throws `Access Denied: Role '<role>' is not in [<list>]`; (3) ONLY when `targetTenantId` is given,
the token's `tenantId` must equal it.

The two calls of this slice and their result per caller:

| Caller | Save: `requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN"])` | Delete: `requireRole(auth, ["GLOBAL_ADMIN"])` |
|---|---|---|
| `GLOBAL_ADMIN` user | pass (step 1) | pass (step 1) |
| MCP master key | pass (step 1) | pass (step 1) |
| `TENANT_ADMIN` | pass (step 2; step 3 not run) | throws (step 2) → 403 |
| `EDITOR` / no role | throws (step 2) → 403 | throws (step 2) → 403 |
| `RENDERER` | throws (step 2) → 403 | throws (step 2) → 403 |
| `CUSTOMER` | throws (step 2) → 403 | throws (step 2) → 403 |
| `SERVICE` (handler-level, defence in depth only) | throws (step 1b) → 403 | throws (step 1b) → 403 |

**The tenant argument: none.** "`TENANT_ADMIN` of any tenant" is expressed by calling `requireRole` without a
`targetTenantId`: step 3 does not run. `policy.ts` is not changed. Why no tenant argument is right here: the item is
written to and deleted from `PK: "SYSTEM"` whatever the request says; the `x-tenant-id` header names the site whose
screen the admin is on, not the data the call changes. Passing the header would check "token tenant = header tenant"
for a `TENANT_ADMIN`: a check that changes nothing about what is written, and that `requireRole` runs only when the
header is present (step 3 is skipped for `undefined`), so its result would depend on an optional header. Precedent for
the same form (a role check with no tenant, on data that is not one tenant's): `users/update.ts`, `users/delete.ts`,
`users/toggle-status.ts` (`requireRole(auth, ["TENANT_ADMIN"])`), `tenant/create.ts` (`requireRole(auth, [])`). The
tenant-isolation rule of `CLAUDE.md` / `docs/database-patterns.md` ("never query `TENANT#…` without explicit tenant
context") is not touched: these handlers touch no `TENANT#` partition.

Delete uses `["GLOBAL_ADMIN"]`, not `[]` (`tenant/create.ts`): the two have the same effect (step 1 returns before the
list check; an empty list refuses everyone else), and the explicit list states the rule of the table above.

**The refusal answer.** The form of a role refusal in the other handlers (47 lines of `backend/src` answer exactly
`return { statusCode: 403, body: JSON.stringify({ error: e.message }) };`, e.g. `tenant/create.ts`, `products/delete.ts`):

```ts
try { requireRole(auth, [...]); } catch (e: any) { return { statusCode: 403, body: JSON.stringify({ error: e.message }) }; }
```

The check runs inside each handler's existing `try`, before `JSON.parse` of the body and before any command, in its own
`try/catch`, so a refusal answers 403 and never reaches the outer `catch` (which answers 500). `withInvalidation` writes
the CDN markers only for a 2xx answer (`backend/src/lib/invalidate-cdn.ts`, `withInvalidation`), so a refusal sends no
command to the table at all.

**MCP.** `create_theme` and `delete_theme` send `x-api-key: AMODX_API_KEY` (`tools/mcp-server/src/index.ts`,
`getHeaders`); with the master key the authorizer gives `role: "GLOBAL_ADMIN"` (table above), which passes both checks.
No tool description states a permission today (`delete_theme` states the sharing, not who may delete; `create_theme`
has no description), so no tool text changes: the MCP tool list stays byte-identical.

## Scope

1. `backend/src/themes/manage.ts`: the save check and the delete check of § *The rule*. `GET /themes` unchanged.
2. `admin/src/pages/Settings.tsx` and `admin/src/pages/settings/Theme.tsx`: the Save Theme control renders only when
   `canSaveTheme` (= the page's existing `isAdmin`: `TENANT_ADMIN` or `GLOBAL_ADMIN`); the delete button of a saved
   theme renders only when `canDeleteTheme` (`userRole === "GLOBAL_ADMIN"`). Both are computed from
   `useAuth().userRole`, the role the page already reads, and passed to `ThemeCard` as props, as `isAdmin` is passed
   to `SchedulingSwitchCard` and `BotProtectionCard`. Every role still sees the saved themes and can apply them.
3. F-SF1-DELETE-THEME-UNCAUGHT: `deleteTheme` catches a refused or failed delete, shows it with the page's existing
   means for the theme actions (`alert(e.message)`, as `saveCurrentTheme` does), and reloads the list in both cases.
4. Tests (§ *Proofs*) and the docs of § *Definition of Done*.

**How the Save control is hidden, and why this form.** The Radix `Dialog` root of the Save Theme dialog stays mounted for
every role; only its `DialogTrigger` (the save button) is rendered under `canSaveTheme`. Reason (OBSERVED in the
captures): in a client render, React's `useId` takes its values from one counter in mount order, shared by all tests of
`Settings.markup.test.ts` (`radix-_r_h_` in `empty`, `_r_7c_` in `shop`, `_r_mv_` in `catalog`, `_r_tq_` in
`shop-bare`). The `Dialog` root calls `useId` three times (content, title, description ids). Not mounting the root for an
`EDITOR` would move every later id — in the `catalog` sweep and in every `shop-bare` capture — so those captures would
change in lines no role lost. With the trigger absent, the dialog cannot open (`isSaveThemeOpen` is set only by the
trigger and by `saveCurrentTheme`), and the closed dialog renders no markup.

## Non-scope

- F-SF1-DARK-SAVE-THEME and F-SF1-DARK-THEME-UNREAD (the dark tab is put to the human).
- F-TR1-ADMIN-403-SIGNOUT (§ *Findings*): the admin API client's answer to any 403. Recorded, not changed.
- No change to `GET /themes`, to the item shape, to ownership, keys, or to the MCP tools.
- No audit entry for a theme save or delete (none exists today; not asked).
- Protected paths, no edit: `backend/src/auth/`, `infra/`, `renderer/`, `packages/`, any `package.json` or lockfile. No
  new route.

## Architectural boundaries

- `policy.ts` is the authorization core and is not edited; the handlers call it as the other handlers do.
- No new module, abstraction, prop type or helper beyond two boolean props of `ThemeCard`. No IAM change: the handlers
  add no table operation (`grantWriteData` of the create and delete functions is unchanged and still sufficient).
- The list handler, the stored item and the response bodies of an allowed call are byte-equal to before (§ *Proofs*).

## Expected capture changes (listed BEFORE the change)

The captures under `admin/src/pages/__markup__/refactor-settings-1/` are one line of HTML each, so a "changed line" is
listed as an exact HTML fragment that disappears. Roles of the states: `empty`, `shop`, `lang`, `shop-bare` are
`TENANT_ADMIN`; `catalog` is `EDITOR`; no state is `GLOBAL_ADMIN`.

1. `catalog.loaded.html` and `catalog.sweep.html` (EDITOR loses Save): the save trigger disappears, exactly
   `<button class="inline-flex … h-9 w-9" title="Save current styles as Theme" type="button" aria-haspopup="dialog"
   aria-expanded="false" aria-controls="radix-_r_na_" data-state="closed"><svg … class="lucide lucide-save h-4 w-4" …>…</svg></button>`
   (`aria-controls="radix-_r_qm_"` in the sweep). Nothing else in either file.
2. `shop.after-interactions.html` and `shop.country-dialog.html` (TENANT_ADMIN loses Delete; these two are taken after
   the test saved the theme "Winter"): the delete button of "Winter" disappears, exactly
   `<button class="absolute right-1 top-1 p-1 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100
   transition-opacity"><svg … class="lucide lucide-trash2 lucide-trash-2 w-3 h-3" …>…</svg></button>`. Nothing else.
3. Every other file of the directory (`*.save.json`, `*.requests.json`, the other 12 `.html`): byte-identical.

Check (mechanical): for each changed file, `HEAD` content with the listed fragment removed once equals the new content
byte for byte; for every other file, `git diff --quiet`.

## Proofs (tests; row ids)

Rows that pin a refusal or the new screen are red before the fix. Rows marked *preservation* pin today's behaviour of
an allowed call; they are green before and after by design (an allowed call must not change).

Backend unit, `backend/test/unit/theme-roles-1.test.ts` (the real handlers; `db.js` replaced by the in-memory table
`memory-table.ts`; the reserved-word guard comes from the setup file). Callers: `GLOBAL_ADMIN` user, master key,
`TENANT_ADMIN`, `EDITOR`, no role, `RENDERER`, `CUSTOMER`, `SERVICE`.

- `TR1-B-LIST-<caller>` (*preservation*): 200 and the stored items, for every caller.
- `TR1-B-SAVE-<caller>`: allowed (`GLOBAL_ADMIN`, master key, `TENANT_ADMIN`, *preservation*): 201; the item written
  and the body are byte-equal to today's shape (`PK, SK, id, name, theme, createdBy, createdAt, Type`, in this order);
  the CDN marker written. Refused (the other five): 403, body `{"error":"Access Denied: …"}`, **no command sent**.
- `TR1-B-DELETE-<caller>`: allowed (`GLOBAL_ADMIN`, master key, *preservation*): 200 `{"message":"Deleted"}`, the key
  `SYSTEM / THEME#<id>` deleted. Refused (the other six): 403, no command sent, the item still stored.
- `TR1-B-REFUSAL-NOT-500`: a refused save with an invalid JSON body answers 403, not 500 (the check runs before the
  parse, outside the 500 catch).

Admin unit, `admin/src/pages/Settings.markup.test.ts` (the existing jsdom harness of the real page; new `describe`
appended at the END of the file, so the ids of the existing captures do not move):

- `TR1-A-CONTROLS-GLOBAL_ADMIN` (*preservation*): Save trigger and the delete button of a saved theme both render.
- `TR1-A-CONTROLS-TENANT_ADMIN`: Save renders; no delete button.
- `TR1-A-CONTROLS-EDITOR`: neither renders; the saved theme is listed.
- `TR1-A-APPLY-EDITOR` (*preservation*): an editor clicks the saved theme; the Save body holds its colour.
- `TR1-A-DELETE-REFUSED`: a refused delete shows the error (`alert`), the list is loaded again, no unhandled rejection.
- `TR1-A-DELETE-OK` (*preservation*): a delete that succeeds sends `DELETE /themes/<id>` and loads the list again.

## Findings

- **F-TR1-ADMIN-403-SIGNOUT (pre-existing, OBSERVED in code).** `admin/src/lib/api.ts` (`apiRequest`, the
  `401 || 403` branch) treats every 403 as an expired session: it removes the stored tenant, signs the user out,
  redirects to `/login` and throws "Session expired. Please login again." A role refusal (403, as every handler answers
  it) seen from the screen therefore ends the session. This slice hides the controls a role may not use, so the screen
  sends no request that the backend refuses for the role (both read the same `custom:role` of the same token). A role
  change while signed in (the token still holds the old role until refresh) or a direct API call can still meet it.
  Fix options, for a later slice: distinguish 401 (session) from 403 (refusal) in `apiRequest`. Not changed here
  (outside the packet; it changes every screen's refusal handling).

## Migration / deployment notes

- Data: none. No key, item shape or index changes; no migration.
- Deploy: the backend functions `CreateThemeFunc` and `DeleteThemeFunc` (code only; no IAM, no resource added or
  removed) and the admin bundle. A normal stack deploy.
- Effect at deploy: an `EDITOR`, the renderer key and a customer can no longer save; a `TENANT_ADMIN` can no longer
  delete. The screen hides those controls in the same deploy. Nothing stored changes.
- Rollback: deploy the previous commit. No data to restore (the slice writes no data of its own).
- Operator proof on staging: with the test admin (`GLOBAL_ADMIN`), save and delete through the API and the screen; the
  refusals of a lower role are proved by the unit tests (staging has one test user).

## Definition of Done

- The handlers answer as § *The rule*; the rows of § *Proofs* pass; refusal rows were red before the fix.
- The captures changed only as § *Expected capture changes* lists (the mechanical check passes).
- Docs: `backend/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`, `tools/mcp-server/ARCHITECTURE.md` (who may write),
  `docs/database-patterns.md` (the theme row of the `SYSTEM` partition), `docs/TECH-DEBT.md` (F-SF1-THEME-WRITE-ROLES and
  F-SF1-DELETE-THEME-UNCAUGHT closed; F-TR1-ADMIN-403-SIGNOUT added), the ROADMAP row, `CURRENT_SLICE.md`.
- Gates, each exit 0: `npm run build`; `npm run typecheck`; `cd admin && npm run test:unit`;
  `npm --prefix backend run test:unit`; `cd tools/mcp-server && npm test`; `git diff --check` (new files too).

## Evidence required

EXECUTED: the red runs before each fix, the green runs after, the capture check, the gates above. Operator, after
review: the staging deploy and the staging proof of § *Migration / deployment notes*.

## Exit criterion

The shared theme library has a written and enforced write policy; the screen shows each role only what it may do; a
failed delete no longer leaves an unhandled rejection.

## References

- `docs/slices/settings-findings-1.md` § *Findings* (F-SF1-THEME-WRITE-ROLES, F-SF1-DELETE-THEME-UNCAUGHT), § *Closeout*
  (the ruling)
- `docs/slices/mcp-sync-1.md` (the shared library contract); `tools/mcp-server/ARCHITECTURE.md` § *Themes*
- `backend/src/auth/policy.ts`, `backend/src/auth/authorizer.ts`
- `docs/slices/refactor-settings-1.md` § *Proofs* (the capture rule)

## Build record

Builder `claude-opus-5-5`, 2026-11-28. Not committed (the tree holds the change for review).

**Files.**

| Path | Why | Serves |
|---|---|---|
| `docs/slices/theme-roles-1.md` | this spec, written before the code | the packet's step 1 |
| `backend/src/themes/manage.ts` | the save check and the delete check; the false comment ("allow anyone to create") replaced | § *The rule* |
| `backend/test/unit/theme-roles-1.test.ts` | the TR1-B rows | § *Proofs* |
| `admin/src/pages/Settings.tsx` | `canDeleteTheme`; `canSaveTheme={isAdmin}`, `canDeleteTheme` passed to `ThemeCard`; `deleteTheme` catches and reloads | § *Scope* 2, 3 |
| `admin/src/pages/settings/Theme.tsx` | the Save trigger and the delete button rendered under the two props | § *Scope* 2 |
| `admin/src/pages/Settings.markup.test.ts` | role `GLOBAL_ADMIN` in the state type; `DELETE /themes/<id>` answered (success or refusal); the TR1-A rows, appended last | § *Proofs* |
| `admin/src/pages/__markup__/refactor-settings-1/{catalog.loaded,catalog.sweep,shop.after-interactions,shop.country-dialog}.html` | re-captured: the listed fragment removed | § *Expected capture changes* |
| `backend/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`, `tools/mcp-server/ARCHITECTURE.md`, `docs/database-patterns.md`, `docs/TECH-DEBT.md`, `docs/ROADMAP.md`, `CURRENT_SLICE.md` | the docs of § *Definition of Done* (`backend/ARCHITECTURE.md` also: "Theme CRUD" → list, save, delete; the file has no update) | DoD |

**Evidence (EXECUTED unless marked).**

- Backend red, on the untouched handler (`cd backend && npx vitest run --config vitest.unit.config.ts
  test/unit/theme-roles-1.test.ts`): 12 failed — `TR1-B-SAVE-{EDITOR,NO_ROLE,RENDERER,CUSTOMER,SERVICE}`,
  `TR1-B-REFUSAL-NOT-500`, `TR1-B-DELETE-{TENANT_ADMIN,EDITOR,NO_ROLE,RENDERER,CUSTOMER,SERVICE}` (each answered 201 or
  200 instead of 403); 13 passed — the 8 `TR1-B-LIST-*`, 3 allowed saves, 2 allowed deletes (preservation). Green after
  the fix: 25 passed.
- Admin red, on the untouched screen (`cd admin && npx vitest run src/pages/Settings.markup.test.ts`): 3 failed —
  `TR1-A-CONTROLS-TENANT_ADMIN` (delete shown), `TR1-A-CONTROLS-EDITOR` (Save shown), `TR1-A-DELETE-REFUSED` (the
  unhandled rejection `Error: theme delete refused`, no alert, no reload); 19 passed, all 10 capture tests among them
  (the test-file edit alone moved no capture). After the screen change: exactly the 3 capture tests that hold the
  listed captures failed (`shop`, `catalog` loaded, `catalog` sweep); every TR1-A row passed. After `-u`: 4 snapshots
  updated, 22 passed.
- Capture check (`node .agent-manager/slices/THEME-ROLES-1/capture-check.mjs`, the gitignored slice trail): 31 files;
  the 4 listed files equal HEAD minus the listed fragment (found once in each); the other 27 byte-identical; exit 0.
- Gates, each exit 0: `npm run build`; `npm run typecheck`; `cd admin && npm run test:unit` (33 files, 512 tests);
  `npm --prefix backend run test:unit` (95 files passed, 2 skipped — the opt-in golden-capture files; 2479 tests);
  `cd tools/mcp-server && npm test` (route coverage, 23 tool-shape tests); `git diff --check` and
  `git diff --no-index --check /dev/null <file>` for the two new files (no whitespace error).
- MCP: no file under `tools/mcp-server/src` changed, so the tool list is unchanged (INFERRED from the empty diff; the
  tool-shape tests pass).
- NOT RUN (operator, after review): the staging deploy and the staging proof.

**Deviations.**

- The packet asks for rows "each red before the fix". The rows that pin an allowed call (marked *preservation*) cannot
  be red before: they prove that an allowed call is unchanged. Every refusal row and every new-screen row was red.
- `GET /themes` admits every caller the authorizer admits (also `RENDERER` and `CUSTOMER`), not only "staff roles":
  that is today's behaviour, and the rule keeps the list "as today".

## Closeout (operator, 2026-11-28)

- Relay: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, one cycle; review-0 `approved`.
- Operator gates on the approved tree, each exit 0: build, typecheck, shared, plugins, renderer, serving,
  serving-bundle, admin unit, backend unit, infra, mcp, `git diff --check`; no change under `backend/src/auth`,
  `infra`, `packages`, `renderer`, `tools/mcp-server/src`, a manifest or a lockfile.
- Staging diff (read before the deploy): 0 resources added, 0 removed, no IAM change; the three theme functions, the
  admin bundle and the renderer rebuilt. Deploy: `AmodxStack-staging` succeeded.
- Staging proof (the staging test admin is a `GLOBAL_ADMIN`; role read from its token claim): `POST /themes` 201, the
  theme is listed on the Settings screen on open, `DELETE /themes/{id}` 200 and the theme is gone from the list; the
  Settings checks of `settings-findings-1` pass unchanged; a `POST /themes` without a staff token answers 401.
- NOT proven on staging: the refusals for `TENANT_ADMIN` (delete) and `EDITOR` (save, delete), and the hidden
  controls for those roles. Staging has one test user. Basis: the backend unit tests (each role and operation, no
  write command on a refusal) and the admin unit tests.

