# IMPORT-POLICY-1 — editors import inside their own tenant; imported WordPress slugs are kept and marked in red for human review

Status: **SHIPPED 2026-10-26** (prod from main `444abfa`, human-run deploy 19:04Z, § 13). Previous: **DEPLOYED-STAGING 2026-10-16** (§ 12; review approved at run-3 cycle 2 on `gpt-6.1-sol`; live probe 14/14; prod on the human's word). Build-time status line kept below: **IMPLEMENTED 2026-10-16** — code complete in two build cycles (cycle 2 = the operator rulings after review-0,
§ 3a) plus revision 1 (documentation only: the ruling on `IP1-EDITOR-CLAIM-SOURCE` recorded, § 3a); all oracles
exit 0 (§ 8). Validation pending: review, then the operator's staging run (§ 7) and deploy. Not deployed.
Track: backend correctness (follow-up of `backend-contract-1`, named there in `docs/ROADMAP.md`).
Depends: `backend-contract-1` (D3 `normalizeSlug`, D4 import key ownership).
Source plan: none — the builder packet of 2026-10-16 is the plan; both problems were root-caused on the code.
Maturity target: the import handlers and the content API stay **MATURE**; this slice changes a policy and adds
review warnings, it does not change the maturity level.

## 1. Human rulings (2026-10-16), quoted

1. "we need an editor to be able to import only in the tenants they are allowed to, similar for the tenant admin"
2. Imported slugs: "keep things as they are and maybe add some warnings in red where applicable so humans review"

## 2. Purpose / risk retired

| # | Defect | Effect before this slice |
|---|--------|--------------------------|
| 1 | `import/media.ts` and `import/wordpress.ts` called `requireRole(auth, ["TENANT_ADMIN"], tenantId)` | An EDITOR saw the import in the admin (`Sidebar.tsx` "WP Migration", `ContentList.tsx` import button) and got `403 Access Denied: Role 'EDITOR' is not in [TENANT_ADMIN]` |
| 2 | The WordPress importer stores `/${wp:post_name}` raw; `normalizeSlug` is not in that path | A page with `_` or percent-encoded characters in its slug is served at a URL that does not follow the site's slug rules, and nothing told a human |

## 3. Scope (per D)

### D1 — editor import, tenant-bound
`backend/src/import/media.ts` and `backend/src/import/wordpress.ts`: the role list is now `["TENANT_ADMIN", "EDITOR"]`;
`tenantId` stays the third argument, so `requireRole` (`backend/src/auth/policy.ts`) still requires the token tenant
to equal `x-tenant-id` (GLOBAL_ADMIN passes with no tenant check, as before). A token with no role counts as EDITOR
(`policy.ts`, `auth.role || 'EDITOR'`). The D4 prefix check (`s3Key` inside `<tenantId>/`) is unchanged. The comment
block in `wordpress.ts` states the new role set.

What this grants (OBSERVED on the code): an EDITOR already may create content (`content/create.ts`
`["EDITOR", "TENANT_ADMIN"]`), update content (`content/update.ts`) and upload assets (`assets/create.ts`) for its own
tenant. The import is a bulk path to the same writes. Roles the authorizer can emit (`auth/authorizer.ts`):
`GLOBAL_ADMIN`, `RENDERER`, Cognito `custom:role` (default `EDITOR`), `CUSTOMER`. `RENDERER` and `CUSTOMER` stay
refused.

