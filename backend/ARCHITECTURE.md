# backend — ARCHITECTURE.md

## Role in the System

The API layer. All Lambda functions behind API Gateway HTTP API. Handles CRUD for every entity, authentication, authorization, audit logging, email sending, payment webhooks, and content import. The admin panel and renderer both call this backend.

**Consumed by:** admin (via HTTP), renderer (via HTTP and direct DynamoDB), mcp-server (via HTTP)
**Depends on:** packages/shared (Zod schemas, types)

## Internal Structure

```
src/
├── lib/                   # (selected modules; 18 files in total)
│   ├── db.ts              # DynamoDB DocumentClient singleton + TABLE_NAME
│   ├── events.ts          # EventBridge publishAudit() helper
│   ├── recaptcha.ts       # reCAPTCHA v3: resolveRecaptchaConfig() + verifyRecaptcha()
│   ├── invalidate-cdn.ts  # Two invalidation classes (cache-4a): withInvalidation() HOF → bulk `/*`
│   │                      #   debounce marker; enqueueEdgeInvalidation() → ordinary edits' targeted
│   │                      #   fast-lane paths (String Set + `rev`) drained by the debounce Lambda
│   ├── edge-invalidation.ts # PURE: fast-lane coalescing — dedupe changed paths, /* over 30 distinct
│   │                        #   (FAST_LANE_WILDCARD_THRESHOLD). Test seam, like revalidate-paths.ts
│   ├── revalidate.ts      # Drives BOTH layers (cache-4a): revalidateTenantPaths() → edge fast lane +
│   │                      #   ISR purge (Layer 2) via the /api/revalidate transport
│   ├── revalidate-paths.ts # PURE: tenant routing + slugs → the domain-keyed paths to purge (unit-tested)
│   └── review-media.ts     # rev-2a staged-media SPINE (no image decode; D-REV-4 SUPERSEDED): declared
│                           #   type-AND-size STAGE to the private quarantine + PROMOTION gate
│                           #   (both-approvals → copy the staged ORIGINAL to public, Asset record) +
│                           #   rollback. Human moderation, not a byte-screen, is the content control.
├── auth/
│   ├── authorizer.ts      # Lambda authorizer (Cognito JWT + API key)
│   ├── context.ts         # AuthorizerContext type definition
│   └── policy.ts          # requireRole(auth, roles[], tenantId?) access control
├── content/
│   ├── create.ts          # POST /content
│   ├── list.ts            # GET /content
│   ├── get.ts             # GET /content/{id}
│   ├── update.ts          # PUT /content/{id}
│   ├── history.ts         # GET /content/{id}/versions
│   └── restore.ts         # POST /content/{id}/restore
├── products/
│   ├── create.ts          # POST /products
│   ├── list.ts            # GET /products
│   ├── get.ts             # GET /products/{id}
│   ├── update.ts          # PUT /products/{id}
│   └── delete.ts          # DELETE /products/{id}
├── reviews/
│   ├── create.ts          # POST /reviews
│   ├── list.ts            # GET /reviews (admin, all statuses). No productId → merges BOTH the
│   │                      #   REVIEW#<productId># and DISJOINT SITEREVIEW# namespaces (rev-1
│   │                      #   D-REV-5) via two PK+begins_with queries (never a Scan), so imported
│   │                      #   business (site-scope) reviews are visible for moderation (rev-2b)
│   ├── update.ts          # PUT /reviews/{id} — TWO actions on one contract (rev-2a):
│   │                      #   default = field update; `action:"approve-image"` = staged-media
│   │                      #   promotion (approval DERIVED FROM THE ROW, never the body).
│   │                      #   Both actions route no-productId reviews to the SITEREVIEW# key.
│   ├── delete.ts          # DELETE /reviews/{id} (no productId → SITEREVIEW# key)
│   └── public-list.ts     # GET /public/reviews/{productId} (approved product reviews only;
│                          #   a public site-review render surface is rev-4 gallery, not built here)
├── comments/
│   ├── create.ts          # POST /comments (public or authed)
│   ├── list.ts            # GET /comments
│   └── moderate.ts        # POST /comments/moderate
├── signals/
│   ├── create.ts          # POST /signals
│   ├── list.ts            # GET /signals
│   └── update.ts          # PUT /signals/{id}
├── leads/
│   ├── create.ts          # POST /leads (public, no auth)
│   └── list.ts            # GET /leads
├── context/
│   ├── create.ts          # POST /context
│   ├── list.ts            # GET /context
│   ├── get.ts             # GET /context/{id}
│   ├── update.ts          # PUT /context/{id}
│   └── delete.ts          # DELETE /context/{id}
├── tenant/
│   ├── create.ts          # POST /tenant (Global Admin only)
│   ├── list.ts            # GET /tenant
│   └── settings.ts        # GET/PUT /tenant/settings
├── users/
│   └── invite.ts          # POST /users/invite (Cognito AdminCreateUser)
├── resources/
│   └── presign.ts         # POST /resources/upload-url, GET /resources/{id}/download-url
├── assets/
│   ├── create.ts          # POST /assets (returns presigned upload URL)
│   └── list.ts            # GET /assets
├── audit/
│   ├── worker.ts          # EventBridge consumer → writes audit log to DynamoDB
│   ├── list.ts            # GET /audit
│   └── graph.ts           # GET /audit/graph (content link graph)
├── contact/
│   └── send.ts            # POST /contact (public, sends SES email)
├── consent/
│   └── create.ts          # POST /consent (public, GDPR tracking)
├── themes/
│   └── manage.ts          # Theme CRUD (create, list, delete handlers)
├── webhooks/
│   └── paddle.ts          # POST /webhooks/paddle (payment fulfillment + SES email)
└── import/
    ├── wordpress.ts       # WordPress XML import handler
    ├── wxr-parser.ts      # WXR XML parser utility
    ├── html-to-tiptap.ts  # HTML → Tiptap JSON converter
    ├── woocommerce.ts     # POST /import/woocommerce — product CSV import
    ├── media.ts           # POST /import/media — bulk media import
    ├── reviews.ts         # POST /import/reviews (rev-2b) — attestation-gated bulk review import.
    │                      #   Import-family instance #3 (own NodejsFunction). ORDER (all validation
    │                      #   is read-only BEFORE the first write): parse source → decode+bound the
    │                      #   media ZIP (fflate, zip-bomb guard) → write the IMMUTABLE ImportBatch
    │                      #   FIRST (D-REV-3 attestation; write-once ConditionExpression) → per-row
    │                      #   map → stage each photo via lib/review-media.stageReviewImage (declared
    │                      #   type+size gate, NO decode — moderation is the content control) →
    │                      #   pending reviews (site scope → SITEREVIEW#, product → REVIEW#<pid>#) →
    │                      #   structured ReviewImportReport (shared DTO — the admin→backend boundary
    │                      #   crossing; full per-row + per-image disposition). Bulk CDN invalidation.
    └── reviews-parse.ts   # rev-2b PURE parser SEAM (no AWS/S3/DDB): CSV/JSON parse, per-row
                           #   validation (malformed → per-row rejection, never abort-the-batch),
                           #   MAX_REVIEW_IMAGES count cap enforced pre-staging, ZIP-entry MIME
                           #   inference, extractImageRefs. Unit-tested against fixtures.

test/
├── setup.ts               # Loads .env.test, validates TABLE_NAME
├── utils.ts               # createEvent(), generateTenantId(), cleanupTenant()
├── content.test.ts
├── products.test.ts
├── comments.test.ts
├── leads.test.ts
├── tenant.test.ts
└── isolation.test.ts      # Cross-tenant isolation verification
```

## Authentication

Three modes, checked in order by `auth/authorizer.ts`:

1. **Master API Key** — `x-api-key` header matched against AWS Secrets Manager. Returns `{sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL"}`
2. **Cognito JWT** — `Authorization: Bearer <idToken>`. Extracts `custom:role` and `custom:tenantId` from token claims
3. **Public routes** — `POST /leads`, `POST /contact`, `POST /consent` bypass auth entirely

Access control via `requireRole(auth, allowedRoles[], targetTenantId?)` in `auth/policy.ts`. GLOBAL_ADMIN always passes. Others must match both role and tenant scope.

### reCAPTCHA v3 (Bot Protection on Public Routes)

Public endpoints are unauthenticated but protected by reCAPTCHA v3. The `resolveRecaptchaConfig()` function in `lib/recaptcha.ts` implements a two-tier resolution:

1. **Tenant keys** — if tenant provides own `siteKey` + `secretKey` in Settings, those are used
2. **Deployment keys** — `RECAPTCHA_SECRET_KEY` env var (from SSM, injected by CDK at deploy time)
3. **None** — local dev only; verification skipped

Deployment-level protection is mandatory. Tenants can override with their own keys or adjust the score threshold, but cannot disable.

Protected public endpoints: `POST /contact`, `POST /leads`, `POST /public/forms/{slug}/submit`, `POST /public/orders`, `POST /coupons/validate`.

Logs include `[deployment]` or `[tenant]` tag for tracing which key source was used.

## DynamoDB Single-Table Design

All entities in one table. Partition key `PK`, sort key `SK`.

| Entity | PK | SK Pattern |
|--------|----|-----------|
| Tenant config | `SYSTEM` | `TENANT#<id>` |
| Content (latest) | `TENANT#<id>` | `CONTENT#<nodeId>#LATEST` |
| Content (version) | `TENANT#<id>` | `CONTENT#<nodeId>#v<N>` |
| Route | `TENANT#<id>` | `ROUTE#<slug>` |
| Product | `TENANT#<id>` | `PRODUCT#<productId>` |
| Comment | `TENANT#<id>` | `COMMENT#<pageId>#<timestamp>` |
| Lead | `TENANT#<id>` | `LEAD#<email>` |
| Context | `TENANT#<id>` | `CONTEXT#<id>` |
| Asset | `TENANT#<id>` | `ASSET#<assetId>` |
| Resource | `TENANT#<id>` | `RESOURCE#<resourceId>` |
| Audit log | `TENANT#<id>` | `AUDIT#<timestamp>#<id>` |
| Signal | `TENANT#<id>` | `SIGNAL#<signalId>` |
| Consent | `TENANT#<id>` | `CONSENT#<visitorId>#<timestamp>` |

**GSIs:** GSI_Domain (lookup tenant by domain), GSI_Type (list by entity type), GSI_Status (workflow queries)

## Key Patterns

- **Content versioning:** Update writes a snapshot at `CONTENT#<nodeId>#v<N>` before overwriting `#LATEST` with `v<N+1>`
- **Slug redirects:** When a slug changes, old route gets `IsRedirect=true` pointing to new slug (SEO preservation)
- **Transactional writes:** `TransactWriteCommand` for multi-item consistency (content + route creation)
- **Conditional writes:** `ConditionExpression="attribute_not_exists(SK)"` prevents duplicate slugs/IDs
- **Audit trail:** Handlers call `publishAudit()` → EventBridge → `audit/worker.ts` → DynamoDB. Non-blocking.
- **Presigned S3 URLs:** Assets get 5-min upload URLs. Resources get 15-min download URLs. Paddle fulfillment gets 24-hour URLs.
- **Lead upsert:** Leads keyed by email — PUT overwrites, so re-submissions update rather than duplicate
- **Pagination:** Manual loop with `LastEvaluatedKey`, safety cap at 20 iterations

## Response Format

```typescript
// Success
{ statusCode: 200 | 201, body: JSON.stringify({ ...data }) }

// Error
{ statusCode: 400 | 403 | 404 | 409 | 500, body: JSON.stringify({ error: "message" }) }
```

## Testing

Two suites with two configs. They are separate because one needs AWS and the other must not.

### Integration — `test/*.test.ts`, config `vitest.config.ts`

Vitest against **real staging DynamoDB** (table from `.env.test`, loaded by `test/setup.ts`,
which throws if `TABLE_NAME` is unset). These tests create and delete real items — do not run
them when the staging table matters. Test utilities in `test/utils.ts`:
- `createEvent(tenantId, body?, pathParams?, queryParams?, userId?, role?, email?)` — builds API Gateway V2 event
- `generateTenantId()` — creates unique `test-<timestamp>-<random>` IDs
- `cleanupTenant(tenantId)` — deletes all items for tenant in batches of 25

Run: `cd backend && npm test` or `npx vitest run <path>` for a single file.

### Pure unit — `test/unit/**/*.test.ts`, config `vitest.unit.config.ts`

No `setupFiles`, so no `.env.test`, no credentials, no real AWS calls of any kind. Two shapes of
test live here, both credential-free:

1. **Pure modules — imported and called directly, no mocks.** A module qualifies when it imports
   neither `lib/db.ts` nor an AWS SDK client. Today: `lib/revalidate-paths.ts` (the ISR purge-path
   rule, `cache-2`) and `lib/edge-invalidation.ts` (the fast-lane coalescing rule, `cache-4a` —
   dedupe + the `/*` collapse over 30 distinct paths). These exist partly *as* pure test seams,
   extracted from AWS-touching callers precisely so the rule can be pinned here.

2. **AWS-boundary modules — the SDK/`db` boundary is mocked at module load (`vi.mock`), so no
   credentials and no network.** This is how `cache-4a`'s stateful invalidation logic is covered
   without staging: `test/unit/debounce-flush.test.ts` mocks `@aws-sdk/client-cloudfront`,
   `@aws-sdk/client-dynamodb`, and `@aws-sdk/lib-dynamodb` with a stateful in-memory store that
   honours the two update expressions the drain issues (`ADD ... #rev`, conditional `DELETE`),
   and `test/unit/invalidate-cdn.test.ts` mocks `lib/db.ts` to prove `enqueueEdgeInvalidation()`
   merges the path String Set and bumps `rev` in ONE atomic `UpdateCommand`. Reach for this shape
   only when the logic under test is genuinely control-flow/expression correctness (marker
   retention, generation-safe cleanup, atomicity) that a pure extraction cannot capture — the
   mock must model only the SDK contract the code depends on, nothing more. `debounce-flush.test.ts`
   additionally uses `vi.useFakeTimers()` + a `runHandler()` helper (`vi.runAllTimersAsync`) to
   fast-forward the drain Lambda's 6-iteration / 5×10s-sleep polling loop in microseconds: the
   handler no longer returns early (it must keep draining the fast lane the whole window — `cache-4a`
   review-3), so the sleeps have to be driven by fake timers rather than waited out.

Run: `cd backend && npm run test:unit`.
