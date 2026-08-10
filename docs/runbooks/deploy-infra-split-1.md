# Runbook — INFRA-SPLIT-1 v2 (catalog FUNCTIONS → CatalogApi nested stack)

**Status:** code IMPLEMENTED; staging rehearsal + prod deploy are the HUMAN gate (not yet run).
**Slice:** `docs/slices/infra-split-1-catalog-nested-stack.md` (Design v2, functions-only).
**Blast radius:** the most production-sensitive change in the project — it moves 14 live Lambda
functions between CloudFormation templates on the shared HTTP API. Read this whole file before
running anything.

---

## 1. What this deploy does (and why v2, not v1)

The parent template `AmodxStack` reached CloudFormation's hard **500-resource-per-template**
ceiling (email-2 synth = 501), which blocks every backend deploy that adds a resource.

**v2 moves ONLY the heavy resources of the catalog group out of the parent template:** for each of
the 14 catalog handlers — content (6), products admin CRUD (5), import (3: wordpress/media/reviews)
— the **Lambda Function + its Role + Policy + LogGroup** move into a new NestedStack `CatalogApi`
(`infra/lib/api-catalog.ts`). That is **56 resources = 14 × 4**.

**The API Route + Integration + Permission for each of those 14 routes STAY in the parent**
(`infra/lib/api.ts`) with their **route keys and logical ids unchanged**. The parent's integrations
now target the moved functions by a cross-stack reference (`Fn::GetAtt` on the CatalogApi output).

Why not move the routes too (v1)? v1 tried, and **failed staging**: moving an ApiGatewayV2 Route to
another stack changes its logical id, so CloudFormation CREATEd the new `POST /products` before
DELETEing the old one → two routes with the same key on the shared HttpApi → nested stack
`CREATE_FAILED` → rollback. v2 never moves a route, so that collision cannot occur. Only the
integration *target ref* updates in place (no key change) → zero-downtime.

**Forbidden in this deploy:** any change to `CommerceApi`/`EngagementApi` structure, or any move of a
stateful resource (DynamoDB table, S3 buckets, Cognito pools). The cdk diff MUST show none.

---

## 2. Builder pre-flight (already EXECUTED — operator re-verifies)

Run from repo root. These were green in the builder run; re-run to confirm on the operator machine.

```bash
# 1. Full workspace build (shared → effects → plugins → backend → admin → renderer → infra)
npm run build

# 2. Infra typecheck
cd infra && npx tsc --noEmit          # expect: exit 0

# 3. Infra assertion suite (synth-only, credential-free; runs next/vite build in isolation)
cd infra && npx jest                  # expect: 50 passed (incl. split1-1..5, the v2 invariants)
```

The suite now PINS the v2 safety invariants as synthesized-template assertions (`amodx-stack.test.ts`,
`describe('INFRA-SPLIT-1 v2 …')`): CatalogApi holds exactly the 14 functions and NO
route/integration/permission/stateful resource (`split1-1..3`); the parent keeps all 14 catalog route
keys, each wired cross-stack into CatalogApi (`split1-4`); and the deployed parent is < 500 (`split1-5`).

Builder-measured DEPLOYED counts — **EXECUTED against the REAL staging config** (`cdk synth
-c stage=staging`, cdk.json feature flags loaded incl. the `useCdkManagedLogGroup` managed LogGroup
per Lambda; credential-free because the staging hosted-zone lookup is cached in `cdk.context.json`).
Full evidence: `docs/runbooks/evidence/infra-split-1-synth-counts-staging.md`.

