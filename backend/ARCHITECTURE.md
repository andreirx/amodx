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
│   ├── image-upload.ts    # Copy a remote image into tenant media (S3 `<tenantId>/<assetId><ext>` + ASSET# item,
│   │                      #   `uploadedBy` = the caller). CAT-IMAGES-1 destination policy (fetchImage), per hop
│   │                      #   BEFORE any byte is sent: http/https only; ALL resolved addresses checked, any
│   │                      #   loopback / RFC 1918 / link-local / CGNAT / ULA / IPv6 link-local / unspecified /
│   │                      #   IPv4-mapped-to-those → refused; connection to the checked address (host name kept
│   │                      #   for SNI + certificate check); redirects by hand, ≤ 3; one 8 s deadline (all hops +
│   │                      #   body); 10 MiB cap; magic bytes jpeg/png/webp decide the stored type. One TLS
│   │                      #   exception: the coreapi.boen.com expired-certificate pin (CIM-A1-2). Users:
│   │                      #   import/media, import/wordpress (downloadAndUploadImage, throws), import/glam-images
│   │                      #   (copyImageToTenantMedia, result sum type). GIF/SVG sources are now refused.
│   ├── catalog-product.ts # CATALOG-MODE-1 product write boundary: readTenantMode() (ConsistentRead tenant mode,
│   │                      #   null = missing → caller answers 404), checkProductWrite() (PURE: catalog tenant →
│   │                      #   refuse price/salePrice/volumePricing/priceOverride/personalizations; other tenants →
│   │                      #   price + imageLink required; importSource products → one variant group, unique
│   │                      #   labels, derived imageLink/additionalImageLinks). Users: products/create, update,
│   │                      #   import/woocommerce (mode read only), import/glam-pricelist (both);
│   │                      #   withDerivedGallery() (the § 3.4 rule) exported for import/glam-images (CAT-IMAGES-1)
│   ├── catprod.ts         # CATPROD#<categoryId>#<productId> projections (the card fields). writeCatProductItems /
│   │                      #   deleteCatProductItems (BatchWrite, responses discarded) and queryCatProducts (one
│   │                      #   page) as before; CAT-IMPORT-1 adds listCatProductIds (complete, ConsistentRead) and
│   │                      #   writeCategoryProjections (one category, UnprocessedItems resent ≤ 5×, returns the
│   │                      #   count left) — used only by the glam importer's reconciliation
│   ├── events.ts          # EventBridge publishAudit() helper
│   ├── recaptcha.ts       # reCAPTCHA v3: resolveRecaptchaConfig() + verifyRecaptcha()
│   ├── invalidate-cdn.ts  # Two invalidation classes (cache-4a): withInvalidation() HOF → bulk `/*`
│   │                      #   debounce marker; enqueueEdgeInvalidation() → ordinary edits' targeted
│   │                      #   fast-lane paths (String Set + `rev`) drained by the debounce Lambda;
│   │                      #   markCdnPending() exported since CACHE-10 (ordinary edits arm `/*` for listings)
│   ├── edge-invalidation.ts # PURE: fast-lane coalescing — dedupe changed paths, /* over 30 distinct
│   │                        #   (FAST_LANE_WILDCARD_THRESHOLD). Test seam, like revalidate-paths.ts.
│   │                        #   CACHE-10: bulkFlushDueAt() — bulk `/*` due = min(quiet, max wait)
│   ├── revalidate.ts      # Drives BOTH layers (cache-4a): revalidateTenantPaths() → ISR purge (Layer 2)
│   │                      #   via the /api/revalidate transport FIRST, then the edge fast lane, then
│   │                      #   markCdnPending() → debounced `/*` for listings (CACHE-10)
│   ├── revalidate-paths.ts # PURE: tenant routing + slugs → the domain-keyed paths to purge (unit-tested)
│   └── review-media.ts     # rev-2a staged-media SPINE (no image decode; D-REV-4 SUPERSEDED): declared
│                           #   type-AND-size STAGE to the private quarantine + PROMOTION gate
│                           #   (both-approvals → copy the staged ORIGINAL to public, Asset record) +
│                           #   rollback. Human moderation, not a byte-screen, is the content control.
├── auth/
│   ├── authorizer.ts      # Lambda authorizer (API keys incl. service keys, Cognito JWT)
│   ├── context.ts         # AuthorizerContext type definition
│   └── policy.ts          # requireRole(auth, roles[], tenantId?, serviceScope?) + SERVICE_ROUTE_SCOPES
├── email/                 # slice email-2 — guided DNS read-only checker (NO DNS writes, NO SES)
│   ├── dns-check.ts       # POST /email/dns-check {provider} — the I/O EDGE. Derives the domain
│   │                      #   from the tenant record (GetCommand only; never the body — §4.3
│   │                      #   cross-tenant-leak rule), resolves each CHECKABLE recipe row in
│   │                      #   PUBLIC DNS (1.1.1.1/8.8.8.8), returns per-row {expected, observed,
│   │                      #   status, observedTtl, recordIndex}. `derive` rows get their expected
│   │                      #   value from shared/deriveEmailDnsValue; checkable:false rows are never
│   │                      #   queried. Read-only: writes nothing to DNS or DynamoDB.
│   └── dns-map.ts         # PURE mapper SEAM (no network/AWS/clock): (expected, observed, priority,
│                          #   lookupError) → {status, detail}. Owns the propagation-AMBIGUITY
│                          #   labelling (missing/error are never verdicts) and MX-priority
│                          #   comparison (wrong priority = mismatch). Unit-tested standalone.
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
│   │                      #   business (site-scope) reviews are visible for moderation (rev-2b).
│   │                      #   rev-3: projection additively includes `images` (per-image tiles) and
│   │                      #   `importBatchId` (batch filter) for the moderation UI.
│   ├── update.ts          # PUT /reviews/{id} + GET /reviews/{id}/image-view-url — ONE Lambda,
│   │                      #   dispatched on HTTP method. PUT carries THREE actions on one contract:
│   │                      #     • default (no `action`) = allow-listed field update
│   │                      #       (status/content/authorName/rating);
│   │                      #     • `action:"approve-image"` (rev-2a) = per-image approval that TRIGGERS
│   │                      #       staged-media promotion (private→public), approval DERIVED FROM THE
│   │                      #       ROW, never the body;
│   │                      #     • `action:"hide-image"` (rev-3, REV3-IMG-HIDE = B) = PURE per-image
│   │                      #       status flip → `hidden`. No promotion/S3/assetKey rewrite; for an
│   │                      #       already-promoted image, public-list simply stops emitting it.
│   │                      #   All actions route no-productId reviews to the SITEREVIEW# key.
│   │                      #   GET image-view-url (rev-3 moderator VIEW): mints a short-lived (300s)
│   │                      #   presigned GET on the PRIVATE staged original of a PENDING image (that
│   │                      #   object is not public until promoted), or returns the public CDN URL once
│   │                      #   approved. Follows resources/presign.ts; rides this SAME Lambda (already
│   │                      #   holds PRIVATE_BUCKET + s3:GetObject on review-staging/* + UPLOADS_CDN_URL
│   │                      #   from rev-2a wiring), so ZERO new grants. Routed on GET precisely so it
│   │                      #   BYPASSES withInvalidation — a read must not mark the CDN pending or raise
│   │                      #   the GO-LIVE banner.
│   ├── delete.ts          # DELETE /reviews/{id} (no productId → SITEREVIEW# key)
│   └── public-list.ts     # GET /public/reviews/{productId} — approved product reviews only. rev-3
│                          #   deep-vertical: projects `images`, exposing ONLY approved + non-staging
│                          #   (public-key) photos, so a private quarantine key can never leak into the
│                          #   public payload. A public site-review render surface is rev-4 gallery,
│                          #   not built here.
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
├── interest/
│   └── public.ts          # CAT-INTEREST-1: the interest list's two PUBLIC routes, one Lambda (dispatch on routeKey).
│                          #   POST /public/interest — a catalog visitor's shortlist as ONE submission of the system
│                          #   form `interest-list` (FORMSUB#interest-list#<sha256(token)>). Origin + reCAPTCHA as
│                          #   forms/public-submit; the shared InterestSubmissionSchema; readTenantMode (404 / 403
│                          #   non-catalog); then a REPLAY check (record for the token → 200 "already-recorded" from
│                          #   that record, before any catalogue read); items deduped by (productId, option), read by
│                          #   a consistent chunked BatchGet (UnprocessedKeys ≤ 3 retries → 503, nothing written);
│                          #   title/slug/option/image recorded from that read; conditional Puts. Mail to
│                          #   integrations.contactEmail only (none → logged, no fallback).
│                          #   POST /public/interest/resolve — the list page's identity read: the same BatchGet,
│                          #   per id active {title, slug, imageLink, collection (attribute `colecție`), optionValues}
│                          #   | not-available (no fields) | absent; incomplete → 503. No reCAPTCHA (public fields).
│                          #   forms/update + forms/delete refuse `interest-list` (409); forms/list omits it
├── context/
│   ├── create.ts          # POST /context
│   ├── list.ts            # GET /context
│   ├── get.ts             # GET /context/{id}
│   ├── update.ts          # PUT /context/{id}
│   └── delete.ts          # DELETE /context/{id}
├── tenant/
│   ├── create.ts          # POST /tenant (Global Admin only); CATALOG-MODE-1: the ONLY place `catalogMode` is set
│   ├── list.ts            # GET /tenant (projects commerceEnabled + catalogMode for the admin)
│   └── settings.ts        # GET/PUT /tenant/settings; PUT: ConsistentRead, 404 on a missing tenant record, and
│                          #   a narrow parse of { commerceEnabled, catalogMode } on the merged item (mode change
│                          #   → 400; commerce on a catalog site → 400) — never a full TenantConfigSchema parse
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
    ├── wordpress.ts       # WordPress XML import handler (featured-image copy under the image destination policy;
    │                      #   unreachable today: wxr-parser.ts never sets featuredImage)
    ├── wxr-parser.ts      # WXR XML parser utility
    ├── html-to-tiptap.ts  # HTML → Tiptap JSON converter
    ├── woocommerce.ts     # POST /import/woocommerce — product CSV import; refuses a catalog tenant (403) and
    │                      #   a missing tenant (404) before the first write (CATALOG-MODE-1, CM-D8 guard 1)
    ├── glam-pricelist.ts  # POST /import/glam-pricelist[?dryRun=1] (CAT-IMPORT-1) — one glam enriched pricelist
    │                      #   CSV → one product per style (its rows = options of one variant group), REPLACING
    │                      #   the products carrying the sheet's importSource. Body must be a JSON object. Catalog
    │                      #   tenants only (404/403 via a ConsistentRead before the lock); categories matched by
    │                      #   slug (CATEGORY#<slug> with its stored slug checked, then GSI_Slug, every page) — an
    │                      #   occupied CATEGORY#<slug> (renamed category) → 409 before any deletion, decided under
    │                      #   the lock (every read that decides a write is made while the lock is held; only the
    │                      #   tenant mode is read before it), reported by the dry run; per-tenant lock
    │                      #   TENANT#<t>/IMPORTLOCK#glam (owner token, conditional put, 15-min expiry +
    │                      #   conditional takeover, owner-only release in finally, only if acquired;
    │                      #   contender → 409); previous set = consistent PRODUCT# query selected in code; delete →
    │                      #   create absent categories (attribute_not_exists, never deleted) → create → reconcile
    │                      #   every touched category (503 + incompleteCategories when the retry bound is
    │                      #   exhausted). Any failure → 500 naming the step. Dry run writes nothing (not even the
    │                      #   CDN marker). Scope catalog:write. The same function serves
    │                      #   POST /import/glam-pricelist/images: `handler` dispatches on routeKey (exhaustive).
    │                      #   CAT-IMPORT-PROFILE-1A: the producer's import profile, TENANT#<t>/IMPORTPROFILE#glam#
    │                      #   <norm(producer)> (revision; written ONLY by an execution, under the lock, conditioned
    │                      #   on the observed revision, BEFORE the mutation phase — step `profile`); optional body
    │                      #   `profileChoice { profile, baseRevision }` (400 when invalid; 409 when made against
    │                      #   another revision with other content, or when the stored profile is unsupported and
    │                      #   not replaced); read before the lock only to refuse early, re-read under the lock to
    │                      #   decide; every product of a profiled import stamped `importProfileRevision` (+
    │                      #   `facetModes` when not empty). Response members `profile`, `sheets` (per-sheet
    │                      #   no-profile/current/stale/mixed), `specLineRefusals` (profiled only); dry run also
    │                      #   `specKeys`, `drafts` (the execution's productItem), `siteProducts`. With no stored
    │                      #   profile and no non-default choice, every write equals the base capture (golden test).
    │                      #   CAT-IMAGE-GATE-1: every product is written `draft` (hidden) unless the profile says
    │                      #   `publishWithoutImages: true` (`glam/profile.ts` importStatus; absent ≡ false, also in
    │                      #   the "same profile" comparison); response member `publication` { status, startHidden,
    │                      #   withoutImageAddress[] } on the dry run and the execution
    ├── glam-images.ts     # POST /import/glam-pricelist/images (CAT-IMAGES-1) — body { producer, sheet }; copies the
    │                      #   sheet's producer option images into tenant media, ONE BOUNDED BATCH per request (the
    │                      #   admin page repeats until `complete`): set = PRODUCT# query selected by importSource;
    │                      #   MEDIAMAP# read once (hits = `cached`, no fetch), each copy recorded at once; no new
    │                      #   copy after 12 s, no new product update after 24 s (except the first); one UpdateCommand
    │                      #   per touched product with attribute_exists(PK) (cancelled → reported, no CATPROD#
    │                      #   write), failed sources REMOVED from their option, derived fields by § 3.4; then the
    │                      #   CATPROD# rebuild. withInvalidation. Scope catalog:write. CAT-IMAGE-GATE-1: a product
    │                      #   read as `draft` that holds a copied image after its write is published (`status =
    │                      #   active`) IN THE SAME UpdateCommand (`glam/images.ts` planProductWrite; a draft whose
    │                      #   image is already under the CDN gets a publish-only write; no other status is ever
    │                      #   changed). Write condition `attribute_exists(PK) AND #status = :read`: a cancelled
    │                      #   write re-reads (absent → replaced) and is re-planned from the fresh read (≤ 3 tries;
    │                      #   a success is never undone, so a copy-published product keeps a copied image).
    │                      #   Holdings reported = options the committed write changed. Answer adds
    │                      #   `products.published[]` and `hiddenWithoutImage[]` (draft, no copied image, no
    │                      #   producer URL left); audit `productsPublished`
    ├── glam/              # CAT-IMPORT-1 PURE core (no I/O): parse.ts (RFC 4180, misplaced quotes refused; 12
    │                      #   columns by index, a non-12-cell record refuses the file; the row type has NO field
    │                      #   for columns 2–5; columns 3–4 = prices never read; columns 2/5 = producer codes read
    │                      #   only to drop every specs line holding one as a whole token), group.ts (key
    │                      #   normalisation trim→collapse→lower→NFC, U+001F rule, styles, options merged on equal
    │                      #   label + equal image cell, collision-aware labels and slugs), map.ts (upload
    │                      #   identifier rule, importSource, GlamStyleDraft DTO, report counts; with an
    │                      #   AppliedProfile: the profile's row rules, extracted attributes, stamps, refusals);
    │                      #   profile.ts (CAT-IMPORT-PROFILE-1A: checkProfile, parseProfileChoice,
    │                      #   readStoredProfile, resolveProfile, applyProfileToRows (grouping trailing-number,
    │                      #   collection from a spec key → else the sheet name), extractAttributes (union over the
    │                      #   style's rows), guardSpecLine (value guard B1 + T3: file-wide code cells and money
    │                      #   words, unfolded AND folded by group.ts `foldTokens` = slugify∘norm, on the line and
    │                      #   each fragment it can feed), analyseSpecKeys; never sees a raw record — it gets the
    │                      #   file's code cells as parse.ts `codeCells`); images.ts
    │                      #   (CAT-IMAGES-1: sources + holders, decision per source, per-product rewrite with the
    │                      #   § 3.4 rule injected, termination measure)
    ├── media.ts           # POST /import/media — bulk media import (copies under the image destination policy;
    │                      #   a refused/failed source → errors[])
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

