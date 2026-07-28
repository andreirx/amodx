# CACHE-2: Fix ISR revalidation keying (domain, not tenantId)

- **Status:** SHIPPED 2026-07-28 — deployed to production by the human, verified live (staging probe suite + prod probes: bijup.com s-maxage/Hit/age, session bypass, nf no-loop)
  `CACHE-2-D2`, both now applied) — code + IAM complete, review pending, **NOT DEPLOYED**.
  Track CACHE deploys only after `cache-3` (H1); nothing in this slice is live.
- **Track:** CACHE — serving-layer remediation
- **Depends:** cache-1 (until pages are cacheable, ISR purges are moot — but this can be
  built in parallel; it only becomes *observable* after cache-1)
- **Source:** code audit 2026-07-26
- **Maturity target:** MATURE

## Defect being fixed

All 8 production ISR `revalidatePath()` calls are no-ops. The backend calls
`revalidatePath("/<tenantId>/<path>")` (`content/update.ts:191`, `products/update.ts:82,85`,
`products/delete.ts:48`, `categories/update.ts:66,69`, `categories/delete.ts:67`), but the
middleware rewrites production traffic to `/<domain>/<path>` — so the OpenNext ISR cache
entry is keyed by **domain**. Purging the tenantId-keyed path touches nothing.
(`content/update.ts:189` comment wrongly assumes "renderer routing supports both".)

Secondary defect: `RENDERER_URL` is `undefined` on deployments without a configured root
domain (`infra/lib/amodx-stack.ts:200`), making `revalidate.ts` silently return — ISR
revalidation disabled entirely, logged at `console.log` only.

## Operator decisions (2026-07-26, resolving reviewer escalation)

- **CACHE-2-D2 → scope AMENDED**: this slice may make exactly one `infra/` change —
  `revalidationSecret.grantRead(<CreateContentFunc>)` in `infra/lib/api.ts` — so the
  `content/create.ts` purge is deployable, not dormant (deep-vertical rule). No other
  infra edits. The grant is reviewed by the human in the `cdk diff` at the cache-3
  deploy gate.
  **APPLIED** — `infra/lib/api.ts:144`, one line, no other infra edit (`git diff infra/`
  shows exactly one changed line). The create-purge is now complete rather than inert.
- **CACHE-2-D1 → evidence AMENDED**: the "multi-domain cases" item is replaced by a
  test pinning the verified single-domain contract (`TenantConfig.domain` is singular
  in the authoritative schema). Domain aliases, if ever needed, are a separate slice.
  **APPLIED** — `test/unit/revalidate-paths.test.ts`, describe block *"one domain per
  tenant (current data model)"*: one tenant → exactly the domain-keyed targets (exact
  array equality), plus a header comment recording that aliases are a schema change
  (`domain` → list, one `GSI_Domain` item per host, middleware host gate, CloudFront
  alias list) and therefore a separate slice.

## Design (ratified approach — D2)

**The backend resolves the tenant's domain(s) and purges domain-keyed paths.** The
backend already holds `TenantConfig` (it is the authority for tenant → domain mapping);
the renderer should stay dumb and purge exactly the paths it is told.

1. In the 5 handlers (or a small shared helper next to `revalidate.ts`), resolve the
   tenant's domain(s) from the already-loaded tenant config (avoid an extra DDB read if
   the handler already has it; otherwise one `GetItem`).
2. Call `revalidatePath` once per domain-keyed path: `/<domain>/<pagePath>` (+ old-slug
   variants exactly as today). Keep the tenantId-keyed purge **only if** test-mode
   (`/tenant/<id>/`) pages are ISR-cached under that key — verify in-slice; if test mode
   is dynamic (per cache-1), drop the tenantId purge entirely.
3. Custom URL prefixes: the existing hardcoded `/product`, `/category` prefixes remain a
   known gap (doc §Known Gaps 2) — **non-scope here** unless the tenant config with the
   prefix is already in hand in the handler, in which case use it (one line, not a
   refactor).
4. Log loudly (console.warn with context) when `RENDERER_URL` is unset instead of a
   silent skip; document in `infra` that ISR revalidation requires it.

## Non-scope

