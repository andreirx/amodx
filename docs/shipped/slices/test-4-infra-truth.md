# TEST-4: Infra truth — real cdk synth assertions, delete the lying stub

- **Status:** SHIPPED 2026-07-28 — deployed to production by the human, verified live (staging probe suite + prod probes: bijup.com s-maxage/Hit/age, session bypass, nf no-loop)
  § Revise cycle 2026-07-28 for the `(d)` contract correction, then
  § Revise cycle 2026-07-28 round 2 for the doc-only reconciliation fixes)
- **Track:** TEST
- **Depends:** test-1 (CI)
- **Source:** `docs/testing-strategy.md` §6; TECH-DEBT (CDK test suite placeholder)
- **Maturity target:** MATURE
- **Constraint:** standing directive 2026-07-27 — NO changes under `infra/lib`
  (or any deployable infra). This slice READS the synthesized template only.

## Purpose / risk retired

`infra/test/infra.test.ts` is 100% commented out yet reports PASS 1/1 — a false green
(a suite that asserts nothing must not exist; testing-strategy invariant 2). Meanwhile
the security-critical infra properties that Track CACHE just ratified exist only as
code — nothing fails if a future edit regresses them. This slice makes them assertions.
It is also the prerequisite `dep-1` step 1 has been blocked on.

## Scope

