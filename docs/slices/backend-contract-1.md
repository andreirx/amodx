# BACKEND-CONTRACT-1 — content API: validation answers 400, SEO fields round-trip, one slug normaliser, import keys stay inside the tenant

Status: **DEPLOYED-STAGING 2026-10-16** (§ 11; review approved at run-2 cycle 3; prod on the human's word). Build-time status line kept below: **IMPLEMENTED 2026-10-16** — code complete in two build cycles (cycle 2 = the operator rulings that followed
the escalation review) plus revision 1 (after the claims review: names and claims narrowed to what is checked; one
message corrected) and revision 2 (after the provenance review: review labels corrected, documentation only). Review
history and record locations: § 7. All oracles exit 0. Validation pending: review, then the operator's deploy and the
human's word. Not deployed.
Track: backend correctness (human direction "Backend slice now", 2026-10-16).
Depends: none.
Source plan: none — the builder packet of 2026-10-16 is the plan; each problem was root-caused on the code and
reproduced on staging 2026-10-15.
Maturity target: content API create/update and import handlers stay **MATURE**; this slice removes contract
defects, it does not change the maturity level.

## 1. Purpose / risk retired

Places where the content API's behaviour contradicts its own contract:

| # | Defect | Effect before this slice |
|---|--------|--------------------------|
| 1 | zod `.parse()`, `JSON.parse()` and (update) `requireRole` throw inside the handler `try`; the update `catch` answers 500 for everything | a client mistake, a forbidden caller or a rename onto a taken slug is reported as a server fault (`PUT /content/<id>` with `seoTitle: null` → 500) |
| 2 | schemas reject `null` for the SEO fields, while update writes `null` for them | GET → PUT round-trip of an unchanged page fails |
| 3 | create normalises slugs; update only prepends `/` | a renamed page is stored `/OPN1-…` and the renderer serves `/opn1-…` → 404 (`opennext-1b.md` § 18) |
| 4 | import handlers `GetObject` any `s3Key`; `import/wordpress.ts` has no role/tenant binding at all | a caller can make the importer read another tenant's upload — and (wordpress) import pages into another tenant by naming it in `x-tenant-id` |

## 2. Scope (the ratified definition of done)

### D1 — client errors are 4xx, not 500
`backend/src/content/create.ts`, `backend/src/content/update.ts`:
- `JSON.parse` failure → `400 {"error":"Invalid JSON"}`.
- schema failure (`safeParse`) → `400 {"error":"Validation failed","issues":<zod issues>}`, before any DB call.
- update (cycle 2): `requireRole` failure → `403 {error}`, wrapped as `create.ts` does; every
  `TransactionCanceledException` → `409`, mapped as `create.ts` does. Verified on the code: the `ROUTE#<newSlug>` Put
  carries `ConditionExpression: "attribute_not_exists(SK)"` inside the single `TransactWriteCommand`, so a taken slug
  cancels the transaction (reason `ConditionalCheckFailed`) — the case the mapping is for. The SDK documents other
  cancellation reasons (`TransactionConflict`, `ProvisionedThroughputExceeded`, `ThrottlingError`, `ValidationError`,
  `ItemCollectionSizeLimitExceeded`); they also answer 409, exactly as in `create.ts` (residual, § 7). The message
  therefore names the slug clash as an example only: "Update cancelled by the database transaction (for example, the
  new slug is already taken)".
- everything else stays 500.

### D2 — null round-trip
`seoTitle`, `seoDescription`, `seoKeywords`, `featuredImage`, `schemaType` accept `null`:
- `update.ts` `StrictUpdateSchema`: `z.string().nullable().optional()` (all five).
- `packages/shared/src/index.ts` `ContentItemSchema` (parsed by `create.ts`): the four string fields
  `z.string().nullable().optional()`; `schemaType` is `SchemaType.nullable().optional()` — **the enum is kept** (§ 6).
