# NEXT-PATCH-1 — Next.js security patch 16.4.3 → 16.4.6

Status: **SHIPPED 2026-11-21 (staging)** — prod deploy pending (human). Written 2026-11-18; human 2026-11-21: "ok start the next.js patch". Track: Maintenance (`dep-1` family).
Depends: none. Maturity target: unchanged (the renderer is PRODUCTION).

## 1. The problem

Next.js published a security advisory after the deploys of 2026-11-16.

- Advisory: GHSA-mfr8-8qww-v76h, severity moderate. "Information disclosure across root params when a
  `use cache` function is called through `unstable_cache()`."
- Range: `>=16.3.0 <=16.4.4`. Installed: `16.4.3` (`node_modules/next/package.json`).
- Fixed versions in the same line: `16.4.5`, `16.4.6` (`npm view next versions`, 2026-11-18).
- Declared: `"next": "~16.4.3"` in `renderer/package.json:24` and `packages/plugins/package.json:80`.
  The range already admits 16.4.6; the lockfile holds 16.4.3.

Exposure: a search of `renderer/src` and `packages/plugins/src` for `use cache`, `unstable_cache` and
`rootParams` finds nothing (2026-11-18). The renderer does not use the feature the advisory names. This is a
source search of two directories, not a proof for the built bundle.

Effect on the work, which is the urgent part:

- Since 16.4.x, `next build` checks for advisories (`node_modules/next/dist/lib/upgrade/nudge.js`). When the
  build runs under an agent and a security advisory applies, the build throws `SecurityFatalError` and writes a
  receipt under `<distDir>/cache/next-agentic-upgrade-retries/`. One retry inside 5 minutes continues with a
  warning and uses up the receipt (`nudge.js:97,150`).
- `infra/deploy.sh staging` runs two builds (`npm run build`, then `build:open`). One of the two always stops.
  **The operator cannot deploy to staging** (two attempts on 2026-11-18, both exit 1, nothing deployed).
- In an interactive terminal the code takes a prompt path, not the throw (`nudge.js:377,416`). What the human
  sees during `./deploy.sh prod` is **not verified**.
- The guard has a configuration switch (`experimental.agentUpgrade`) and an environment switch. Neither is
  used. Turning a security check off to deploy is not proposed.

## 2. Scope

1. `next` → `16.4.6` in the lockfile; the declared floor moves to `~16.4.6` in both `package.json` files so that
   no install can go back into the advisory range.
2. `@opennextjs/aws` stays at the exact pin 4.1.9. `patches/@opennextjs+aws+4.1.9.patch` must still apply; the
   guard `node scripts/verify-opennext-patch.mjs` must pass unchanged.
3. Record: the 16.4.3 → 16.4.6 release notes read for changes to the middleware, the cache handler interface,
   RSC request headers and the `_rsc` hash (the three places where earlier patch releases changed serving).
4. `docs/TECH-DEBT.md` § Dependency Audit Remediation: one dated line.

## 3. Non-scope

A minor or major Next.js upgrade. An OpenNext upgrade (only if 16.4.6 cannot run on 4.1.9 — then stop and
ask). `infra/` changes. The other `dep-1` items. Any use of the guard's switches.

## 4. Evidence taxonomy

| Proof | Expected |
|---|---|
| `npm ls next` in every workspace | one version, 16.4.6 |
| `next build` under the agent, cold (no receipt) | exit 0, no `SecurityFatalError` |
| `npm run test:serving` | all rows green, no row edited |
| `npm run test:serving-bundle` | all rows green on the built Lambda bundle, no row edited |
| `node scripts/verify-opennext-patch.mjs` | OK |
| the ten repository gates of `badge-case-1.md` § 6 | exit 0 |
| staging: the 51 CM1 URLs (Layer 2 canonical form, `catalog-mode-1.md` § 8.20) | identical to the capture before the upgrade, apart from build ids |
| staging: cache headers | a second request for a tenant page answers `x-cache: Hit`; a client-side navigation gives 0 × 307 (`rsc-nav-1.md` § 7) |

A serving row that changes is a finding to bring to the human, not a row to update.

## 5. Deployment and rollback