1. Delete the stub (and its stale compiled .js/.d.ts siblings if present untracked).
2. `infra/test/amodx-stack.test.ts` (or per-construct files) using `aws-cdk-lib/assertions`
   `Template.fromStack`, asserting AT LEAST:
   a. RendererCachePolicy: header allowlist EXACTLY {X-Forwarded-Host, RSC,
      Next-Router-Prefetch, Next-Router-State-Tree, Next-Router-Segment-Prefetch,
      x-has-session}; query allowlist EXACTLY {page,q,availability,id,email,preview,nf};
      cookies none; TTLs (default 0, max 365d)
   b. The viewer-request CloudFront Function is attached to the default and api/*
      behaviors
   c. /api/* behavior uses CACHING_DISABLED
   d. `cloudfront:CreateInvalidation` appears in EXACTLY the 4 intended roles and no others,
      split into the two categories the design distinguishes: the **3 request-path** Lambdas
      (debounce, flush, nightly — the security-relevant set) and **1 deploy-time** role
      (CDK's `BucketDeployment` custom resource, which invalidates static assets during
      `cdk deploy`). Any fifth grant fails.
      *(Corrected 2026-07-28 from "the 3 intended roles" by operator decision
      `test4-invalidation-role-contract` — see § Finding 2. The synthesized template always
      had 4; the contract, not the infra, was wrong.)*
   e. EventBridge rules: debounce 1/min + nightly 02:00 UTC cron exist
   f. S3/static behaviors (_next/static, assets, favicon) target S3, not the Lambda
3. If synth requires account/region context unavailable locally: use env-agnostic
   synth (no lookups) — if the stack construction itself blocks credential-free synth,
   STOP and report (do not modify infra/lib to work around it).
4. CI: infra test job (credential-free `npm test` in infra after build).
5. Reconciliation: strategy doc estate row, TECH-DEBT items (stub deletion closes the
   'CDK infra test placeholder' entry; dep-1 unblock noted), ROADMAP row.

## Non-scope

- ZERO edits under `infra/lib` / `infra/bin`. No cdk version bumps (dep-1 stays parked).
- No deploys, no cdk diff against real environments.

## Definition of Done

1. Stub gone; suite green; each assertion names the ratified property it pins
   (comment: which slice/decision established it).
2. Mutation check: flip one policy value locally (temp edit under infra/lib,
   REVERTED + proven reverted) → suite fails. This is the one permitted temporary
   touch under infra/lib and must never appear in the final diff.
3. CI runs it credential-free.

## Evidence

- `EXECUTED`: `cd infra && npm test` transcript; mutation-check fail + revert proof;
  root build + typecheck green.
- `NOT RUN` (operator): CI run on push.

---

## Build run 2026-07-28

### What shipped

| File | Change |
|---|---|
| `infra/test/infra.test.ts` | **deleted** — the false green. Its untracked compiled siblings `infra.test.js` / `infra.test.d.ts` deleted too (scope 1) |
| `infra/test/amodx-stack.test.ts` | new — 15 assertions over a REAL `Template.fromStack(new AmodxStack(...))` |
| `infra/test/no-dotenv.cjs` | new — `.env*` blindfold for the process tree the synth spawns |
| `infra/jest.config.js` | `moduleFileExtensions` (`ts` before `js`), `testTimeout`, `maxWorkers: 1` |
| `.github/workflows/ci.yml` | new credential-free job `infra-synth` |
| `infra/ARCHITECTURE.md` | `test/` tree + a § *Testing* section |
| docs | this file, `docs/ROADMAP.md`, `docs/testing-strategy.md`, `docs/TECH-DEBT.md`, `CURRENT_SLICE.md` |

`infra/package.json` was **not** touched: no new dependency was needed (jest + ts-jest +
`aws-cdk-lib/assertions` were already present), so `dep-1`'s jest/ts-jest advisory group is
unchanged and no `npm audit` delta rides along.

**Zero edits under `infra/lib` and `infra/bin` in the final diff** — proven below.

### Assertion → ratified property map

| id | pins | ratified by |
|---|---|---|
| `(src1)` | the suite loads the TypeScript source, not a stale compiled sibling | this slice (see § Finding 1) |
| `(a1)` | header allowlist == the six ratified headers | `cache-1` (H1, RSC family) + `cache-3` rev 3 decision `CACHE3-SESSION-KEY` = B (`x-has-session`) |
| `(a2)` | query allowlist == the seven read parameters | `cache-3` (allowlist replaces `all()`), finding F1 (`nf` mandatory) |
| `(a3)` | `CookieBehavior: none` | `cache-3` rev 3 — the precondition for `x-has-session` |
| `(a4)` | TTLs default 0 / min 0 / max 365 d | `cache-1` (`minTtl: 0` is what makes `no-store` not stored) |
| `(b)` | viewer-request Function on the default AND `api/*` behaviors | Phase 4 tenant isolation + Phase 6.1 origin verify |
| `(b2)` | default behavior uses `RendererCachePolicy`, not a managed one | guards `enableCaching`; without it `(a1)`–`(a4)` could pass on a distribution that caches nothing |
| `(c)` | `api/*` == managed `CACHING_DISABLED` | `docs/caching-architecture.md` § */api/\* Behavior* |
| `(f)` | `_next/static/*`, `assets/*`, `favicon.ico` → S3 + OAC + `CACHING_OPTIMIZED` | § *CloudFront Distribution Layout* |
| `(d)` | `cloudfront:CreateInvalidation` blast radius — 3 request-path + 1 deploy-time role | § *Key Architectural Decision: No CloudFront IAM on Mutation Lambdas* (corrected 2026-07-28, decision `test4-invalidation-role-contract`) |
| `(e1)`/`(e2)` | debounce `rate(1 minute)`, nightly `cron(0 2 * * ? *)` | § *Debounce Flush Lambda* / § *Nightly Safety Net* |
| `(iso1)`–`(iso3)` | the credential-free claim, measured | `docs/testing-strategy.md` § *Invariants* |

### Result — `EXECUTED` 2026-07-28

`cd infra && npm test` → **15/15 pass, 58.5 s**, exit 0. Full run: `PASS test/amodx-stack.test.ts`.

410 resources in the parent template. `(iso1)` printed its measured coverage rather than
asserting a machine-dependent constant.

### Mutation check — `EXECUTED`, two rounds

| # | temporary edit | result |
|---|---|---|
| 1 | `infra/lib/renderer-hosting.ts` — drop `'nf'` from the query allowlist | exit 1; **exactly** `(a2)` failed, diff named the missing `"nf"`; other 14 green |
| 2 | `infra/lib/amodx-stack.ts` — nightly cron `hour: '2'` → `'3'` | exit 1; **exactly** `(e2)` failed (`cron(0 3 * * ? *)` vs expected `cron(0 2 * * ? *)`); other 14 green |

Round 2 exists because round 1 only proves the renderer-hosting path; the two rounds
together show assertions on two different files and two different resource families fire.

