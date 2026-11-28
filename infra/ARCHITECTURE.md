# infra — ARCHITECTURE.md

## Role in the System

AWS CDK infrastructure-as-code. Defines and deploys all cloud resources: DynamoDB, Lambda functions, API Gateway, Cognito, S3, CloudFront, EventBridge, Route53, ACM certificates. A single stack serves both production and staging via a suffix-based naming convention.

**Depends on:** backend (Lambda handler source code), admin (Vite build output), renderer (OpenNext build output)

## Internal Structure

```
bin/
└── infra.ts                    # CDK App entry point: reads stage context, loads config file

lib/
├── amodx-stack.ts              # Main stack: composes all constructs, wires dependencies
├── api.ts                      # HTTP API Gateway + authorizer + all routes; wires catalog routes to CatalogApi's functions (passed in)
├── api-catalog.ts              # NestedStack: content/products/import FUNCTIONS (routes stay in api.ts; instantiated in amodx-stack.ts)
├── api-scheduling.ts           # NestedStack: scheduling functions + routes (SCHED-1D1: 10 admin routes; SCHED-1D2: 7 visitor routes; SCHED-1E1: 12 appointment admin routes; SCHED-1G1: the calendar feed route + the scheduled job and its one rate(15 minutes) rule; L1 routes, own authorizer)
├── auth.ts                     # Two Cognito User Pools (Admin invite-only, Public self-signup)
├── database.ts                 # The main DynamoDB table and its GSIs; + two private tables: scheduling (sched-1b) and commerce (CMRC-1B: empty, wired to nothing — § Commerce-Private Table)
├── uploads.ts                  # S3 buckets (public assets + private resources) + CloudFront CDN
├── domains.ts                  # Route53 hosted zone + ACM certificates (global + regional)
├── events.ts                   # EventBridge bus + audit rule + dead letter queue
├── config-generator.ts         # Writes runtime config to S3 for admin/renderer
├── admin-hosting.ts            # S3 + CloudFront for admin SPA deployment
└── renderer-hosting.ts         # OpenNext → Lambda + CloudFront for Next.js SSR

test/
├── amodx-stack.test.ts         # Real `Template.fromStack` assertions over the whole stack
└── no-dotenv.cjs               # `.env*` blindfold for the builds the synth spawns
```

See § *Testing* near the end of this document — the suite has behaviour worth knowing about
before you run it.

## Stack Composition (`amodx-stack.ts`)

```
AmodxStack
├── Secrets (Master API Key + NextAuth Secret via Secrets Manager)
├── AmodxUploads (S3 assets + S3 private + CloudFront CDN)
├── AmodxDatabase (the main DynamoDB table + GSIs; the scheduling-private table; the commerce-private table — CMRC-1B: empty, passed to no construct)
├── AmodxAuth (Admin Cognito Pool + Public Cognito Pool)
├── AmodxEvents (EventBridge bus + Audit rule + SQS DLQ)
├── CatalogApi (NestedStack — content/redirects/products/import FUNCTIONS only; instantiated before AmodxApi and passed in; their routes live in AmodxApi)
├── AmodxApi (HTTP API Gateway + Custom Authorizer + all routes; owns the Lambdas NOT in a nested stack; wires catalog routes to CatalogApi's functions)
├── CommerceApi (NestedStack — categories, public products, orders, customers, delivery, coupons, reviews, reports; CMRC-1B, CMRC-1L: the three customer read routes for the renderer key)
├── EngagementApi (NestedStack — popups, forms)
├── SchedulingApi (NestedStack — scheduling routes; SCHED-1D1: admin bookings, customers, resources, mail templates; SCHED-1D2: visitor routes; SCHED-1E1: services, default availability, week planner, appointments; SCHED-1G1: calendar feed, scheduled job; after AdminHosting, which supplies `adminUrl`)
├── AmodxRendererHosting (OpenNext Lambda + CloudFront)
├── AmodxAdminHosting (S3 + CloudFront)
├── AmodxDomains (Route53 + ACM certs)
└── ConfigGenerator (Runtime config written to S3)
```

## Environment Strategy

