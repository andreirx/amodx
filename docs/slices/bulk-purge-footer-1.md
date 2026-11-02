# BULK-PURGE-FOOTER-1 — bulk changes go live on the real domain; footer colours (implementation record)

Status: BUILT round 2, 2026-11-02 (builder), uncommitted, awaiting review. Start: `main` at `0f7586d`, tree clean.
Ratified by the human on 2026-11-02 ("write it and run it and don't forget I want color for the footer too").
Two independent parts: A (cache) and B (footer colours). Round 1 stopped two items of Part A on a decision; the operator
ruled after review 0 (2026-11-02 ~21:00Z): BPF1-ENGAGEMENT-INFRA = A, BPF1-REVIEWS-READ = A (least privilege, and every
write-only purge Lambda, not only the two reviews ones), BPF1-EDGE-ACCEPTANCE = A — § 6. Round 2 implements them (§ 2.3).

## 1. Root cause (operator, EXECUTED on prod 2026-11-02, read-only)

A handler wrapped by `withInvalidation()` wrote only the `CDN_PENDING` marker (edge `/*` ≤ 16 min, or GO LIVE NOW).
Nothing purged the renderer's stored ISR pages (S3) for a bulk change; the edge `/*` then refilled from the stale S3
copy, so the real domain showed the old page until the nightly flush (02:00 UTC). `docs/caching-architecture.md` known
gap 1.

## 2. Part A — what was built

### 2.1 Design (one line each)

- Purge mechanism: an optional second parameter of the wrapper, `withInvalidation(handler, purgeStoredPages?)`. After a
  2xx answer the wrapper awaits the purge, then writes the marker (CACHE-10 order: S3 before edge). A throw from the purge
  is caught and logged; the response is returned unchanged.
- Abstraction: `purgeStoredPages` parameter of `withInvalidation` — users: the 18 files of § 2.2 (18 wrapped exports) —
  axis: which pages a mutation must purge (request tenant / none), operations fixed, callers growing, so a function
  parameter — rejected simpler alternative: `invalidate-cdn.ts` importing `revalidate.ts` directly, which makes a module
  cycle (`revalidate.ts` already imports `invalidate-cdn.ts`); also rejected: an explicit call in each handler (many
  handlers, several 2xx return points each).
- Shared purge logic, ONCE: `revalidate.ts#purgeIsrTargets(targets, what)` — extracted from `revalidateTenantPaths` (the
  renderer gate + one `revalidatePath()` per target). Users: `revalidateTenantPaths` (ordinary) and
  `purgeStoredPagesOfDomains` (bulk). Same renderer call `{ domain, slug }`, same 10 s bound, same best-effort rule.