### D2 — one `normalizeSlug`, in the shared package
`normalizeSlug` and its doc comment moved from `backend/src/lib/slug.ts` (deleted) to `packages/shared/src/slug.ts`,
re-exported from `packages/shared/src/index.ts` (`export { normalizeSlug, needsSlugReview } from "./slug.js"`).
`backend/src/content/create.ts` and `update.ts` import it from `@amodx/shared`. Function body byte-identical. The
"follow-up, not this slice" sentence about the WordPress importer now reads: kept raw by decision (human, 2026-10-16,
IMPORT-POLICY-1): the page keeps the URL `/<wp:post_name>` exactly as WordPress had the post name (the permalink's
folder structure is not kept — ruling IP1-WARNING-TRUTH); the admin marks such slugs in red for review. (Cycle 1 used
the packet's words "keeps its original WordPress URL"; that is false when the permalink had folders — § 3a.)

Justification line: shared module `normalizeSlug`; concrete users backend `content/create.ts` / `content/update.ts`
and admin `ContentList.tsx` / `ContentEditor.tsx`; no new axis of variation — one rule, two packages; rejected
alternative: a copy of the regex in `admin/` (the warning would drift from what the API stores — the defect class D3
of `backend-contract-1` closed).

### D3 — red review warnings on three admin surfaces
Predicate everywhere: `needsSlugReview(slug) = slug !== normalizeSlug(slug)`, exported next to `normalizeSlug`.
No new component; inline JSX. No API response changes — the admin computes the predicate from the slug it already has.

**What the warnings can and cannot know (ruling IP1-WARNING-TRUTH).** `needsSlugReview` is a text rule: it knows the
slug's characters, not where the slug came from. The importer stores `/<wp:post_name>`
(`backend/src/import/wordpress.ts:192-193`, "FLATTEN everything"), so an imported page does NOT keep its WordPress
permalink when that permalink had folders (`/2024/05/<name>/`). No warning text claims WordPress origin or an exact
original URL.

- `admin/src/pages/ContentList.tsx` slug cell: red badge `REVIEW SLUG` (shape of the `HOME` badge,
  `bg-red-100 text-red-700 border-red-200`), `title="This URL does not follow the site's slug rules (for example an
  underscore or encoded characters) and is served exactly as stored. Open the page to review it."`. Guarded by `item.slug !== undefined` because `ContentItemSchema.slug` is optional — a page with
  no slug has no URL, so the badge text would be false for it.
- `admin/src/pages/ContentEditor.tsx` URL field: a `text-xs text-red-600` line below the `URL:` row.
  - Shown when `needsSlugReview(slugWithLeadingSlash)`, where `slugWithLeadingSlash = "/" + form.slug.replace(/^\//, "")`.
    The field hides the leading `/` and, once edited, stores the typed value without it; the predicate is applied to
    the slug with its slash (ruling IP1-EDITOR-RED-ON-EDIT), so an ordinary edit such as `about-us` is not flagged.
  - Unedited (`form.slug === serverState?.slug`): "This URL does not follow the site's slug rules and is served exactly
    as shown. If you change it, it is saved as <normalizeSlug(form.slug)> and the old URL redirects to the new one."
    Edited: "Will be saved as <normalizeSlug(form.slug)>."
  - Rule for the claims in the line: every claim is computed from `form.slug`, the exact value `save()` sends
    (`...form`), with the comparison `content/update.ts:94` makes (`input.slug === oldSlug` keeps; otherwise
    `normalizeSlug(input.slug)`). The redirect claim is backed by `update.ts` (a changed slug writes the redirect
    old → new in the same transaction). This is the ratified rule (`IP1-EDITOR-CLAIM-SOURCE = A`, § 3a); it supersedes
    the letter of IP1-EDITOR-RED-ON-EDIT, which also used the slash form for the stored-state test and the
    `<normalised>` text.
- `admin/src/pages/Migration.tsx` Step 3: a second paragraph, `text-xs text-red-600`: "Imported pages get the URL
  /<WordPress post name>, stored exactly as WordPress had it; the permalink's folder structure (for example /2024/05/)
  is not kept. Pages whose URL does not follow this site's slug rules are marked REVIEW SLUG in Content — check them
  after the import." (`<` `>` are written as `&lt;` `&gt;` in JSX.)

### 3a. Operator rulings after review-0 (2026-10-16) and how they were applied

- **IP1-WARNING-TRUTH = A** — applied with the ruled copy at the three surfaces. The same class (a text claiming
  WordPress origin or the original WordPress URL) was closed in every changed file: the `slug.ts` doc comments of
  `normalizeSlug` and `needsSlugReview`, and this document (§ 3 D2, § 10).
- **IP1-DOC-SCOPE = A** — `packages/shared/ARCHITECTURE.md` lists `slug.ts` in its module tree and both functions in
  its Functions table. `backend/ARCHITECTURE.md`, `docs/ROADMAP.md` and `docs/slices/backend-contract-1.md` unchanged
  by the ruling.
- **IP1-EDITOR-RED-ON-EDIT = B** — applied to the show/hide decision. NOT applied to the stored-state test and the
  `<normalised>` text, because the ruling's premise ("the API adds the slash") does not hold on the code: the API
  compares the raw sent value (`update.ts:94`). Two cases where the letter of the ruling gives a false text:
  (1) stored `/foo_bar`, the user types in the field and returns to the same text → `form.slug` is `foo_bar`;
  `"/" + "foo_bar" === "/foo_bar"` would show "served exactly as shown", but save renames the page to `/foo-bar`;
  (2) a leading space, `form.slug = " x"` → the slash form normalises to `/-x`, the API stores `/x`. The builder
  raised decision `IP1-EDITOR-CLAIM-SOURCE` in the cycle-2 build report.
- **IP1-EDITOR-CLAIM-SOURCE = A, as built** (operator ruling, 2026-10-16, packet § 7) — RESOLVED. The slash form
  (`slugWithLeadingSlash`) decides only whether the red line is shown. The claims in the line ("served exactly as
  shown" / "Will be saved as …") follow the raw `form.slug`, which is what `save()` sends and what `update.ts:94`
  compares (`input.slug === stored ? keep : normalizeSlug(input.slug)`). This ruling supersedes the letter of
  IP1-EDITOR-RED-ON-EDIT for those two claims. No code change followed from the ruling: the cycle-2 code already
  implements it.
- **Oracle defect accepted** — the precise oracle is `grep -rn "lib/slug\.js\|lib/slug\"" backend/src backend/test`.

## 4. Non-scope

No route change, no new endpoint, no API response change, no CDK, no renderer change, no change to `policy.ts`, no
commerce handler, no `woocommerce.ts`, no normalisation at import time, no redirect generation, no deploy.

## 5. Architectural boundaries

- Tenant isolation: the import stays bound to the token tenant (`requireRole` third argument) and to the
  `<tenantId>/` key prefix.
- `@amodx/shared` stays pure: `slug.ts` has no I/O and no dependency.
- Dependency direction unchanged: backend and admin already depended on `@amodx/shared`; no new edge.

## 6. Migration / deployment notes

None for data. Deploy: backend import + content Lambdas and the admin SPA. Rollback: revert the commit.

## 7. Definition of Done / evidence required

Bound tests:

`backend/test/unit/import-key-ownership.test.ts`, for both handlers:
- renamed: "EDITOR of its own tenant → authorised: GetObject called with the key; status is not 403"
- added: "EDITOR of tenant t1 with header t2 and s3Key 't2/x.xml' → 403, no S3 call, no DynamoDB call"
- NOT bound: "role absent on the token → treated as EDITOR (policy.ts:15), own tenant → authorised". The `event()`
  helper declares `role = "TENANT_ADMIN"` as a destructuring default, so `{ role: undefined }` becomes
  `TENANT_ADMIN`; the test would pass for the wrong reason. Binding it needs a helper change, which the packet
  excluded.
- unchanged and green: the TENANT_ADMIN prefix tests and the forged-header test. (The file has no GLOBAL_ADMIN test;
  its header says so.)

`packages/shared/test/slug.test.ts` (moved from `backend/test/unit/slug.test.ts`; imports `../src/index.js`, which
also proves the public export): the five existing `normalizeSlug` cases unchanged, plus `needsSlugReview`:
`"/foo_bar"` → true, `"/%d0%b1"` → true, `"/foo-bar"` → false, `"/"` → false, `"/already/ok"` → false.

Admin: no page component test harness exists; the three surfaces are proven by the root typecheck plus the
operator's staging run — import a two-item WXR (one slug with `_`) on the cache-probe tenant and screenshot the three
surfaces. NOT RUN by the builder.

## 8. Evidence (2026-10-16, builder; cycle 2 results — cycle 1 gave the same counts)

| Oracle | Result | Label |
|---|---|---|
| `packages/shared`: `npm run build && npm test` | exit 0 / exit 0; 5 files, 107 tests | EXECUTED |
| `backend`: `npm run test:unit` | exit 0; 25 files, 302 tests; the renamed and added EDITOR tests listed by name for both handlers | EXECUTED |
| root `npm run typecheck` | exit 0, 0 `error TS` (cycle 1 first run: exit 2, `ContentList.tsx` `string \| undefined` — fixed by the guard in D3) | EXECUTED |
| `admin`: `npm run test:unit` | exit 0; 2 files, 18 tests | EXECUTED |
| `git diff --check` | exit 0; the untracked new files have no trailing whitespace | EXECUTED |
| `grep -rn "lib/slug\.js\|lib/slug\"" backend/src backend/test` (precise oracle, § 3a) | prints nothing (exit 1) | EXECUTED |
| Model of the editor line vs `update.ts:94` against the built `normalizeSlug` (6 cases: imported untouched / typed back / normal edit / bad edit / leading space / untouched) | built logic agrees with what the API stores in 6/6; the ruling's letter disagrees in 2/6 (§ 3a) | EXECUTED (the model copies the logic; the component itself is INFERRED) |
| Staging screenshots of the three surfaces | — | NOT RUN (operator) |

## 9. Known open items

- No decision is open. `IP1-EDITOR-CLAIM-SOURCE` is resolved (A, as built — § 3a).
- A pre-existing behaviour, not changed by this slice: any keystroke in the URL field drops the leading `/` from
  `form.slug`, so a page whose stored slug breaks the rules is renamed on save even when the visible text was typed back
  unchanged. The red line states this ("Will be saved as …").
- `docs/ROADMAP.md` (`backend-contract-1` row) and `docs/slices/backend-contract-1.md` still name
  `backend/src/lib/slug.ts`: as-shipped historical records, kept by ruling IP1-DOC-SCOPE; the operator's
  `import-policy-1` ROADMAP row names the new location.

## 10. Exit criterion

An EDITOR can run the WordPress migration for its own tenant; a human reviewing content sees, in red, every page whose
URL does not follow the site's slug rules (whatever its origin) and what a rename would store.

## 11. References

`docs/slices/backend-contract-1.md` (D3, D4); `backend/src/auth/policy.ts`; `backend/src/import/wxr-parser.ts`
(`wp:post_name`); `renderer/src/components/SitePage.tsx` → `renderer/src/lib/dynamo.ts` (exact-key serving).

## 12. Staging verification (operator, 2026-10-16 — appended after review approval and the staging deploy)

- Review history: run 1 review-0 `gpt-6-sol` escalate (3 correct packet findings → rulings packet § 6); run 2 builder cycle 2 complete,
  reviewer `gpt-6-sol` failed 4 attempts (503 ×5, "Selected model is at capacity", 07:46–07:53Z); run 3 resumed at `review-impl` on the
  capacity fallback `gpt-6.1-sol`: revise (one doc item, `IP1-DOC-DECISION-STATE`) → approved at cycle 2. Builder `claude-opus-5-5`.
- Operator gates on the approved tree: shared build + test 107/107, backend `test:unit` 302/302, root typecheck 0, admin `test:unit` 18/18,
  `git diff --check` 0, `grep "lib/slug\.js|lib/slug\""` empty. Log: operator scratchpad `IMPORT-POLICY-1/gates.log`.
- `cdk deploy -c stage=staging AmodxStack-staging` exit 0 (log `IMPORT-POLICY-1/deploy-staging.log`).
- Live probe `ip1-probe.ts` (operator scratchpad; log `ip1-probe.log`): **14/14 PASS.** An EDITOR user was created on the staging admin
  pool (`custom:role=EDITOR`, `custom:tenantId=cache-probe-2026`), signed in through the real admin login page (SRP by the SPA; nothing
  on the pool client changed), and its id token used for the API checks. D1: `/import/wordpress` own tenant → 200 (created 2); foreign
  `x-tenant-id` → 403 "You do not have access to this tenant"; `/import/media` own tenant → not 403 (500 on the missing key, after the
  role check); foreign → 403. Raw slug: `/ip1_under_score-<ts>` stored with the underscore and served 200 at that exact URL;
  `/ip1-normal-<ts>` stored as-is. The three admin surfaces rendered as that editor and screenshotted (`shot-content-list.png`,
  `shot-content-editor.png`, `shot-migration.png`): red `REVIEW SLUG` badge on the underscore page; the red line under the URL field
  with the exact "saved as /ip1-under-score-<ts>" text; the red Step 3 paragraph. The list also badged three legacy archived probe pages
  stored with uppercase before BACKEND-CONTRACT-1 (`/opn1-e22-cold-20261015T191602Z`, `/opn1-e15-…`, `/opn1-e1-…`) — the class the
  predicate exists for. Cleanup: both pages archived (200), the editor user deleted (pool filter count 0).
- Prod: on the human's word (`cdk diff` prod expected: CatalogApi import/content Lambda assets + the admin bucket deployment; no infra
  resource change). Follow-ups unchanged (§ 9).

## 13. Prod deploy and verification (operator, 2026-10-26 — appended after the human's prod deploy)

- **Deploy.** Human-run `cdk deploy -c stage=prod AmodxStack` from main `444abfa` (this slice + the 2026-10-26 dependency
  re-triage, `docs/TECH-DEBT.md`); Lambda `LastModified` 19:04:04Z (`ImportFunc`), 19:04:05Z (`MediaImportFunc`),
  19:04:04Z (`ReviewImportFunc`); admin bundle `index-D2suczwZ.js` served from `admin.amodx.net`.
- **Read-only checks (no EDITOR account exists on prod; D1 was proven on staging with a real EDITOR login, § 12):** the served
  admin bundle carries the three surfaces — `REVIEW SLUG` ×2 (list badge + title), the editor's "does not follow the site" line,
  the Migration Step 3 note ("stored exactly as WordPress had it"); `config.json` keys unchanged, `VITE_API_URL=https://api.amodx.net/`.
- **Does not prove:** the 403 for a foreign-tenant EDITOR on prod itself (would need a prod EDITOR account). The policy line is the
  same `requireRole(auth, ["TENANT_ADMIN", "EDITOR"], tenantId)` in both handlers, exercised by `import-key-ownership.test.ts`.