- Update merge: absent (`undefined`) = keep the stored value; `null` = clear (store `null`); string = set. Implemented
  with an explicit `=== undefined` test (`keepOrSet` in `update.ts`), because `??` reads `null` as "keep".
- Create writes `null` as `null` (the item builder copies the parsed value; no code change needed there).
- Consumer adapted (ruling BC1-RENDERER-NULL = A): `renderer/src/components/SitePage.tsx` passes
  `content.seoDescription ?? undefined` to Next's `openGraph.description` (type `string | undefined`). The value could
  already be `null` at runtime before this slice; the shared type now says so. The top-level `description` accepts
  `null` and is unchanged.

### D3 — one slug normaliser
New `backend/src/lib/slug.ts` `normalizeSlug(raw)` = the former `create.ts` `cleanSlug`, unchanged: lowercase, trim,
`[\s_]+`→`-`, strip `[^a-z0-9-/]`, collapse `-+`, strip trailing `-`, ensure leading `/`. `create.ts` uses it (local
helper deleted). `update.ts`:
`newSlug = input.slug === undefined || input.slug === current.slug ? current.slug : normalizeSlug(input.slug)`; the
`slugChanged` logic and the commerce-prefix guard are unchanged.

**The guarantee, exactly:** a slug supplied to create, and a slug supplied to update that differs from the stored one,
is stored in normalised form. **Not guaranteed:** (a) update keeps a slug that is absent or resent unchanged — the
admin resends `slug` on every save (`admin/src/pages/ContentEditor.tsx` `save()`), and a legacy page's live URL must
not move because of an unrelated edit; (b) the WordPress importer stores raw `/${wp:post_name}` slugs and does not call
the normaliser (follow-up, not this slice); (c) the normaliser keeps repeated leading slashes (`//a` → `//a`) —
unchanged, ratified as is.

