# REDIRECT-1 — an owner can add a redirect from an old address

> Copied 2026-11-18 from `satulbanului/docs/amodx-slices/redirect-1.md` (draft written by the satulbanului session). This copy is the one to edit.
> Ratified 2026-11-27 by the human's order of work ("satulbanului gaps: gallery-1, redirect-1, stay-1 part A"); operator
> rulings 1–11 in the builder packet. The `file:line` evidence below is from `3388999`; the current references are in
> § "Build record".

Status: **IMPLEMENTED 2026-11-27 — built, operator gates pending** (staging deploy and staging check are the
operator's). Track: new, `redirect`. Depends: none. Maturity target: PROTOTYPE.

## Purpose / risk retired

A site that moves to AMODX loses the search position of every old address that has no page with the same
address. The redirect record already exists and the renderer already obeys it; only a slug rename can write one.

- Record: `packages/shared/src/index.ts:246-247` — `isRedirect`, `redirectTo` on the route.
- Reader: `renderer/src/lib/dynamo.ts:202-203` returns `{redirect}`; `SitePage.tsx:552-553` calls
  `permanentRedirect` (answer 308).
- Only writer: `backend/src/content/update.ts:149-158`, on a slug change.
- List: `backend/src/content/list.ts:22-29` (`type=Redirect`). No admin screen calls it.

## Scope

1. Backend: `POST /redirects` `{from, to}` and `DELETE /redirects` `{from}` (admin roles of the content
   handlers). `from` goes through `normalizeSlug`; refused when `reservedAddressRefusal` refuses it, when a
   live page owns `ROUTE#<from>` (a conditional write: never overwrite a page route), when `from === to`, or
   when `to` is itself a redirect (no chains). `to` is a root-relative address of the same site; an absolute
   URL is refused. Writes the same item shape as `update.ts:149-158`. `publishAudit` with actor email and a
   title (Critical Rule 7). Cache: purge the changed path the way a slug rename does.
2. Admin: a "Redirects" list under the content section — the existing `type=Redirect` list, an add row, a
   delete button. English texts (the admin stays English).
3. MCP server: the two routes, `routes.json` refreshed.

> **Note to Scope item 1 (2026-11-27, operator rulings after review-0; the text above is unchanged).** "`from` goes
> through `normalizeSlug`" is applied as ratified decision REDIRECT1-NORMAL-FORM = A: an address that normalization would
> change by more than surrounding whitespace and slashes is refused with 400 and a text that names the reason; nothing
> is stored in a changed form (a stored source that differs from the address a visitor requests is a redirect that
> never fires). `/` and `/contact` are system routes (`docs/database-patterns.md`, Hard Rules item 4): `POST` with
> either as `from`, and `DELETE` of either, are refused. "`to` is itself a redirect" includes the home alias: `to` = `/`
> is read at `ROUTE#<homePageSlug>` when that is set.

## Non-scope

Patterns or wildcards. Redirects to another host. Answer code 301 in place of 308 (search engines treat both
as permanent). Import of a redirect file.

## Evidence taxonomy

| Input | Expected |
|---|---|
| valid `from`, valid `to` | 201; the renderer answers 308 with `Location: to` |
| `from` owned by a published page | 409, the page route unchanged (read back) |
| `from` under a reserved prefix | 400 with the refusal text of the guard |
| `to` absolute URL / empty / equal to `from` | 400 |
| `to` is a redirect | 400 (no chain) |
| `from` with a trailing slash | stored without it (the address Next asks for after its own 308) |
| delete of an address that is a page, not a redirect | 409, nothing deleted |
| another tenant's `from` | not reachable: keys are built from `x-tenant-id` only |

## Migration / deployment notes

Additive: one new route pair; no existing item changes. No `infra/` edit beyond the route registration that
every new handler needs (name it at the cdk-diff gate: gain = owners keep old addresses). Staging first.
Rollback: redeploy; redirect items already written keep working, because the reader is unchanged.

## Definition of Done

Repository gates exit 0; `tools/mcp-server` route coverage green. Staging: add `/room` → `/guest-house`,
`curl -sI` shows 308 and the Location; delete it; the address answers 404.

## Exit criterion

The 17 addresses in `satulbanului/infra/redirects.json` can be entered by hand or by script and all answer 308.

## Build record (2026-11-27, builder `claude-opus-5-5`, tree 9cb22ad + uncommitted diff; revision 1 on e8266b1)

### Current references (ruling 1; read on 9cb22ad)

| Spec says (3388999) | Now |
|---|---|
| Record `packages/shared/src/index.ts:246-247` | `RouteSchema` `:280-288` (`isRedirect` :284, `redirectTo` :285). Not the stored shape: the item holds `IsRedirect` / `RedirectTo`; no code parses a route with `RouteSchema` (grep, OBSERVED) |
| Reader `renderer/src/lib/dynamo.ts:202-203` | `getContentBySlug` `:225-237` (truthy `IsRedirect` → `{redirect: RedirectTo}` at :235-236) |
| `SitePage.tsx:552-553` | `renderer/src/components/SitePage.tsx:576` (`/` → `homePageSlug`), `:582` `permanentRedirect` (308) |
| Only writer `backend/src/content/update.ts:149-158` | Builder `redirectRouteItem` `update.ts:23-40`; writers: rename `update.ts:436`, WordPress importer `import/wordpress.ts:625` (`settleRedirect` :615, import :11) |
| List `backend/src/content/list.ts:22-29` | `:23-31` before this slice (no projection, one unpaginated page); rewritten here |
| Guard | `backend/src/lib/slug-guard.ts` `readReservedAddresses` :58-65, `reservedAddressRefusal` :83-85, `reservedAddressRefusalIn` :88-98 |
| — | `normalizeSlug` `packages/shared/src/slug.ts:29-36` keeps a trailing `/` (only a trailing `-` is stripped) |
| — | Rename audit `update.ts:474-484`; rename purge `update.ts:495` (`revalidateTenantPaths(t, "page", [new, old, …])`); roles `update.ts:294` |
| — | Infra: content functions `infra/lib/api-catalog.ts:152-159` (UpdateContentFunc), routes `infra/lib/api.ts:163-193` |

### What was built

- **One item, no third copy (ruling 2).** The two existing writers already share `redirectRouteItem` (since
  import-paths-1), so the extraction condition of ruling 2 is not met; `redirects/create.ts` imports it as the importer
  does. Same guard: `reservedAddressRefusalIn` (slug-guard.ts), text unchanged.
- **`backend/src/redirects/rules.ts`** (pure): `RedirectRefusal` (18 kinds since revision 3, each with its context),
  `refusalAnswer` — the one mapping to 400/404/409 and the English text, an exhaustive `switch` with no default (ruling 6).
- **`POST /redirects`** (`redirects/create.ts`): checks (below), two reads of the tenant record (reserved addresses;
  `homePageSlug`), the routes at `from` and at the effective target, then ONE `TransactWriteCommand` (revision 1): the
  `Put` of `redirectRouteItem` under `attribute_not_exists(SK)` (ruling 3) and a `ConditionCheck`
  `attribute_not_exists(IsRedirect) OR IsRedirect = :no` (`:no` = false) on the effective target's route (revision 3:
  exactly `routeAtOf`'s page or none; see § "Revision 3"). A failed
  condition → 409 `changed-meanwhile` naming the address that changed.
  `publishAudit` `CREATE_REDIRECT`, title `<from> → <to>`; purge of `from` by `revalidateTenantPaths` (ruling 9). 201
  `{from, to}` as stored.
- **`DELETE /redirects`** (`redirects/delete.ts`): `from` is the stored key exactly as the list shows it (not
  normalized: a rename stores the old slug as it was, which may not be normal); `/` and `/contact` → 400 before any read
  (revision 1). Nothing → 404; a page route → 409, nothing
  deleted (ruling 5); `Delete` conditioned on `IsRedirect = :yes AND RedirectTo = <read>`. Audit `DELETE_REDIRECT`, purge.
- **List (ruling 4, ruling 7).** The existing `GET /content?type=Redirect` serves the screen; no new list route. Its
  branch is now paginated and projected (Critical Rule 2; before: one unpaginated page of whole items, no caller in
  admin or MCP — grep, OBSERVED) and adds `targetFound` per redirect. **Chosen: computed in the list answer** — the query
  already reads every `ROUTE#` item, so it is one map lookup; the screen alternative needs a second load of all pages.
  `targetFound` (revision 1, operator ruling after review-0 — ROUTE PRESENCE ONLY) = the route at `to` exists and is not
  a redirect; for `/`, the route of `homePageSlug` when set (SitePage.tsx:576), else `ROUTE#/`. One tenant read
  (`homePageSlug`). A built-in page's address (`/cart`, `/shop`, `/product/<slug>`) has no route and is marked; the
  round-0 inference from reserved prefixes is removed (it marked `/product/does-not-exist` and `/cart` with commerce
  off as found). Screen text of the mark: "target not found (no page at this address yet)".
- **Infra (ruling 7):** `CreateRedirectFunc`, `DeleteRedirectFunc` in `CatalogApi` (grants, env and fast lane as
  UpdateContentFunc — pinned by comparing their policy statements); routes `POST`/`DELETE /redirects` in the parent.
  No other `infra/` change. cdk-diff gain: owners keep old addresses.
- **Admin (ruling 8):** `admin/src/pages/Redirects.tsx`, route `/redirects`, menu Content → Redirects. Structure of
  `Forms.tsx` (header, Card, Table, empty row), shadcn components already in the repo. No request before a site is
  selected (same rule as `InvalidationBanner.tsx`: the page renders "Select a site." until `currentTenant` exists).
- **MCP (ruling 10):** `list_redirects`, `add_redirect`, `delete_redirect`; `routes.json` + 2 under `localAdditions`
  (the routes are not deployed, so the live table cannot hold them yet); ARCHITECTURE.md 77 → 80 tools.

### Address rule — one rule for `from` and `to`

`addressOf`: refused when it holds a control character (Unicode Cc, incl. C1) or `\` ANYWHERE IN THE STRING AS SENT
(`bad-character`; revision 1 — round 0 trimmed first, so a leading tab or a trailing CR/LF passed, F-R1-CONTROLS); then
trimmed; refused when empty (`missing`), when absolute (`<scheme>:`) or scheme-relative (`//`)
(`not-root-relative`), when it holds `//` inside (trailing slashes excepted; `repeated-slash`, revision 2); else stored as `normalizeSlug(typed)` without trailing slashes. **Ratified (REDIRECT1-NORMAL-FORM
= A, operator 2026-11-27):** when `normalizeSlug` would store another address
than the one typed — other than the leading slash, trailing slashes and surrounding whitespace — the request is refused
(`not-normal`, 400) with the form it would get, never changed silently. Reason: Next.js routes paths case- and
byte-exactly; a typed `/Room` stored as `/room` answers 201 and never redirects `/Room`; `/page?lang=de` would become
`/pagelangde`. All 17 addresses of `satulbanului/infra/redirects.json` pass the rule unchanged except the trailing slash
(OBSERVED: lowercase ASCII, `-` and `/` only).

`from` only (`fromRefusal`): `reservedAddressRefusalIn` (400 with the guard's text), then the importer's reachability
rule `rendererRoute` (import/wp-addresses.ts): an address the renderer never looks up a route for (`/`, `/api…`,
`/static…`, `/tenant/…`, `/products/<id>`, …) → 400 `not-served`. **Deviation (recorded):** not in the evidence table;
reuse of an existing pure rule so that such a redirect does not answer 201 and never serve. Since revision 1, `/` and
`/contact` are refused earlier as `system-route` (operator ruling).

### Revision 1 (after review-0) — finding → rule that closes its class

| Finding | Class of defect | Rule now | Tests |
|---|---|---|---|
| F-R1-DESTINATION | the destination check read a key other than the one the renderer reads, and was not part of the write | Every check of the target uses `effectiveTarget(to, homePageSlug)` (the renderer's `/` → home page rule) and is repeated inside the write as a `ConditionCheck` of the same transaction | `R1-F-DESTINATION` (1) home alias is a redirect → 400, (2) `/home → /` with the home page at `/home` → 400 `home-loop`, (3) interleaved `/a → /b` / `/b → /a` → the second 201, the first 409, no cycle; positive: home page is a page → 201 |
| F-R1-CONTROLS | a check ran on a transformed value | Character checks run on the string as sent; transformation (trim, normalization) only after | `R1-F-CONTROLS` (8 control characters × leading / embedded / trailing / inside spaces × both fields; spaces only = accepted; handler: `\n`, `\t`, `\r` → 400, nothing written) |
| F-R1-TARGET-MARK | existence inferred from an address reservation | `targetFound` = a page route at the effective target, nothing else | `R1-F-TARGET-MARK` (pure: `/product/does-not-exist`, `/cart`, `/shop`, a redirect target → false; home → true) and the list row |
| F-R1-PROTECTED-DELETE + ruling | a documented hard rule not enforced | `/`, `/contact` refused as `from` and on delete, before any read | `R1-SYS` (pure, POST with read-back, `db.commands` empty), `R1-F-PROTECTED-DELETE + R1-SYS` (redirect items at both keys stay, read back) |
| F-R1-DOC-RIPPLES | partial reread after an edit | Every doc that names a changed behaviour reread (MCP/backend/admin/infra ARCHITECTURE, database-patterns, ROADMAP, CURRENT_SLICE, TECH-DEBT, this record) | — |

Mutation checks (EXECUTED, restored after each): without the `ConditionCheck` → the interleave row fails; control check on
the trimmed string → both control rows fail; no system-route check on delete → both system rows fail.

### Revision 2 (after review-1) — finding → rule that closes its class

| Finding | Class of defect | Rule now | Tests |
|---|---|---|---|
| F-R1-DESTINATION (repeated slashes) | an address the serving stack rewrites before its route is read: Next.js answers `/a//b` with a 308 to `/a/b` (next/dist/server/base-server.js:577-581), so `/a/b → /a//b` is a loop | `addressOf` refuses `//` inside an address, both fields (`repeated-slash`). With `bad-character` and `not-normal`, every rewrite left after `normalizeSlug`'s character set is refused or (trailing slash) applied before storing | pure: `/a//b`, `/a///b`, `/a//b/`, `/de//room` × both fields refused; `/a/b//` → `/a/b`; handler: self-alias `/a/b → /a//b` and `///` → 400; hidden redirect `/old → /a//b` with `/a/b` a redirect → 400, `/a/b` unchanged; ordinary `/old → /a/b` → 201 |
| F-R1-TARGET-PREDICATE | the write's condition and the decision rule said "not a redirect" in two ways | One predicate: not a redirect = `IsRedirect` absent or not `true`, in `routeAtOf` and in the ConditionCheck (`attribute_not_exists(IsRedirect) OR IsRedirect <> :yes`) — **superseded by revision 3** (it admitted `"true"` and `1`, which the renderer serves as redirects) | handler: a target page route with `IsRedirect: false` → 201 (direct) and through `homePageSlug` → 201; the interleave cycle row kept |
| F-R1-DOC-RIPPLES (over-claim) | a guarantee stated wider than the test | Docs state the narrow guarantee: the destination is checked at insertion (reciprocal cycle tested); redirects that point at `from` are not checked | "documented limitation" row: interleaved `/b → /c` and `/a → /b` both 201, a chain |

The test double `backend/test/unit/lang-1a-table.ts` gained `OR` between AND-groups and `x <> :v` (false when `x` is
missing; the create condition does not depend on that, its first clause admits a missing attribute). Mutation checks
(EXECUTED, restored): the round-1 predicate → both predicate rows (and the expression assertion) fail; no `//` check →
the three repeated-slash rows fail; no ConditionCheck → the interleave row fails.

### Revision 3 (after review-2) — finding → rule that closes its class

| Finding | Class of defect | Rule now | Tests |
|---|---|---|---|
| F-R1-TARGET-PREDICATE | "safe target" defined by what the flag is NOT (`<> true`) while the renderer serves any truthy flag as a redirect | `routeAtOf` is the one reading of `IsRedirect`, three-way: `true` → redirect; absent or Boolean `false` → page route; ANY other stored value → `unclassified` (new `RouteAt` variant). An unclassified route is refused as a target, as a `from`, and on delete (`unclassified-route`, 409). The ConditionCheck admits exactly page/none: `attribute_not_exists(IsRedirect) OR IsRedirect = :no`, `:no` = false. `createRefusal`'s `from` check is now an all-arms-return switch (`sourceRefusal`), so the new variant was a compile error until every site handled it | pure: `"true"`, `1`, `null`, `0`, `""`, `"false"` → unclassified; refusals for target, from, delete. Handler: a target with `IsRedirect: "true"` or `1` → 409, nothing written, target unchanged; the same through `homePageSlug` → 409; a truthy non-Boolean flag written between read and commit → the ConditionCheck refuses, 409 `changed-meanwhile`; a `from` / delete address with an unclassified flag → 409, read back unchanged. Kept: both `IsRedirect: false` rows (201) and the reciprocal-cycle row |
| F-R1-DOC-RIPPLES ("in either order") | an ordering claim stated without its test | The reverse chain forms only when `A → B` commits before `B → C` (also overlapping); the other order is refused | new row "the order that is refused" (`/b → /c`, then `/a → /b` → 400 `target-is-redirect`); "documented limitation" row kept |

The test double's `x <> :v` (added in revision 2) is removed: no expression uses it any more; `OR` stays. Mutation
checks (EXECUTED, restored): `routeAtOf` reading every non-`true` flag as a page (the revision-2 reading) → 4 rows fail;
a ConditionCheck that admits any flag → the reciprocal-cycle row and the "written between read and commit" row fail.

No writer in the repository stores a non-Boolean `IsRedirect`; whether live data holds one is not known (as the reviewer
noted). The rule makes such an item inert for this handler, not repaired.

### Revision 4 (after review-3; scope frozen by the operator checkpoint of 2026-11-27)

Frozen taxonomy of the stored flag (operator): absent → page; Boolean `false` → page; Boolean `true` → redirect; ANY
other stored value → `unclassified-route` (409), nothing written.

| Finding | Class of defect | Rule now | Tests |
|---|---|---|---|
| F-R1-REFUSAL-FORMATTING | an expected-failure path that serializes untrusted stored data and can throw (`JSON.stringify` of a `bigint` → 500 instead of the 409 refusal) | The refusal text describes the flag by its TYPE only (`flagTypeOf`: `null`, `list`, `set`, `binary`, `map`, else the `typeof` name) and never by its value; the refusal field is `flagType`. A function that reads only `typeof`, `Array.isArray`, `instanceof Set` and `ArrayBuffer.isView` cannot throw for any value the document client returns | EXECUTED in the build: `@aws-sdk/util-dynamodb` `unmarshall` turns N `9007199254740993` into a `bigint` (scalar, in a map, in a list), NS into a `Set`, B into a typed array, and `JSON.stringify` of the `bigint` throws. Handler rows: a big integer as scalar, in a map and in a list, each at `from`, at the direct target, through the home alias and on DELETE → 409 `unclassified-route`, the value absent from the text, read back unchanged, nothing written (12 rows); pure row: every shape → its type name, the text built without throwing |

Mutation check (EXECUTED, restored): the formatter back to `JSON.stringify` → 14 rows fail (the 12 handler rows answer
500 with "Do not know how to serialize a BigInt").

**INFERRED, not tested beyond the reciprocal case:** a cycle of any length made only of redirects written by
`POST /redirects` cannot commit — the last edge of a cycle to commit would have a destination that is already a
redirect, and its ConditionCheck refuses it (DynamoDB transactions are serializable). Redirects written without that
check (a slug rename, `update.ts`) are outside this argument.

### Evidence table → tests (`backend/test/unit/redirect-1.test.ts`, `admin/src/pages/Redirects.test.ts`)

| Spec row | Test |
|---|---|
| valid `from`, `to` → 201 | `R1-TAX-VALID + R1-TAX-SLASH` (item equals `redirectRouteItem`; the renderer's reader rule, copied, answers the redirect). The 308 itself: staging check (operator) |
| `from` owned by a published page → 409, route unchanged | `R1-TAX-PAGE + R1-R3` (read back, no write sent); `R1-R3` conditional write (page written between read and write → 409, page kept) |
| `from` under a reserved prefix → 400 guard text | `R1-TAX-RESERVED` ×2 (default and renamed `/shop`) |
| `to` absolute / empty / equal | `R1-TAX-TO` (+ scheme-relative, control character, backslash — ruling 4); `R1-F-CONTROLS` |
| `to` is a redirect → 400 | `R1-TAX-CHAIN`; home alias and concurrency: `R1-F-DESTINATION` (1)–(3); repeated-slash aliases: `R1-F-DESTINATION (review-1)` ×4; `IsRedirect: false` targets: `R1-F-TARGET-PREDICATE` ×2; non-Boolean flags (`"true"`, `1`): `R1-F-TARGET-PREDICATE (review-2)` ×4; reverse-chain order: "the order that is refused", "documented limitation" |
| trailing slash stored without it | `R1-TAX-SLASH` (pure and handler) |
| delete of a page → 409, nothing deleted | `R1-TAX-DELPAGE + R1-R5` (read back); conditional delete row |
| another tenant's `from` | `R1-TAX-TENANT` ×3 (body tenant ignored; t2's route neither blocks nor is deleted; t2 caller on t1 → 403, no command sent) |
| ruling 3 replace = delete then add | `R1-R3: an existing redirect at from → 409 …` |
| ruling 6 one mapping | `R1-R6` (18 kinds → status, all texts distinct; the `not-normal` text names the reason); `R1-F-REFUSAL-FORMATTING` (the `unclassified-route` text never throws) |
| system routes `/`, `/contact` | `R1-SYS` ×2, `R1-F-PROTECTED-DELETE + R1-SYS` |
| ruling 9 audit + purge | `R1-R9`, delete row |
| ruling 8 screen states | admin: empty, list, refusal shown, target not found (ruled text), failed load/delete, no site → no request |

### Findings and deferred debt (`docs/TECH-DEBT.md` § "REDIRECT-1 residuals")

- **F-REDIRECT1-REVERSE-CHAIN.** Only `to`-is-a-redirect is refused. Adding `B → C` while `A → B` exists makes a
  two-hop chain — also when the two requests overlap and `A → B` commits first (pinned by the "documented limitation"
  test); the other order is refused (pinned). A later slug rename makes the same chain (pre-existing behaviour of
  `update.ts`). Search engines follow it; not fixed (review-1: not in scope).
- **F-REDIRECT1-NON-ASCII-FROM.** An old address with upper case, non-ASCII letters, a dot or `%`-escapes cannot be
  entered by hand (`not-normal`; REDIRECT1-NORMAL-FORM = A); the WordPress importer has its own rule (decoded path).
  Follow-up only when a real old address needs it.
- **Target mark is route presence only:** a redirect to a built-in page is marked "target not found (no page at this
  address yet)" even when that page answers (operator ruling after review-0).
- **F-PREVIEW-REDIRECT-PREFIX** (known, ruling 11): not touched; renderer unchanged.
- **Name mismatch (surfaced, not renamed):** `RouteSchema` (`isRedirect`, `redirectTo`, `targetNodeId`) does not
  describe the stored route item (`IsRedirect`, `RedirectTo`, `TargetNode`). Rename/alignment is a shared-schema change →
  not done here.

REDIRECT1-NORMAL-FORM: raised as DECISION_REQUIRED in round 0; ratified A by the operator after review-0 (2026-11-27).

## Closeout 2026-11-27 — ON STAGING

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, five cycles, approved (review-4). After review-3 the operator froze
the scope: the stored redirect flag is absent, `false`, `true` or "any other value", and any other value is refused.

Operator-executed on the final tree:

| Check | Result |
|---|---|
| Gate script (build, typecheck, shared, plugins, renderer, serving, serving-bundle, admin unit, backend unit, infra, MCP, `git diff --check`) | every exit 0; no manifest, lockfile, renderer or package path changed |
| Staging diff, read before the deploy | added: `CreateRedirectFunc`, `DeleteRedirectFunc` with role, policy and log group each; routes `POST /redirects`, `DELETE /redirects`. Permissions as the content update function: table read-write, audit events, the revalidation secret, the purge trigger. Nothing removed |
| Staging deploy | `AmodxStack-staging` success line present |
| Add `/room-…/` → `/guest-house-…/` | 201, stored without the trailing slash; the site answers the old address 308 to the new one; before the add it answered 404 |
| Refusals, each with a read-back that nothing was stored or changed | page at the old address 409; existing redirect 409; absolute, scheme-relative, empty, same address, target that is a redirect, line break, doubled slash, upper-case old address, `/`, `/contact`, reserved prefix: 400 |
| Target with no page yet | accepted; the list marks it target not found, and the first redirect as found |
| Delete | a page address 409 with the page route unchanged; `/contact` refused; a redirect 200, then the old address answers 404; a second delete 404 |
| Admin screen Redirects, real browser | lists the redirects with the target-not-found mark; a refused add shows the reason; an added redirect appears and the site answers 308; delete after the confirmation removes the row and the item; no page error |
| Cleanup | every table item the run added is deleted; the test site's key set equals the one before |

**Not verified on staging.** The Location value on a preview address has no `/_site/<tenant>` prefix (known finding
F-PREVIEW-REDIRECT-PREFIX, out of scope), so the hop to the final page was not followed there. The 17 real addresses of
the exit criterion were validated by the reviewer against the request rule, not entered on a real site. The MCP tools
were not called against staging (route coverage and shape tests only).

Module maturity: `backend/src/redirects` PROTOTYPE.