Controlled by `-c stage=<name>` CDK context flag:

| Aspect | Production | Staging |
|--------|-----------|---------|
| Config file | `amodx.config.json` | `amodx.staging.json` |
| Stack name | `AmodxStack` | `AmodxStack-staging` |
| Resource suffix | (none) | `-staging` |
| Table | `AmodxTable` | `AmodxTable-staging` |
| Removal policy | RETAIN | RETAIN |

All resources tagged with `Stage` and `Project: AMODX`.

A second deploy-time input (CMRC-2B): the CDK context `commerceWriteFreezeTenants` (comma list of tenant ids; absent =
empty). `amodx-stack.ts` reads it (a non-text value stops the synth) and passes it to `CommerceApi`; `deploy.sh` sets it
from the operator's environment variable `COMMERCE_WRITE_FREEZE_TENANTS` and prints it before the diff. A deploy that
does not name it deploys the empty list. § *Commerce Write Freeze*.

## DynamoDB Table (`database.ts`)

- **Billing:** PAY_PER_REQUEST (serverless auto-scaling)
- **PITR:** Enabled
- **Removal policy:** RETAIN

| Index | PK | SK | Purpose |
|-------|----|----|---------|
| Primary | PK (STRING) | SK (STRING) | All entity access |
| GSI_Domain | Domain (STRING) | PK (STRING) | Tenant lookup by domain |
| GSI_Type | Type (STRING) | CreatedAt (STRING) | List entities by type |
| GSI_Status | Status (STRING) | ScheduledFor (STRING) | Workflow/inbox queries |

## Commerce-Private Table and Customer Read Routes (CMRC-1B, CMRC-1L)

Records `docs/slices/cmrc-1b.md` (the table and two routes) and `docs/slices/cmrc-1l.md` (the third route);
specification `docs/slices/cmrc-1.md` § 5.8. PROTOTYPE until the operator's staging run. The section above describes the main table only; `database.ts` declares three tables: the main table, the
scheduling-private table (described under `SchedulingApi` below) and this one.

**What is NOT true yet — read this first.** The table protects nothing. It is empty, and every order and customer
item is still in the main table. The renderer server function still has `grantReadData` on the whole main table
(`renderer-hosting.ts`), so the renderer's IAM reach to that data is the same as before these slices. CMRC-1B and
CMRC-1L changed which CODE reads the data (the renderer's two account routes and its two order pages now ask the
backend; since CMRC-1L no renderer code reads an order or a customer item), not which ROLE can read
it. The reach ends only when the items leave the main table (`cmrc-4`, `cmrc-6`).

**The table (`database.ts`, property `commerceTable`).** `AmodxCommerceTable<suffix>`, construct id `CommerceTable`,
in the parent stack: `PK`/`SK` strings, PAY_PER_REQUEST, point-in-time recovery, RETAIN on delete and on replace. No
GSI (the four moved key families take part in no index), no stream, no TTL (a TTL attribute would delete any item
that ever carries it). **Unused on purpose:** `amodx-stack.ts` passes it to no construct; no function has its name in
a variable (there is no `COMMERCE_TABLE_NAME`); no role has a statement on it. Why it exists before anything uses it:
a stateful resource is reviewed alone, in a diff that cannot break a function, and `cmrc-2` proves the copy tool
against the empty table on staging. `cmrc-4` wires it into the commerce functions only.

**The three functions and their routes (`api-commerce.ts`).** All are built from
`backend/src/customers/self-service.ts` with one property set (`selfServiceReadProps`):

| Function (construct id) | Handler | Route | Since |
|---|---|---|---|
| `CustomerOrderHistoryFunc` | `orderHistoryHandler` | `POST /customer/order-history` | CMRC-1B |
| `CustomerProfileReadFunc` | `profileReadHandler` | `POST /customer/profile-read` | CMRC-1B |
| `CustomerOrderLookupFunc` | `orderLookupHandler` | `POST /customer/order-lookup` | CMRC-1L |

