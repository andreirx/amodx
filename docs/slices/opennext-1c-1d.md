# Slice OPENNEXT-1C + OPENNEXT-1D — remove the renderer warmer, expire the `_cache/` ISR prefix (one CDK change)

Status: DEPLOYED-STAGING 2026-10-15 (534ab81; staging `cdk diff` as predicted, live checks green; prod awaits the
human's word). Infra suite 58/58.
Track: CACHE. Maturity target: unchanged (renderer hosting stays MATURE; this removes a broken part and adds a
retention rule, it adds no new module).
Depends: `docs/slices/opennext-1-upgrade.md` § Ratification (human, 2026-10-15): `OPENNEXT1-WARMER = B`,
`OPENNEXT1-ORPHANS = C`, and the ruling "1c and 1d ship as ONE CDK deploy". `siteid-binding-1` (SHIPPED
2026-10-15) is the slice before this one in the ratified order.
Source plan: `docs/slices/opennext-1-upgrade.md` (§ 3.H warmer, § 5.5 orphans, § 12 revisit triggers).
Builder: claude / claude-opus-5-5. Reviewer: codex / gpt-6-sol.
Deliverable surface: `infra/lib/renderer-hosting.ts`, `infra/test/amodx-stack.test.ts`, docs.
**No renderer, backend, admin, shared or dependency change. No OpenNext config change.**

## 1. Purpose / risk retired

Two defects in the renderer hosting construct, both measured on the live system on 2026-10-15.

**1c — the warmer never worked.** The stack created a `WarmerFunction` from open-next's `warmer-function`
bundle and an EventBridge rule that invoked it every 5 minutes. The construct gave it the environment
variables `FUNCTION_NAME` and `CONCURRENCY`. open-next 3.1.3's warmer reads `WARM_PARAMS` (spec § 3.H, row H1).
So every invocation failed: 864 of 864 per day in the spec measurement; CloudWatch prod 17:01–17:21Z on
2026-10-15 showed `Invocations 12 / Errors 12`. The human ruled removal, not repair: the cold-start benefit of a
warmer at concurrency 1 was never measured, and a component that fails silently misleads every reader of the
stack. Revisit trigger (spec § 12): a **measured** cold-start latency problem.

**1d — old-build ISR cache objects never leave S3.** The renderer's ISR cache lives under
`_cache/<buildId>/` in the `RendererAssets` bucket (`CACHE_BUCKET_KEY_PREFIX: '_cache'` in the RendererServer
environment). Each deploy starts a new build id, and nothing ever reads the old prefix again. The only thing
that deletes it is the nightly flush, and that runs only after an edit (`nightly-cache-flush.ts`, change-gated).
After the SITEID-BINDING-1 prod deploy, prod `BUILD_ID` was `_oHLl-5MQKPOxqfEgBZDQ` and four prefixes were
present — three orphans (`EkLlOnwbwMpu2RD1Snm8R`, `oqH9IYXlbGT8j1jbx58zD`, `t8bhm_x9jMj3wJqw4-v8k`). Neither
stage's bucket had a lifecycle configuration (`NoSuchLifecycleConfiguration`) and neither is versioned. Spec
§ 5.5 measured 41,631 orphan objects (792 MB) in ONE old prefix on 2026-10-13.

**What an expiry does to a live page** (read in the deployed bundle,
`renderer/.open-next/server-functions/default/renderer/cache.cjs`): the cache handler wraps
`incrementalCache.get` in `try/catch` and returns `null` on failure. Next treats `null` as a MISS and renders
the page fresh. `NoSuchKey` from `GetObjectCommand` is in the adapter's "expected error" list and is logged at
debug level only. So an expired object costs exactly one cold render of that page and produces no error line.
A page that revalidates is rewritten (`set`), which is a new S3 object with a new age.

## 2. Scope (the change)

One edit in `infra/lib/renderer-hosting.ts`:

- **1c.** Delete the `// 4.5 Warmer Lambda` block: the `fs.existsSync(warmerFuncPath)` branch with
  `WarmerFunction`, `serverFunction.grantInvoke(warmerFunc)`, `WarmerSchedule`, and the `else` warning. Delete the
  then-unused imports `aws-cdk-lib/aws-events` and `aws-cdk-lib/aws-events-targets`.
- **1d.** Add one lifecycle rule to the `RendererAssets` bucket: id `ExpireIsrCache`, prefix `_cache/`,
  expiration 30 days, enabled. The comment beside it records that the prefix is one contract with
  `CACHE_BUCKET_KEY_PREFIX` (RendererServer env, and the nightly-flush Lambda env in `amodx-stack.ts`).

**Why the rule cannot touch the site.** `DeployRendererAssets` uploads `.open-next/assets/` to the bucket ROOT
(no `destinationKeyPrefix`); that directory holds `_next/` and `BUILD_ID` (OBSERVED: `ls
renderer/.open-next/assets`). Both are outside `_cache/`. S3 lifecycle `Prefix` is a literal key prefix, so the
rule cannot match them.

**30 days.** The spec's example value and the precedent of the `review-staging/` rule in `infra/lib/uploads.ts`.
Operator decision, recorded here; pinned by test `(o1)` so a change is deliberate.

**CloudFormation effect** (resource list read from the existing staging synth
`infra/cdk.out/AmodxStack-staging.template.json`, 446 resources; the test synth after the change shows 6 fewer):

| Logical id (staging) | Type | Effect |
|---|---|---|
| `RendererHostingWarmerFunction1C7950A0` | `AWS::Lambda::Function` | removed |
| `RendererHostingWarmerFunctionServiceRoleED2FD21F` | `AWS::IAM::Role` | removed |
| `RendererHostingWarmerFunctionServiceRoleDefaultPolicyF14AB400` | `AWS::IAM::Policy` | removed |
| `RendererHostingWarmerFunctionLogGroupA992E256` | `AWS::Logs::LogGroup` | removed |
| `RendererHostingWarmerSchedule221F1651` | `AWS::Events::Rule` (`rate(5 minutes)`) | removed |
| `RendererHostingWarmerScheduleAllowEventRule…WarmerFunction2FCDBDFF686C04C8` | `AWS::Lambda::Permission` | removed |
| `RendererHostingRendererAssets9370F811` | `AWS::S3::Bucket` | `LifecycleConfiguration` added (update in place, no replacement — INFERRED from CloudFormation's update behaviour for this property; the operator verifies it in the staging `cdk diff` and records the result under § Staging verification) |

The parent template's `AWS::Events::Rule` inventory goes from 4 to 3: `EventsAuditRule` (event pattern),
`DebounceFlushSchedule` (`rate(1 minute)`), `NightlyCacheFlushSchedule` (`cron(0 2 * * ? *)`). The spec
estimated "about −4 to −5" resources; the real count is 6 because CDK also emits one managed log group per
function (`@aws-cdk/aws-lambda:useCdkManagedLogGroup`).

`open-next` still emits `.open-next/warmer-function/`. Nothing references it any more. `open-next.config.ts`
is not changed.

## 3. Non-scope

- No change to the nightly flush, the debounce flush, the CACHE-10 purge, or any other `_cache/` writer/reader.
- No one-time deletion of the existing orphan prefixes. The rule removes them when they reach 30 days.
- No warmer repair (`WARM_PARAMS`) — ruled out by `OPENNEXT1-WARMER = B`.
- No bucket versioning, no change to `autoDeleteObjects: false`, `RETAIN`, `publicReadAccess: false`.

## 4. Architectural boundaries

- Tenant isolation: unchanged. The rule is bucket-wide by prefix; the cache is derived state for every tenant
  and an expiry is a MISS for that page only.
- Contract tie: `_cache/` in the rule = `CACHE_BUCKET_KEY_PREFIX` + `/`. Held by three strings today
  (the rule, the RendererServer env, the nightly-flush env). Test `(o2)` ties the first two in the synthesized
  template.

## 5. Tests (`infra/test/amodx-stack.test.ts`, the one real-synth file)

| Id | Asserts |
|---|---|
| `(w1)` | no `AWS::Lambda::Function` in the parent template has a logical id containing `Warmer` |
| `(w2)` | no `AWS::Events::Rule` in the parent template has `ScheduleExpression` `rate(5 minutes)` |
| `(w3)` | EXACTLY three `AWS::Events::Rule`: one event pattern without a schedule, `rate(1 minute)`, `cron(0 2 * * ? *)` |
| `(o1)` | the one `RendererAssets` bucket has EXACTLY one lifecycle rule: `Enabled`, `Prefix` `_cache/`, `ExpirationInDays` 30 |
| `(o2)` | that rule's `Prefix` equals the RendererServer function's `CACHE_BUCKET_KEY_PREFIX` + `/` |

The header sentence that listed "no warmer rule" as a property a stubbed synth would miss now names the
revalidation function instead (also gated on an `.open-next` subdirectory existing, `renderer-hosting.ts`).

Negative proof (EXECUTED 2026-10-15): with the original `renderer-hosting.ts` written back, the five new tests
are red and all 53 others are green; with this slice's edit, the five are green.

### 5.1 `(split1-5)` — ruling OPENNEXT1CD-SPLIT1-5 = B (operator, 2026-10-15, on review-0)

`(split1-5)` (INFRA-SPLIT-1) held two deploy-safety gates (`deployedParent < 500`, `deployedCatalog < 500`) and a
reconstruction of the pre-split parent count derived from the CURRENT parent count, pinned to `501`. That
derivation is valid only at the INFRA-SPLIT-1 commit; this slice removes 6 parent resources, so it read `495`
and failed (build-0; the negative proof showed it green on the original construct). The packet's claim that no
existing assertion referenced the warmer was wrong: `(split1-5)` referenced it by count, not by name.

Ruling B, applied: the derived reconstruction and `expect(impliedParentBefore).toBe(501)` are deleted; 501 is
recorded in a comment as a measured fact with its split-commit derivation; both `< 500` gates are unchanged; the
log line prints the two deployed counts only. The current-count comments now read 377 + 50 + 13 = 440 (this
synth); cdk.out staging still shows 446 until the opennext-1c deploy — expected 440 after it, INFERRED until the
operator's deploy synth confirms. `PARENT_STAGE_OVERHEAD = 13` is untouched (the removed resources are all in the
credential-free synth). Rule this closes: a test does not re-derive a historical count from the live synth;
history is recorded, live state is gated.

## 6. Migration / deployment notes (operator)

Order after review approval:

1. Commit.
2. `cd infra && npx cdk diff AmodxStack-staging -c stage=staging`. Expected: the six warmer resources removed,
   `LifecycleConfiguration` added on `RendererAssets`, the usual code-asset hashes; nothing else.
3. Deploy staging.
4. Live checks on staging:
   - `aws lambda list-functions` shows no `Warmer` function for the staging stack;
   - `aws s3api get-bucket-lifecycle-configuration --bucket <staging asset bucket>` shows the one rule
     `ExpireIsrCache`, `_cache/`, 30 days;
   - `aws events list-rules` shows no 5-minute rule;
   - serving probes: `/_site/preview-probe` 200 `no-store`, a published page 200, `robots.txt` 200;
   - Playwright `preview-site` and `public-site` unchanged.
5. Prod on the human's word.

S3 applies lifecycle actions asynchronously (typically within about 48 h of an object becoming eligible).
The staging object count is therefore not an immediate gate; the lifecycle configuration read-back is.

**Rollback:** redeploy the previous commit. CloudFormation recreates the warmer resources (they fail as
before). Removing the lifecycle rule stops future expiries; objects already expired re-render on demand. No
data loss: the ISR cache is derived state.

## 7. Definition of Done

- [x] CDK edit (§ 2); `cd infra && npm run typecheck` exit 0.
- [x] `cd infra && npm test` all green — 58/58 after the § 5.1 ruling.
- [x] `(w1)(w2)(w3)(o1)(o2)` green; negative proof red on the original construct.
- [x] Docs updated: ROADMAP, caching-architecture, architecture deep dive, security status, two plan notes,
      TECH-DEBT.
- [ ] Staging deploy + § 6 live checks (operator).
- [ ] Prod deploy (operator, human's word).

## 8. Evidence required before SHIPPED

EXECUTED by the builder: typecheck, infra synth suite, negative proof, `git diff --check`. OBSERVED by the
operator: `cdk diff` content, staging live checks of § 6, prod deploy.

## 9. Exit criterion

The renderer stack has no failing scheduled component, and old-build ISR cache stops growing without bound.
`opennext-1a` (bundle harness) is next in the ratified order.

## 10. References

- `docs/slices/opennext-1-upgrade.md` § 3.H, § 5.5, § 12, § Ratification.
- `docs/caching-architecture.md` § Infrastructure Resources.
- `infra/lib/uploads.ts` — the `review-staging/` lifecycle rule (shape precedent).
- `docs/TECH-DEBT.md` § opennext-1c/1d.

## Staging verification (operator, 2026-10-15, commit 534ab81)
- Operator gates on the unchanged candidate (reviewer sandbox cannot synth): `infra` typecheck 0; `npm test` 58/58; `git diff --check` 0.
- `cdk diff AmodxStack-staging`: `[-]` destroy `WarmerFunction`, its `ServiceRole`, `ServiceRoleDefaultPolicy`, `WarmerSchedule`,
  the `AllowEventRule` permission; `[-]` orphan (retained) `WarmerFunction/LogGroup`; `[~]` `RendererAssets` with
  `[+] LifecycleConfiguration {ExpirationInDays 30, Id ExpireIsrCache, Prefix _cache/, Status Enabled}` — an in-place update,
  0 replacement markers in the diff (the INFERRED label in § 5.1 is now VERIFIED); plus the usual code-asset hashes.
  Synthesized parent template = 440 resources (the INFERRED 440 in `(split1-5)`'s comment is now measured); rules exactly
  `EventsAuditRule` (pattern), `DebounceFlushSchedule` `rate(1 minute)`, `NightlyCacheFlushSchedule` `cron(0 2 * * ? *)`.
- Deploy exit 0, no rollback; CloudFormation events show `DELETE_COMPLETE` for Permission, Rule, Function, Policy, Role and
  `UPDATE_COMPLETE` for the bucket.
- Live: `aws lambda list-functions` → 0 `Warmer` functions in the staging stack (the only amodx 5-minute rule left is prod's);
  `aws s3api get-bucket-lifecycle-configuration` on the staging asset bucket → one rule `ExpireIsrCache`, `Filter.Prefix _cache/`,
  `Expiration.Days 30`, `Enabled`; `list-stack-resources` → 440.
- Serving unchanged (no renderer source change in this slice; no invalidation needed): `/_site/preview-probe` 200 `no-store`;
  `/ab-page` 200; `/robots.txt` 200; `/wp-login.php` 307 (D3 doubled `Location` still present, as recorded). Playwright
  `preview-site` + `public-site` 2/2. `staging.amodx.net/` answers 404 `no-store`: no staging tenant carries that domain (checked
  via the staging admin API, 427 tenants) — the unwired-host contract, not a change; the host is the preview/test-mode alias only.
- Object-count effect of the lifecycle rule is asynchronous (S3 evaluates within ~48 h of eligibility): staging prefixes
  `_cache/SueHtBXRQjiIWd3xCFKWE/` (orphan) and the current build's are the baseline to re-read after 2026-10-17.