- No tag-based revalidation adoption (doc §Known Gaps 5) — separate future slice.
- No change to CloudFront invalidation (debounce) machinery.
- No new wrapped handlers (`content/delete.ts` question is surfaced in cache-1 DoD 4).

## Architectural boundaries

- Tenant → domain resolution stays in the backend (authority); renderer `/api/revalidate`
  contract unchanged (token + path/tag).
- Best-effort semantics preserved: revalidation failure must never fail the mutation.

## Definition of Done

1. The 5 handlers purge domain-keyed paths for the mutated content (+ old slugs).
2. tenantId-keyed purge kept or dropped per the in-slice verification, with the finding
   recorded in the slice doc.
3. Unset `RENDERER_URL` logs a warning with the skipped path.
4. `docs/caching-architecture.md` §5 table updated to describe domain keying.

## Evidence required

- `EXECUTED`: backend build green; unit test (pure, no AWS) for the path-construction
  helper: tenant config + slug → expected `revalidatePath` arguments, including
  old-slug cases and a test pinning the single-domain contract (amended per CACHE-2-D1).
- `NOT RUN` (operator gate, post-deploy): edit a page on a staging tenant with a mapped
  domain; within seconds `curl` of the page through CloudFront with a cache-busting
  header shows fresh content from ISR (before the 15-min CloudFront debounce fires).

## Exit criterion

An admin content edit refreshes the S3 ISR entry for the real production URL of the
page, so the post-invalidation CloudFront miss serves fresh content without waiting for
the nightly flush.

## References

- `backend/src/lib/revalidate.ts`, the 5 calling handlers.
- `renderer/middleware.ts` — path rewrite that defines the ISR key.
- `docs/caching-architecture.md` §Invalidation Mechanisms 5, §Known Gaps 2.

---

# Build run 2026-07-26 — outcome

Everything above this line is the plan as ratified. Everything below is what was built and
what was found while building it.

## What was built

One pure module + one composed entry point, then six call sites.

| File | Role |
|---|---|
| `backend/src/lib/revalidate-paths.ts` (new) | **Pure.** `purgeTargets(routing, kind, slugs) → {domain, slug}[]`. Imports one constant from `@amodx/shared` and nothing else — no AWS SDK, no `db.js` — which is what makes it unit-testable with no credentials. |
| `backend/src/lib/revalidate.ts` | Adds `getTenantRouting()` (one projected `GetItem`) + `revalidateTenantPaths(tenantId, kind, slugs)`, which composes lookup → `purgeTargets` → the existing `revalidatePath(domain, slug)` transport. Adds `warnRevalidationDisabled()`. `revalidatePath` / `revalidateTag` signatures and the renderer contract are untouched. |
| 6 handlers | Call `revalidateTenantPaths(...)` instead of `revalidatePath(tenantId, ...)`. |
| `backend/test/unit/revalidate-paths.test.ts` (new) | 17 tests, pure. |
| `infra/lib/api.ts` | One line: `revalidationSecret.grantRead(createContentFunc)` (`CACHE-2-D2`), so the create-purge can fetch the token. Only `infra/` change in the slice. |
| `backend/vitest.unit.config.ts` (new) + `test:unit` script | An AWS-free runner. Required because `vitest.config.ts` loads `test/setup.ts`, which demands a live staging `TABLE_NAME` and whose suites mutate real staging data. |

### Before / after — the purge calls

`tenantId` is the tenant record's id (e.g. `bijuterie`); `domain` is `TenantConfig.domain`
(e.g. `bijuterie.ro`); `prefix` is that tenant's `urlPrefixes.product` / `.category`.

| Handler | Before (no-op in production) | After |
|---|---|---|
| `content/create.ts` | *(no purge at all)* | `/<domain><slug>` |
| `content/update.ts` | `/<tenantId><newSlug>`, `/<tenantId><oldSlug>` | `/<domain><newSlug>`, `/<domain><oldSlug>` |
| `products/update.ts` | `/<tenantId>/product/<newSlug>`, `/<tenantId>/product/<oldSlug>` | `/<domain><prefix>/<newSlug>`, `/<domain><prefix>/<oldSlug>` |
| `products/delete.ts` | `/<tenantId>/product/<slug>` | `/<domain><prefix>/<slug>` |
| `categories/update.ts` | `/<tenantId>/category/<newSlug>`, `/<tenantId>/category/<oldSlug>` | `/<domain><prefix>/<newSlug>`, `/<domain><prefix>/<oldSlug>` |
| `categories/delete.ts` | `/<tenantId>/category/<slug>` | `/<domain><prefix>/<slug>` |

