# INFRA-SPLIT-1: Relieve the CFN 500-ceiling — catalog group → new nested stack

- **Status:** PLANNED — #1 backend blocker (nothing that adds a Lambda deploys until this
  lands). Prod-sensitive; staging-rehearsed; prod deploy is a HUMAN gate.
- **Track:** Infra
- **Decision:** option A (nested-stack split), human-ratified 2026-08-10.

## Problem

AmodxStack hit CloudFormation's hard 500-resource-per-stack limit (email-2 diff = 501).
All backend deploys that add resources are blocked. Prod is fine at rest.

## Design (ratified constraints — do NOT deviate)

1. **Move ONLY the catalog/content group** currently in the MAIN stack (`api.ts`) into a
   NEW nested stack (`api-catalog.ts`, pattern-identical to the existing
   `api-commerce.ts` / `api-engagement.ts` NestedStacks): products (8), content (6),
   import (7) handlers + their routes/integrations/grants. VERIFY the exact current
   placement first — some may already be nested; move only what's in the main stack.
2. **DO NOT TOUCH `CommerceApi`** (categories/orders/customers/reviews/delivery/coupons).
   Rationale (binding): Track B (cmrc-*) extends CommerceApi with the private-table
   split; re-cutting that boundary now would collide. Leave it exactly as-is.
3. Cross-stack wiring follows the CommerceApi precedent exactly: the parent passes the
   shared HttpApi, table, buckets, authorizer, secrets into the nested stack via props.
4. **Resource-recreation reality:** moving a construct changes its CFN logical id →
   CloudFormation DELETES old + CREATES new. For these STATELESS Lambdas/roles/routes
   that is acceptable, BUT: (a) no stateful resource (table/bucket/pool) may move;
   (b) the API routes will briefly recreate — the staging rehearsal MUST prove every
   moved route resolves after deploy (and ideally characterize the mid-deploy window).

## Non-scope

No new features; no handler logic changes; no CommerceApi/Engagement changes; no
stateful-resource moves; no email-2a/Track-B work.

## DoD / evidence

1. `cd infra && npx cdk synth` succeeds and the MAIN stack resource count drops well
   under 500 (report the before/after counts); the new nested stack is well under 500.
2. `cdk diff -c stage=staging` reviewed: the moved resources show
   delete-from-parent / create-in-nested; NO stateful resource replacement; NO
   CommerceApi changes.
3. Infra assertion suite green (update any assertions that referenced moved logical ids).
4. **Staging rehearsal (operator-run, but the slice must produce the runbook):** deploy
   to staging; after deploy, probe EVERY moved route (products CRUD, content, import
   endpoints) returns its normal auth-gated status (not 404); existing commerce/other
   routes unaffected.
5. **Prod deploy is a HUMAN gate** — the slice delivers the code + the staging rehearsal
   result + a prod runbook (including: expect brief route recreation; rollback = redeploy
   prior template).

## Output surface

Before/after resource counts (main + new nested); the cdk diff summary (moves only, no
stateful replacement, no CommerceApi touch); the staging route-resolution probe results.