Every live tenant is served by this code. Order: gates → staging diff read → staging deploy → the proofs of § 4
→ commit → push → the human's prod deploy. Rollback: revert the commit and redeploy; no data changes.

Launch precondition: a clean worktree. On 2026-11-18 the worktree holds the reviewed, gate-green candidate of
`public-harden-1`, which cannot reach staging while this block stands. Two ways, the human's choice at launch:

| Way | Reward | Risk |
|---|---|---|
| Commit `public-harden-1` first, without its staging run; one staging deploy then carries both | simple; history stays in order | a commit on `main` that staging has not run (unit-proven only) for the time of this slice |
| Keep `public-harden-1` as a patch file outside the tree; run this slice; apply it again | `main` never holds unstaged code | a second apply step; the patch must apply cleanly after the lockfile change (the two touch different files) |

## 6. Definition of Done

§ 4 complete; staging on the new build; the operator's staging deploy runs with no stop; this record has its
closeout section; ROADMAP row updated.

## 7. Exit criterion

`./deploy.sh staging` and `./deploy.sh prod` run with no security notice, and the advisory no longer applies to
the installed version.

## Build record (builder, 2026-11-21)

Packet: operator, 2026-11-21 ("ok start the next.js patch"). Base `839eaab`, tree clean. Not committed.
Logs: `.agent-manager/slices/NEXT-PATCH-1/` (gitignored). Result: **the build guard no longer stops; 10 serving rows
fail on byte identity (findings F1, F2); every other gate exit 0.**

### Versions (EXECUTED: `npm ls next --all`, lockfile read)

| Package | Before | After |
|---|---|---|
| `next` (every workspace: plugins, renderer, deduped under `@opennextjs/aws`, `next-auth`) | 16.4.3 | 16.4.6 |
| `@next/env`, `@next/swc-*` (8 platforms) | 16.4.3 | 16.4.6 |
| `@next/eslint-plugin-next`, `eslint-config-next` | 16.1.1 | 16.1.1 |
| `@opennextjs/aws` | 4.1.9 | 4.1.9 (patch applied: `@opennextjs/aws@4.1.9 ✔`) |

Lockfile entries changed: `node_modules/next`, `node_modules/@next/env`, the 8 `node_modules/@next/swc-*`, and the
declared range in the `renderer` and `packages/plugins` workspace entries. None added, none removed, none outside
this set. `npm audit` no longer lists `next`.

### Release notes 16.4.4 – 16.4.6 (EXECUTED: `gh release view`, `gh api …/security-advisories`, `gh pr view 101280`)

`node_modules/next` holds no changelog. The notes are titles; this is a claim about the titles, not about every line.
- 16.4.4: backports (Turbopack dev CSS, a reverted chunk optimisation, CSP nonce for the Turbopack bootstrap in a
  PPR resume, analyzer, `fast-jwt`). None in the five categories.
- 16.4.5: 7 advisories (this slice's GHSA-mfr8-8qww-v76h and 6 more). Near serving: GHSA-pc58-hwjq-p385 (route
  handlers forwarding a fetched response; framing), GHSA-f3mh-rxg3-f5g2 (internal `x-middleware-set-cookie` on Edge
  routes; the renderer has no Edge route). Nothing on the cache handler interface, `incrementalCache`, RSC request
  headers, `_rsc`, `next/headers` or the build output layout.
- 16.4.6: PR #101280 "compress route handler responses if not already compressed" (`server/base-http/node.ts`).
  OpenNext 4.1.9 sets `compress: false` (`@opennextjs/aws/dist/core/util.js:27-29`), so INFERRED: no effect on the
  Lambda. `next start` keeps the default and shows it (F2).

### Guard (EXECUTED)

- Agent detection: `next/dist/telemetry/agent-name.js` → `claude-code_2-1-330_agent`. No `agentUpgrade`, no
  `__NEXT_AGENT_UPGRADE*` / `NEXT_PRIVATE_*` variable.
- Before the first build the receipt directory was NOT empty: one file from 2026-11-17, name =
  sha256(renderer, **16.4.3**, build, security). The 16.4.6 guard looks up other names (`e3ae2e11…`, `d409d169…`),
  and `nudge.js:150` rejects any receipt older than 5 minutes. So the first build was cold for 16.4.6. Not deleted.
