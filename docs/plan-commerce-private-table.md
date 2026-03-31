# Commerce-Private Table Migration Plan

## Status

- Decision record: proposed and documented
- Current maturity: renderer/content boundary is mature, customer-data least-privilege is not
- Target maturity: production-grade boundary where the renderer Lambda cannot read customer-private commerce data

## Problem

The renderer Lambda currently has `grantReadData()` on the main DynamoDB table. That means a compromise of the public SSR/runtime process can read customer-private records that do not belong in a public-facing trust zone:

- `ORDER#` - order contents, addresses, payment method, status history
- `CUSTORDER#` - email-to-order adjacency
- `CUSTOMER#` - profile, phone, birthday, address defaults, spend totals
- `COUNTER#ORDER` - order sequence state

This is the specific risk captured in Security Remediation finding 7.6.

## Goal

Move customer-private commerce data into a separate DynamoDB table that is readable and writable only by backend commerce handlers.

The renderer Lambda must not have IAM access to that table.

Renderer customer account/profile routes must proxy through backend handlers instead of reading DynamoDB directly.

## Non-Goals

This plan does not fully solve every renderer read-exposure in one step.

The first boundary is customer-private commerce data:

- moved out: `ORDER#`, `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER`
- not moved in this phase: `LEAD#`, `FORMSUB#`, `AUDIT#`, `SIGNAL#`, `CONSENT#`, `COUPON#`

That means this phase materially reduces blast radius, but it does not produce perfect renderer least-privilege for the remaining single-table entities. Those can be addressed in a later hardening phase.

## Decision

Adopt backend-proxied reads for renderer customer self-service paths.

This is the previously discussed "Option X":

- renderer keeps handling NextAuth session validation
- renderer derives tenant from host
- renderer calls backend using the `RENDERER` API key
- backend is the only process that reads the commerce-private table

Rejected directions:

- Dedicated customer-read Lambda behind custom CloudFront routing
  - operationally complex
  - does not match current OpenNext deployment shape
- Split tables but keep renderer read access to the private table
  - fails the core security objective

## Architectural Boundary

### Current Main Table

The existing single table remains the public/content/catalog table.

It continues to hold:

- tenant config and site config
- content and routes
- products and categories
- reviews
- forms and popups
- delivery configuration
- all current non-commerce-private entity families

### New Commerce-Private Table

The new table holds only customer-private commerce entities:

- `ORDER#<orderId>`
- `CUSTORDER#<email>#<orderId>`
- `CUSTOMER#<email>`
- `COUNTER#ORDER`

Keys remain the same:

- `PK = TENANT#<tenantId>`
- `SK = <entity-specific pattern>`

This preserves the existing access patterns and minimizes migration complexity.

## Security Properties After Cutover

### Improved

- Renderer Lambda compromise no longer grants direct read access to customer profile and order data.
- Backend becomes the single access point for customer-private commerce data.
- Commerce-private table can have separate alarms, PITR policy, and lifecycle controls.

### Residual

- Renderer still has read access to whatever remains in the content table.
- This phase is a bounded hardening step, not the final least-privilege endpoint for every entity family.

## API Design

Do not put customer email in URL paths or query strings.

Bad:

- `GET /public/customers/{email}/orders`
- `GET /public/customers/{email}/profile`

Reason:

- email becomes part of logs, traces, metrics, and caches

Preferred backend endpoints:

- `GET /customer/orders`
- `GET /customer/profile`
- `POST /customer/profile`

Trust model:

- renderer validates NextAuth session
- renderer derives tenant from `Host`
- renderer passes session email to backend in a request header or request body
- backend authenticates the renderer with the `RENDERER` API key

These endpoints are not generic public routes. They are renderer-only self-service routes with tightly scoped DTOs.

## Clean Architecture Shape

### Support Module

Introduce a backend commerce-private data access module that isolates the table detail from use cases.

Responsibilities:

- read/write order records
- read/write customer profiles
- read/write customer-order adjacency
- read/write order counter