- `purgeStoredPagesOfDomains(domains)` — whole-tenant purge of each domain (slug `"/"`: since CACHE-10 every call deletes
  all the domain's S3 objects); drops non-strings and blanks, collapses duplicates. Users: `tenant/create`,
  `tenant/settings`, `purgeStoredPagesOfTenant`.
- `purgeStoredPagesOfTenant(tenantId)` — checks the renderer gate BEFORE the tenant GetItem (no read when the purge is
  off), then the same projected `getTenantRouting` read as the ordinary path. Users: `purgeStoredPagesOfRequestTenant`,
  `products/bulk-price`.
- `purgeStoredPagesOfRequestTenant(event)` — the `x-tenant-id` header; no header → no purge, no log. User: the wrapper
  call of the 18 files.
- Tenant isolation: the header tenant is purged only after a 2xx answer, and every wrapped handler authorizes the
  caller for that header tenant (`requireRole(auth, …, tenantId)`) before it can answer 2xx (OBSERVED: each of the 18
  files calls `requireRole`; INFERRED from that pattern: with the header tenant); the renderer route accepts
  only a dotted domain without `/` (CACHE-10 isolation rule). A caller cannot purge a tenant it may not mutate.
- Exactly one purge per mutation: the six ordinary handlers are not wrapped (they keep `revalidateTenantPaths`); a bulk
  handler purges once per affected domain, through the wrapper OR inside the handler, never both.

### 2.2 The bulk set and how each purges

Basis (EXECUTED): `grep -rl "withInvalidation(" backend/src` → 32 files; minus `lib/invalidate-cdn.ts` (definition),
`lib/revalidate.ts` and `lib/invalidate-cdn_ts_MAP.md` (doc text), `scheduled/nightly-cache-flush.ts` (comment — not a
mutation, left as is), and the six ordinary handlers (`content/{create,update}`,
`products/{update,delete}`, `categories/{update,delete}` — comments only, they are not wrapped) = 22 files, 23 wrapped
exports. Pinned from the source by `backend/test/unit/bulk-purge.test.ts` ("every wrapped handler chooses its purge").

| Handler (file) | Purge | Tenant |
|---|---|---|
| `categories/create`, `content/restore`, `forms/{create,update,delete}`, `import/{glam-pricelist,glam-images,media,reviews,woocommerce,wordpress}`, `popups/{create,update,delete}`, `products/create`, `reviews/{create,update,delete}` | wrapper: `withInvalidation(_h, purgeStoredPagesOfRequestTenant)` | `x-tenant-id` |
| `products/bulk-price` | inside the handler, apply branch only (`purgeStoredPagesOfTenant(tenantId)` before the 200) — the preview (`dryRun`, the default) also answers 200 and must not purge (rule A6) | `x-tenant-id` |
| `tenant/create` | inside the handler before the 201: `purgeStoredPagesOfDomains([validTenant.domain])` | the created tenant (its domain is held; no read — the Lambda has only a write grant) |
| `tenant/settings` (`updateHandler`) | inside the handler before the 200: `purgeStoredPagesOfDomains([current.domain, merged.domain])` | the domain before AND after the save (rule A4); held values, not a re-read (an eventually consistent read just after the Put could return the old domain) |
| `themes/manage` (`createHandler`, `deleteHandler`) | none (record line: writes `PK SYSTEM / SK THEME#<id>`, a shared preset — not tenant-scoped; a tenant's pages change when the tenant saves its settings, which purges) | — |

- `import/glam-pricelist` dry run (`?dryRun=1`) bypasses the wrapper (unchanged dispatch, `glam-pricelist.ts:368`): no
  purge, no marker. The `reviews/update` GET view-URL route bypasses the wrapper too (unchanged).
- `tenant/create` — can a page be stored for the new host? Not by this tenant (no record → middleware answers 404
  `no-store` before any render, `docs/caching-architecture.md` § "How a 404 stays out of the cache"). But stored pages
  are keyed by host only: a previous owner of the host (a tenant that moved to another domain before this slice, or a
  record that is gone) may have left some. So it purges (INFERRED from the key layout, `renderer/src/app/api/revalidate/route.ts` header).

### 2.3 Infra (rule A7)

`git diff -- infra` = 14 added lines, each `props.revalidationSecret.grantRead(<fn>);` (EXECUTED: 0 other changed lines):
`api.ts` UpdateSettingsFunc, CreateTenantFunc; `api-catalog.ts` RestoreContentFunc, CreateProductFunc, ImportFunc,
MediaImportFunc, ReviewImportFunc, GlamPricelistImportFunc (also serves glam-images; its line notes that it supersedes the
"No revalidation secret" comment above it); `api-commerce.ts` CreateCategoryFunc, CreateReviewFunc, UpdateReviewFunc,
DeleteReviewFunc, BulkPriceFunc, WooImportFunc. No environment line was needed: these functions already receive
`RENDERER_URL` and `REVALIDATION_SECRET_NAME` from the stack's shared `nodeProps` (`api.ts:142-143`,
`api-catalog.ts:103-104`, `api-commerce.ts:60-61`; overriding `environment` blocks spread `...nodeProps.environment`)
(OBSERVED in the source). Not changed in round 1: `api-engagement.ts` and the write-only table grants — § 6.

**Round 2 (2026-11-02, rulings of § 6).**
- `api-engagement.ts`: `EngagementApiProps` + `revalidationSecret: secretsmanager.ISecret`, `rendererUrl?: string` (+ the
  `secretsmanager` import); one loop over EXACTLY the six purge-enabled functions (CreatePopupFunc, UpdatePopupFunc,
  DeletePopupFunc, CreateFormFunc, UpdateFormFunc, DeleteFormFunc): `addEnvironment('RENDERER_URL', …)`,
  `addEnvironment('REVALIDATION_SECRET_NAME', …)`, `revalidationSecret.grantRead(fn)`. Not the shared `nodeProps`: the
  stack's read and public functions get nothing new. `amodx-stack.ts`: passes `revalidationSecret` and `rendererUrl`
  (= `rendererBaseUrl`, the value the other three API stacks get). No new resource.
- `dynamodb:GetItem` ONLY (`table.grant(fn, 'dynamodb:GetItem')`, never a read-write upgrade) for every purge-enabled
  Lambda whose table grant was write-only and whose purge reads the tenant record: CreatePopupFunc (`api-engagement.ts`),
  CreateReviewFunc, DeleteReviewFunc (`api-commerce.ts`). Round 1 named only the two reviews ones — CreatePopupFunc was
  missed (review-0 F2). Class: a purge-enabled Lambda whose deployed capability was inferred from mocks, not verified.
  Rule applied: every purge-enabled Lambda's capability is enumerated from the infra source (table below) and checked on
  a real offline synth (§ 4); the durable form of that check belongs in `infra/test/amodx-stack.test.ts` (not allocated —
  § 7).

Every purge-enabled Lambda (from the infra source; capability columns EXECUTED on a synth, § 4):

| Lambda (construct id) | Stack file | Handler | Table grant | Purge reads the tenant record? | GetItem | Secret read | Both env names |
|---|---|---|---|---|---|---|---|
| UpdateSettingsFunc | `api.ts` | tenant/settings | read-write | no (domains held) | yes (RW) | yes | yes |
| CreateTenantFunc | `api.ts` | tenant/create | write only | no (domain held) | not needed | yes | yes |
| RestoreContentFunc | `api-catalog.ts` | content/restore | read-write | yes | yes (RW) | yes | yes |
| CreateProductFunc | `api-catalog.ts` | products/create | read-write | yes | yes (RW) | yes | yes |
| ImportFunc | `api-catalog.ts` | import/wordpress | read-write | yes | yes (RW) | yes | yes |
| MediaImportFunc | `api-catalog.ts` | import/media | read-write | yes | yes (RW) | yes | yes |
| ReviewImportFunc | `api-catalog.ts` | import/reviews | read-write | yes | yes (RW) | yes | yes |
| GlamPricelistImportFunc | `api-catalog.ts` | import/glam-pricelist + glam-images | read-write | yes | yes (RW) | yes | yes |
| CreateCategoryFunc | `api-commerce.ts` | categories/create | read-write | yes | yes (RW) | yes | yes |
| CreateReviewFunc | `api-commerce.ts` | reviews/create | write only | yes | **round 2: GetItem only** | yes | yes |
| UpdateReviewFunc | `api-commerce.ts` | reviews/update | read-write | yes | yes (RW) | yes | yes |
| DeleteReviewFunc | `api-commerce.ts` | reviews/delete | write only | yes | **round 2: GetItem only** | yes | yes |
| BulkPriceFunc | `api-commerce.ts` | products/bulk-price | read-write | yes | yes (RW) | yes | yes |
| WooImportFunc | `api-commerce.ts` | import/woocommerce | read-write | yes | yes (RW) | yes | yes |
| CreatePopupFunc | `api-engagement.ts` | popups/create | write only | yes | **round 2: GetItem only** | round 2 | round 2 |
| UpdatePopupFunc | `api-engagement.ts` | popups/update | read-write | yes | yes (RW) | round 2 | round 2 |
| DeletePopupFunc | `api-engagement.ts` | popups/delete | read-write | yes | yes (RW) | round 2 | round 2 |
| CreateFormFunc | `api-engagement.ts` | forms/create | read-write | yes | yes (RW) | round 2 | round 2 |
| UpdateFormFunc | `api-engagement.ts` | forms/update | read-write | yes | yes (RW) | round 2 | round 2 |
| DeleteFormFunc | `api-engagement.ts` | forms/delete | read-write | yes | yes (RW) | round 2 | round 2 |

`themes/manage` (CreateThemeFunc, DeleteThemeFunc) is not purge-enabled (§ 2.2). The `table.grant` GetItem statement also lists the
`…/index/*` ARN (CDK adds it for a table with indexes; OBSERVED on the synth); GetItem cannot address an index, so this
grants nothing beyond GetItem on the table.

### 2.4 Bounds and costs (recorded, not changed)

- Each bulk mutation adds one renderer call (≤ 10 s abort) and, for the header path, one projected GetItem. `PUT
  /settings` with a domain change makes two renderer calls in sequence: worst case ≈ 20 s inside the 29 s Lambda timeout.
- The renderer purge deletes the whole tenant's S3 ISR objects; a burst of bulk calls (e.g. the image-copy batches of
  `import/glam-images`) purges once per call. The next request per page re-renders from DynamoDB.