Concretely, for tenant `bijuterie` (domain `bijuterie.ro`, `urlPrefixes.product = /produs`)
renaming a product `inel-vechi → inel-nou`, the emitted arguments change from

```
revalidatePath("bijuterie", "/product/inel-nou")     → purges /bijuterie/product/inel-nou     (nothing)
revalidatePath("bijuterie", "/product/inel-vechi")   → purges /bijuterie/product/inel-vechi   (nothing)
```

to

```
revalidatePath("bijuterie.ro", "/produs/inel-nou")   → purges /bijuterie.ro/produs/inel-nou   (the real entry)
revalidatePath("bijuterie.ro", "/produs/inel-vechi") → purges /bijuterie.ro/produs/inel-vechi (the real entry)
```

## Findings

### F1 — the tenantId-keyed purge is DROPPED (DoD 2)

**Finding: test mode is dynamic, so no ISR entry is ever keyed by a tenant id.**
`renderer/middleware.ts` rewrites `/tenant/<id>/<path>` to `dynamicPath(tenantId, restOfPath)`
= `/<id>/_dyn/<path>` (lines 94–108) and `/_site/<id>/…` likewise (lines 109–141); both land
on the `force-dynamic` twin, which answers `private, no-cache, no-store`. `cache-1` measured
this end to end (`docs/caching-architecture.md` § *Serving contract*, twin column, and the
OpenNext-Lambda table: "`?nf=1` landing (twin) — **no S3 access**").

The only exception is a *Route Handler* under test mode (`/tenant/<id>/sitemap.xml` →
`/<id>/sitemap.xml`, not the twin), and no handler purges those paths.

Conclusion: emitting a tenantId-keyed purge would address nothing and double the HTTP calls
per mutation. Dropped. `revalidate-paths.ts` carries this reasoning in its header so the next
reader does not "restore" it. Evidence label: `OBSERVED` (middleware source + `cache-1`
measurements), not re-measured in this slice.

### F2 — a tenant has exactly ONE domain; the "multi-domain case" has no representable input

The evidence-required list asks for a multi-domain unit-test case. There is no such case to
write against the current data model:

- `TenantConfigSchema.domain` is a single `z.string()` (`packages/shared/src/index.ts:708`).
- `tenant/create.ts:149` and `tenant/settings.ts:124-126` write one `Domain` attribute,
  mirrored from `domain`; `Domain` is `GSI_Domain`'s partition key (`infra/lib/database.ts:28`).
- `renderer/src/lib/tenant-directory.ts:93-102` admits a host only on an exact match of that
  value, so a second host (apex vs `www`, an alias, the CloudFront domain) is answered `404`
  by middleware before any render and can never produce an ISR entry.

Building a `string[]` fan-out for a variation that does not exist would be unearned. Instead
the single-domain contract is **pinned by a test** ("one domain per tenant (current data
model)") and `revalidate-paths.ts` names `TenantRouting.domain` as the single fan-out point if
aliases are added later. See DECISION `CACHE-2-D1` below.

### F3 — `content/create.ts` needed an IAM grant that lives in `infra/` (RESOLVED by `CACHE-2-D2`)

The create-purge was added (it is the smallest correct fix for the `cache-1` `?nf=1` tail, per
the packet). But `CreateContentFunc` was the **only** revalidating handler without
`props.revalidationSecret.grantRead(...)`:

Line numbers below are **post-fix** (the new grant shifted `api.ts` by one line):

| Lambda | `revalidationSecret.grantRead` | Source (re-verified 2026-07-26, post-fix) |
|---|---|---|
| **`CreateContentFunc`** | **yes — added by this slice** | `infra/lib/api.ts:144` |
| `UpdateContentFunc` | yes | `infra/lib/api.ts:166` |
| `UpdateProductFunc` | yes | `infra/lib/api.ts:643` |
| `DeleteProductFunc` | yes | `infra/lib/api.ts:651` |
| `UpdateCategoryFunc` | yes | `infra/lib/api-commerce.ts:132` |
| `DeleteCategoryFunc` | yes | `infra/lib/api-commerce.ts:140` |