Suggested boundary:

- pragmatic typed-function module, not a full repository-pattern refactor for the whole backend
- suggested file: `backend/src/lib/commerce-db.ts`
- table name supplied by a dedicated env var such as `COMMERCE_TABLE_NAME`

Reason for this scoped decision:

- it isolates the new boundary cleanly
- it matches the current backend style better than introducing interfaces and implementation classes across unrelated handlers
- it reduces migration risk by avoiding a broad persistence refactor during a security-driven storage split

Deferred technical debt:

- a formal repository/interface pattern can still be introduced later if the backend is refactored more broadly toward ports/adapters

### Feature Implementation

Use the support module from:

- order creation
- order reads
- customer profile reads
- customer profile updates
- reporting paths that depend on orders/customers

The renderer must not import or query commerce-private DynamoDB helpers directly after cutover.

## Rollout Plan

### Phase 1 - Remove Known Boundary Violation

Remove the remaining SSR order read from the renderer page layer.

Specifically:

- stop using `getOrderForCustomer()` in `renderer/src/app/[siteId]/[[...slug]]/page.tsx`

This should happen regardless of the table split.

### Phase 2 - Backend Self-Service Read Endpoints

Add backend renderer-only endpoints for:

- customer profile read
- customer order history read

In this phase they may still read from the current table.

Purpose:

- move renderer account/profile reads behind backend DTOs first
- reduce migration risk by changing read topology before changing storage

### Phase 3 - Renderer Proxy Cutover

Rewrite renderer routes:

- `renderer/src/app/api/account/orders/route.ts`
- `renderer/src/app/api/profile/route.ts`

Behavior after rewrite:

- validate session
- derive tenant from host
- call backend self-service endpoints
- stop reading DynamoDB directly

### Phase 4 - Infrastructure

Add the new commerce-private DynamoDB table in CDK with:

- `PAY_PER_REQUEST`
- point-in-time recovery
- same regional/account placement as the current table
- tags and alarms consistent with the main table

Grant access:

- backend commerce handlers: read/write
- renderer Lambda: no access

### Phase 5 - One-Time Data Migration

Copy existing commerce-private records from the main table into the new table.

Important:

- no `ScanCommand`
- query by tenant and by sort-key prefix only
- copy records exactly as stored
- preserve PK and SK
- source and destination exist simultaneously during this phase
- no source deletion in this phase

Operational requirement:

- activate a temporary commerce write freeze before migration begins and keep it in place until backend storage cutover is complete

Reason:

- without dual-write, any order created after migration starts but before cutover finishes exists only in the old table and becomes invisible after cutover

For the current estate this is acceptable because commerce is test-only.

### Phase 6 - Backend Storage Cutover

Update backend commerce repositories/handlers to read and write the new commerce-private table:

- order create
- order get/list helpers
- customer profile get/update
- reports that depend on orders/customers

Cutover readiness requires all of:

- migration completed for every target tenant
- source and destination counts match for all moved prefixes
- key parity verification passes
- renderer proxy paths already use backend self-service endpoints
- commerce write freeze is active
- cross-table order creation has been tested successfully

Implementation hotspot:

- `backend/src/orders/create.ts` is the highest-risk file in this migration

Why:

- order creation will no longer be a single-table transaction
- `ORDER#`, `CUSTORDER#`, `CUSTOMER#`, and `COUNTER#ORDER` move to the commerce-private table
- `COUPON#` usage updates stay in the main table

That means the order transaction must target two tables in one `TransactWriteCommand`.

Expected shape:

```ts
TransactItems: [
  { Put: { TableName: COMMERCE_TABLE_NAME, Item: orderItem } },
  { Put: { TableName: COMMERCE_TABLE_NAME, Item: custOrderItem } },
  { Put: { TableName: COMMERCE_TABLE_NAME, Item: customerItem } },
  { Update: { TableName: COMMERCE_TABLE_NAME, Key: counterKey, ... } },
  { Update: { TableName: TABLE_NAME, Key: couponKey, ... } },
]
```