- `test:serving` removes all of `renderer/.next` before its build (`harness.mjs:347`); that removed the old receipt.
  `build:open` then ran with no receipt directory and created none.

### Gates (each log in the slice directory; exit codes bare)

| Gate | Exit | Rows |
|---|---|---|
| `npm run build` (cold) | 0 | `▲ Next.js 16.4.6`; no `SecurityFatalError`, `UpgradeNudgeError` or upgrade text |
| `npm run typecheck` | 0 | 8 workspaces |
| `npm --prefix renderer test` | 0 | 45 files / 625 |
| `npm --prefix renderer run test:serving` | **1** | 124: 114 pass, **10 fail** (F1, F2) |
| `npm --prefix renderer run build:open` | 0 | OpenNext v4.1.9, Next.js 16.4.6; no guard text |
| `npm --prefix renderer run test:serving-bundle` | 0 | 58 / 58 |
| `node scripts/verify-opennext-patch.mjs` | 0 | 4 PASS/OK, script unchanged |
| `npm --prefix packages/plugins test` | 0 | 12 / 355 |
| `npm --prefix packages/shared test` | 0 | 22 / 385 |
| `npm --prefix admin run test:unit` | 0 | 15 / 296 |
| `npm --prefix backend run test:unit` | 0 | 59 + 1 skipped (`CAPTURE_GOLDEN_TO` unset) / 1488 + 1 skipped |
| `npm --prefix tools/mcp-server test` | 0 | 17 |
| `git diff --check` | 0 | — |
| `node scripts/audit-gate.mjs` (information) | 0 | 1 accepted hit (tiptap), no new high/critical |

### Findings (no test, expectation file or capture edited)

**F1 — framework chunk names in the Turbopack bootstrap (rows 40, 41, 87, 88, 90, 95, 97, 100, 123).**
Every page has `<script id="_R_">…{"otherChunks":["static/chunks/<hash>.js",…]}</script>`. The names have no
`/_next/` prefix, so the CM1-A1 asset mask (`/_next/static/…`) does not cover them. 16.4.6 framework chunks have
new content hashes (`31hx0cvg76b46`, `21-r8h3faw8xk`, `0m89jrpzvbcl3` → `3ao1zvc-a1ya3`, `1hn-9hst7-xrq`,
`2vks9de_nlq63`); all 1247 stored captures carry the old list. Rows 88 and 123 also pin the raw root-layout chunk
`/_next/static/chunks/0a-rekt06v0sv.js`, which the new build does not have.
Proof that this is the only difference (EXECUTED, scripts outside the repository): CM1 51 URLs → 39 differ, all 39
only in `_R_`; flight payload, other HTML, status and content type equal. Row 87 with the suite's own
`checkExpected`: 81 pages, 69 problems as-is, **0** with only the `_R_` script made equal on both sides. Rows 90,
95, 97, 100: same message and same comparator, INFERRED same cause.

**F2 — `Vary` on route handlers under `next start` (row 124).** 48 responses (`sitemap.xml`, `openai-feed`,
`robots.txt`, `llms.txt` × 12 hosts) add `, Accept-Encoding` to `Vary`. Status, `cache-control`, `content-type`
unchanged. Cause: 16.4.6 PR #101280 with `compress` at its default. The bundle suite passes but does not probe
route-handler `Vary`, so "no change on the Lambda" is INFERRED from the OpenNext code, not observed.

### Not run (operator)

Staging deploy, the 51-URL identity check on staging, the cache-header checks (§ 4). Suggested addition to the
operator's check: one route handler (`/sitemap.xml`) on staging — `Vary` without `Accept-Encoding`.

### 2026-11-21 — cycle 2 (builder, after review-0 `escalate` and the operator rulings of the packet § 6)

Rulings applied: R-NP1-F1 = A (resource identity), R-NP1-F2 = A, R-NP1-COLD = B. The five paths of cycle 1 are
unchanged. Logs: `.agent-manager/slices/NEXT-PATCH-1/r1-*.log`; diagnostics with scripts and outputs kept in
`.agent-manager/slices/NEXT-PATCH-1/diag/`.

