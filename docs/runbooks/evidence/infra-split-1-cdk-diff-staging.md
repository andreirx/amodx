# INFRA-SPLIT-1 v2 — staging `cdk diff` evidence (BUILDER-EXECUTED, read-only)

Addresses review-6 item 1 ("Run and attach the staging `cdk diff` evidence"). This is a **read-only**
CloudFormation operation: `cdk diff --no-change-set` reads the deployed template via
`CloudFormation:GetTemplate` and diffs it against the local synth. It creates **no** change set and
mutates **no** resource. (`cdk deploy` — reviewer items 2/3 — is still the human gate; see the
DECISION_REQUIRED in the builder report and §Rollback in `deploy-infra-split-1.md`.)

## Command (EXECUTED 2026-08-10)

```bash
cd infra && npx cdk diff -c stage=staging AmodxStack-staging --no-change-set
```

Result footer: `✨  Number of stacks with differences: 4`.
Full structural transcript (from the first `Stack` header): `infra-split-1-cdk-diff-staging.raw.txt`.

## Deployed baseline being diffed against

`aws cloudformation list-stacks` (2026-08-10): **`AmodxStack-staging` is `UPDATE_ROLLBACK_COMPLETE`**
— i.e. it holds the *pre-v1* topology (the v1 full-move rolled back). So this diff is the **complete
v2 change** the operator would apply from a clean rolled-back base: CatalogApi created, catalog
functions moved out of the parent, integrations retargeted. (Prod `AmodxStack` — no suffix — is
`UPDATE_COMPLETE` and lives in the **same account**; this diff does not touch it.)

## Parent `AmodxStack-staging` — change census (by resource type)

| Marker | Count | Type | Meaning |
|--------|-------|------|---------|
| `[-]` destroy | 14 | `AWS::Lambda::Function` | the 14 catalog functions leave the parent (`Api/CreateContentFunc` … `Api/DeleteProductFunc`) |
| `[-]` destroy | 14 | `AWS::IAM::Role` | their service roles leave the parent |
| `[-]` destroy | 14 | `AWS::IAM::Policy` | their default policies leave the parent |
| `[-]` destroy | 14 | `AWS::Logs::LogGroup` | their managed log groups leave the parent |
| **`[-]` total** | **56** | — | **= the "56 moved" in split1-5 (14 × {Function, Role, Policy, LogGroup})** |
| `[~]` | 14 | `AWS::ApiGatewayV2::Integration` | the 14 catalog integrations **retargeted in place** — `IntegrationUri` → `Fn::GetAtt` on CatalogApi. **Route keys & integration logical ids UNCHANGED** (packet: "integration target ref update in-place is OK") |
| `[~]` | 14 | `AWS::Lambda::Permission` | the 14 catalog invoke-permissions repoint to the moved functions |
| `[~]` | 11 | `AWS::Lambda::Function` | **bundle-hash churn only** (0 structural — verified: every `[~]` touches only `Code.S3Key` / asset path) |
| `[~]` | 2 | `AWS::CloudFormation::Stack` | Commerce + Engagement nested-stack asset S3 keys (bundle churn) |
| `[~]` | 1 / 2 | `Custom::AWS` / `Custom::CDKBucketDeployment` | asset/deployment churn |
| `[+]` | 1 | `AWS::CloudFormation::Stack` | **the new CatalogApi nested-stack pointer** (the "+1" in the 501 reconciliation) |
| `[+]` | 7 | Route+Integration+Permission+Role+Policy+Function+LogGroup | **pre-existing drift**, NOT this slice — `POST /email/dns-check` (`EmailDnsCheckFunc`), see below |

### The four v2 acceptance gates — all met

1. **Catalog FUNCTIONS move, delete-parent / create-nested.** 56 parent resources `[-] destroy`;
   CatalogApi nested is all `[+]` (81 lines = 57 template resources + 14 `Fn::GetAtt` ARN outputs).
2. **Catalog ROUTES stay in the parent, keys UNCHANGED.** `grep` of the parent diff for
   `AWS::ApiGatewayV2::Route` finds **zero** catalog route add/delete/replace. The only route `[+]` is
   the unrelated `POST /email/dns-check` (fresh key). The 14 catalog routes are untouched; only their
   integrations' target ref updates in place. **This is the exact shape that avoids the v1 route-key
   collision.**
3. **No stateful replacement.** `grep` of the whole diff for `DynamoDB::Table`, `S3::Bucket`,
   `Cognito::UserPool`, `GlobalTable` → **zero**. No table/bucket/pool is created, destroyed, or
   replaced.
4. **No CommerceApi / EngagementApi structural delta.** Both nested stacks show only `[~]` Lambda
   `Code.S3Key` bundle-hash churn (13 and 3 resources) plus a cosmetic Description em-dash fix
   (`?` → `—`). **Zero** add/delete; zero route/integration/permission/role/stateful change.

### The one non-catalog item: `POST /email/dns-check` (pre-existing drift — SURFACED)

The parent diff **adds** a `POST /email/dns-check` route + `EmailDnsCheckFunc` (+role/policy/loggroup).
This is **NOT introduced by INFRA-SPLIT-1**:

- It is present in committed **HEAD** `infra/lib/api.ts:319-329` (a prior EMAIL slice) and is **absent
  from this slice's working-tree diff** of `api.ts` (`git diff` shows no dns-check line).
- It appears only because the deployed staging stack is **behind HEAD** (rolled back below the EMAIL
  slice). A real staging deploy from this base would apply it too, along with the Lambda bundle-hash
  churn on Commerce/Engagement/parent functions.
- **It is a brand-new route with a fresh key**, so it CANNOT cause a route-key collision (v1's failure
  was moving an *existing* key; a net-new `CREATE` is safe).

**Operator action:** accept this drift as part of the same deploy, or first fast-forward staging to
HEAD so the split deploys in isolation. Called out so the deploy is a conscious choice, not a surprise.

## IAM Policy Changes (from the diff's own table)

14 rows `-` (each catalog function's `AWSLambdaBasicExecutionRole` managed-policy attachment leaves the
parent — recreated identically inside CatalogApi) and 1 row `+` (`EmailDnsCheckFunc`, the drift). No
broadened permissions; no stateful-resource policy change; the per-handler least-privilege grants
(e.g. ReviewImportFunc's prefix-scoped `s3:PutObject`) moved verbatim into `api-catalog.ts` and are
pinned by `infra/test/amodx-stack.test.ts` (`rev2b-iam`).

## What this proves — and does NOT

- **PROVES:** the update CloudFormation *would* apply is exactly the v2 functions-only move + the new
  nested-stack pointer, with the catalog routes untouched, no stateful churn, and neighbours
  structurally clean. The v1 collision precondition (a moved route key) is **absent**.
- **Does NOT prove:** that CloudFormation *accepts* the update to `UPDATE_COMPLETE`. Update ordering,
  the mid-deploy window, and post-deploy route resolution are **deploy-time** properties. Only a green
  `cdk deploy` to staging + the 14 route probes settle them — the human gate (runbook §3–§6).