| Template            | Resource count |
|---------------------|----------------|
| PARENT (AmodxStack-staging) | **446**  (was **501** pre-split — the blocker; CDK's own info line: "446 … approaching … 500"; < 500 ✓) |
| CatalogApi (new)    | 57  (14 Function + 14 Role + 14 Policy + 14 LogGroup + 1 CDK::Metadata) |
| CommerceApi         | 258 (unchanged structurally; ±1 bundle-hash only) |
| EngagementApi       | 94  (unchanged structurally; ±1 bundle-hash only) |

> **Reconciling the jest suite's own counts.** The suite constructs the stack with a bare
> `new cdk.App()`, which does NOT load `cdk.json`'s context, so its `useCdkManagedLogGroup` flag is
> off and the synth OMITS the managed `AWS::Logs::LogGroup` per Lambda. Its `(split1)` log therefore
> prints LOWER raw counts (parent 382, Catalog 42, Commerce 221, Engagement 80) — each exactly its own
> function count below the table above (parent −51 fns, Catalog −14, Commerce −36, Engagement −13,
> EXECUTED-verified 2026-08-10). `split1-5` adds those back plus a fixed domain overhead to gate the
> DEPLOYED figure (≈ 446 on real staging config). The real `cdk synth` in §3 produces the table's
> numbers; confirm the exact parent count from it.

---

## 3. Staging — synth + diff review (the gate)

Both `cdk synth` and `cdk diff` here are **BUILDER-EXECUTED already** (2026-08-10). `cdk diff` with
`--no-change-set` is **read-only** (it reads the deployed template via `GetTemplate` and diffs locally
— no change set, no mutation), so the builder ran it and captured the result:
`docs/runbooks/evidence/infra-split-1-cdk-diff-staging.md` (+ `…-staging.raw.txt`). All five checks
below were verified green there. Re-run on the operator machine to confirm before deploying.

> **Baseline note:** staging is currently `UPDATE_ROLLBACK_COMPLETE` (the v1 rollback), i.e. *behind*
> HEAD. The builder diff therefore also shows one **pre-existing, non-slice** addition —
> `POST /email/dns-check` (`EmailDnsCheckFunc`, from a prior EMAIL slice, committed in `api.ts` but not
> yet on staging) — plus Lambda bundle-hash churn on parent/Commerce/Engagement functions. A fresh
> route key cannot collide. Decide consciously: deploy the split + this drift together, or fast-forward
> staging to HEAD first so the split lands in isolation.

```bash
cd infra
npx cdk synth -c stage=staging AmodxStack-staging > /dev/null   # must succeed (builder: green, 446)

# Exact parent resource count on the real staging config:
node -e "const t=require('./cdk.out/AmodxStack-staging.template.json');console.log('PARENT resources:',Object.keys(t.Resources).length)"
# EXPECT: < 500  (builder observed 446).

# Read-only (no change set, no mutation). Builder already captured this; re-run to confirm:
npx cdk diff -c stage=staging AmodxStack-staging --no-change-set 2>&1 | tee ../docs/runbooks/evidence/infra-split-1-cdk-diff-staging.txt
```

**Review the diff against ALL of these — do NOT deploy unless every line holds (builder-verified 2026-08-10):**

1. **Catalog FUNCTIONS move:** for each of the 14 handlers you see the Lambda Function + Role +
   Policy + LogGroup as `[-]` (removed) at the parent `Api...Func...` logical id **and** `[+]`
   (added) inside the `CatalogApi` nested stack. (In cdk diff, nested-stack internals show under the
   `AWS::CloudFormation::Stack` change for `CatalogApi`.)
2. **Catalog ROUTES do NOT move / do NOT recreate:** there is **no** `[-]`/`[+]` on any
   `AWS::ApiGatewayV2::Route` for `/content*`, `/products*`, `/import/wordpress|media|reviews`. At
   most you see an in-place **modify** of the matching `AWS::ApiGatewayV2::Integration`
   (`IntegrationUri` now a cross-stack ref). An Integration MODIFY is fine; a Route
   ADD/REMOVE/REPLACE is a STOP — it is the v1 failure mode.
3. **No stateful replacement:** zero changes to any `AWS::DynamoDB::Table`, `AWS::S3::Bucket`,
   `AWS::Cognito::UserPool*`. If any shows replace (`[-]`+`[+]`) → **STOP**.
4. **No CommerceApi / EngagementApi structural delta:** their nested `AWS::CloudFormation::Stack`
   entries may show a template-hash change from bundle rebuilds, but **no route/function
   add/remove**. Spot-check by opening their diffs if the tool flags them.
5. **One new nested stack:** exactly one new `AWS::CloudFormation::Stack` (`CatalogApi`) added to the
   parent.

If 1–5 all hold, proceed. Otherwise STOP and escalate.

---

## 4. Staging — deploy

```bash
cd infra
npx cdk deploy -c stage=staging AmodxStack-staging --require-approval never 2>&1 | tee ../docs/runbooks/evidence/infra-split-1-deploy-staging.txt
```

**The v1 failure gate:** the deploy MUST reach `UPDATE_COMPLETE` with **no** nested-stack
`CREATE_FAILED` and **no** `Route ... already exists` / duplicate-route-key error. If you see a
route-key collision, the change regressed to v1 behavior — STOP, let it roll back, and escalate.

Expected: `CatalogApi` nested stack CREATE_COMPLETE (new); parent UPDATE_COMPLETE; the 14 parent
integrations updated in place.

---

## 5. Staging — route resolution probe (all 14 moved routes)

All 14 catalog routes are behind the **default Lambda authorizer**. Unauthenticated →
**HTTP 401** (route exists, auth denied). **HTTP 404** = route missing = the regression this whole
slice guards against. The probe asserts *not 404*.

Paste this block into `bash` (array-based curl args — avoids the zsh word-splitting bug):

```bash
API="https://api.staging.amodx.net"

# method|path  (path params get a throwaway value; authorizer runs before the handler)
routes=(
  "POST|/content"
  "GET|/content"
  "GET|/content/probe-id"
  "PUT|/content/probe-id"
  "GET|/content/probe-id/versions"
  "POST|/content/probe-id/restore"
  "POST|/products"
  "GET|/products"
  "GET|/products/probe-id"
  "PUT|/products/probe-id"
  "DELETE|/products/probe-id"
  "POST|/import/wordpress"
  "POST|/import/media"
  "POST|/import/reviews"
)

fail=0
for r in "${routes[@]}"; do
  m="${r%%|*}"; p="${r##*|}"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" "$API$p" -H 'content-type: application/json' -d '{}')
  status="OK"
  if [ "$code" = "404" ]; then status="FAIL-404-ROUTE-MISSING"; fail=1; fi
  printf '%-6s %-32s -> %s  %s\n' "$m" "$p" "$code" "$status"
done
echo "----"
if [ "$fail" = "0" ]; then echo "PASS: no catalog route returned 404"; else echo "FAIL: a catalog route is missing (404)"; fi
```

**Expected:** every row `401` (or `403`) — never `404`. Final line `PASS`.

### 5b. Neighbor routes unaffected (regression check)

These live in CommerceApi / EngagementApi / the parent and must be untouched. Same 401-not-404 rule.

```bash
for r in "GET|/categories" "GET|/orders" "GET|/coupons" "GET|/forms" "GET|/popups" "GET|/settings" "GET|/public/products"; do
  m="${r%%|*}"; p="${r##*|}"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" "$API$p")
  printf '%-6s %-24s -> %s\n' "$m" "$p" "$code"
done
```

`/public/products` is `noAuth` → expect 200/400 (a real handler response). The rest → 401. None 404.

---

## 6. Production deploy — HUMAN GATE

Do NOT run until the staging rehearsal above is fully green and reviewed.

```bash
cd infra
# 1. Diff first — apply the SAME §3 checklist to the prod diff.
npx cdk diff AmodxStack 2>&1 | tee ../docs/runbooks/evidence/infra-split-1-cdk-diff-prod.txt
# 2. Deploy.
npx cdk deploy AmodxStack --require-approval never 2>&1 | tee ../docs/runbooks/evidence/infra-split-1-deploy-prod.txt
```

- Prod stack name is `AmodxStack` (no `-stage`), prod domain is the production API domain
  (`api.<prod-root-domain>`). Re-run the §5 probe against the prod API host.
- **Expect a brief in-place integration update** on each of the 14 routes as CloudFormation repoints
  the integration target from the old parent function to the new CatalogApi function and deletes the
  old functions. Routes are never removed, so there is no 404 window; worst case is a few seconds of
  cold-start latency on first invocation of a moved function.

### Rollback

The change is a pure stateless reorg — no data resource moves — so rollback is a redeploy of the
prior template:

```bash
# Fastest: let a failed deploy auto-rollback (CloudFormation reverts the parent + deletes the
# half-created CatalogApi automatically on UPDATE_FAILED).
# Manual rollback after a completed-but-bad deploy:
git checkout <prior-good-commit> -- infra/lib/api.ts infra/lib/amodx-stack.ts
git rm infra/lib/api-catalog.ts          # only if it existed solely for this slice
cd infra && npx cdk deploy AmodxStack --require-approval never
```

Redeploying the prior template moves the 14 functions back into the parent and re-points the
integrations. Because no route key ever changed, this reverse move is also collision-free. No
DynamoDB/S3/Cognito data is affected at any point.

---

## 7. Evidence to attach

- `docs/runbooks/evidence/infra-split-1-cdk-diff-staging.txt` — the reviewed staging diff.
- `docs/runbooks/evidence/infra-split-1-deploy-staging.txt` — the green staging deploy log.
- The §5 probe output (14 rows, all non-404) + §5b neighbor output.
- Repeat for prod under the `-prod` evidence filenames.