`RENDERER_URL` and `REVALIDATION_SECRET_NAME` were already present (they are on the shared
`nodeProps.environment`), so only the Secrets Manager read was missing. Operator decision
`CACHE-2-D2` amended this slice's scope to add exactly that one line, and it is applied — so
the create-purge is **complete, not dormant**: all six revalidating handlers can now fetch the
token. The grant and the `content/create.ts` call are two halves of one change and must reach
an environment together; the code without the grant logs `[Revalidate] No secret available`
and purges nothing (best-effort, so it still cannot fail a page creation). Nothing is deployed
yet — the whole track waits on `cache-3`.

Table-read IAM is fine for all six: every one already holds `grantReadWriteData`, so the new
`GetItem` on the tenant record adds no IAM surface (this is the failure mode
`MEMORY.md` records from the slug-guard regression, checked explicitly).

### F4 — commerce prefixes were taken from the tenant config (scope note)

Design step 3 said to use the tenant's prefixes only if the config is "already in hand".
Resolving the domain *puts* it in hand — the same `GetItem` returns `urlPrefixes` for free.
Continuing to emit the hardcoded `/product` while holding the tenant's actual `/produs` would
have shipped a knowingly-wrong path, so the configured prefix is used (one expression,
`prefixFor()`). This closes Known Gap 2 for product and category pages. Recorded rather than
assumed silent.

### F5 — `RENDERER_URL` is `''`, not `undefined`

`infra/lib/api.ts:129` and `api-commerce.ts:48` pass `props.rendererUrl || ''`, so the Lambda
env var exists and is empty rather than absent. `if (!rendererUrl)` covers both; noted because
the slice text said "undefined" and an operator grepping for a missing variable would not find
one.

## Deviations from the plan

1. **DoD 1 says "the 5 handlers"; six were changed.** `content/create.ts` was added under the
   packet's explicit allowance for the `cache-1` `?nf=1` tail. Its IAM blocker (F3) is closed
   by `CACHE-2-D2`, so the sixth handler is functionally complete, not dormant.
2. **One `infra/` file was touched**, against the original hard constraint — exactly one line
   (`infra/lib/api.ts:144`), authorised by operator decision `CACHE-2-D2`.
3. **"document in `infra` that ISR revalidation requires it" (design step 4) was NOT done in
   `infra/`** — the `CACHE-2-D2` amendment permits the grant line only, not documentation
   edits. The requirement is documented in `docs/caching-architecture.md` § *Invalidation
   Mechanisms 5* → "When revalidation is switched off", and in the code comment on
   `warnRevalidationDisabled()`.
4. **Multi-domain test case not written** — replaced, per `CACHE-2-D1`, by a test pinning the
   single-domain contract. See F2.

## Operator decisions — RESOLVED 2026-07-26

Both escalations were decided by the operator and are applied in the working tree; neither is
outstanding. Recorded here because the reasoning is what the next reader will need.

### CACHE-2-D1 — multi-domain evidence item → *single-domain contract pinned instead*

The evidence list required a multi-domain unit-test case. The data model supports exactly one
domain per tenant (F2), so that case has no representable input. **Decision: accept the
single-domain contract and pin it with a test** — no unearned generality. Implemented as the
describe block *"one domain per tenant (current data model)"* in
`backend/test/unit/revalidate-paths.test.ts`: one tenant resolves to exactly the domain-keyed
targets (asserted by exact array equality), and the block's header comment records why the
alternative is not a test but a slice — aliases would change `TenantConfigSchema.domain` to a
list, require one `GSI_Domain` item per host, and touch the middleware host gate and the
CloudFront alias list. The rejected option (build the alias fan-out now) would have added a
`string[]` code path with no caller and no way to exercise it.

### CACHE-2-D2 — the `content/create.ts` IAM grant → *applied, scope amended to allow it*