## 3. Part B — the footer colours

| Field | Type / rule | Absent = | Read by | Admin control |
|---|---|---|---|---|
| `footer.backgroundColor` | `CssColorSchema`, optional, no default, `FooterConfigSchema` strict | the shape's class (`bg-muted/30`, editorial `bg-muted`) | `renderer/src/app/[siteId]/layout.tsx#footerColorStyle` → `<footer style="background-color:…">`; `mapTenant` already copies `footer` (`dynamo.ts:150`) | Navbar & Layout → Footer Colours → Background |
| `footer.textColor` | same | the theme's text colours | same → `--color-foreground` and `--color-muted-foreground` re-declared on the `<footer>` | Navbar & Layout → Footer Colours → Text |

Record lines (local decisions):
- Mechanism: inline `style` on `<footer>`, added by a conditional spread only when a valid colour is set (`isCssColor`,
  the rule PUT /settings validates with). An unconditional `style={undefined}` would change the RSC payload of every
  tenant (`"$undefined"`) — EXECUTED control: 9 byte-identity rows fail with it.
- Text: the footer's texts are coloured by `text-foreground`, `text-muted-foreground`, `hover:text-foreground`, whose
  compiled rules read `--color-foreground` / `--color-muted-foreground` (OBSERVED in the built CSS). `@theme` declares
  `--color-foreground: var(--foreground)` on `:root`, so re-declaring `--foreground` on the footer would reach nothing;
  the footer re-declares the two `--color-*` variables. Hover takes the same colour (readable on the chosen background).