Checked in this order by `auth/authorizer.ts`:

1. **Master API Key** — `x-api-key` matched against Secrets Manager → `{sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL"}`
2. **Renderer API Key** — `x-api-key` matched against its own secret → `{sub: "renderer", role: "RENDERER", tenantId: "ALL"}`
3. **Service key** (SERVICE-ACCOUNT-1) — `x-api-key` starting `amx_sk_`. One consistent `GetItem` on the lookup item
   keyed by `sha256(secret)` (`lib/service-keys.ts`); absent (unknown or revoked) → deny. Then the route allowlist
   `SERVICE_ROUTE_SCOPES` (`policy.ts`: `GET /products` → `catalog:read`, `GET /leads` → `leads:read`,
   `POST /import/glam-pricelist` and `POST /import/glam-pricelist/images` → `catalog:write`): a route not in
   the table, a missing scope, or an `x-tenant-id` other than the key's tenant → deny, before any Lambda runs.
   Otherwise → `{sub: "service:<keyId>", role: "SERVICE", tenantId, scopes: "a,b", keyId}`; the first use per UTC
   day updates `lastUsedAt` and publishes `SERVICE_KEY_USED` (best effort). A service key never falls through to 4–5.
4. **Public routes** — `POST /leads`, `POST /contact`, `POST /consent` allow anonymous when no valid key was presented
5. **Cognito JWT** — `Authorization: Bearer <idToken>`: admin pool (`custom:role`, `custom:tenantId`), then public pool (role `CUSTOMER`)