### D4 — import key ownership
Key ownership = **the caller is authorised for the target tenant (`requireRole`) AND the key is inside the tenant
prefix** — never the prefix check alone (a caller who forges `x-tenant-id` also chooses a matching key). "Authorised for
the target tenant" means: a TENANT_ADMIN whose token tenant equals `x-tenant-id`, **or a GLOBAL_ADMIN, which
`requireRole` passes with no tenant check** (`backend/src/auth/policy.ts` step 1: "Global Admin (or Robot) allows
everything").
- Binding: `backend/src/import/media.ts` already called `requireRole(auth, ["TENANT_ADMIN"], tenantId)`.
  `backend/src/import/wordpress.ts` now does the same (ruling BC1-WP-AUTH = A), with the same `try/catch → 403 {error}`
  shape, after the `tenantId` presence check and before any S3 read or DynamoDB write — so it also guards the inline
  `wxrContent` path. `requireRole` passes GLOBAL_ADMIN (and the master key, which the authorizer maps to GLOBAL_ADMIN)
  with no tenant check; otherwise it requires role TENANT_ADMIN and token tenant === header tenant.
- Prefix: both handlers answer `403 {"error":"s3Key is not owned by this tenant"}` before any S3 read when
  `!s3Key.startsWith(`${tenantId}/`)`. The trailing `/` is part of the check, so tenant `t1` cannot read `t10/…`.
- Consequence (OBSERVED in cycle 2; follows from the ratified role set, not named in the ruling — surfaced for the
  operator): `admin/src/pages/ContentList.tsx:84` calls `/import/wordpress` with inline `wxrContent` and has no role
  gate in the UI; an EDITOR who uses that Import button now gets 403.

## 3. Non-scope

No route change, no new endpoint, no DELETE /content, no `users/*` change, no commerce handler, no CDK, no deploy
(operator). Renderer: exactly one file, `renderer/src/components/SitePage.tsx` (ruling BC1-RENDERER-NULL). The WordPress
importer's raw slugs are not normalised (follow-up). `users/list` returning the whole pool to GLOBAL_ADMIN is by design
(dropped after root-causing: `admin/src/pages/Users.tsx:183`).

## 4. Architectural boundaries

- Tenant isolation (CLAUDE.md rule 3): D4 authorises the importer caller for the target tenant (GLOBAL_ADMIN
  excepted, § 2 D4) and keeps S3 reads inside the tenant prefix.
- Shared-first types (rule 4): the shared schema changes first; every dependent workspace typechecks (§ 5, O2).
- `normalizeSlug` is pure (no I/O) and lives in `backend/src/lib/`; two concrete callers (create, update).
- D1 adds one new response shape at the HTTP boundary: the 400 body `{"error":"Validation failed","issues":[…]}`.
  It is plain JSON (zod's `issues` array is plain objects: `code`, `path`, `message`, …) — no framework object
  crosses the boundary. The 403 and 409 bodies keep the existing `{"error": string}` shape.

## 5. Evidence (bound tests and oracles)

Bound tests (all credential-free, db-mock seam of `backend/test/unit/revalidate-order.test.ts`). In backend test
names, "writes X" means X is in the DynamoDB command the handler sends to the mocked client; nothing is persisted.

| File | Test names (as executed) |
|------|-------|
| `backend/test/unit/content-update-contract.test.ts` | "seoTitle absent → 200, :st = the stored value (keep)"; "seoTitle null → 200, :st = null (clear)"; "seoTitle string → 200, :st = the string (set)"; "seoTitle number → 400 with issues[0].path == ['seoTitle']; no db call at all"; "token for another tenant (auth.tenantId t9 ≠ header t1) → 403, no db call"; "rename whose TransactWrite is cancelled (mocked TransactionCanceledException, ConditionalCheckFailed) → 409; the ROUTE#/taken Put sent is conditional"; "body not JSON → 400 'Invalid JSON'"; "slug '/Foo Bar' → 200, writes slug /foo-bar and a redirect Put from /old"; "legacy slug resent unchanged ('/Legacy%20Slug') → 200, writes no slug and no ROUTE# Put; response slug unchanged"; "legacy slug changed to '/New Slug' → writes slug /new-slug and a redirect Put from '/Legacy%20Slug'"; "slug absent → 200, writes no slug; response slug is the stored /old" |
| `backend/test/unit/content-create-contract.test.ts` | "slug 'My Page' + seoTitle null → 201, writes slug /my-page, ROUTE#/my-page and seoTitle null"; "blocks: 'x' → 400 'Validation failed' with issues; no TransactWrite" |
| `backend/test/unit/slug.test.ts` | `normalizeSlug`: `My Page`→`/my-page`; `/A_B--C!`→`/a-b-c`; `/already/ok` unchanged; `trailing-`→`/trailing`; `//a`→`//a` (characterisation of unchanged behaviour) |
| `backend/test/unit/import-key-ownership.test.ts` | per handler (media, wordpress): "s3Key under another tenant's prefix → 403, S3 never called"; "s3Key whose prefix only STARTS like the tenant id ('t10/…') → 403"; "forged header (token t1, header t2, s3Key 't2/x.xml') → 403, no S3 call, no DynamoDB call"; "EDITOR of its own tenant → 403, no S3 call, no DynamoDB call"; "s3Key under '<tenantId>/' → GetObject called with exactly that key; status is not 403". GLOBAL_ADMIN is not exercised. |
| `packages/shared/test/schemas.test.ts` | "ContentItemSchema accepts null for seoTitle, seoDescription, seoKeywords, featuredImage, schemaType; still rejects a non-enum schemaType and a numeric seoTitle" — schema only; no handler, GET or PUT is called |

What is NOT verified by any test in this slice: a real GET→PUT round-trip through the deployed handlers, and
DynamoDB's actual response to the conditional route Put (the exception is mocked). Both need the operator's deployed
run.

Discrimination (EXECUTED 2026-10-16, revision 1, temporary worktree removed; output in the relay's
`rev1-discrimination.txt`):
- `HEAD` (63d4caa; one docs-only commit since e3ef337, no overlap with this slice's files) source + the current
  update/import/create tests → 15 fail, 8 pass. The 8 that pass are the cases `HEAD` already satisfies: seoTitle
  absent (keep) and string (set); legacy slug resent unchanged and slug absent (`HEAD` never renamed an identical or
  absent slug); media forged header and media EDITOR (`media.ts` already called `requireRole`); own-key GetObject ×2.
  Every other case fails on `HEAD`, with the old fault (e.g. `expected 500 to be 400`, `expected 200 to be 403`).
- Mutations of the current source, each reverting one cycle-2 rule; each is caught by exactly its bound test(s):
  M1 slug rule back to cycle-1 → "legacy slug resent unchanged…" fails; M2 409 mapping removed → "rename whose
  TransactWrite is cancelled…" fails; M3 update role failure rethrown → "token for another tenant…" fails; M4 wordpress
  `requireRole` removed → wordpress "forged header…" and "EDITOR of its own tenant…" fail. Control: 28/28.

Oracles (EXECUTED 2026-10-16, revision 1): `npm run build` → exit 0; `backend npm run test:unit` → exit 0, 26 files /
305 tests; root `npm run typecheck` → exit 0; `packages/shared npm test` → exit 0, 97 tests; `git diff --check` → exit 0;
`renderer npm run test:serving` → exit 0, 39/39; `tools/mcp-server npm test` → exit 0.

## 6. Deviations from the packet text (accepted in the operator rulings of 2026-10-16, packet § 6)

- **`schemaType` enum kept in shared.** `SchemaType.nullable().optional()` meets D2 without widening create to any
  string. `StrictUpdateSchema.schemaType` was already `z.string()` and is now `z.string().nullable().optional()`
  (the create/update enum divergence is pre-existing; not changed).
- **No shared "update variant" exists.** The packet's `index.ts:236-242` is inside `ContentItemSchema` (one parser,
  `create.ts`).
- **No hand-written MAP for `slug.ts`.** The `*_MAP.md` files are generated by `rmap map` ("do not hand-edit").

## 7. Review history, decisions (resolved) and residual items

Reviews are named by verdict and record location, not by ordinal: the relay restarted its numbering at the cycle-2
build (`runs/build-0.json` starts 2026-10-16T04:10:31Z), so "review-0" in the packet and `review-0.json` in the relay
directory are two different reviews.

| Review | Verdict | Record | Led to |
|--------|---------|--------|--------|
| Escalation review (of cycle 1) | `escalate` | relay `notes-for-human.md`; the packet's § 6 calls it "review-0 (gpt-6-sol)" | the operator rulings below → cycle 2 |
| Claims review (of cycle 2) | `revise` | relay `review-0.json` (run started 2026-10-16T04:15:57Z) | revision 1 |
| Provenance review (of revision 1) | `revise` | relay `review-1.json` (run started 2026-10-16T04:22:08Z) | revision 2 (this label correction) |

- `BC1-RENDERER-NULL` = A (operator, 2026-10-16) — § 2 D2.
- `BC1-WP-AUTH` = A (operator, 2026-10-16) — § 2 D4.
- `BC1-SLUG-CLAIMS` (operator, 2026-10-16) — § 2 D3: prose narrowed; unchanged resend keeps the stored slug.
- Residual (follow-up, not this slice): the WordPress importer stores raw slugs; legacy non-normal slugs stay as they
  are until an admin changes them.
- Residual (same as `create.ts`, kept by the ruling "mapped the way create.ts does"): every
  `TransactionCanceledException` answers 409, including cancellations that are not conflicts (`ThrottlingError`,
  `ProvisionedThroughputExceeded`, `ValidationError`, `ItemCollectionSizeLimitExceeded`). A precise mapping would read
  `CancellationReasons` in both handlers — follow-up, not this slice.

## 8. Migration / deployment notes

No data migration. Backend Lambdas (content create/update, import media/wordpress), the shared package and the
renderer change; the operator deploys. Behaviour change for callers of `/import/wordpress`: every caller that is not
a TENANT_ADMIN of the named tenant or a GLOBAL_ADMIN now gets 403 — EDITOR tokens, public-pool CUSTOMER tokens (when
the authorizer's public pool is enabled), the renderer key (role RENDERER) — all admitted before, because the handler
had no role check.
Rollback: redeploy the previous backend/renderer build — stored data is compatible both ways (`null` was already a
stored value).

## 9. Exit criterion

Intended outcome (what becomes possible once deployed): admin saves that send a wrong field type get 400 with the field
path; a forbidden save gets 403 and a rename onto a taken slug 409; a page opened and saved unchanged validates and
keeps its URL; a renamed page is stored in the renderer's form; the importers read and write only for a caller
authorised for the target tenant (a TENANT_ADMIN of that tenant, or a GLOBAL_ADMIN), and only keys inside that
tenant's prefix.

Verified so far: at the unit level only, by the § 5 tests (handlers invoked directly, DynamoDB and S3 mocked). The
deployed confirmation is the operator's run.

## 10. Reconciliation pending (operator)

`docs/ROADMAP.md`, `CURRENT_SLICE.md`, `docs/TECH-DEBT.md` (WordPress raw slugs) and `backend/ARCHITECTURE.md`
(new `lib/slug.ts`) are outside this packet's file list.

## References

`docs/slices/opennext-1b.md` § 18 (slug 404 on staging); `backend/src/assets/create.ts:44` (upload key form);
`backend/test/unit/revalidate-order.test.ts` (db-mock seam); `infra/lib/api.ts:112, 351-355` (default authorizer on the
import routes); CLAUDE.md Critical Rules 3 and 4.

## 11. Staging verification (operator, 2026-10-16 — appended after review approval and the staging deploy)

- Review: run 1 cycle 1 `escalate` (three findings → operator rulings, packet § 6); run 2 cycles 1–2 `revise` (names,
  claims, provenance), cycle 3 **approved** (gpt-6-sol). Records: `.agent-manager/slices/BACKEND-CONTRACT-1/review-*.json`.
- Operator re-run of the gates on the unchanged candidate: backend `npm run test:unit` 305/305; shared `npm test` 97/97;
  root `npm run typecheck` 0; renderer `npm run test:serving` 0 (39 rows); `git diff --check` 0 (log: operator scratchpad
  `bc1-gates.log`).
- `cdk deploy -c stage=staging AmodxStack-staging` exit 0 (216 s).
- Live probe through the deployed staging API (`bc1-probe.ts`, one page on `cache-probe-2026`, archived after), 11/11:
  create accepts `seoTitle: null` (201) and normalises the slug; D1 schema failure → 400 with `issues`, invalid JSON → 400;
  D2 set → clear with `null` → GET returns `null`; a PUT of the full GET body → 200; D3 unchanged resend keeps the slug,
  a changed slug is normalised (`/BC1 Renamed …` → `/bc1-renamed-…`); D4 `s3Key: other-tenant/…` → 403 on
  `/import/wordpress` and `/import/media` (global-admin credential: the role check passes, the prefix check refuses; the
  forged-header path is covered by the unit tests — no tenant-scoped staging token is provisioned).
- Residuals stay as § 7 records them: EDITOR tokens no longer reach `/import/wordpress` (as `/import/media` already);
  every `TransactionCanceledException` on update maps to 409 (as `create.ts`); WordPress import still stores raw slugs
  (follow-up).
- Prod: on the human's word. From `main` the prod deploy carries OPENNEXT-1B, RSC-NAV-1 and this slice together.