**Correction (review-0 finding 3) of F2 of cycle 1** ("48 responses … × 12 hosts"): the measured population is
**24 responses on 6 hosts** — the four route handlers on `cm1-commerce`, `cm1-content`, `cm1-catalog`,
`loc1-ro-commerce`, `loc1-ro-content`, `loc1-ro-catalog` (EXECUTED: distinct `(host, path)` keys in the cycle-1 log;
the same 24 in the r1 run, row `loc1e-cache-headers`). Cycle 1 counted each record twice: the assertion message lists
it in the diff and again under `actual:`. Rule kept since: count distinct record keys, never text matches.

**Diagnostics with the UNCHANGED comparator (ruling item 5; EXECUTED before any comparator edit).**

| Script → output | Result |
|---|---|
| `diag/00-test-serving-unchanged-comparator.log` | 124 rows, 114 pass, the same 10 fail; CM1 captures to `diag/cm1-candidate/` |
| `diag/01-cm1-51.mjs` → `01-cm1-51.out` | 51 CM1 URLs: 39 differ; **all 39 only by `static/chunks/<name>.js` tokens inside `<script id="_R_">`** (equal once only those tokens are made equal); 12 byte-equal (route handlers, no element) |
| `diag/02-rows.mjs` → `02-rows.out` | the failing assertion of each row, as-is → with only the `_R_` tokens equal: 87 69 → 0 (81 URLs); 90 1 → 0; 95 2 → 0 (2 `roNone` URLs); 97 1 → 0; 100 1 → 0; 88 2 → 1 (left: the stored root-layout script name); 123 2 → 2 per landing (the stored name, and the HTML: the early return of `moveRootLayoutRaw` skips the allowed shell-preload removal — confirmed: 123 passes once rule 3 holds) |

Rows 90, 95, 97 and 100, INFERRED in cycle 1, are now proven.

**Rule 3 — what the current build names.** The stored script `0a-rekt06v0sv.js` sat in the d9999d2 head and (16.4.3)
in the after head. In the 16.4.6 build the chunk at that place is `421c_el12128q.js`, and the client-reference
manifest names it as the only JS entry of `[project]/renderer/src/app/not-found` (the root 404 boundary that writes the
document since locale-1e); it holds Next's own client code (`useRouterBFCache`, the layout router), so its hash moves
with every Next.js version (OBSERVED). `readRootNotFoundScript` reads that entry from the build; fail closed when no
manifest names it, the manifests disagree, or it is not one file.

**Changes (allocation of § 6).**

| Path | Change | Rule |
|---|---|---|
| `renderer/test/serving-contract/cm1-byte-identity.mjs` | `maskBody`: inside `<script id="_R_">` only, each `static/chunks/<name>.js` → one placeholder, count `bootstrapChunks`; `bootstrapChunks()`, `bootstrapChunkProblems()`; `readRootNotFoundScript()`; the manifest walk shared with `readClientModules` (`clientReferenceManifests`, no behaviour change) | F1 rules 1, 2, 3 |
| `renderer/test/serving-contract/locale-1/proof.mjs` | `moveRootLayoutRaw`: the after head must load `afterSet.rootNotFoundScript` (fail closed); the before head keeps the before payload's name (stored side against itself) | F1 rule 3 |
| `renderer/test/serving-contract/contract.test.mjs` | the CM1 / en-US / row-123 sets carry `rootNotFoundScript`; row 88 takes the build's name + 3 fail-closed controls; new rows `np1-bootstrap-mask-controls` (controls a, b, c and a positive control) and `np1-bootstrap-chunks` (rule 2; control d on a copy of the static output; a chunk the build does not have; a missing element); row 124: named allowance `ROUTE_HANDLER_VARY_16_4_6` (route handlers checked against `app-path-routes-manifest.json`; next ≥ 16.4.6) + 3 controls | F1 rules 2–4, F2 |
| `renderer/test/serving-contract/README.md`, `cm1-byte-identity/README.md` | the row table and the comparison list | ripple |
| `docs/caching-architecture.md` | § Serving contract: re-measure on 16.4.6 — the `Vary` allowance, the mask rule, the resource row, rule 3 | § 6 |
| `docs/slices/catalog-mode-1.md` | § 8.21 amendment CM1-A3 (appended) | § 6 |
| `renderer/ARCHITECTURE.md` | one sentence in the locale proof paragraph | § 6 |