The first two serve the account page (the email is the validated session's). The third serves the order
confirmation and tracking pages: its request holds the order id and the email of the page address, with no session —
a recorded exception to PD-002 (`docs/platform-decisions.md`, amendment 2026-11-28; an operator ruling, not yet
confirmed by the human). The infrastructure of the three is the same; the difference is in the handler.

- **Authorization:** `addRoute` without `noAuth` → `AuthorizationType: CUSTOM` with the nested stack's authorizer
  (`CommerceAuthorizer`), as `POST /public/customers/profile`. The authorizer admits any valid credential and passes
  its role; the HANDLER admits the renderer key (`RENDERER`, and `GLOBAL_ADMIN`) and answers 403 to every other role.
  So "renderer only" is a property of the handler (backend tests), and "not anonymous" is the property of the
  infrastructure (row `(cmrc1b-3)`).
- **Restricted variables:** `TABLE_NAME` only. They do not take the stack's `nodeProps.environment`: no
  `EVENT_BUS_NAME`, no `RENDERER_URL`, no `REVALIDATION_SECRET_NAME` (they publish nothing and purge nothing).
- **Restricted grants:** `table.grantReadData` only — the read actions on the main table and its indexes (CDK writes
  it as two statements). No write, no SES, no secret, no `lambda:InvokeFunction`.
- **No event bus:** the loop at the end of the `CommerceApi` constructor grants `events:PutEvents` to every
  `NodejsFunction` of the nested stack. It skips exactly these three (the list `publishNoEvent`). Every other commerce
  function keeps the grant it had; a new read-only function that must not publish joins that list.

**After a rollback** the table stays (RETAIN). The next deploy that declares it fails on the existing name until the
operator deletes the empty table (item count 0 checked first) or imports it.

**Assertions** (`test/amodx-stack.test.ts`, inside the `SCHED-1B` block so that its IAM reading rule is the one used —
every IAM value is matched as a whole against a closed list of shapes, so an absence claim cannot pass by not
understanding a value):

- `(cmrc1b-1)` the table: one, in the parent, the properties above and no other property but the stack's tags;
- `(cmrc1b-2)` nothing uses it: no resource, output or parameter of any template mentions it (seven mention forms are
  each detected on a probe); no function variable holds it by name or by value; every DynamoDB grant of the stack
  tree has a table shape and denotes the main table or the renderer's OpenNext tag-cache table — never this one (a
  probe grant on it IS resolved to it);
- `(cmrc1b-3)` the three routes: once in the stack tree, in the commerce nested stack, `CUSTOM` with its authorizer,
  each on its own function and handler; no other route of the tree is under `/customer/`;