Access control via `requireRole(auth, allowedRoles[], targetTenantId?, serviceScope?)` in `auth/policy.ts`.
GLOBAL_ADMIN always passes. SERVICE passes only when the handler declares `serviceScope`, the target tenant equals
the key's tenant, and the key holds the scope (`"SERVICE"` in `allowedRoles` admits nothing). Others must match both
role and tenant scope.

**Service-key storage** (`lib/service-keys.ts`, the only module that knows it): key item `TENANT#<t>` /
`SVCKEY#<keyId>` (listed by `GET /service-keys`, kept after revoke) and lookup item `SVCKEYHASH#<hash>` (both keys;
`tenantId, keyId, name, scopes, lastUsedDay`), written in one transaction. Revoke sets `revokedAt` and deletes the
lookup item in one transaction. The secret is never stored. Routes: `GET /service-keys`, `POST /service-keys`,
`POST /service-keys/{id}/revoke` (`service-keys/`, TENANT_ADMIN / GLOBAL_ADMIN).

### reCAPTCHA v3 (Bot Protection on Public Routes)

Public endpoints are unauthenticated but protected by reCAPTCHA v3. The `resolveRecaptchaConfig()` function in `lib/recaptcha.ts` implements a two-tier resolution:

1. **Tenant keys** — if tenant provides own `siteKey` + `secretKey` in Settings, those are used
2. **Deployment keys** — `RECAPTCHA_SECRET_KEY` env var (from SSM, injected by CDK at deploy time)
3. **None** — local dev only; verification skipped

