# Commerce-Private Table Migration Plan

## Status

- Decision record: proposed and documented; the renderer→backend trust model is now formalized as PD-002 (`docs/platform-decisions.md`)
- Current maturity: renderer/content boundary is mature, customer-data least-privilege is not
- Target maturity: production-grade boundary where the renderer Lambda cannot read customer-private commerce data
- Sensitivity: **data migration is low-stakes** (commerce is test-only — one tenant, disposable orders), but **shared-code / CDK deploys remain production-sensitive** (the same backend + renderer fleet serves all non-commerce production tenants). Treat the first migration as a rehearsal of the production migration machinery on disposable data — build the tooling full-strength, run it as a rehearsal.

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

This is now formalized platform-wide as **PD-002** (`docs/platform-decisions.md`): a
two-hop trust chain — browser→renderer (validated NextAuth session), then renderer→backend
(RENDERER key + host-derived tenant + session-derived email). The browser never supplies
`tenantId` or customer email as an authority. Do not "optimize" by letting the browser
call the backend customer routes directly.

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
- `CUSTORDER#<normalizedEmail>#<orderId>`
- `CUSTOMER#<normalizedEmail>`
- `COUNTER#ORDER`

where `normalizedEmail = normalizeEmail(customerEmail)` (shared utility — trim +
lowercase; no inline `toLowerCase()`). The current checkout only lowercases, so the
migration must align historical keys to this normalized form and all new writes must use
it.

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

Trust model (PD-002):

- the browser never sends customer identity (email or tenant) as an authority
- renderer validates the NextAuth session and derives the customer email from it
- renderer derives tenant from `Host`
- renderer sends identity to the backend only on the server-to-server call, authenticated
  with the `RENDERER` API key
- if a header carries the email, it MUST be an internal header excluded from
  access/request logging; prefer the JSON body for non-GET internal calls where the API
  shape allows
- the backend IGNORES any browser-originated customer email; identity comes only from the
  RENDERER-authenticated call

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

- the GSI pre-migration gate (see Assumptions) must be cleared first
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
  { Put:    { TableName: COMMERCE_TABLE_NAME, Item: orderItem } },       // ORDER#<orderId>
  { Put:    { TableName: COMMERCE_TABLE_NAME, Item: custOrderItem } },   // CUSTORDER#<normalizedEmail>#<orderId>
  { Update: { TableName: COMMERCE_TABLE_NAME, Key: customerKey, ... } }, // CUSTOMER#<normalizedEmail> — UPDATE
  { Update: { TableName: COMMERCE_TABLE_NAME, Key: counterKey, ... } },  // COUNTER#ORDER
  { Update: { TableName: TABLE_NAME, Key: couponKey, ... } },            // COUPON# stays in main table
]
```

The customer record is an **`Update`**, not a `Put`: preserve the current `create.ts`
upsert semantics (`if_not_exists` for profile fields, additive spend/order counters). A
`Put` would clobber an existing customer's profile and totals. Verify the current
`create.ts` write shape and replicate it exactly on the new table.

DynamoDB supports cross-table transactions in the same account and region, so this remains atomic if implemented correctly.

### Phase 7 - Validation

Validate per tenant (post-cutover semantics — destination already has new orders, so do
NOT require strict count parity here):

- every expected source key exists in destination (`verify --post-cutover`)
- destination-only keys were all created after cutover; no writes still land in the old table
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

Purge only via the script's `purge` mode, after `purge-plan` review and a recorded backup reference (on-demand backup ARN, or PITR + the exact UTC timestamp) + NDJSON export (see Safety Rules); then run `purge-verify`.

## Rollback Plan

Rollback should be staged, not improvised.

### Safe rollback points

1. Before backend storage cutover
   - new endpoints can still read the old table
   - migration can be repeated safely

2. After migration but before source purge
   - backend can be pointed back to old table
   - source data still exists

### Rollback after Deploy 2 (destination-only writes)

Once Deploy 2 is live and any order is created, that order is **destination-only**.

- Before the write freeze is lifted (no destination-only writes yet): rollback is simply
  pointing code/env back to the old table.
- After destination-only writes exist, rollback requires either:
  - reverse-copying the destination-only records back to the old table, or
  - accepting their loss — acceptable for the current **test** commerce tenant, NOT for a
    future production commerce tenant.
- For future production use: no rollback after destination-only writes without a
  reverse-migration plan prepared in advance.

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
- `verify --strict` (before Deploy 2 / storage cutover)
  - exact source/destination parity: same keys, same counts
- `verify --post-cutover` (after Deploy 2; a.k.a. `--destination-superset`)
  - every expected source item exists in destination
  - destination-only items are allowed, but must have been created after cutover
  - proves no new writes are still landing in the old table
- `purge-plan`
  - list the source records that would be deleted from the main table, without deleting
- `purge`
  - delete the moved source records from the main table (only after validation + backup)
- `purge-verify`
  - confirm the moved keys are absent from the main table and still present in destination

### Safety Rules

- requires explicit tenant list
- requires explicit source and destination tables
- defaults to dry planning behavior unless an explicit write mode is selected
  (`--mode migrate` or `--mode purge`)
- aborts if destination already contains moved records unless `--allow-existing-destination` is supplied
- `migrate` never deletes source records; deletion happens only via the explicit `purge` mode
- `purge-plan`, `purge`, and `purge-verify` all require BOTH `--source-table` and
  `--destination-table`; `purge` refuses to delete any candidate not already present in the
  commerce-private (destination) table
- `purge` refuses to run without a recorded backup reference — an on-demand backup ARN, or
  PITR enabled plus the exact UTC restore timestamp recorded immediately before purge — AND
  an NDJSON export of the purge candidates
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

Verify (pre-cutover, strict parity):

```bash
npm run migrate-commerce-private-table -- \
  --mode verify --strict \
  --source-table AmodxTable \
  --destination-table AmodxCommerceTable \
  --tenants tenant-a,tenant-b
