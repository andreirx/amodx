# SMALL-FIXES-1 — four recorded follow-ups (implementation record)

Status: **BUILT** (2026-11-16), uncommitted, awaiting review. Start: `main` at `cef3b69`, tree clean.
Direction (human, 2026-11-15): "no reason not to fix things that can be fixed right now". Packet: operator, 2026-11-16.
All oracles of the packet's § 4 pass on the final tree (§ 5). One old-name hit is outside the allocation (finding
F-SF1-SHARED-COMMENT, § 6): row B "appears nowhere in tests" is therefore not fully met.

## 1. A — a category create or update with a bad body answered 500; now 400

**Cause.** `backend/src/categories/create.ts` and `update.ts` called `JSON.parse(event.body)` and the schema's
`.parse(body)` inside the handler's `try`; both throw on a bad body, and the `catch` answered 500 with `e.message`
(`docs/slices/category-content-1.md` finding F-2).

**Change.** The shape of `content/create.ts` (BACKEND-CONTRACT-1 D1), in both handlers: a local `try`/`catch` around
`JSON.parse` → 400 `{"error":"Invalid JSON"}`; `.safeParse` instead of `.parse` → on failure 400
`{"error":"Validation failed","issues":[…zod issues…]}`.
- `backend/src/categories/create.ts:36-51`
- `backend/src/categories/update.ts:26-33` (JSON) and `:42-48` (schema)

The order of the steps in `update.ts` is kept: JSON first, then the Get, the 404, then the schema. So an unknown id with
a body that fails the schema still answers 404, as before. A 4xx answer skips the purge: `create.ts` is wrapped by
`withInvalidation` (it purges and writes the CDN marker on 2xx only, `backend/src/lib/invalidate-cdn.ts:278-281`);
`update.ts` calls `revalidateTenantPaths` after the write only. A real server failure still reaches the outer `catch`
→ 500.

No shared helper (packet § 2): two callers, two short blocks; repeated.

**Tests.** New `backend/test/unit/small-fixes-1-category-body.test.ts` (11 rows; the real handlers, `requireRole`
and `withInvalidation` against the in-memory table, so the CDN marker write is visible as a DynamoDB command):

| Case | Expected | Row |
|---|---|---|
| create: malformed JSON | 400 "Invalid JSON"; no DynamoDB command; no purge | `POST … malformed JSON` |
| create: no `name` | 400 "Validation failed", issue at `name`; no command; no purge | `… a missing name` |
| create: `blocks: "not an array"` | 400, issue at `blocks`; no command; no purge | `… blocks not an array` |
| create: valid | 201, purge once | `… a valid body` |
| create: the Put fails | 500 "injected failure"; no purge | `… DynamoDB fails on the write` |
| update: malformed JSON | 400 "Invalid JSON"; no command; no purge | `PUT … malformed JSON` |
| update: `blocks: "not an array"` (the F-2 staging case) | 400 at `blocks`; only the Get; item unchanged; no purge | `… blocks not an array` |
| update: `status: "archived"` | 400 at `status`; only the Get; item unchanged; no purge | `… an unknown status value` |
| update: valid | 200, purge once | `… a valid body` |
| update: unknown id | 404 | `… an unknown id` |
| update: the Get fails | 500; no write; no purge | `… DynamoDB fails on the read` |

Red before the change: 6 failed (the six 400 rows), 5 passed (EXECUTED). Green after (EXECUTED).

**Changed expectations (existing tests that pinned F-2).** `backend/test/unit/category-content-1.test.ts`:
- `:84-87` (POST, blocks not an array): `toBe(500)` + `error toContain("blocks")` → `toBe(400)` + `error` "Validation
  failed" + issues path `["blocks"]`.
- `:117-119` (PUT, blocks not an array): the same change.
The row names stay true ("refused…, nothing written"); the "nothing written" assertions are unchanged.

## 2. B — `checkSlugCommerceConflict` renamed `reservedAddressRefusal`

**Cause.** Since `cdl-2` the function reserves the addresses of the built-in pages the renderer serves for the
tenant's kind of site (cart, checkout, shop, product, category, account, search; the interest list on a catalog site),
not only commerce paths, and returns the refusal text or null (`docs/slices/cdl-2.md` F-CDL2-GUARD-NAME).

**Name.** `reservedAddressRefusal(tenantId, slug): Promise<string | null>` — it returns the REFUSAL text for a slug at
a RESERVED ADDRESS, else null; "check…Conflict" said neither the scope nor the return value. The file name
`slug-guard.ts` is kept (not asked; renaming it widens the change to every import path).