DynamoDB supports cross-table transactions in the same account and region, so this remains atomic if implemented correctly.

### Phase 7 - Validation

Validate per tenant:

- source and destination counts match for each moved prefix
- all source keys exist in destination
- backend reads resolve from the commerce-private table
- manual spot checks for:
  - account order history
  - profile read/update
  - public order tracking
  - order creation

### Phase 8 - Read Freeze and Purge

Keep old source records only during the validation window.

After validation succeeds:

- remove old `ORDER#`, `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER` copies from the main table

This purge is mandatory if the security objective is to become true. If old copies remain in the main table, the renderer can still read them through its current main-table IAM grant.

## Rollback Plan

Rollback should be staged, not improvised.

### Safe rollback points

1. Before backend storage cutover
   - new endpoints can still read the old table
   - migration can be repeated safely

2. After migration but before source purge
   - backend can be pointed back to old table
   - source data still exists

### Unsafe rollback point

After old source records are purged from the main table, rollback requires either:

- restoring from backup
- re-running migration in reverse from the commerce-private table

Do not purge until validation is complete.

## One-Time Migration Script

This section describes a proposed future script for the post-infrastructure migration phase.

It is not part of the current deployable architecture and assumes all of the following already exist:

- the commerce-private table
- backend cutover support for that table
- finalized backend self-service endpoints
- an agreed write-freeze window

### Modes

- `plan`
  - query source and destination counts
  - print the migration surface without writing
- `migrate`
  - query source items
  - write them to destination
  - verify counts and key parity
- `verify`
  - compare source and destination without writing

### Safety Rules

- requires explicit tenant list
- requires explicit source and destination tables
- defaults to dry planning behavior unless `--mode migrate`
- aborts if destination already contains moved records unless `--allow-existing-destination` is supplied
- does not delete source records
- uses `QueryCommand`, never `ScanCommand`

### Example Usage

Illustrative future usage:

Plan:

```bash
npm run migrate-commerce-private-table -- \
  --mode plan \
  --source-table AmodxTable \
  --destination-table AmodxCommerceTable \
  --tenants tenant-a,tenant-b
```

Migrate:

```bash
npm run migrate-commerce-private-table -- \
  --mode migrate \
  --source-table AmodxTable \
  --destination-table AmodxCommerceTable \
  --tenants tenant-a,tenant-b
```

Verify:

```bash
npm run migrate-commerce-private-table -- \
  --mode verify \
  --source-table AmodxTable \
  --destination-table AmodxCommerceTable \
  --tenants tenant-a,tenant-b
```

### Validation Model

Per tenant and per moved prefix, the script reports:

- source count
- destination count
- missing keys in destination
- unexpected keys in destination

This is sufficient for the current small commerce footprint.

## File-Level Change Plan

### Infrastructure

- add a new commerce-private table in `infra/`
- grant backend handlers access
- remove renderer need for commerce table access by moving reads to backend

### Backend

- add commerce-private repository/module
- add renderer-only self-service read endpoints
- update order/customer/report handlers to use the new table

### Renderer

- remove direct DynamoDB reads for customer/order data
- proxy through backend from session-validated routes

### Scripts and Docs

- add the one-time migration utility
- document rollout, validation, and purge

## Assumptions

- commerce footprint is currently small
- existing commerce tenants can be migrated from an explicit allowlist
- migration runs in the same AWS account and region as both tables
- no schema transformation is needed; this is a record-preserving move
- no dual-write transition layer is introduced for this phase
- a temporary write freeze is acceptable during migration and cutover

## Divergences From a Full Least-Privilege End State

- the main table still contains some non-public entity families
- the renderer still has read access to the main table
- this plan fixes customer-private commerce exposure first because that is the highest-value boundary and aligns with the active renderer customer-account paths

## What does it look like from deployment perspective?