Deployment-level protection is mandatory. Tenants can override with their own keys or adjust the score threshold, but cannot disable.

Protected public endpoints: `POST /contact`, `POST /leads`, `POST /public/forms/{slug}/submit`, `POST /public/interest`, `POST /public/orders`, `POST /coupons/validate`.

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
- **Tenant mode (CATALOG-MODE-1):** `catalogMode` is fixed at `POST /tenants` (CM-D11) and read through
  `isCatalogMode()` (`@amodx/shared`). A catalog tenant stores no monetary field on any product (refused, 400, at
  `products/create.ts` / `update.ts` via `lib/catalog-product.ts`; WooCommerce import refused, 403); a non-catalog
  tenant must send `price` and `imageLink`. `POST /public/orders` refuses (403) every tenant whose `commerceEnabled`
  is not `true`, before reCAPTCHA and any product read. Five mode-enforcing reads are `ConsistentRead` and answer
  404 on a missing tenant record, with nothing written: `tenant/settings.ts` (PUT), `products/create.ts`,
  `products/update.ts`, `import/woocommerce.ts`, `import/glam-pricelist.ts` (which also answers 403 for a
  non-catalog tenant — it imports into catalog sites only). Exception, by design (spec `catalog-mode-1.md` § 3.1): the order
  handler `orders/create.ts` keeps its eventually consistent read; a missing record maps to `{}`, which the CM-D6
  guard refuses with 403 (fail closed). `products/update.ts` writes with `attribute_exists(PK)` (a product deleted meanwhile →
  404, no `CATPROD#` rebuild), reads `imageLink: null` as "remove the image", and both product routes strip
  `importSource` (importer-owned) and answer an invalid body with 400 (was 500)

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
   rule, `cache-2`), `lib/edge-invalidation.ts` (the fast-lane coalescing rule, `cache-4a` —
   dedupe + the `/*` collapse over 30 distinct paths) and `import/glam/` (CAT-IMPORT-1 parser, grouping and
   mapper; `test/unit/glam-import-core.test.ts`, incl. the BOEN acceptance fixture; CAT-IMAGES-1 `images.ts`,
   `test/unit/glam-images-core.test.ts`; CAT-IMPORT-PROFILE-1A `profile.ts`, `test/unit/glam-profile.test.ts`,
   incl. the T3 fold corpus `fixtures/glam/cat-import-profile-1a-fold-corpus.json`). The handler's preservation
   is pinned against a golden captured from a base commit — b0a3055, re-captured from b5ef8fb with only the
   CAT-IMAGE-GATE-1 status change (`test/unit/glam-profile-golden.test.ts`, fixture
   `fixtures/glam/cat-import-profile-1-baseline.json`, capture `cat-import-profile-1-golden.capture.test.ts`). These exist partly *as* pure test seams,
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
   `test/unit/debounce-maxwait.test.ts` (CACHE-10) runs the REAL `markCdnPending()` writer and the
   REAL debounce-flush handler against one in-memory marker row under fake time (minute-by-minute
   edit streams) to pin the max-wait rule; its fake refuses any `CDN_PENDING` UpdateExpression
   other than the production one, so it cannot model semantics the real write lacks.

`test/unit/catalog-mode.test.ts` (CATALOG-MODE-1) is shape 2: the real tenant, settings, product, WooCommerce and
order handlers with `lib/db.ts`, `publishAudit`, the cache-revalidation call and the order handler's origin and
reCAPTCHA helpers mocked; each row inspects the commands that would reach DynamoDB.

Run: `cd backend && npm run test:unit`.