Reverted with `git checkout --` after each; proven by `shasum -a 256` equality against the
pre-mutation hash, and by `git diff -- infra/lib infra/bin` + `git status --untracked-files=all
-- infra/lib infra/bin` both empty.

    infra/lib/renderer-hosting.ts  165f7482995aa064bced2b0cd5ea1ba9d0c90f2ce1ee6892bdde4e225098b199 (before == after)
    infra/lib/amodx-stack.ts       6cf07aa9f27954e27e9ed560e1e4224b711526d6edac10a4bff7ef0a90a46080 (before == after)

Rounds 3-4 re-prove the **rewritten** `(d)` — see § *Revise cycle*.

### Finding 1 — jest was silently testing a seven-month-old compiled stack

The first green-looking implementation was not green: 10 of 14 assertions failed because
`import { AmodxStack } from '../lib/amodx-stack'` resolved to **`infra/lib/amodx-stack.js`**,
an untracked, gitignored artifact dated 2026-01-27, emitted before `infra/tsconfig.json`
gained `noEmit: true`. Jest's default `moduleFileExtensions` puts `js` ahead of `ts`.

That snapshot predates the whole CACHE track — `grep -c 'RendererCachePolicy\|x-has-session'
infra/lib/renderer-hosting.js` → **0**, `grep -c 'DebounceFlushFunc' infra/lib/amodx-stack.js`
→ **0** — so the suite synthesized a stack with no cache policy, no `api/*` behavior and no
flush Lambdas, and reported those absences as ordinary assertion failures.

This is the deleted stub's failure mode in a different costume, and it is the more dangerous
form: a less suspicious author would have written the assertions to match what the stale
artifact produced and shipped a green, meaningless suite. `cdk.json` has always guarded the
deploy path with `ts-node --prefer-ts-exts`; nothing guarded the test path.

Fixed by pinning `moduleFileExtensions: ['ts','tsx','js','json','node']`, and pinned by
`(src1)`, which asserts the resolved module path ends in `.ts` — so the guard cannot be
removed by someone tidying the config. The stale `.js` files themselves were deliberately
**not** deleted (they are the operator's untracked working-tree detritus, and deleting them
would hide the hazard while leaving the config unguarded); recorded in `docs/TECH-DEBT.md`.

### Finding 2 — the invalidation blast radius is 4 roles, not 3 — CONTRACT CORRECTED

Scope item 2d and `docs/caching-architecture.md` § *Key Architectural Decision* both said
`cloudfront:CreateInvalidation` reaches exactly **3** Lambdas. The synthesized template — both
this suite's and the committed `infra/cdk.out/AmodxStack-staging.template.json` — has **4**
grants (`OBSERVED`, by scanning every `AWS::IAM::Policy` in the committed staging template):

    CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756CServiceRole89A01265
    DebounceFlushFuncServiceRole5C80FDB8
    InvalidationFlushFuncServiceRole64B9FE77
    NightlyCacheFlushFuncServiceRole772EE5E4

The fourth is CDK's own `BucketDeployment` custom resource, which receives the permission
because `renderer-hosting.ts:539` passes `distribution: this.distribution` to
`s3deploy.BucketDeployment` so it can invalidate after uploading static assets. Pre-existing
CDK-generated tooling, not a grant this project wrote.

**Resolved 2026-07-28 — operator decision `test4-invalidation-role-contract`: correct the
contract to four named roles.** The synthesized template is the evidence and it wins. The
least-privilege property the design actually cares about is about the *request path*
("mutation handlers write a DDB marker, they do not hold CloudFront IAM"), and that property
is intact: the deploy-time role holds the action only while `cdk deploy` runs.

`(d)` therefore asserts the two categories separately rather than a flat set of four —
3 request-path roles by name (the security-relevant set), 1 deploy-time role by name — and
fails on a fifth grant (reported by role name) or on a known role acquiring the action a
second time (caught by the total). A reviewer reading a red `(d)` learns *which kind* of grant
moved, which a flat count cannot say.

Both documents are corrected in this cycle: `docs/caching-architecture.md`
§ *Key Architectural Decision* now names the fourth role and the request-path/deploy-time
split; scope item 2d above says four. The `docs/TECH-DEBT.md` entry that carried the
correction forward is closed.