**Decision: this slice makes exactly one `infra/` change**, so the create-purge is deployable
rather than dormant (deep-vertical rule). Applied at `infra/lib/api.ts:144`, immediately after
`props.table.grantReadWriteData(createContentFunc);`:

```typescript
props.revalidationSecret.grantRead(createContentFunc);  // cache-2: ISR purge on page create
```

`git diff infra/` shows this one line and nothing else. IAM delta: one `secretsmanager:GetSecretValue`
(+ `DescribeSecret`) on the single revalidation secret, for one Lambda role — the same grant the
other five revalidating handlers already hold. The human reviews it in the `cdk diff` at the
`cache-3` deploy gate.

## Migration / deployment notes

**Data migration: none.** No schema change, no new DynamoDB item, no backfill. The change is
Lambda code plus one additional projected `GetItem` per mutation (~5 ms, on the write path
only), plus one IAM statement (`CACHE-2-D2`).

**Deploy order.** This is backend code plus one IAM grant, and is safe to deploy
independently, but it is *pointless* before `cache-1`: with no cacheable HTML there is nothing
to purge. `cache-1` in turn is deploy-gated on `cache-3` (H1). **Nothing in Track CACHE is
deployed today.** The intended order is unchanged:

1. `cache-3` (CloudFront cache-key/RSC fix — CDK)
2. `cache-1` (renderer routes) + `cache-2` (this slice: backend + the one IAM line) — combined
   is fine

The `CACHE-2-D2` grant is no longer an optional step 3: it is part of this slice and must land
in the same deploy as `content/create.ts`, or that handler's purge is inert.

Deploying `cache-2` *before* `cache-1` is harmless: the purges become correct but address
entries that do not exist yet.

**Blast radius on live tenants.** Six mutation Lambdas change, and one Lambda role gains one
Secrets Manager read (`CreateContentFunc` — the same grant the other five already hold; no
other role, secret, or resource is touched). Failure modes are all best-effort by construction
and none can fail an admin save:

| Failure | Behaviour |
|---|---|
| Tenant record read fails | `console.error`, purge skipped, mutation succeeds |
| Tenant has no `domain` | `console.warn` naming the skipped paths, mutation succeeds |
| `RENDERER_URL` unset/empty | `console.warn` naming the skipped paths, mutation succeeds |
| Renderer `/api/revalidate` non-2xx or unreachable | existing `console.warn` / `catch`, mutation succeeds |

In every case the nightly flush remains the backstop, exactly as before.

**Rollback.** `git revert` of this slice's commit + redeploy. No state to unwind: the only
persistent side effect of this code is *deleting* S3 ISR entries, which the renderer refills
on the next request. A revert restores the previous (no-op) purges, i.e. Layer-2 staleness
until the nightly flush — the pre-slice behaviour, not a broken state. The revert includes the
`CACHE-2-D2` grant; leaving it in place instead is equally safe (an unused secret read by a
handler that no longer revalidates) and avoids a second CDK deploy if only the backend is
being rolled back.

**Post-deploy verification (operator, `NOT RUN` here).** On staging, with a tenant that has a
mapped domain:

```bash
# 1. warm the ISR entry for a published page
curl -sD- -o /dev/null "https://<staging-domain>/<page>"          # x-nextjs-cache: MISS
curl -sD- -o /dev/null "https://<staging-domain>/<page>"          # x-nextjs-cache: HIT

# 2. edit that page in the admin, then immediately (well inside the 15-min debounce):
curl -sD- "https://<staging-domain>/<page>" | grep -i "x-nextjs-cache"
#    expect MISS (the purge deleted the S3 entry) and the NEW content in the body

# 3. confirm it was the ISR purge, not CloudFront: the CloudFront invalidation must not have
#    fired yet — check the distribution's invalidation list is unchanged.

# 4. CloudWatch Logs for UpdateContentFunc must show
#    "[Revalidate] Path success: /<domain>/<page>"   — the DOMAIN, not the tenant id.
```

Step 4 is the cheapest single check that this slice works: the success line prints the key
that was purged.

## Evidence