No stored capture, `before*`/`after*` body or `expected*` file changed (`git status`, EXECUTED).

**Gates r1 (EXECUTED, exit codes bare).** The root build ran with NO receipt directory before it (listed:
`r1-receipts.before.txt`, "No such file or directory") and none after it (ruling R-NP1-COLD = B; deviation 1 of cycle 1
stands as recorded above).

| Gate | Exit | Rows |
|---|---|---|
| `npm run build` | 0 | `▲ Next.js 16.4.6`; no `SecurityFatalError`, `UpgradeNudgeError` or upgrade text |
| `npm run typecheck` | 0 | 8 workspaces |
| `npm --prefix renderer test` | 0 | 45 / 625 |
| `npm --prefix renderer run test:serving` | 0 | **126 / 126** (124 + the two `np1-*` rows) |
| `npm --prefix renderer run build:open` | 0 | no guard text |
| `npm --prefix renderer run test:serving-bundle` | 0 | 58 / 58 |
| `node scripts/verify-opennext-patch.mjs` | 0 | 4 PASS/OK, script unchanged |
| `npm --prefix packages/plugins test` | 0 | 355 |
| `npm --prefix packages/shared test` | 0 | 385 |
| `npm --prefix admin run test:unit` | 0 | 296 |
| `npm --prefix backend run test:unit` | 0 | 1488 + 1 skipped |
| `npm --prefix tools/mcp-server test` | 0 | 17 |
| `git diff --check` | 0 | — |

Row outputs (r1 log): `np1-bootstrap-chunks` — 154 documents (en-US 81, RO 58, CQ1 6, CT1 6, 404 landings 3), 130 with
the element, 3 distinct chunks, each in `.next/static` and 200; `np1-bootstrap-mask-controls` — 1 positive control, 5
refusals by both comparators; `loc1e-cache-headers` — 150 URLs, the allowance used by 24 responses on 6 hosts.

**Not run (operator).** Staging deploy; the 51-URL Layer 2 check — its canonicaliser (CM1-A2 tooling) has no CM1-A3
rule yet, so across 16.4.3 → 16.4.6 it will show the `_R_` differences (INFERRED from its code; § 8.21 of
`catalog-mode-1.md`); the cache-header checks, including `Vary` on `/sitemap.xml` through the Lambda.
**Ripple outside the allocation:** `docs/slices/locale-1e.md` § 18 still says the removed root-layout script is "in
the document head on both sides" by its stored name; rule 3 supersedes that for the after side. Not edited (not
allocated).

### 2026-11-21 — cycle 3 (builder, after review-1 `revise`)

Logs: `.agent-manager/slices/NEXT-PATCH-1/r2-*.log` (the `r1-*` logs stay as cycle-2 evidence); diagnostic
`diag/05-test-serving-journal.log`.

**Correction 1 (review-1 finding 1) of cycle 2's rule-2 row.** Cycle 2 checked "every document of the suite's compared
capture sets" (154 documents) — a narrower population than the ruling's "every document the suite serves"; the
documents of the HC1, CC1, SL1*, BPF1 … rows were not checked. Class: a population defined by an enumerated list,
which the next row added to the suite would also miss. Rule now: the population is the journal of the suite's only
HTTP client — `harness.mjs` `request` records every response (`servedResponses`; `http.request` occurs nowhere else
in `serving-contract/`, OBSERVED by grep) — and `np1-bootstrap-chunks` runs as the LAST `next`-target row, so every
response of the run is in it. The baseline rule ("no `_R_` where the baseline has one") applies to a plain GET (no
request header, as the stored sets were captured) of a URL with a stored baseline (`cdl-2/before`, `1e/before-404`).
New controls: a chunk the build does not have, put into a served document of each of HC1, CC1, SL1A and BPF1, is
reported by both halves. Measured (r2 run): **531 HTTP responses from the suite's server, 456 of them `text/html`
documents, all 456 with a bootstrap, on 48 hosts; 287 plain GETs anchored to a baseline with the element; 3 distinct
chunks, each in `.next/static` and 200.** `docs/slices/catalog-mode-1.md` § 8.21 rule 2 and
`renderer/test/serving-contract/README.md` now state the ratified scope.