**Change (no behaviour change).** `backend/src/lib/slug-guard.ts:58-64` (the name and its NAME note);
`backend/src/content/create.ts:10,61-62`; `backend/src/content/update.ts:9,97-99` (the call and the stale comment
"commerce URL prefixes" beside it); test mocks `backend/test/unit/{bulk-purge:32, content-create-contract:12,20,
content-update-contract:14,23}.test.ts` (mock key + the header comment "commerce-prefix guard"); `cdl-2-paths.test.ts:20,27`
(import and call only — no assertion changed). Documents: `backend/ARCHITECTURE.md:56,62-63`; `docs/commerce.md:671`
(name and the description, which said "commerce URL prefixes"); `docs/plan-static-html-pages.md:696` (name only).

**Completeness.** Code: `npm run typecheck` exits 0 (a missed import or call fails to compile; a `vi.mock` factory key
is not type-checked, so the four mock files were found by search and their suites pass — the contract tests would see
`undefined` for a stale key). Text: `git grep -n checkSlugCommerceConflict` over every tracked file (EXECUTED) — the
remaining hits:
- `docs/slices/cat-interest-1.md:281`, `docs/slices/cdl-2.md:184,408,465` — past slice records, kept as history.
- `backend/.rgr/warm-cache/backend.{cache,vf}` — binary `rgr` index caches (tracked), not source; refreshed by the tool.
- `packages/shared/test/schemas.test.ts:108` — a comment in a test, OUTSIDE the allocation; not edited (F-SF1-SHARED-COMMENT).

## 3. C — a checkbox field printed its text twice

**Cause.** `packages/plugins/src/form/DynamicForm.tsx` drew, for every field, a label line above the control, and for
a checkbox also a wrapping label beside the box with `field.placeholder || field.label` (`docs/slices/shop-look-1e.md`
F-1E-CHECKBOX-LABEL).

**Change.** `DynamicForm.tsx:125-132`: the label line is drawn for every type but `checkbox` (for the other types the
markup is the same: `htmlFor={controlId}` gave the same attribute before). `:165-169`: the wrapping label holds the box
and one `<span>` with the text (placeholder, else label) and, when required, the same required mark as the other
labels. The `<span>` keeps the mark next to the text: the label is `flex gap-2`, so a bare mark would be one flex gap
away. The box's accessible name is the wrapping label's text. The submitted key is unchanged (`data[field.label]`,
`:79-81`, not edited).

**Baseline (the `hero.baseline.json` method).** `packages/plugins/test/dynamicForm.baseline.json`: the HTML of the
component at `cef3b69` (file equal to HEAD when recorded: `git diff --quiet HEAD -- packages/plugins/src/form/
DynamicForm.tsx` → 0, EXECUTED from the repository root) for the 14 inputs of `dynamicFormBaselineCases.ts` (text,
email, phone, number, textarea, select — each required with a placeholder and optional without; a select without
options; all six in one form), in `renderToStaticMarkup` and `renderToString`. Recorded by a one-off generator test,
deleted after use.

**Tests.** New `packages/plugins/test/dynamicForm.test.ts` (19 rows): 15 baseline rows (each case equal to the
baseline in both renderers, plus the case list), and 4 checkbox rows — no placeholder: the label once, inside the
wrapping label, no label line; with a placeholder: the placeholder once, the label absent; required: the mark once,
one `<label>`; a mixed form: the six other rows equal the baseline rows, the checkbox row is the only addition. Red
before the change: 4 failed, 15 passed (EXECUTED). Green after (EXECUTED).

**Changed expectations.** `packages/plugins/test/formBlock.test.ts`:
- `:66-67`: the checkbox markup `…/>I agree</label>` → `…/><span>I agree<span class="text-destructive ml-1">*</span></span></label>`.
- `:73-75`: `toContain('<label class="text-sm font-medium block mb-1">Terms…')` → `not.toContain("Terms")` and no
  label line without `for`.

**Serving rows `sl1e-*`.** The fixture `SL1E_FIELDS` (`renderer/test/serving-contract/fixtures.mjs:1025-1030`) holds
no checkbox (text, email, select, textarea). No `sl1e-*` expectation changed; both rows pass (§ 5).

## 4. D — stale comment

`renderer/src/components/InterestShortlist.tsx:12-13`: "as DynamicForm does for forms" now names the real file,
`packages/plugins/src/form/DynamicForm.tsx` (the `form` block since SHOP-LOOK-1E). The claim was checked: that
component calls `fetch` from the browser (`DynamicForm.tsx:91`). No code change.

## 5. Gates (final tree; all EXECUTED, each exit code by `echo $?`)