Re-run in full on the revision (2026-07-26, `CACHE-2-D1` / `CACHE-2-D2`); labels below reflect
that run, not the first one. The subsequent review-0 cycle changed **no code** — it corrected
one stale `CURRENT_SLICE.md` line that still called the slice "Backend-only" after
`CACHE-2-D2` added the IAM statement — and the build, unit-test and infra gates below were
nonetheless re-executed unchanged (backend `tsc` exit 0, `test:unit` 17/17, infra `tsc`
exit 0, root `npm run build` exit 0).

| Claim | Label | Basis |
|---|---|---|
| `packages/shared` build green | `EXECUTED` | `cd packages/shared && npm run build` → exit 0 |
| Backend build green | `EXECUTED` | `cd backend && npm run build` (`tsc`) → exit 0 |
| Pure unit test, no AWS | `EXECUTED` | `cd backend && npm run test:unit` → **17/17 pass**, 1 file, `setup 0ms` (no `setupFiles`), no credentials |
| Single-domain contract pinned (`CACHE-2-D1`) | `EXECUTED` | the two tests in describe *"one domain per tenant (current data model)"* — verbose run in the build report |
| **Infra build green (`CACHE-2-D2`)** | `EXECUTED` | `cd infra && npm run build` (`tsc`) → exit 0 |
| **The grant reaches the CloudFormation template** | `EXECUTED` | `npx cdk synth` → `ApiCreateContentFuncServiceRoleDefaultPolicyBE95C816` gains statement `secretsmanager:DescribeSecret, GetSecretValue` on `{"Ref":"RevalidationSecretF125631E"}` |
| **The grant adds no CloudFormation resource** (500-limit safety) | `EXECUTED` | baseline vs. post-change `cdk synth` compared resource-by-resource: **835 → 835, delta 0**; the only semantic delta is that one IAM statement |
| Exactly one `infra/` line changed | `EXECUTED` | `git diff --stat infra/` → `1 file changed, 1 insertion(+)` |
| Isolated wire-level probe of the real compiled module | `OBSERVED` | § *Isolated integration probe* — `EXECUTED` in the first build run; **not re-run in the revision**, which changed only a comment in `content/create.ts` (runtime behaviour identical, verified by `git diff`) |
| Full monorepo build green | `EXECUTED` | `npm run build` at root → exit 0 |
| All 8 old call sites replaced | `EXECUTED` | `grep -rn "revalidatePath(" backend/src` → only `lib/revalidate.ts` (decl + its own call); all 6 handlers call `revalidateTenantPaths` |
| Test mode / preview are never ISR-cached (F1) | `OBSERVED` | `renderer/middleware.ts:94-141`; `cache-1` measured tables in `docs/caching-architecture.md` |
| One domain per tenant (F2) | `OBSERVED` | shared schema, `tenant/create.ts`, `tenant/settings.ts`, `infra/lib/database.ts`, `renderer/src/lib/tenant-directory.ts` |
| `CreateContentFunc` lacked the secret grant (F3) — now granted | `OBSERVED` → fixed | read of `infra/lib/api.ts` + `api-commerce.ts`; fix at `api.ts:144`, confirmed in the synthesized template |
| IAM policy *simulation* / real Secrets Manager fetch by the deployed Lambda | `NOT RUN` | requires a deploy; covered by the operator's post-deploy gate (step 4 prints the purged key) |
| Staging round-trip (purge → fresh ISR content) | `NOT RUN` | operator gate, post-deploy; commands above |
| Behaviour under real S3 latency / the SQS revalidation queue | `NOT RUN` | unchanged by this slice; still unexercised |

## Isolated integration probe (EXECUTED 2026-07-26, in the FIRST build run — not re-run in the revision)

> The revision (`CACHE-2-D1` / `CACHE-2-D2`) changed only a comment in `content/create.ts`, a
> test file, one `infra/` line and docs — no runtime behaviour in the probed path — so the
> output below still describes the current code. Treat it as `OBSERVED`, not as evidence
> produced by the revision run.

The unit test pins the *rule*; this probe pins the *wire*. It imports the real compiled
`backend/dist/lib/revalidate.js` and runs it against two localhost stubs — one answering
DynamoDB `GetItem` **and** Secrets Manager `GetSecretValue` (dispatching on `X-Amz-Target`,
both reached via `AWS_ENDPOINT_URL_DYNAMODB` / `AWS_ENDPOINT_URL_SECRETS_MANAGER`), one
standing in for the renderer's `/api/revalidate` and recording every request body. No AWS
account, no staging table, nothing installed. Fake credentials.