### Deploy 1 — Build the new read path + create empty table

  What you code:

  - Phase 1: Remove getOrderForCustomer import and usage from renderer/src/app/[siteId]/[[...slug]]/page.tsx. The
  order tracking page switches to a client-side fetch through a renderer API route (or the existing GET
  /public/orders/{id} backend endpoint, which stays in the main table).
  - Phase 2: Add backend/src/lib/commerce-db.ts — the typed-function module. In this deploy it wraps the OLD table.
  Every function takes a table name parameter or reads from COMMERCE_TABLE_NAME env var, falling back to TABLE_NAME.
  This means the module works against the main table until the env var is set.
  - Phase 2: Add two new backend handlers — GET /customer/orders and GET /customer/profile. Both use
  requireRole(["RENDERER"]), read email from a request header (e.g., x-customer-email), and call commerce-db.ts
  functions. Register routes in CDK (api-commerce.ts nested stack).
  - Phase 3: Rewrite renderer/src/app/api/account/orders/route.ts — stop importing getCustomerOrders from dynamo.ts,
  instead call GET /customer/orders on the backend with renderer key + tenant from host + session email in header.
  - Phase 3: Rewrite renderer/src/app/api/profile/route.ts GET — stop importing getCustomerProfile from dynamo.ts,
  instead call GET /customer/profile on the backend with renderer key.
  - Phase 4: Add the new DynamoDB table in CDK. Suggested location: infra/lib/database.ts alongside the existing
  table, or a new infra/lib/commerce-database.ts construct. PK/SK, PAY_PER_REQUEST, PITR enabled. Pass the table to
  api-commerce.ts as a new prop. Do NOT set COMMERCE_TABLE_NAME on any Lambda yet — the fallback to TABLE_NAME means
  everything still reads the main table.
  - Remove getOrderForCustomer, getCustomerOrders, getCustomerProfile from renderer/src/lib/dynamo.ts (dead code
  after Phases 1+3).

  What you deploy:

  Single cdk deploy. Everything goes live together. The new backend endpoints exist. The renderer uses them. The new
  table exists but is empty and unused.

  What you verify:

  - Account page loads order history (data flows: renderer → backend → main table, same data as before)
  - Profile page loads and saves (renderer → backend → main table)
  - Order tracking page works (no longer SSR, uses client-side or public endpoint)
  - No renderer code imports customer/order DynamoDB functions
  - New empty table visible in DynamoDB console

  Risk: Low. All reads still hit the main table. The new table is inert. If the backend endpoints fail, the renderer
  shows errors on account/profile pages — test-only pages, easily caught.

  ---
###  Operational Step — Data migration

  Prerequisite: Activate commerce write freeze. In practice: stop placing test orders. If the test shop has a
  storefront, temporarily disable checkout or just don't use it.

  What you run:

  # Plan — see what will be migrated
  npx tsx scripts/migrate-commerce-private-table.ts \
    --mode plan \
    --source-table AmodxTable \
    --destination-table AmodxCommerceTable \
    --tenants <your-commerce-tenant-id>

  # Migrate — copy records
  npx tsx scripts/migrate-commerce-private-table.ts \
    --mode migrate \
    --source-table AmodxTable \
    --destination-table AmodxCommerceTable \
    --tenants <your-commerce-tenant-id>

  # Verify — confirm parity
  npx tsx scripts/migrate-commerce-private-table.ts \
    --mode verify \
    --source-table AmodxTable \
    --destination-table AmodxCommerceTable \
    --tenants <your-commerce-tenant-id>

  What you verify:

  - Plan output shows expected record counts per prefix
  - Migrate completes without errors
  - Verify confirms zero missing keys, zero unexpected keys
  - DynamoDB console shows records in the new table

  Do not proceed to Deploy 2 until verify passes. Write freeze stays active.

  ---