**Correction 2 (review-1 finding 2) of cycle 2's wording** — "its hash moves with every Next.js version (OBSERVED)" in
the cycle-2 entry above, and the same claim in the code comments, the READMEs and `docs/caching-architecture.md`.
What was measured is one transition: next 16.4.3 → 16.4.6 changed all three bootstrap chunk names and the
root-layout chunk name. Corrected everywhere it was added (cycle-2 entries of this record are kept as written): such
content-hashed names CAN change with a framework update; 16.4.3 → 16.4.6 is the measured case. Class: a universal
claim from one measurement; rule: state the measured transition and the possibility, never "every".

**Gates r2 (EXECUTED, exit codes bare).** Before the root build the receipt directory did not exist
(`r2-receipts.before.txt`).

| Gate | Exit | Rows |
|---|---|---|
| `npm run build` | 0 | `▲ Next.js 16.4.6`; no guard text |
| `npm run typecheck` | 0 | 8 workspaces |
| `npm --prefix renderer test` | 0 | 625 |
| `npm --prefix renderer run test:serving` | 0 | 126 / 126 |
| `npm --prefix renderer run build:open` | 0 | no guard text |
| `npm --prefix renderer run test:serving-bundle` | 0 | 58 / 58 |
| `node scripts/verify-opennext-patch.mjs` | 0 | 4 PASS/OK, script unchanged |
| `npm --prefix packages/plugins test` | 0 | 355 |
| `npm --prefix packages/shared test` | 0 | 385 |
| `npm --prefix admin run test:unit` | 0 | 296 |
| `npm --prefix backend run test:unit` | 0 | 1488 + 1 skipped |
| `npm --prefix tools/mcp-server test` | 0 | 17 |
| `git diff --check` | 0 | — |

Not run (operator), unchanged from cycle 2: staging deploy, Layer 2 51-URL check (its canonicaliser needs CM1-A3),
cache-header checks incl. `Vary` through the Lambda; `locale-1e.md` § 18 wording (not allocated).

### 2026-11-21 — cycle 4 (builder, after review-2 `revise`)

Logs: `.agent-manager/slices/NEXT-PATCH-1/r3-*.log`; diagnostic `diag/06-test-serving-drain.log`.