- The hairlines (`border-t` of the footer and of the copyright divider) keep the theme's border colour.
- One setting for the light and the dark theme (inline style wins in both).
- Admin labels: a "Footer Colours" heading with the palette's `ColorInput` labelled "Background" and "Text" (the packet's
  "Footer background" / "Footer text"): `ColorInput`'s label column is 64 px wide and truncates longer text. Hint: "Empty =
  theme default (light and dark)."
- `withFooterKey(config, key, value)` — sets or removes one footer key and keeps the others; users: the width control and
  the two colour inputs (3); alternative rejected: three inline copies. The width control used to replace `footer` with
  `{ contentMaxWidth }`, which would have deleted the colours on a width change.
- Admin tree: both footer groups share ONE child slot of the card (a fragment). OBSERVED: React's `useId` width depends
  on the parent's child count; a new sibling re-numbered the card's Radix Select ids (`_R_962b_` → `_R_i62b_`) and the
  captures failed outside the new controls.
- Captures (`cat-theme-1-impl.md` § 5 procedure): NOT re-taken and not modified; `Settings.test.ts` excludes exactly one
  more group (`FooterColorControls`, rendered on its own, occurring once); a new control (one byte next to that group)
  must still fail, and does.

## 4. Evidence

| Check | Command | Result | Label |
|---|---|---|---|
| Part A unit | `cd backend && npx vitest run --config vitest.unit.config.ts test/unit/bulk-purge.test.ts` | 22/22 | EXECUTED |
| A order control | wrapper mutated to mark before purging (then restored) | 2 order tests fail | EXECUTED |
| Part B schema | `packages/shared` `test/theme-details.test.ts` | 12/12 | EXECUTED |
| Part B backend | `backend` `test/unit/cat-theme-settings.test.ts` | 12/12 | EXECUTED |
| Part B admin | `admin` `src/pages/Settings.test.ts` | 38/38 | EXECUTED |
| Gates 1–10 (`docs/slices/locale-1.md` § 10) | build, typecheck, shared 285, plugins 204, renderer 398, test:serving 104, admin 241, backend 1266 (+1 skipped), mcp-server, `git diff --check` | each exit 0 | EXECUTED |
| Serving × 6 | `npm --prefix renderer run test:serving`, six consecutive runs | each exit 0, 104/104 | EXECUTED |
| Footer-style control | `style={footerStyle}` unconditional (then restored) | 9 rows fail (cm1-identity, loc1-diff-theme-1, cq1-*, ct1-footer-width, …) | EXECUTED |
| Infra synth | `cd infra && npm test` (offline `cdk synth`) | 61/61 | EXECUTED |
| Round 2: capability of every purge-enabled Lambda (§ 2.3 table) | temporary `infra/test/BULK-PURGE-FOOTER-1-capabilities.test.ts` (offline synth of `AmodxStack`, isolation as `amodx-stack.test.ts`; deleted after the run): per Lambda, the CloudFormation env keys and the role's policy actions | 20/20 have both env names and `secretsmanager:GetSecretValue`; the 18 whose purge reads hold `dynamodb:GetItem`; CreatePopupFunc / CreateReviewFunc / DeleteReviewFunc hold exactly `grantWriteData`'s set (baseline: CreateTenantFunc, untouched) + `dynamodb:GetItem`; control ListPopupsFunc: no env, no secret | EXECUTED (rows in `.agent-manager/…/build-progress.md`) |
| Round 2: gates 1–10 on the final code | as above | each exit 0: shared 285, plugins 204, renderer 398, serving 104, admin 241, backend 1266 (+1 skipped), mcp-server 13 | EXECUTED |
| Round 2: serving × 6 | as above | six consecutive, each exit 0, 104/104 | EXECUTED |
| Round 2: infra synth | `cd infra && npm test` | 61/61 | EXECUTED |
| Round 2: infra diff | `git diff -- infra` | 33 added lines, 0 removed: secret `grantRead`, the two env names, `dynamodb:GetItem`, the engagement props and the `amodx-stack.ts` wiring, comments | EXECUTED |
| `cdk diff` | operator | — | NOT RUN (operator's) |
| Staging § 6 (amended by BPF1-EDGE-ACCEPTANCE) | operator | — | NOT RUN (operator's) |

Serving rows: `bpf1-footer-colours` (both colours: the `<footer>` opening tag carries exactly the background and the two
text variables; every footer text kind inside; every text-colour class there reads one of them; compiled rules checked;
payload `style`), `bpf1-footer-background-only` (editorial, background only: no text variable, today's classes, content
markup identical). Every other fixture: unchanged bytes (the `loc1-*`, `cq1-*`, `ct1-*` rows, zero ledger rows).

## 5. Findings for the operator

- **Staging § 6 expectation — resolved by ruling BPF1-EDGE-ACCEPTANCE = A (2026-11-02).** Acceptance = the renderer's
  stored pages are fresh immediately after the bulk save (the origin); the public edge within the documented debounce
  bound (≤ ~16 min) or at once with GO LIVE NOW — the edge `/*` debounce is unchanged by this slice. Operator evidence
  (prod, as reported in the ruling, not re-run by the builder): HTML responses of `glamourfloors.amodx.net` answered
  `x-cache: Miss from cloudfront` on repeated requests while `x-nextjs-cache: HIT` — the stale copy the human saw came
  from the stored (S3) page, which this slice purges. The staging check is amended to: origin fresh at once
  (`x-nextjs-cache` not a stale HIT, the change visible) and the edge state reported as observed.
- **Stale counts in `docs/caching-architecture.md` § Invalidation Mechanisms 1.** The "20 wrapped handler exports
  across 19 files" text and its table predate `import/{reviews,glam-pricelist,glam-images}`; a note with today's count
  (23 / 22, test-pinned) was added; the historical text is kept.
- `infra/lib/api-catalog.ts` comment "No revalidation secret (the CDN is marked by `withInvalidation`…)" above
  GlamPricelistImportFunc is now false; not edited (the infra oracle, also as amended in round 2, lists no comment edits)
  — the new `grantRead` line says so.

## 6. Decisions — round 1 blocks (history) and the operator's rulings

Rulings (operator, after review 0, 2026-11-02 ~21:00Z; the human present and ratified the goal):
- **BPF1-ENGAGEMENT-INFRA = A** — implemented in round 2 (§ 2.3). `amodx-stack.ts` allocated for those lines only.
- **BPF1-REVIEWS-READ = A, least privilege** — `dynamodb:GetItem` only, for CreatePopupFunc, CreateReviewFunc,
  DeleteReviewFunc (the round-1 option A text below said "grantReadWriteData"; the ruling replaced it with GetItem only).
- **BPF1-EDGE-ACCEPTANCE = A** — § 5.

Round 1 blocks, as submitted:

```
DECISION_REQUIRED:
- ID: BPF1-ENGAGEMENT-INFRA
  QUESTION: The six popups/forms Lambdas (EngagementApi nested stack) have no revalidation secret and no RENDERER_URL,
    because EngagementApiProps has neither prop and amodx-stack.ts does not pass them. Their code is wired (they call the
    purge) but it logs "[Revalidate] DISABLED (RENDERER_URL is not set)" and purges nothing. Giving them what the purge
    needs requires two prop fields + one import in api-engagement.ts and two lines in amodx-stack.ts — outside the
    packet's infra oracle (only grantRead / env lines) and outside the allocation (amodx-stack.ts).
  OPTIONS:
  - A: Allow the plumbing (api-engagement.ts: `revalidationSecret`, `rendererUrl` props, env entries, 6 grantRead lines;
    amodx-stack.ts: pass both). Reward: popups/forms changes go live on the real domain like every other bulk change.
    Risk: low — `cdk diff` shows IAM statements for that secret and two env entries per function; no new resource.
  - B: Leave as is. Reward: no infra change. Risk: a popup or form change stays on the real domain until the nightly
    flush (the bug this slice fixes, for these six handlers); a DISABLED warning per save in CloudWatch.
  RECOMMENDED: A
  BLOCKING_REASON: the change crosses the packet's infra oracle and allocation.
- ID: BPF1-REVIEWS-READ
  QUESTION: CreateReviewFunc and DeleteReviewFunc hold `table.grantWriteData` only. The purge resolves the tenant's
    domain with one projected GetItem; for these two it is denied (AccessDeniedException), logged and swallowed — no
    purge. Fix: `table.grantReadWriteData` on both (2 lines, api-commerce.ts) — not a `grantRead(` of the secret, so
    outside the infra oracle.
  OPTIONS:
  - A: Upgrade both to grantReadWriteData. Reward: a review added or deleted by an admin goes live on the real domain.
    Risk: low — adds dynamodb read actions (GetItem/Query/Scan/BatchGet…) on the table to two admin Lambdas; `cdk diff`
    shows a table policy change, which the packet's diff rule does not list.
  - B: Leave as is. Reward: no IAM change. Risk: those two changes stay stale until the nightly flush; one error log per
    save. (`reviews/update` and `import/reviews` already read and are not affected.)
  RECOMMENDED: A
  BLOCKING_REASON: the change crosses the packet's infra oracle (rule A7 "No other infra change").
```

## 7. Deferred debt

- Tag-based or per-page ISR purge instead of whole-tenant (known gap 5) — unchanged.
- The capability check of § 4 (round 2) was a temporary synth test, deleted after the run. Its durable form — every
  purge-enabled Lambda has both env names, the secret read and (where the purge reads) GetItem — belongs in
  `infra/test/amodx-stack.test.ts`, which this slice may not edit. Proposed for a follow-up.

## Operator closeout (2026-11-02 ~22:30Z; staging only — the human deploys prod)

- Review: round 1 → escalate (BPF1-ENGAGEMENT-INFRA, BPF1-REVIEWS-READ, BPF1-EDGE-ACCEPTANCE); round 2 → approved;
  decision review all-converged (3/3). Rulings by the operator under the human's direction for this slice ("write it
  and run it"); the packet's infra rule A7 was the operator's error (too narrow) and was widened to exactly what A1 needs.
- Operator gate run (`glam/bpf-gates.log`, bare exit codes): build, typecheck, shared 285, plugins 204, renderer 398,
  serving 104/104, admin 241, backend 1266 (+1 skipped), MCP 13, `git diff --check` — all exit 0. Infra diff: 33 added
  lines in 5 files, every one renderer-URL / revalidation-secret plumbing, a secret `grantRead`, or a `dynamodb:GetItem`
  grant (the two lines my oracle printed are the `for` loop that holds those three statements for the six engagement
  Lambdas). Allocation `(none)`; records and dependencies untouched.
- `cdk diff -c stage=staging`: 52 Lambda functions (code / environment), 20 IAM policies, one new nested-stack parameter
  (the secret reference passed into EngagementApi), the usual bucket deployments and admin config. IAM actions added:
  `secretsmanager:GetSecretValue` + `DescribeSecret` on the revalidation secret (20 statements); `dynamodb:GetItem` merged
  into the three existing write statements of `CreatePopupFunc`, `CreateReviewFunc`, `DeleteReviewFunc`. Nothing removed.
- Staging (build `0fZip-BiHNyp45jzN82uG` → `6TrsKwrz58S76KFRlWm_j`; `glam/bpf-staging-out/`): the 51 CM1 URLs text- and
  status-identical. `glam-staging` domain set to `glam-staging.staging.amodx.net` (a bulk save). `/shop` loaded twice,
  then footer colours saved and SIL re-imported: the edge kept serving its copy (`Hit from cloudfront`) — the edge `/*`
  stays debounced, as ruled. After the edge was cleared (`POST /system/invalidation`), the origin answered
  `x-nextjs-cache: MISS` with the saved colours: the stored page had been purged by the bulk save (before this slice it
  would have answered a stale `HIT`, as `glamourfloors.amodx.net` did on prod). Headless Chromium: footer background
  `rgb(90, 26, 42)`, every footer text `rgb(245, 243, 243)`.
- **Correction (operator):** the BPF1-EDGE-ACCEPTANCE ruling text said the prod edge answered `Miss from cloudfront`
  "on repeated requests", implying changes would show at once in practice. Staging shows the edge DOES cache HTML. The
  true behaviour after this slice: a bulk change is live at the origin at once and on the public edge within the
  debounce bound (≤ ~16 min) or at once with GO LIVE NOW. Before this slice it was never live until the nightly flush or
  a page save.