### Finding 3 — `npm test` in infra runs two application builds, and would have leaked a live API key

`Template.fromStack` is neither cheap nor pure here: `RendererHosting` and `AdminHosting`
shell out to `npm run build:open` and `npm run build` **inside their constructors**
(`renderer-hosting.ts:62`, `admin-hosting.ts:31`), each with an inherited `{...process.env}`.

Consequences, all measured:

1. The suite costs ~58 s and **rebuilds `renderer/.open-next` and `admin/dist`** as a side
   effect. Both are gitignored build outputs that every `cdk deploy` regenerates anyway, so
   nothing durable is lost — but it is surprising and it is documented at the top of the test
   file and in `jest.config.js`.
2. Without a countermeasure the gate would be credential-**bearing**: `next build` loads
   `renderer/.env.local`, which on this checkout carries a real `AMODX_API_KEY`, a real
   `TABLE_NAME` and `AWS_REGION`; `vite build` loads `admin/.env.local`. On a machine with an
   AWS profile the build's data fetches would then address real DynamoDB.

`installProcessTreeIsolation()` closes this without touching `infra/lib`: it strips `AWS_*` /
`AMODX_*` / `TABLE_NAME` / `API_URL` / `NEXTAUTH_SECRET` / `REVALIDATION_SECRET` from
`process.env` *before* the constructors copy it, points `AWS_SHARED_CREDENTIALS_FILE` /
`AWS_CONFIG_FILE` at a nonexistent path, sets `AWS_EC2_METADATA_DISABLED`, and delivers
`infra/test/no-dotenv.cjs` through `NODE_OPTIONS` so the `.env*` blindfold survives every fork
(`test-2`'s measurement: an argv `--require` does not).

Measured, not argued: `(iso1)` reads the hook's own per-process journal back after the real
builds and asserts blocks in **both** `renderer` and `admin` — final run printed
`125 processes covered, 10 reads blocked in [admin, renderer] via [stat]`. (The histogram is
printed rather than pinned: the process count tracks the build's worker count, so a constant
would be flaky on a different core count. It also records that only `stat` fires today —
`readFileSync`/`existsSync` are patched as defence in depth against a loader that changes its
probe order, and `(iso2)` exercises the `readFileSync` path so neither patch is untested.)
`(iso2)` is the positive control
(the same detector, in a child, aimed by `AMODX_INFRA_DOTENV_DIRS` at a scratch dir holding a
REAL `.env` — blocked — and a plain file — readable), which the strategy doc requires of any
absence claim; `(iso3)` pins the stripped environment. Corroborating first-party reading
(`OBSERVED`): `next build` printed **no** `- Environments: …` line, i.e. it loaded zero env
files.

The clean fix is to lift build orchestration out of the CDK constructs so a synth is a pure
function of source. That is an `infra/lib` change this slice is barred from making;
`docs/TECH-DEBT.md`.

### Deliberate non-decisions

- **Not** stubbing `child_process.execSync` to skip the builds. It would synthesize a
  *different* construct graph than the one that deploys (no image-optimization behavior, no
  warmer rule, both gated on `.open-next` subdirectories existing) and would require
  fabricating a `.open-next` tree. A slice called "infra truth" asserting against a fabricated
  input is the failure it exists to remove.
- **Not** asserting the CloudFront Function's *source* (the session-cookie predicate).
  `cache-3`'s `probe-cache3-cffunc.mjs` §C already pins it against `middleware.ts`; restating
  it here is duplication, not coverage (`docs/testing-strategy.md` §1).
- **Not** a snapshot test. `Template.fromStack(...).toMatchSnapshot()` over 410 resources fails
  on every unrelated change and is re-blessed rather than read — a green that means "someone
  pressed `-u`". Named assertions cost more to write and are the only form that survives a
  reviewer asking *why* a value is what it is.

### Env-agnostic synth (scope item 3) — no STOP required

The stack constructs credential-free. The test stack passes `config: { domains: {} }`, so
`AmodxDomains` — the only construct that calls `route53.HostedZone.fromLookup`, i.e. the
stack's only synth-time context provider — is never instantiated. Everything else resolves
at deploy time as a CloudFormation intrinsic.

`VERIFIED`: dropping `domains.root` changes only domain-shaped output (`Aliases`,
`ViewerCertificate`, the API custom domain, Route53 records). Every property asserted here was
diffed against `infra/cdk.out/AmodxStack-staging.template.json` (synthesized *with* domains)
and is identical: the cache policy, all six behaviors, the CloudFront Function, the four
invalidation grants and both EventBridge rules.

### `dep-1` unblocked

`dep-1` step 1 was "activate CDK infra tests + CI `cdk synth` baseline" before bumping
`aws-cdk-lib 2.241.0 → 2.260.0`. That step is now satisfied: a real synth runs on every push,
and a bump that changes any pinned property fails a **named** assertion rather than a snapshot
blob. `docs/TECH-DEBT.md` § *Dependency Audit Remediation* updated.

### Not run

- `NOT RUN` (operator): the `infra-synth` CI job on a real push. The workflow change cannot be
  exercised locally. Two CI-specific risks to watch on the first run: `NodejsFunction` bundling
  falls back to Docker if esbuild is not locally resolvable (slower, still correct), and the
  job pays a cold `next build` with no cache.
- `NOT RUN`: any deploy or `cdk diff` against a real account. Out of scope by construction.

---

## Revise cycle 2026-07-28 — decision `test4-invalidation-role-contract`

Operator ruling on Finding 2: **correct the contract to four named roles.** The synthesized
template is the evidence and it wins. Scope of this cycle, and nothing else:

| File | Change |
|---|---|
| `infra/test/amodx-stack.test.ts` | `(d)` rewritten — two named categories, four expectations |
| `docs/caching-architecture.md` | § *Key Architectural Decision* — the "3 specialized Lambdas" claim corrected |
| this file | scope item 2d, the `(d)` map row, Finding 2, this section |
| `docs/TECH-DEBT.md` | the "doc says 3, template has 4" entry CLOSED (the fix it deferred is applied) |
| `docs/ROADMAP.md`, `infra/ARCHITECTURE.md` | ripple: the `(d)` wording in both |
| `CURRENT_SLICE.md` | **reverted** — see § *Scope overreach, corrected* |

### `(d)` as rewritten

Two named lists, not one flat set of four:

- `REQUEST_PATH_INVALIDATORS` — the **security-relevant** set. `DebounceFlushFuncServiceRole`
  (EventBridge `rate(1 minute)`, fires the debounced `/*` invalidation), `InvalidationFlushFuncServiceRole`
  (`POST /system/invalidation`, the admin "GO LIVE NOW" button), `NightlyCacheFlushFuncServiceRole`
  (`cron(0 2 * * ? *)`, the change-gated safety net). A fourth entry here is the ~70-Lambda
  post-construction grant loop coming back.
- `DEPLOY_TIME_INVALIDATORS` — `CustomCDKBucketDeployment…ServiceRole`. Holds the action only
  while `cdk deploy` runs. CDK-generated tooling, not a grant this project wrote.

Four expectations, so a red run says *which kind* of grant moved rather than "the count is wrong":

1. every request-path role is still present — failure names the **missing** role;
2. same for the deploy-time role;
3. any grant matching neither list — failure names the **offending** role;
4. total == 3 + 1 — catches a *known* role acquiring the action a second time through a second
   policy, which 1-3 cannot see because they only test membership.

Grants are collected across the parent stack **and** both API NestedStacks, without
de-duplication (which is what makes 4 meaningful).

### Mutation check on the rewritten `(d)` — `EXECUTED`, two rounds

| # | temporary edit to `infra/lib/amodx-stack.ts` | result |
|---|---|---|
| 3 | comment out the `nightlyFlushFunc.addToRolePolicy` grant | exit 1; **exactly** `(d)` failed at expectation **1**, diff named the missing `"NightlyCacheFlushFuncServiceRole"`; other 14 green |
| 4 | grant `cloudfront:CreateInvalidation` to `invalidationStatusFunc` (a DDB-read-only handler) — i.e. a genuine FIFTH grant | exit 1; **exactly** `(d)` failed at expectation **3**, diff named `"InvalidationStatusFuncServiceRole856DFD8C"`; other 14 green |

Round 4 is the regression the assertion exists to catch: a request-path Lambda that has no
business holding CloudFront IAM acquiring it. It fails **by name**, not as a count.

Reverted with `git checkout --` after each. Proven: `shasum -a 256 infra/lib/amodx-stack.ts` ==
`6cf07aa9f27954e27e9ed560e1e4224b711526d6edac10a4bff7ef0a90a46080` (the pre-mutation hash, same
value recorded for round 2 above), and `git diff -- infra/lib infra/bin` +
`git status --porcelain --untracked-files=all -- infra/lib infra/bin` both empty.

Final state `EXECUTED`: `cd infra && npm test` → **15/15 pass, 53.2 s, exit 0**;
`(iso1)` printed `125 processes covered, 10 reads blocked in [admin, renderer] via [stat]`.

### Finding 4 — a stale `renderer/.next` fails the whole suite, and it is not the suite's fault

`OBSERVED` during mutation round 4's first attempt: all 15 assertions failed, not because of the
mutation but because `beforeAll` threw —

    Build error occurred
    Error: ENOTEMPTY: directory not empty, rmdir
      '…/renderer/.next/standalone/node_modules/next'

`next build` failed clearing `.next/standalone` left behind by the *previous* run of this same
suite. `rm -rf renderer/.next` and the identical command produced the expected single-assertion
failure. Nothing was changed to fix it.

This is a **consequence of the builds-inside-constructors defect already recorded** in
`docs/TECH-DEBT.md` § *CDK constructs run application builds inside their constructors*, not a
new one: because the synth mutates `renderer/.next`, consecutive runs are not independent, and a
partially-written tree from an interrupted run turns every assertion red for a reason unrelated
to infra. Recorded as consequence 4 there and as a one-line operator note in
`infra/ARCHITECTURE.md` § *Testing*. CI is not exposed (clean checkout each run); a developer
re-running locally is. The real fix is the same one: take the builds out of the constructors.

### Scope overreach, corrected

Cycle 1 modified `CURRENT_SLICE.md`. The packet's reconciliation list does not include it, and
`docs/documentation.md:126` reserves that file. **Reverted** with `git checkout -- CURRENT_SLICE.md`;
`git diff --stat CURRENT_SLICE.md` is empty. The `test-4` entry it added is not lost — the ROADMAP
row and this document carry the same content, and `CURRENT_SLICE.md` is the operator's to move.

---

## Revise cycle 2026-07-28 round 2 — doc reconciliation only

Review found no code defect: the suite, its `(d)` rewrite, the CI job and the `infra/lib`
read-only constraint all held. What it found was that two **plan-side** surfaces still carried
the pre-implementation claims while their own status text right below carried the corrected
ones — a document that contradicts itself in adjacent lines. Both are the same class of bug the
deleted stub was: a truth surface that reads as authoritative and is not.

**No code, config, test or CI file changed in this round.**

| File | Line | Was | Now |
|---|---|---|---|
| `docs/ROADMAP.md` | 61 (Scope cell) | "real `cdk synth` **snapshot tests** + CI synth job" | "real `cdk synth` assertions — `Template.fromStack`, one **named** assertion per ratified property (NOT `toMatchSnapshot()`)", with the correction dated inline |
| `docs/testing-strategy.md` | 74-76 (§6 Infra plan) | "IAM boundaries (e.g. CloudFront invalidation **confined to 3 Lambdas**)" | "`cloudfront:CreateInvalidation` confined to **3 request-path Lambdas** (debounce, flush, nightly) **plus 1 deploy-time role** (CDK's `BucketDeployment` custom resource, which holds the action only while `cdk deploy` runs)", with the correction dated inline and pointed at decision `test4-invalidation-role-contract` |
| `docs/testing-strategy.md` | §6 status para | "Two corrections to the plan above came out of the implementation" | same, plus "and both are now folded into it" — so the paragraph does not imply the line above is still wrong |
| this file | Status line, this section | — | round 2 recorded |

Each correction is **dated and attributed inline** rather than silently overwritten: the plan
text is evidence of what was believed before the synth was read, and a reader auditing decision
`test4-invalidation-role-contract` needs to see what it overturned.

### Stale-phrase scan — `EXECUTED`

Deterministic `grep -rn` (not a semantic read) over every surface this slice touched —
`docs/ROADMAP.md`, `docs/testing-strategy.md`, `docs/TECH-DEBT.md`,
`docs/caching-architecture.md`, `infra/ARCHITECTURE.md`, this file,
`.github/workflows/ci.yml`, `infra/test/amodx-stack.test.ts`:

    grep -rn "snapshot" <surfaces>
    grep -rn "3 Lambdas\|three Lambdas\|3 roles\|three roles\|3 intended\|limited to 3\|confined to 3" <surfaces>

Every surviving hit was classified, and each falls into exactly one of three permitted kinds —
there are no unclassified hits:

1. an explicit **negative** claim ("Not a snapshot", "no snapshot file, no fixture template",
   "NOT `toMatchSnapshot()`") — these are the design rationale and must stay;
2. the **other sense** of "snapshot": Finding 1's seven-month-old compiled `infra/lib/*.js`
   artifact (`test-4-infra-truth.md:141`, `TECH-DEBT.md:218`). Same word, different referent;
   correct in place;
3. a **dated historical record** of what a contract used to say
   (`TECH-DEBT.md:264,269` — the CLOSED entry; `caching-architecture.md:1410`;
   this file:37; `testing-strategy.md:79`). Deleting these would erase the audit trail for
   decision `test4-invalidation-role-contract`.

`caching-architecture.md:1406` keeps "3 specialized Lambdas" deliberately: it is already scoped
by its own clause — "**on the request path**, CloudFront access is limited to those 3 specialized
Lambdas instead of 70" — which is the true and security-relevant claim. The deploy-time fourth
role is named on the following line. Broadening 1406 to "4" would *weaken* the least-privilege
statement the section exists to make.

A second staleness ripple was caught by the same scan and fixed: three summary surfaces
(`docs/ROADMAP.md:61`, `docs/testing-strategy.md` §6, `docs/TECH-DEBT.md:185`) still said
"mutation-checked in **two** rounds" after rounds 3-5 had happened. Under-reporting evidence is
the same class of defect as over-reporting it — a reviewer sizing the confidence in this suite
reads those lines, not the per-cycle tables. All three now say five.

### Mutation check, round 5 — `EXECUTED`

This round changed no code, but it re-runs and re-reports the suite, so the green being reported
had to be shown non-vacuous *in the final state*, not inherited from a previous cycle's
transcript. One round, aimed at `(d)` — the assertion decision `test4-invalidation-role-contract`
reshaped and the one this review round is about — and at a **different** role than rounds 3-4
touched, so all three request-path entries have now been independently proven live:

| # | temporary edit to `infra/lib/amodx-stack.ts:315` | result |
|---|---|---|
| 5 | debounce grant's action `cloudfront:CreateInvalidation` → `cloudfront:GetDistribution` (the role survives, the *grant* leaves the set — a subtler mutation than deleting the statement) | exit 1; **exactly** `(d)` failed at expectation **1**; diff named the missing `"DebounceFlushFuncServiceRole"`; other **14 green** |

Reverted with `git checkout -- infra/lib/amodx-stack.ts`. Proven:
`shasum -a 256 infra/lib/amodx-stack.ts` ==
`6cf07aa9f27954e27e9ed560e1e4224b711526d6edac10a4bff7ef0a90a46080` (identical to the value
recorded for rounds 2 and 3-4), and `git diff -- infra/lib infra/bin` +
`git status --porcelain --untracked-files=all -- infra/lib infra/bin` both empty.

Round coverage after five rounds: `(a2)` query allowlist, `(e2)` nightly schedule, and `(d)` at
expectation 1 via `NightlyCacheFlushFunc` (round 3) and `DebounceFlushFunc` (round 5), at
expectation 3 via a genuine fifth grant (round 4). `InvalidationFlushFunc` is the one
request-path role never individually mutated — it is covered by the same `held()` code path as
the other two, so a per-role round would test the fixture, not the assertion.

Final state `EXECUTED`: `cd infra && npm test` → **15/15 pass, exit 0, 51.6 s** (measured with
the exit code captured, not inferred from the summary line); `(iso1)` printed
`125 processes covered, 10 reads blocked in [admin, renderer] via [stat]`.