The harness is **not checked in** — productising probe harnesses is ROADMAP slice `test-2`,
and `cache-1`'s equivalent lives with its build report. Reproduce by re-creating a script
that sets those five env vars and calls `revalidateTenantPaths()`.

Observed output (abridged; `→ purges` is the path the stub renderer received, i.e. what
`revalidatePath("/" + domain + slug)` would delete):

```
### content/update — page rename, tenant bijuterie (domain bijuterie.ro)
   POST /api/revalidate  token=probe-token  → purges  /bijuterie.ro/despre-noi
   POST /api/revalidate  token=probe-token  → purges  /bijuterie.ro/despre

### products/update — rename, custom prefix (urlPrefixes.product = /produs)
   POST /api/revalidate  token=probe-token  → purges  /bijuterie.ro/produs/inel-nou
   POST /api/revalidate  token=probe-token  → purges  /bijuterie.ro/produs/inel-vechi

### products/update — no rename (old slug passed unconditionally, deduped)
   POST /api/revalidate  token=probe-token  → purges  /bijuterie.ro/produs/inel-nou

### categories/update — tenant without urlPrefixes (falls back to the default)
   POST /api/revalidate  token=probe-token  → purges  /shop.example.com/category/tools

### products/delete — product had no slug
   (no POST to /api/revalidate)
   DynamoDB reads during that call: 0 (expected 0)

### content/update — tenant record has no domain
   [Revalidate] Tenant nodomain has no 'domain' on its tenant record — skipped ISR purge
   of page /about. Production traffic is keyed by domain, so there is no cache entry to
   address until a domain is configured.
   (no POST to /api/revalidate)

### content/update — RENDERER_URL unset (the infra `props.rendererUrl || ''` case)
   [Revalidate] DISABLED (RENDERER_URL is not set) — skipped ISR purge of page /about
   (tenant bijuterie). Layer 2 (S3) will only clear on the nightly flush (up to 24h stale).
   RENDERER_URL requires a configured root domain — see docs/caching-architecture.md §5.
   (no POST to /api/revalidate)
   DynamoDB reads during that call: 0 (the guard runs before the read)

Total DynamoDB GetItem calls: 5
Projection on the last one: "#domain, urlPrefixes"  {"#domain":"domain"}
```

Everything DoD 1–3 asserts is visible there: the domain (never the tenant id) in the purged
key, the tenant's own prefix, both slugs on a rename, and a warning that names the skipped
path. What it does **not** cover — and what only the operator's post-deploy gate can — is
whether Next/OpenNext actually deletes the corresponding S3 object for that key.

## Files changed by the build run

```
backend/src/lib/revalidate-paths.ts          (new — pure path construction)
backend/src/lib/revalidate.ts                (tenant lookup + revalidateTenantPaths + loud warning)
backend/src/content/create.ts                (new purge; IAM now granted — CACHE-2-D2)
backend/src/content/update.ts                (domain-keyed)
backend/src/products/update.ts               (domain-keyed + tenant prefix)
backend/src/products/delete.ts               (domain-keyed + tenant prefix)
backend/src/categories/update.ts             (domain-keyed + tenant prefix)
backend/src/categories/delete.ts             (domain-keyed + tenant prefix)
backend/test/unit/revalidate-paths.test.ts   (new — 17 pure tests, incl. the CACHE-2-D1 contract)
backend/vitest.unit.config.ts                (new — AWS-free runner)
backend/package.json                         (test:unit script)
infra/lib/api.ts                             (CACHE-2-D2 — one line: grantRead on the revalidation secret)
docs/caching-architecture.md                 (§5 rewritten; Known Gaps 2,4,7; nightly-flush list; open-next note)
docs/shipped/slices/cache-2-isr-revalidation-keying.md (this file)
docs/ROADMAP.md                              (cache-2 status)
docs/TECH-DEBT.md                            (CreateContentFunc grant entry removed — fixed; alias entry kept)
CURRENT_SLICE.md                             (priority + status)
```
