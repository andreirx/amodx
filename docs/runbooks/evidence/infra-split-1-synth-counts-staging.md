# INFRA-SPLIT-1 v2 — staging synth resource counts (BUILDER-EXECUTED, credential-free)

Produced by the builder, not the operator. `cdk synth -c stage=staging` is credential-free on this
checkout because the staging hosted-zone lookup is already cached in `infra/cdk.context.json`, so
`--no-lookups` reaches no AWS API. This is synth ONLY — `cdk diff` and `cdk deploy` still require live
credentials and mutate the environment, so they remain the operator's human gate (see the runbook).

## Command (EXECUTED 2026-08-10, exit 0)

```bash
cd infra && npx cdk synth -c stage=staging AmodxStack-staging --no-lookups
```

CDK's own capacity warning on the parent template:

```
[Info at /AmodxStack-staging] Number of resources: 446 is approaching allowed maximum of 500
```

## Per-template resource counts (from infra/cdk.out/*.template.json)

| Template                    | Resources | Lambda fns | Status |
|-----------------------------|-----------|-----------|--------|
| PARENT `AmodxStack-staging` | **446**   | 52        | **< 500 ✓** (was **501** pre-split — the blocker) |
| `CatalogApi` (new nested)   | 57        | 14        | content 6 + products 5 + import 3 |
| `CommerceApi`               | 258       | 36        | unchanged vs pre-slice (±1 bundle-hash) — **no structural delta** |
| `EngagementApi`             | 94        | 13        | unchanged vs pre-slice (±1 bundle-hash) — **no structural delta** |

## Before/after reconciliation (the CFN-500 story)

Pre-split, every catalog resource lived in the parent and there was no nested-stack resource:

```
parentBefore = parentAfter(446) − 1 (drop the added AWS::CloudFormation::Stack for CatalogApi)
                                  + 56 (moved resources = CatalogApi 57 − 1 CDK::Metadata, which is new)
             = 501
```

**501** is exactly the count email-2 hit against CloudFormation's hard 500-per-template ceiling — the
blocker this slice clears. After the move the parent is **446 < 500**, and the new CatalogApi template
is **57 < 500**.

## What this does and does NOT prove

- PROVES (synth-level): the split synthesizes cleanly; the cross-nested-stack function→integration
  reference resolves (`AWS::CloudFormation::Stack` for CatalogApi + `Fn::GetAtt` integration URIs in
  the parent); the parent is back under 500; Commerce/Engagement are structurally unchanged.
- Does NOT prove (operator gate): that CloudFormation ACCEPTS the update without the v1 route-key
  collision. That is a DEPLOY-time property — only `cdk deploy` to staging reaching `UPDATE_COMPLETE`
  (no nested `CREATE_FAILED`, no duplicate-route-key error) settles it. Runbook §3–§5.