```

Verify (post-cutover, destination superset):

```bash
npm run migrate-commerce-private-table -- \
  --mode verify --post-cutover \
  --source-table AmodxTable \
  --destination-table AmodxCommerceTable \
  --tenants tenant-a,tenant-b
```

Purge (only after `verify --post-cutover` passes):

```bash
# 1. Review what would be deleted (no writes)
npm run migrate-commerce-private-table -- \
  --mode purge-plan \
  --source-table AmodxTable \
  --destination-table AmodxCommerceTable \
  --tenants tenant-a,tenant-b

# 2. Delete — requires a backup reference + NDJSON export; only deletes candidates
#    confirmed present in the destination table
npm run migrate-commerce-private-table -- \
  --mode purge \
  --source-table AmodxTable \
  --destination-table AmodxCommerceTable \
  --tenants tenant-a,tenant-b \
  --backup-ref "<on-demand-backup-ARN | pitr-utc-timestamp>" \
  --export-path <ndjson-path>

# 3. Confirm removal from source, presence in destination
npm run migrate-commerce-private-table -- \
  --mode purge-verify \
  --source-table AmodxTable \
  --destination-table AmodxCommerceTable \
  --tenants tenant-a,tenant-b
```

### Validation Model

Per tenant and per moved prefix, the script reports:

- source count
- destination count
- missing keys in destination (always a failure)
- destination-only keys — a failure under `verify --strict` (pre-cutover), but EXPECTED
  under `verify --post-cutover` (new orders write only to destination after Deploy 2)

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
- add a CI guard (a lint rule, not a fragile grep that trips on comments/docs) that fails
  the build if production renderer source — scope `renderer/src/**`, excluding docs,
  tests, and generated files — imports or calls any of: the DynamoDB commerce read helpers
  (`getOrderForCustomer` / `getCustomerOrders` / `getCustomerProfile`), direct table access
  for `ORDER#` / `CUSTOMER#` / `CUSTORDER#` / `COUNTER#ORDER`, `COMMERCE_TABLE_NAME`, or any
  backend/internal commerce repository module. Renderer API proxy routes may call the backend HTTP client
  only — never DynamoDB.

### Scripts and Docs

- add the one-time migration utility
- document rollout, validation, and purge

## Assumptions

- commerce footprint is currently small
- existing commerce tenants can be migrated from an explicit allowlist
- migration runs in the same AWS account and region as both tables
- no payload transformation is needed; key transformation is limited to deterministic
  normalization of `CUSTOMER#` and `CUSTORDER#` email components through `normalizeEmail()`
- no dual-write transition layer is introduced for this phase
- a temporary write freeze is acceptable during migration and cutover
- **GSI participation is a hard pre-migration gate** (not just an assumption). Migration
  MUST NOT run until verified:
  - whether `ORDER#`, `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER` participate in any GSI
    (the `CUSTORDER#` adjacency should be a base-table SK-prefix query, not a GSI);
  - whether any admin/report/list path depends on a `Type`/entity GSI projection;
  - whether the new commerce-private table needs matching GSIs, or whether all commerce
    access remains PK/SK-only.
  Any GSI those entities feed must be recreated on the new table and every dependent query
  re-pointed, or the migration scope is incomplete.
- **email normalization must be consistent**: `CUSTOMER#<email>` keys must use the shared
  `normalizeEmail()` (see `plan-public-pool-customer-auth.md`). Checkout currently does
  inline `customerEmail.toLowerCase()` (no `.trim()`); migrate it to `normalizeEmail()` or
  account-linking forks duplicate `CUSTOMER#` records.

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
  requireRole(["RENDERER"]) and read customer identity ONLY from the renderer-authenticated internal carrier (API Design — if a header, excluded from request/access logging; browser-originated email is never trusted), then call commerce-db.ts
  functions. Register routes in CDK (api-commerce.ts nested stack).
  - Phase 3: Rewrite renderer/src/app/api/account/orders/route.ts — stop importing getCustomerOrders from dynamo.ts,
  instead call GET /customer/orders on the backend with renderer key + tenant from host + session-derived customer identity through the renderer-authenticated internal identity carrier (API Design); if that carrier is a header, it must be excluded from request/access logging. Browser-originated email is never trusted.
  - Phase 3: Rewrite renderer/src/app/api/profile/route.ts GET — stop importing getCustomerProfile from dynamo.ts,
  instead call GET /customer/profile on the backend with renderer key + tenant from host + session-derived customer identity through the renderer-authenticated internal identity carrier (API Design); if that carrier is a header, it must be excluded from request/access logging. Browser-originated email is never trusted.
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

  # Verify — confirm strict pre-cutover parity
  npx tsx scripts/migrate-commerce-private-table.ts \
    --mode verify --strict \
    --source-table AmodxTable \
    --destination-table AmodxCommerceTable \
    --tenants <your-commerce-tenant-id>

  What you verify:

  - Plan output shows expected record counts per prefix
  - Migrate completes without errors
  - `verify --strict` confirms zero missing keys and zero unexpected keys before storage cutover
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
  - Run `verify --post-cutover` to confirm destination is a superset of the expected source keys and the new test
  order exists only in destination

  Lift write freeze. Commerce is now fully operational on the new table.

  Risk: Medium. This is the cutover moment. If something fails, rollback is: revert the CDK deploy (which removes
  COMMERCE_TABLE_NAME env var, handlers fall back to main table). Data in the main table is untouched.

  ---
### Operational Step — Purge old records from main table

  When: After validation is complete and you're confident the new table is the source of truth. No rush — the old
  records don't cause functional issues, they're just a residual security exposure.

  What you run:

  The migration script's `purge` mode — after `purge-plan` review and a recorded backup reference (on-demand backup ARN, or PITR
  + the exact UTC timestamp) + NDJSON export — deletes ORDER#, CUSTORDER#, CUSTOMER#, COUNTER#ORDER from
  the main table for each migrated tenant; then `purge-verify` confirms removal.

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
  │ Purge     │ Script    │ Old records deleted from main     │ Restore from backup/PITR                        │
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
- purge runs only after a recorded backup reference (on-demand backup ARN, or PITR + UTC timestamp) + NDJSON export, confirmed by `purge-verify`
- a CI guard fails the build if renderer code imports `getOrderForCustomer` / `getCustomerOrders` / `getCustomerProfile` or reads `ORDER#` / `CUSTOMER#` / `CUSTORDER#`
- checkout email keying is migrated to the shared `normalizeEmail()` (consistent `CUSTOMER#` keys)
- docs and remediation notes point to the new boundary (PD-002) and migration process