### Deploy 2 — Backend storage cutover

  What you code:

  - Phase 6: Set COMMERCE_TABLE_NAME env var on all commerce Lambda handlers in CDK. This switches commerce-db.ts
  from the fallback (main table) to the new table.
  - Phase 6: Update orders/create.ts — the TransactWriteCommand now references two tables. ORDER#, CUSTORDER#,
  CUSTOMER#, COUNTER# items use COMMERCE_TABLE_NAME. COUPON# usage update uses TABLE_NAME.
  - Phase 6: Update orders/get.ts, orders/list.ts, orders/public-get.ts, orders/update.ts, orders/update-status.ts —
  read/write from COMMERCE_TABLE_NAME.
  - Phase 6: Update customers/get.ts, customers/list.ts, customers/update.ts, customers/public-update.ts — read/write
   from COMMERCE_TABLE_NAME.
  - Phase 6: Update reports/summary.ts — reads from COMMERCE_TABLE_NAME.
  - Phase 6: Grant grantReadWriteData on the new table to all affected Lambda functions in CDK. Grant grantReadData
  on the new table to read-only handlers (reports, get, list).

  What you deploy:

  Single cdk deploy. All backend handlers now read/write the new table. The migrated data is already there from the
  previous step.

  What you verify (Phase 7):

  - Place a new test order → confirm it appears in the new table (DynamoDB console)
  - Account page shows old migrated orders AND the new test order
  - Profile read/update works
  - Public order tracking works
  - Admin order list shows all orders
  - Reports page loads
  - Run verify mode of migration script again to confirm source and destination still match (plus the new order only
  in destination)

  Lift write freeze. Commerce is now fully operational on the new table.

  Risk: Medium. This is the cutover moment. If something fails, rollback is: revert the CDK deploy (which removes
  COMMERCE_TABLE_NAME env var, handlers fall back to main table). Data in the main table is untouched.

  ---
### Operational Step — Purge old records from main table

  When: After validation is complete and you're confident the new table is the source of truth. No rush — the old
  records don't cause functional issues, they're just a residual security exposure.

  What you run:

  A purge script (not yet written) or manual DynamoDB operations that delete ORDER#, CUSTORDER#, CUSTOMER#,
  COUNTER#ORDER records from the main table for each migrated tenant.

  What you verify:

  - Renderer Lambda cannot read any customer/order data from the main table (the security property is now true)
  - All commerce paths still work (they read the new table)

  ---
  Summary

  ┌───────────┬───────────┬───────────────────────────────────┬─────────────────────────────────────────────────┐
  │   Step    │   Type    │           What changes            │                    Rollback                     │
  ├───────────┼───────────┼───────────────────────────────────┼─────────────────────────────────────────────────┤
  │ Deploy 1  │ cdk       │ New read path + empty table       │ Revert code, redeploy                           │
  │           │ deploy    │                                   │                                                 │
  ├───────────┼───────────┼───────────────────────────────────┼─────────────────────────────────────────────────┤
  │ Migration │ Script    │ Data copied to new table          │ Delete from new table                           │
  ├───────────┼───────────┼───────────────────────────────────┼─────────────────────────────────────────────────┤
  │ Deploy 2  │ cdk       │ Backend reads/writes new table    │ Revert code, redeploy (main table still has     │
  │           │ deploy    │                                   │ data)                                           │
  ├───────────┼───────────┼───────────────────────────────────┼─────────────────────────────────────────────────┤
  │ Purge     │ Script    │ Old records deleted from main     │ Restore from PITR backup                        │
  │           │           │ table                             │                                                 │
  └───────────┴───────────┴───────────────────────────────────┴─────────────────────────────────────────────────┘

  Two deploys. One migration script run. One purge. Write freeze only between migration and Deploy 2 validation
  completion.

## Definition of Done

- renderer no longer reads `ORDER#`, `CUSTORDER#`, `CUSTOMER#`, or `COUNTER#ORDER` directly
- backend self-service endpoints exist and are used by renderer proxies
- commerce-private table is deployed with PITR and proper IAM
- one-time migration completes for all current commerce tenants
- validation passes per tenant and per moved prefix
- cross-table order creation succeeds with coupon usage updates
- old source copies are purged from the main table after validation
- docs and remediation notes point to the new boundary and migration process