- `(cmrc1b-4)` each function: `TABLE_NAME` its only variable; its own role with the one AWS logging policy; every
  statement an Allow of read actions on the main table, together exactly the read set; every OTHER commerce function
  still has `events:PutEvents`. The row logs the logical ids of the table and of the three functions' resources
  (listed in `docs/slices/cmrc-1b.md` and `docs/slices/cmrc-1l.md` § *Migration / deployment notes*, for the
  operator's reading of each staging diff) and the nested stack's resource count;
- `(cmrc1b-5)` the renderer server function: no variable names the commerce table; its DynamoDB grants denote the
  main table and its tag-cache table only.

Counts (credential-free test synth, 2026-11-28): parent raw 413 / 53 functions, deployed ≈ 479 — **21 below
CloudFormation's limit of 500**, and a stateful resource cannot move to a nested stack without replacement
(`docs/TECH-DEBT.md`, F-CMRC1B-PARENT-HEADROOM); `CommerceApi` raw 239 / 39 functions, deployed ≈ 278 (CMRC-1L added
one function: 6 resources and its log group; before it 233 / 38, ≈ 271). The parent count did not change with CMRC-1L.

## Commerce Write Freeze (CMRC-2B)

Record: `docs/slices/cmrc-2b.md`. At the end of the customer block of `api-commerce.ts`, one loop sets
`COMMERCE_WRITE_FREEZE_TENANTS` = the prop `commerceWriteFreezeTenants` on exactly the five writer functions of the
commerce-private items: `CreateOrderFunc`, `UpdateOrderStatusFunc`, `UpdateOrderFunc`, `UpdateCustomerFunc`,
`PublicUpdateCustomerFunc` (W1-W5, `docs/slices/cmrc-1.md` § 6). Each answers 503 `commerceFrozen` for a listed tenant
before its first effect (`backend/src/lib/commerce-freeze.ts`). No IAM change; no other function has the variable.
The shipped value is the empty text (no tenant frozen). Freeze: `COMMERCE_WRITE_FREEZE_TENANTS=<ids> ./deploy.sh
<stage>`; release: `./deploy.sh <stage>`; drain after a freeze deploy: at least 60 s (twice the 29 s timeout). Tests:
`(cmrc2b-1)` exactly the five functions hold the variable, all in the `CommerceApi` nested stack; `(cmrc2b-2)` with
no context its value is `""` on each.

## Lambda Configuration (`api.ts`)

Standard template for all functions:
- Runtime: Node.js 22.x
- Memory: 1024 MB (3008 MB for import function)
- Timeout: 29 seconds (15 min for import)
- Bundling: esbuild, minified, source maps, `@aws-sdk/*` external
- Environment: TABLE_NAME, EVENT_BUS_NAME, SES_FROM_EMAIL, secret names, bucket names

Functions in the PARENT (`api.ts`): comments (3), signals (3), leads (2), context (5), tenant (3), users (1), resources (3), assets (2), audit (3), contact (1), consent (1), themes (3), webhooks (1), email DNS (1).

Functions moved to the `CatalogApi` NestedStack (`api-catalog.ts`, INFRA-SPLIT-1 v2), **their routes still registered here in `api.ts`**: content CRUD (6), redirects (2: `POST`/`DELETE /redirects`, REDIRECT-1 — grants, env and fast lane as UpdateContentFunc), products admin CRUD (5), import (5: wordpress/media/reviews/glam-pricelist/migration upload link). The parent's integrations target these via a cross-stack `Fn::GetAtt`; the functions keep the same runtime/env/grants they had in the parent.

`EmailDnsCheckFunc` (slice `email-2`, `POST /email/dns-check`): read-only guided-DNS
checker. One `NodejsFunction` + one route + `table.grantReadData` (it Gets the tenant record
to derive the domain server-side; the DNS lookups themselves write nothing). Within the
"route + grant" ceiling — no NestedStack, no SES/IAM identity change (that is `email-2a`).

`SchedulingApi` NestedStack (`api-scheduling.ts`, SCHED-1D1; docs/slices/sched-1.md § 11.2, § 17): functions AND
routes (L1 `CfnRoute`/`CfnIntegration`, its own `CfnAuthorizer` on the parent's authorizer function, as CommerceApi).
Routes: the 10 admin routes under `/scheduling/admin/…` (SCHED-1D1), the 7 visitor routes under
`/scheduling/visitor/…` (SCHED-1D2: offer, slots, holds, bookings/view|confirm|cancel|move), the calendar
feed `POST /scheduling/visitor/feed` (SCHED-1G1, § 12: read-only on the scheduling table, no mail / link-base /
event-bus / reCAPTCHA wiring, row `(sched1g1)`) and the 12 appointment admin routes of SCHED-1E1 (services ×4, `resources/{r}/availability` GET/PUT,
`resources/{r}/week`, `resources/{r}/days` PUT, `resources/{r}/days/copy-week`, `appointments` GET/POST,
`bookings/{id}/move-slot`; no closed-time route, row E14, which also pins every scheduling admin route of the stack to
`tools/mcp-server/routes.json`). The 13 group admin routes of SCHED-1F1 and the visitor route
`courses/{c}/runs` were removed by SCHED-GROUPS-REMOVE-1 (code on branch `archive/group-scheduling-2026-11`). Every route runs the authorizer (`CUSTOM`, one authorizer for the nested stack): no scheduling route is
anonymous; the renderer key resolves to `RENDERER`. Wiring per function, pinned by `infra/test` rows I1-I5 and the
amended `(sched1b-3)`: every function has `SCHEDULING_TABLE_NAME` and `TABLE_NAME` (read on the main table); on the
scheduling-private table read only for the GET routes (SCHED-1E1: services list, availability, week, appointments
list), the customer lookup and the visitor view, read-write for the
writers, no grant for the templates route; `EVENT_BUS_NAME` + `events:PutEvents` ONLY on the functions that publish a
main-table audit event (resource writes, feed secret, erasure; SCHED-1E1: service writes, default availability, day
edits, copy-week — never a booking function and never a visitor function,
SCHED-AUDIT-PII = C); `SES_FROM_EMAIL` + one `ses:SendEmail` on the sender identity on the mailing functions (admin
booking cancel, manual appointment, slot move; visitor hold, confirm, cancel, move; the scheduled job); `RENDERER_CLOUDFRONT_ORIGIN` on the mailing functions and the
feed-secret route; `RECAPTCHA_SECRET_KEY` on the visitor hold only, from the optional prop `recaptchaSecretKey` exactly
as CommerceApi: `amodx-stack.ts` passes the parent's SSM-backed deployment secret to `SchedulingApi` (row I3, § 9.1
fail-open guard; the hold handler also refuses — 503 `verificationUnavailable` — when no configuration resolves). The
scheduling table is granted to no function outside this
nested stack, and the renderer's role has no statement on it. Counts (credential-free synth, 2026-11-22, SCHED-1D2):
parent deployed ≈ 469 (< 500; unchanged by the visitor routes), SchedulingApi raw 110 / 18 functions, deployed ≈ 129;
the secret adds one nested-stack parameter, no resource. SCHED-1E1 (synth comparison against HEAD `b9c56f2`): 72
resources added in SchedulingApi only (12 × function, role, policy, permission, integration, route), none removed;
the 18 existing scheduling functions change their code asset hash only (they bundle `scheduling-db.ts`, which gained
`replaceService` and the `consistent` flag of `listServices`); the parent changes only the nested-stack resource's
template asset hash; SchedulingApi raw 182 / 30
functions, deployed ≈ 213. SCHED-1F1 (synth comparison against HEAD `a3b7318`, HEAD synthesized twice for noise): 78
resources added in SchedulingApi only (13 × function, role, policy, permission, integration, route), none removed;
the 30 existing scheduling functions change their code asset hash only (they bundle `scheduling-db.ts`, which gained
the course rulings of SCHED-1F1); the nested template's description names the groups; the parent changes only the
nested-stack resource's template URL. SchedulingApi raw 260 / 43 functions, deployed ≈ 304; parent deployed ≈ 469
(unchanged). SCHED-1G1: the feed route (read-only, row `(sched1g1)` G11) and ONE scheduled function
`SchedulingJobFunc` (`backend/src/scheduling/reminders.ts`: reminders, the daily expired-hold cleanup, the Sunday
planner mail) with ONE rule `SchedulingJobSchedule` `rate(15 minutes)` that targets it; the function's resource-policy
grant is scoped to that rule; no API route is created. Authorized operator invocation (for example `aws lambda
invoke`) remains possible; IAM outside this stack was not examined.
Wiring (least privilege, § 11.2): main table read, scheduling table read-write, `ses:SendEmail` on the sender identity,
`SES_FROM_EMAIL`, `RENDERER_CLOUDFRONT_ORIGIN`, `ADMIN_URL`; no event bus; timeout 300 s (a timeout does not stop two
invocations from running at once: reminders stay one per start through the conditional mark, the cleanup is
idempotent, the weekly mail can be sent twice — documented in § 11.4). `ADMIN_URL` comes from the ONE property
`adminUrl` that `amodx-stack.ts` passes (the expression of the `AdminUrl` output; ruling SCHED-1G1-ADMIN-URL-LINE = A);
row G16 is asserted for both configurations (without a root domain in the main synth; with `domains.root` in a second
synth whose hosted-zone lookup is answered from the app context and which reuses the first synth's build output).
Comparison of the ACTUAL app (`bin/infra.ts`, stage staging, cached context, no AWS call; HEAD `6af9388` synthesized
twice: only `AdminHostingRuntimeConfigWriteConfigJson` differs, synth noise): SchedulingApi 303 → 316, 13 added
(`SchedulingJobFunc` + log group, role, policy, `SchedulingJobSchedule`, its invoke permission; `VisitorFeedFunc` +
log group, role, policy, permission, integration, route), none removed in any stack; the parent and the three other
nested stacks add or remove nothing. Changed: nested-stack template URLs and function `Code` assets — non-scheduling
bundles byte-identical (only the source maps differ, they carry checkout paths); scheduling bundles: 13 verified (9
identical, 4 differ only in renamed minified names; OBSERVED), 30 with a residual difference, caused by
`lib/scheduling-email.ts` (`whenText`, the § 11.4 weekly text) and `admin/bookings-cancel.ts` (INFERRED from the source diff: no other changed source is reachable). Local synth counts:
SchedulingApi raw 271 / 45 functions, deployed ≈ 317; parent deployed ≈ 469 (unchanged).
SCHED-GROUPS-REMOVE-1: the 13 group admin functions and `VisitorRunsFunc` leave SchedulingApi with their routes,
integrations, permissions, roles and policies (14 functions; 31 remain); the nested template's description no longer
names groups; the parent and the other nested stacks are not changed (INFERRED from the source diff; the synth counts
are not re-measured here).

Custom Lambda authorizer validates Cognito JWT or master API key. Public routes (`POST /leads`, `/contact`, `/consent`) bypass auth.

## Storage (`uploads.ts`)

| Bucket | Access | CDN | Purpose |
|--------|--------|-----|---------|
| `amodx-assets{-suffix}` | CORS PUT/POST from browser | CloudFront with OAC | Public images/media |
| `amodx-private{-suffix}` | Lambda presigned URLs only | None | Gated downloads, digital products |

Both buckets: `BlockPublicAccess.BLOCK_ALL`, removal policy RETAIN.

## Certificates & DNS (`domains.ts`)

Two-certificate strategy:
1. **Global cert** (us-east-1) — required by CloudFront. Covers `root-domain` + `*.root-domain`
2. **Regional cert** (stack region) — for API Gateway custom domain (`api.root-domain`)

Optional `globalCertArn` in config imports a pre-managed wildcard cert covering tenant custom domains.

## Config Generator (`config-generator.ts`)

Writes runtime config files to S3 during deployment:
- **Admin config:** API URL, Cognito pool IDs, region, renderer URL → served as `/config.json`
- **Renderer config:** TABLE_NAME, API_URL, NEXTAUTH_SECRET, API key secret name → Lambda env vars

Uses `AwsCustomResource` with `S3.putObject`, cache-control `no-cache`.

## Testing

`cd infra && npm test` — jest + ts-jest, CI job `infra-synth`. Added by slice `test-4`,
extended by `cache-6`; rationale and the assertion → ratified-property map are in
`docs/slices/test-4-infra-truth.md` and
`docs/slices/cache-6-distribution-transport-hotfixes.md`.

`test/amodx-stack.test.ts` synthesizes the **real** `AmodxStack` once and makes 18 named
assertions over the resulting template: the CloudFront cache key (header + query allowlists,
`CookieBehavior: none`, TTLs), the viewer-request Function on the default and `api/*`
behaviors, `api/*` = CACHING_DISABLED, the S3 static behaviors, the
`cloudfront:CreateInvalidation` blast radius (4 roles, asserted in two named categories: the
**3 request-path** cache Lambdas — the least-privilege set — plus **1 deploy-time** role, CDK's
`BucketDeployment` custom resource), and both flush schedules. Not a snapshot: a snapshot over
410 resources gets re-blessed instead of read.

**Two of the 18 were added by `cache-6` (2026-07-28)**, and both pin a **transport** list —
what CloudFront lets reach the origin — rather than a cache-key property. Each covers a defect
that shipped to production precisely because no assertion covered the list:

- `(g)` — `_next/image*` is keyed by a dedicated `ImageCachePolicy` on exactly `url,w,q`, the
  optimizer's required query-string inputs, and the behavior must actually reference that
  policy. Distinct from `(a2)`, which pins the *default* behavior's seven-parameter allowlist.
- `(h)` — `RendererOriginPolicy` forwards exactly eight headers: `x-revalidation-token`
  (`cache-6`) included; `x-prerender-revalidate` + `x-isr` (`cache-7`, the OpenNext background-ISR
  revalidation protocol) were removed 2026-10-13 (security fix; open-next 3.1.3 skipped tenant
  middleware on any `x-isr`) and stay removed on `@opennextjs/aws` 4.1.9 (ruling OPENNEXT1-XISR = A,
  `opennext-1b`); their absence is pinned. (The test title still says "ten" — finding F2 in
  `docs/slices/opennext-1a.md`, a rename for the next infra slice.) Distinct from `(a1)`, which pins the six headers in the cache
  *key*: `(a1)` governs which stored response a viewer gets, `(h)` governs what the origin is
  allowed to see at all, on hits and misses alike. `cache-7` extended the list `(h)` pins without
  adding a new assertion. (`STATIC-EP` did NOT extend it: its CYCLE-1 `Origin` addition hit
  CloudFront's hard 10-header cap on deploy and was reverted — the anonymous-write origin barrier
  moved to the viewer-request CloudFront Function, pinned by the new named assertion `(i)` below,
  D-STATIC-EP-ORIGIN.)
- `(i)` — the viewer-request CloudFront Function's `STATIC_EP_EDGE_ORIGIN_GUARD` 403s a cross-site
  / null-origin POST to `/api/consent|contact|leads` at the edge, before the renderer Lambda. The
  assertion drives the shared guard source (`STATIC_EP_EDGE_ORIGIN_GUARD`, exported from
  `renderer-hosting.ts`) over the full decision table AND asserts the deployed function body
  contains it — so the deployed edge function is proven to run the verified logic. This is a new
  assertion; it is the barrier `STATIC-EP` could not place on the ORP (see `(h)`).

Rationale: `docs/slices/cache-6-distribution-transport-hotfixes.md`,
`docs/slices/cache-7-prerender-revalidate-header.md`, and `docs/caching-architecture.md`
§ *Transport defects — CloudFront deletes a required request field*.

Three things to know before running it:

- **It takes ≈58 s and rebuilds `renderer/.open-next` and `admin/dist`.** Not a design choice
  of the test — `RendererHosting` and `AdminHosting` run those builds inside their constructors
  (`lib/renderer-hosting.ts:62`, `lib/admin-hosting.ts:31`), so *any* synth does this. Both are
  gitignored outputs that a deploy regenerates. Tracked in `docs/TECH-DEBT.md`.
  Consequence to know: consecutive runs are **not** independent. If a run is interrupted, the
  next one can die in `beforeAll` with `ENOTEMPTY … .next/standalone/node_modules/next` and
  report *all 18* assertions red for a reason unrelated to infra — `rm -rf renderer/.next` and
  re-run before believing a wholesale failure.
- **It is credential-free and enforces that itself.** The test stack passes
  `config: { domains: {} }`, so `AmodxDomains` — the only synth-time context provider
  (`HostedZone.fromLookup`) — is never built; and the suite strips credential-shaped
  environment variables, closes the SDK's file and IMDS credential paths, and hides
  `renderer/.env*` + `admin/.env*` from the whole spawned process tree via `no-dotenv.cjs`.
  Assertions `(iso1)`–`(iso3)` fail if any of that regresses.
- **`jest.config.js` pins `moduleFileExtensions` with `ts` before `js`,** the jest equivalent of
  the `--prefer-ts-exts` that `cdk.json` passes to ts-node. `lib/` and `bin/` carry untracked
  compiled `*.js` leftovers from before `tsconfig.json` gained `noEmit: true`; without the pin,
  jest loads those instead of the sources. Assertion `(src1)` fails if the pin is removed.

## Deployment

```bash
# First time
npm run setup              # Interactive wizard (root)

# Deploy
cd infra && npx cdk deploy                          # Production
cd infra && npx cdk deploy -c stage=staging          # Staging

# Post-deploy
npm run post-deploy        # Writes runtime configs, sets up MCP server
```