| Oracle | Exit | Result |
|---|---|---|
| root `npm run build` | 0 | — |
| `npm run typecheck` | 0 | — |
| `backend`: `npm run test:unit` | 0 | 57 files passed, 1 skipped (`cat-import-profile-1-golden.capture.test.ts`, capture-only, unchanged); 1456 passed, 1 skipped |
| `packages/plugins`: `npm test` | 0 | 12 files, 351 passed |
| `packages/shared`: `npm test` | 0 | 22 files, 385 passed |
| `renderer`: `npm test` | 0 | 45 files, 625 passed |
| `renderer`: `npm run test:serving` | 0 | 124 / 124; `sl1e-form`, `sl1e-draws-nothing` ok; no capture or expectation changed (`git status renderer/test` empty) |
| `admin`: `npm run test:unit` | 0 | 15 files, 296 passed |
| `tools/mcp-server`: `npm test` | 0 | 17 passed (no route changed; `routes.json` not refreshed) |
| `git diff --check` | 0 | new (untracked) files checked separately: no trailing whitespace |

## 6. Findings

- **F-SF1-SHARED-COMMENT** (allocation): `packages/shared/test/schemas.test.ts:108` names `checkSlugCommerceConflict()`
  in a comment. The path is outside the allocation, so it was not edited. Fix: replace the name with
  `reservedAddressRefusal()` (comment only). Needs an allocation decision.
- **F-SF1-README** (stale text, not the name): `backend/README.md:28` says "slug-guard checks commerce prefix conflicts".
  It does not name the function; it describes the pre-`cdl-2` scope. Outside the allocation; not edited.
- **F-SF1-OTHER-500** (non-scope, packet § 6): handlers that call `JSON.parse(event.body…)` and do not contain the
  "Invalid JSON" answer — candidates for the same 500-on-a-bad-body defect. Basis: a text search
  (`grep -rl "JSON.parse(event.body" backend/src | xargs grep -L "Invalid JSON"`), INFERRED, not checked one by one;
  some may catch the error another way. 46 files: assets/create, comments/{create,moderate}, consent/create,
  contact/send, content/restore, context/{create,update}, coupons/{create,public-validate,update},
  customers/{public-update,update}, delivery/update, forms/{create,public-submit,update},
  import/{glam-images,glam-pricelist,media,reviews,woocommerce,wordpress}, leads/create,
  orders/{create,update-status,update}, popups/{create,update}, products/{bulk-price,create,update}, research/search,
  resources/presign, reviews/{create,update}, service-keys/create, signals/{create,update}, tenant/{create,settings},
  themes/manage, users/{invite,toggle-status,update}, webhooks/paddle. Of these, a throwing schema `.parse(body…)` is
  seen in: comments/create, context/create, coupons/{create,update}, leads/create, popups/{create,update},
  signals/create.
- **Observation (admin text):** a refused category save now shows the admin "Validation failed" instead of the zod
  message (the shape ruled for A, the same as content pages). The issues are in the body.

## 7. Assumptions and deviations

- `docs/plan-static-html-pages.md` is counted as a current document (a ratified plan, not a past slice record); only
  the name was changed there.
- `backend/ARCHITECTURE.md` also gains two lines on the categories' 400 answers (`:102-103`), the documentation
  step of the definition of done.
- No deviation from a ratified assumption.

## 8. Operator closeout

**Review.** One build, one review: escalate on one point (SF1-SHARED-COMMENT: a comment in
`packages/shared/test/schemas.test.ts:108`, outside the allocation, still named the old function); the review
states it approves the rest. Operator ruling: the path joins the allocation and the operator replaced the name in
that comment (a mechanical edit after the review). Builder `claude-opus-5-5`; reviewer `claude-sonnet-5-5`
(fallback). Same provider family; not cross-vendor independence.

**Operator gates (2026-11-16, on the tree with the comment edit).** Build, typecheck, shared, plugins, renderer,
serving, admin unit, backend unit, MCP, `git diff --check`: each exit 0. Protected paths, captures, trailing
whitespace: no line. The allocation check of the operator's script names only
`packages/shared/test/schemas.test.ts`, the path ruled in above.

**Staging (deployed 2026-11-16; diff read first: seven functions, two bucket deployments, the admin runtime config,
nested-stack descriptions).** Admin API, tenant `cm1-commerce`.

| Request | Answer |
|---|---|
| category create, malformed JSON | 400 "Invalid JSON" |
| category create, no name | 400 "Validation failed" with the issue |
| category create, valid body | 201 |
| category update, `blocks` not an array | 400 "Validation failed" (was 500) |
| category update, malformed JSON | 400 "Invalid JSON" |
| category update, valid body | 200 |
| a page saved at `/cart` | 400 with the built-in page named (the renamed function still refuses) |

Not checked on staging: the checkbox label in a browser (unit-bound, with a baseline for the other field types).
The probe category was deleted.

Prod deploy: the human's.