**Correction (review-2) of cycle 3's rule-2 row and its counts** ("531 HTTP responses … 456 of them `text/html`" in
the cycle-3 entry above). The row read the journal ONCE, before its own controls and status probes; those add
responses — a probe for a chunk the build does not have answers a 307 HTML document — and none of them was checked, so
531 / 456 described a snapshot, not the run. Class: a check over a population that the check itself extends, read
once. Rule now: the row runs its document-producing controls FIRST, then `bootstrapChunkProblemsOfJournal`
(`cm1-byte-identity.mjs`) reads the journal again and again, checking only the entries added since the last pass,
until a pass finds none; it fails closed when the journal still grows after 10 passes. New controls: a fake journal
that gains a document with a chunk the build does not have during the first pass — reported in pass 2; a journal
that grows on every probe — fails closed after 3 passes. Measured (r3 run): **549 HTTP responses from the suite's
server, controls and probes included, checked in 2 passes; 460 `text/html` documents, all with a bootstrap, on 48
hosts** (the 4 more documents are the 307 answers to the family controls' missing-chunk probes); 287 plain GETs
anchored to a baseline with the element; 3 distinct chunks, each in `.next/static` and 200.

**Gates r3 (EXECUTED, exit codes bare).** Before the root build the receipt directory did not exist
(`r3-receipts.before.txt`).

| Gate | Exit | Rows |
|---|---|---|
| `npm run build` | 0 | `▲ Next.js 16.4.6`; no guard text |
| `npm run typecheck` | 0 | 8 workspaces |
| `npm --prefix renderer test` | 0 | 625 |
| `npm --prefix renderer run test:serving` | 0 | 126 / 126 |
| `npm --prefix renderer run build:open` | 0 | no guard text |
| `npm --prefix renderer run test:serving-bundle` | 0 | 58 / 58 |
| `node scripts/verify-opennext-patch.mjs` | 0 | 4 PASS/OK, script unchanged |
| `npm --prefix packages/plugins test` | 0 | 355 |
| `npm --prefix packages/shared test` | 0 | 385 |
| `npm --prefix admin run test:unit` | 0 | 296 |
| `npm --prefix backend run test:unit` | 0 | 1488 + 1 skipped |
| `npm --prefix tools/mcp-server test` | 0 | 17 |
| `git diff --check` | 0 | — |

Not run (operator), unchanged: staging deploy, Layer 2 51-URL check (its canonicaliser needs CM1-A3), cache-header
checks incl. `Vary` through the Lambda; `locale-1e.md` § 18 wording (not allocated).

## Operator closeout (2026-11-21)

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, four cycles. Review-0 escalated (ten serving rows failed);
reviews 1 and 2 sent the new test support back (families of pages not covered by the resource check; a journal
read once, which missed pages produced late in a run); review-3 approved.

**Operator rulings (packet § 6), test tooling only — reported to the human, who may overrule before prod.**
R-NP1-F1 = A: the comparison ignores framework chunk names inside `<script id="_R_">` only; row
`np1-bootstrap-chunks` checks that every listed chunk exists in the build and answers 200; the root script of two
rows is read from the build's manifest; four deliberate-failure controls. R-NP1-F2 = A: route handlers on the
`next` target may gain exactly `Accept-Encoding` in `Vary`. R-NP1-COLD = B: the harness may remove `.next`; the
operator records a receipt-free build. No stored capture or expectation data changed.

**Gates (operator run on the approved tree).** build 0, typecheck 0, shared 0, plugins 0, renderer 0, serving 0
(126 of 126), build:open 0, serving-bundle 0 (58 of 58), patch guard 0, admin unit 0, backend unit 0, mcp 0,
`git diff --check` 0. `npm ls next`: 16.4.6 only. Every changed path in the allocation. The receipt directory did
not exist before the root build; the log holds no `SecurityFatalError`, no `UpgradeNudgeError`, no reminder line.

**Staging.** `./deploy.sh staging diff` ran both builds with no stop. Diff read first: code and asset hashes only
(the three renderer functions, the renderer assets, the admin config writer, and the 15 handlers of
`public-harden-1`); no resource added or removed; no permission change. Deployed to `AmodxStack-staging`.

| Check | Result |
|---|---|
| 51 CM1 reference URLs (`/_site/cm1-*`), captured before and after: status, content type, cache-control, vary, location, `lang`, count of bootstrap chunks | equal on 51 of 51 |
| the same 51: visible text | the same words on 51 of 51. On 8 pages the `<title>` text is at another position. Two captures of the SAME new build differ in that way on 6 pages, so it is the known streamed-metadata position, not the upgrade |
| bootstrap chunk names | 3 before, 3 after, none shared (the expected rename); each new one answers 200 on `staging.amodx.net` |
| `staging.amodx.net/` twice | `Miss from cloudfront`, then `Hit from cloudfront`; `cache-control: s-maxage=31536000`; `Vary` unchanged |
| `/sitemap.xml` through the Lambda (`staging.amodx.net`, `Accept-Encoding: gzip`) | `Vary` holds no `Accept-Encoding`: the F2 change does not reach the deployed setup |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt` on `/_site/cm1-commerce` | headers equal before and after |
| `tests/e2e/preview-site.spec.ts` (Chromium, staging) | 1 passed: preview page renders, the click stays inside the preview |

**Limit of this proof.** The staging comparison is of text and headers, not the canonical byte form of
`catalog-mode-1.md` § 8.20; the byte form is proven by the serving suite on both targets. The 51-URL canonical
capture tool of October is not rebuilt (`LAYER2-CANON-1` stays open).

**Finding for the human.** F-NP1-GUARD: the Next.js build check will stop an agent's build again at the next
advisory. The staging deploy then needs the patch first. That is the intended effect of the check; no switch is
set.
