# backend — ARCHITECTURE.md

## Role in the System

The API layer. All Lambda functions behind API Gateway HTTP API. Handles CRUD for every entity, authentication, authorization, audit logging, email sending, payment webhooks, and content import. The admin panel and renderer both call this backend.

**Consumed by:** admin (via HTTP), renderer (via HTTP and direct DynamoDB), mcp-server (via HTTP)
**Depends on:** packages/shared (Zod schemas, types)

## Internal Structure

```
src/
├── lib/                   # (selected modules; 20 files in total)
│   ├── db.ts              # DynamoDB DocumentClient singleton + TABLE_NAME
│   ├── scheduling-db.ts   # SCHED-1C (docs/slices/sched-1.md § 6-§ 8.4, § 13, § 14, § 23; PROTOTYPE): the ONLY code
│   │                      #   that names the scheduling-private table. Every function takes a SchedulingStore
│   │                      #   (client, table, sleep); handlers use schedulingStoreFromEnv() (SCHEDULING_TABLE_NAME,
│   │                      #   the one read). Decisions are the @amodx/shared kernel's. Reads that a write decides
│   │                      #   on are ConsistentRead; display reads (readIntervals, listRuns(…, false), getBookingViews,
│   │                      #   listResources(…, false)) are not. Each booking or container change is ONE
│   │                      #   TransactWriteItems; cancellation reasons are mapped by item position to the spec's
│   │                      #   refusal unions (Result values). Not one transaction by design: a run cancel (cancelRun
│   │                      #   = the run transaction only; then the caller's clearCancelledRunTokens = one
│   │                      #   token-cleanup transaction per held booking it cancelled, § 7.6), removeResource (fence update, check, release or delete, § 13), the per-booking
│   │                      #   transactions of cleanupExpiredHolds/eraseCustomer, and single-item writes (mail
│   │                      #   mark, WEEKMAIL# claim/sent, DAYS# Put, configuration Puts). Two version rules in one
│   │                      #   loop (`versioned`, ≤ 3 attempts, then busy): a write that reads a container's
│   │                      #   entries (RESDAY#, RUN#.seats, HOLDS#) rewrites the map under `v` without the entries
│   │                      #   its clock counts as expired (updateRun reads no seat and leaves `seats` as stored);
│   │                      #   a BOOKING# change is conditioned on `rev` and sets only the attributes it changes
│   │                      #   (+ rev, updatedAt, history with an entry). A stored item that fails its schema
│   │                      #   throws StoredDataInvalidError (500 storedDataInvalid). confirmBooking returns an
│   │                      #   explicit ConfirmOutcome (SCHED-1D2): `applied` (this call's transaction confirmed it)
│   │                      #   or `alreadyConfirmed` (no write), each with the booking — the mail owner is the
│   │                      #   `applied` caller, never inferred from a timestamp. SCHED-1E1 (operator ruling
│   │                      #   S1E1-STORE-ALLOCATION): listServices(…, consistent) as listResources (the create bound
│   │                      #   reads consistently; displays do not); replaceService = the update of an EXISTING
│   │                      #   service, one Put under attribute_exists(SK) → notFound when it is gone (a concurrent
│   │                      #   delete is never undone); putService stays for create. SCHED-1F1 (operator rulings
│   │                      #   after review-0): listCourses / listRuns take `consistent`; replaceCourse = UpdateItem of
│   │                      #   name, defaultCapacity, languages under attribute_exists(SK) (notFound when gone; the
│   │                      #   course version is not touched). S1F1-COURSE-DELETE-GUARD: COURSE#.v is raised (ADD v 1,
│   │                      #   attribute_exists) in the transaction of every write that gives a course a new
│   │                      #   dependent — createRun (≤ 13 items), createManualSeat without a run (5), moveSeat out of
│   │                      #   a run (4), cancelRun when someone is unplaced (≤ 2 + 2 × 45 + 1 = 93) — and deleteCourse
│   │                      #   = consistent course read (v) + consistent run / UNPLACED# checks + one Delete under
│   │                      #   that v (→ courseInUse | notFound | the deleted course). S1F1-CANCEL-OUTCOME (review
│   │                      #   S1F1-R02): cancelRun sends ONE transaction and returns right after its commit with
│   │                      #   { unplaced, cancelled, run (the snapshot it decided on) }; the caller records the commit
│   │                      #   (the audit), then runs clearCancelledRunTokens(ids) → { failed } (logged by id, never
│   │                      #   thrown).
│   │                      #   No Scan. Tests: test/unit/scheduling-db.test.ts (rows C1-C35 against an in-memory
│   │                      #   fake that evaluates the emitted expressions); test/scheduling-db.integration.test.ts
│   │                      #   (operator-run on the staging table: skipped without SCHEDULING_TABLE_NAME, refuses a
│   │                      #   name not ending in -staging, one random tenant per test; every concurrent group
│   │                      #   settles before the `finally` purge, and the partition is read back empty)
│   ├── scheduling-email.ts # SCHED-1D1 (sched-1.md § 11.1; PROTOTYPE): the seven scheduling mails — keys, English
│   │                      #   defaults (defaultSchedulingTemplates), the tenant override rule (resolveTemplate: an
│   │                      #   override replaces subject and body; an absent sendTo… flag keeps the default's),
│   │                      #   storedOverrides (a stored schedulingEmailConfig that fails its schema → null → 500
│   │                      #   storedDataInvalid, never "no override"), rendering via order-email.ts renderTemplate.
│   │                      #   Users: scheduling/admin/bookings-cancel.ts (mail `cancelled`), email-templates.ts,
│   │                      #   scheduling/visitor/mail.ts (SCHED-1D2: `hold`, `confirmed`, `cancelled`, `moved`; also
│   │                      #   used by SCHED-1E1 appt-appointments-create.ts `confirmed` and appt-move-slot.ts `moved`,
│   │                      #   and by SCHED-1F1 group-seats-create.ts `confirmed`, group-runs-move.ts and
│   │                      #   group-move-seat.ts `moved`), scheduling/admin/group-common.ts sendGroupAdminMail
│   │                      #   (SCHED-1F1: `unplaced`; `cancelled` after an admin run cancel, no owner copy),
│   │                      #   scheduling/reminders.ts (SCHED-1G1: `reminder`, `weekAhead`). whenText ({{when}}: a slot in
│   │                      #   the tenant zone, a seat at its run's first start in the RUN's zone) lives here since
│   │                      #   SCHED-1G1; admin/bookings-cancel.ts re-exports it for group-common.ts and visitor/mail.ts
│   │                      #   (their imports still point there: a recorded one-line follow-up each)
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
│   │                      #   withDerivedGallery() = the product with the gallery of @amodx/shared deriveGallery
│   │                      #   (CAT-IMPORT-GALLERY-1: each option's imageLink then its additionalImageLinks, in
│   │                      #   option order, each once — the one rule; also called by import/glam/map.ts and,
│   │                      #   through the core's `derive` port, by import/glam-images)
│   ├── catprod.ts         # CATPROD#<categoryId>#<productId> projections (the card fields). writeCatProductItems /
│   │                      #   deleteCatProductItems (BatchWrite, responses discarded) and queryCatProducts (one
│   │                      #   page) as before; CAT-IMPORT-1 adds listCatProductIds (complete, ConsistentRead) and
│   │                      #   writeCategoryProjections (one category, UnprocessedItems resent ≤ 5×, returns the
│   │                      #   count left) — used only by the glam importer's reconciliation
│   ├── events.ts          # EventBridge publishAudit() helper
│   ├── recaptcha.ts       # reCAPTCHA v3: resolveRecaptchaConfig() + verifyRecaptcha() (a success answer without a
│   │                      #   finite numeric score, or an answer that is not an object → refusal; PUBLIC-HARDEN-1)
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
│   │                      #   BULK-PURGE-FOOTER-1: purgeStoredPagesOf{RequestTenant,Tenant,Domains}() — whole-tenant
│   │                      #   S3 purge for bulk handlers, passed to withInvalidation(h, purge) (purge, then marker)
│   ├── revalidate-paths.ts # PURE: tenant routing + slugs → the domain-keyed paths to purge (unit-tested)
│   ├── slug-guard.ts      # reservedAddressRefusal(): refuses a content slug equal to, or under, an address the renderer
│   │                      #   serves before content (CDL-2, design catalog-data-labels-1 § 14 item 1): cart, checkout, shop,
│   │                      #   product, category, account, search on every site; interest on a catalog site only
│   │                      #   (isCatalogMode). One GetCommand (urlPrefixes, catalogMode); prefixes via urlPrefixesOf.
│   │                      #   The message names the page the renderer shows at the slug (builtInPageAt: a COPY of the
│   │                      #   renderer's precedence, pinned by the same overlap table in a renderer unit test); else the
│   │                      #   first reserved address in that precedence. Returns the refusal text, or null if the slug is
│   │                      #   free (renamed in SMALL-FIXES-1, F-CDL2-GUARD-NAME). Unit: test/unit/cdl-2-paths.test.ts
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
│   ├── create.ts          # POST /content. LANG-1A: `translationOf` → the link transaction (planTranslation)
│   ├── list.ts            # GET /content. LANG-1A: projects translationKey; a page that holds a key also gets
│   │                      #   hasTranslationItem (its TRANSLATION#<key>#<nodeId> exists) — one paginated Query of
│   │                      #   the tenant's TRANSLATION# items, sent only when some page holds a key
│   ├── get.ts             # GET /content/{id}
│   ├── update.ts          # PUT /content/{id}. LANG-1A (docs/slices/lang-1.md § 5.2, § 6.3; PROTOTYPE): also the
│   │                      #   translation-set logic `planTranslation` (C2 400, C3 409 read-then-write, no-op,
│   │                      #   join / leave / move) used by create.ts; one transaction, one action per item, each
│   │                      #   page action conditioned on the key as read; a cancelled set write → 409. Returns a
│   │                      #   Result (ok:false = refusal); every decision on TranslationPlan is a switch whose arms
│   │                      #   all return (membershipActionsOf, changesSet, keyAfter): a new variant does not compile
│   │                      #   LANG-1C (§ 9.3): `setPurgeSlugs` — create and update of a page that holds a set key as
│   │                      #   read OR as written also purge every other member's slug of each named set, `/` when
│   │                      #   homePageSlug is the page's slug (read or written) or a member's (the root renders it),
│   │                      #   and /sitemap.xml (strongly consistent set reads after the write; a failed read is
│   │                      #   logged, what it would add skipped). No key before or after → today's targets, no read
│   │                      #   (test/unit/lang-1c-purge.test.ts, row L1C-PURGE-SIBLINGS-SITEMAP)
│   ├── history.ts         # GET /content/{id}/versions
│   └── restore.ts         # POST /content/{id}/restore. LANG-1A: a page with a key keeps its current slug and key
│                          #   (Put conditioned on both → 409 on a concurrent rename); a keyless page restores as
│                          #   before (no key copied; condition attribute_not_exists(translationKey))
├── products/
│   ├── create.ts          # POST /products
│   ├── list.ts            # GET /products
│   ├── get.ts             # GET /products/{id}
│   ├── update.ts          # PUT /products/{id}
│   └── delete.ts          # DELETE /products/{id}
├── categories/
│   ├── create.ts          # POST /categories (CategorySchema.omit; `blocks` stored when sent)
│   ├── update.ts          # PUT /categories/{id}: Get + merge over the stored item + Put — a body without
│   │                      #   `blocks` keeps them (CATEGORY-CONTENT-1); purges the category page
│   │                      #   (revalidateTenantPaths "category", old + new slug)
│   │                      #   Both (SMALL-FIXES-1 A): malformed JSON → 400 "Invalid JSON"; a schema refusal → 400
│   │                      #   "Validation failed" + zod issues; no write, no purge (content/create.ts shape)
│   ├── get.ts             # GET /categories/{id} — the whole item, `blocks` included (the admin editor)
│   ├── list.ts            # GET /categories, public-list.ts GET /public/categories — Projection without
│   │                      #   `blocks`, every page followed (the 1 MB page limit counts the stored item)
│   ├── public-get.ts      # GET /public/categories/{slug} (GSI_Slug) — one category + its products
│   └── delete.ts          # DELETE /categories/{id}
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
├── forms/
│   ├── create/list/get/update/delete.ts, submissions.ts   # admin forms (FORM#<id> + FORMSLUG#<slug> pointer)
│   └── public-submit.ts   # POST /public/forms/{slug}/submit (public): origin check, then the body parsed once (not a
│                          #   JSON object → 400), reCAPTCHA, the form read under TENANT#<verified tenant> (FORMSLUG#
│                          #   → FORM#; 404 / disabled 403). SHOP-LOOK-1E: `data` read BY FIELD LABEL for exactly the
│                          #   stored form's fields (FormFieldSchema-valid, first field of each label); per type cleaned
│                          #   (strings trimmed, ≤ 500 / textarea ≤ 5 000; number finite or "", as text ≤ 500 — FORM-SUBMIT-2;
│                          #   checkbox boolean;
│                          #   select "" or an option) — wrong type / option 400 "Invalid value", too long 400 "Value
│                          #   too long", bad email 400 "Invalid email format", blank required 400 "Missing required
│                          #   fields", each with the labels; submitter email = body.submitterEmail else the first
│                          #   email field (CR/LF removed, pattern checked). Stores and mails only the cleaned values
│                          #   (mail value CR/LF → space). FORM-SUBMIT-2: a refusal is a separate result variant (a
│                          #   value "invalid" / "too-long" is stored); an exception (DynamoDB, reCAPTCHA fetch) →
│                          #   console.error, 500 "Internal error" — its text never goes to the caller (a mail
│                          #   failure stays logged only, 201). Unit: test/unit/forms-public-submit.test.ts
├── interest/
│   └── public.ts          # CAT-INTEREST-1: the interest list's two PUBLIC routes, one Lambda (dispatch on routeKey).
│                          #   POST /public/interest — a catalog visitor's shortlist as ONE submission of the system
│                          #   form `interest-list` (FORMSUB#interest-list#<sha256(token)>). Origin + reCAPTCHA as
│                          #   forms/public-submit; the shared InterestSubmissionSchema; readTenantMode (404 / 403
│                          #   non-catalog); then a REPLAY check (record for the token → 200 "already-recorded" from
│                          #   that record, before any catalogue read); items deduped by (productId, option), read by
│                          #   a consistent chunked BatchGet (UnprocessedKeys ≤ 3 retries → 503, nothing written);
│                          #   title/slug/option/image recorded from that read; conditional Puts. Mail to
│                          #   interestListEmail, else integrations.contactEmail (CAT-QUOTE-1; neither → logged,
│                          #   no fallback; the same mail either way). CDL-1: the mail's subject and lines are in
│                          #   the site language with the owner's Labels overrides (shared catalogServerTexts);
│                          #   the stored system form and each record's formName hold English admin constants.
│                          #   POST /public/interest/resolve — the list page's identity read: the same BatchGet,
│                          #   per id active {title, slug, imageLink, collection (the attribute keyed by the
│                          #   product's `importLabels.collection`; no or a malformed marker → `colecție`, CDL-1), optionValues}
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
│   ├── list.ts            # GET /tenants (projects commerceEnabled + catalogMode + schedulingEnabled for the admin;
│                          #   SCHED-MENU-1: schedulingEnabled is true only for stored boolean true, else false,
│                          #   in both role branches; the global Query projects only the response metadata)
│   └── settings.ts        # GET/PUT /tenant/settings; PUT: ConsistentRead, 404 on a missing tenant record, and
│                          #   a narrow parse of { commerceEnabled, catalogMode } on the merged item (mode change
│                          #   → 400; commerce on a catalog site → 400) — never a full TenantConfigSchema parse.
│                          #   LOCALE-1A: when the body holds `siteStrings`/`catalogStrings`, the limits of
│                          #   docs/slices/locale-1.md § 4.4 on that attribute as sent (a JSON object of texts; keys
│                          #   ^[A-Za-z][A-Za-z0-9]{0,63}$; ≤ 200 entries; values ≤ 500 UTF-16 units; ≤ 32 768 UTF-8
│                          #   bytes as JSON; `siteStrings` without the nine cookie/legal keys) → 400 before any read.
│                          #   commerceStrings, gdpr, legalLinks stay unvalidated (test/unit/locale-settings.test.ts)
│                          #   SCHED-LABELS-1: `bookingStrings` (booking-page texts) gets the same limits + its own
│                          #   rule: a booking key's value is a text; a non-empty one keeps exactly the {placeholders}
│                          #   of the key's English standard text (400 names the key and the missing/unknown one);
│                          #   "" and unknown keys pass (test/unit/sched-labels-1-settings.test.ts)
│                          #   CAT-QUOTE-1: `contactChannels` (shared ContactChannelsSchema) and `interestListEmail`
│                          #   (an e-mail, or null) checked as sent, same place → 400 naming the field before any
│                          #   read (test/unit/cat-quote-settings.test.ts). BOUNDARY CONVENTION, this request field
│                          #   only (ruling CQ-INTEREST-EMAIL-CLEAR = A): `interestListEmail: null` REMOVES the stored
│                          #   attribute (the merge cannot remove an omitted one; no general removal mechanism exists,
│                          #   F-CQ-5); the stored shape stays an optional e-mail string. `contactChannels: {}` clears.
│                          #   CAT-THEME-1: `themeAttributesError` — on `theme`/`darkTheme` (an object, or a JSON string
│                          #   parsed for the check only and stored as sent; a non-object string is not checked) the eight
│                          #   NEW fields only (shared ThemeSchema.pick: fontNav, fontWeights 100–900, headingWeight,
│                          #   mutedColor/borderColor = shared colour grammar isCssColor, shape, cardImage, cardCategoryLine; older
│                          #   theme fields stay unvalidated), and `footer` (FooterConfigSchema, strict) → 400 naming
│                          #   the field before any read (test/unit/cat-theme-settings.test.ts). HEADER-COLOURS-1: on
│                          #   an object `header`, the keys added since that slice only (HeaderCheckedKeysSchema =
│                          #   HeaderConfigSchema.pick backgroundColor, textColor = isCssColor; SHOP-LOOK-1A: + tagline
│                          #   ≤ 60, categoryBarIds ≤ 12 non-empty ids); other header keys and a non-object header: as
│                          #   before. SHOP-LOOK-1A: footer.brandText ≤ 400 and footer.columns (≤ 4, strict, ≤ 12
│                          #   links) via FooterConfigSchema (test/unit/shop-look-1a-settings.test.ts).
│                          #   SCHED-1D1 (sched-1.md § 4.1, § 6.5 point 4): `schedulingEnabled` (boolean), `scheduling`
│                          #   (shared SchedulingSettingsSchema, strict: § 4.5 ranges, IANA time zone) and
│                          #   `schedulingEmailConfig` (SchedulingEmailConfigSchema, strict: the seven keys, subject +
│                          #   body) checked as sent, same place → 400 naming the field; stored as sent. On the merged
│                          #   record: schedulingEnabled true without scheduling.timezone → 400. A body that names any of
│                          #   the three omits `ip` from the UPDATE_SETTINGS event (whole event, also for a mixed body);
│                          #   other bodies send `ip` as before (test/unit/scheduling-settings.test.ts, rows D13/D14/D17).
│                          #   LANG-1A (lang-1.md § 5.2): shared `languageSettingsProblem` (V1-V6) on the MERGED record
│                          #   → 400 naming the field (`languages`, `navLinksByLang`, `footerLinksByLang`,
│                          #   `homePageSlug`); a record without the language fields checks nothing; a language-list
│                          #   change writes no page or membership item (test/unit/lang-1a-settings.test.ts).
├── scheduling/
│   ├── common.ts          # SCHED-1D2 (moved from admin/common.ts, behaviour unchanged): the plumbing of BOTH route
│   │                      #   families — answer/refusal (`{ error, code, ...context }`), parseBody/parseValue/pathParam
│   │                      #   (400 invalid with issue paths, never values), guarded (StoredDataInvalidError → 500
│   │                      #   storedDataInvalid logged by key; any other error → 500 internal logged by its NAME only),
│   │                      #   readTenantRecord / readSchedulingTenant (+ SCHED-1D2 fields: enabled = schedulingEnabled
│   │                      #   === true, recaptcha as stored, contactEmail). Used through admin/common.ts adminRoute and
│   │                      #   visitor/common.ts visitorRoute.
│   ├── reminders.ts       # SCHED-1G1 (sched-1.md § 11.3, § 11.4, § 14.1; PROTOTYPE): the ONE scheduled job (rule
│   │                      #   rate(15 minutes); SchedulingJobFunc in infra/lib/api-scheduling.ts, ADMIN_URL = the parent's
│   │                      #   AdminUrl output value, row G16). handler(event)
│   │                      #   → runSchedulingJobs({ scheduledAt = event.time, now = Date.now() }). Tenants: AP12, one
│   │                      #   main-table Query PK=SYSTEM begins_with TENANT# with a projection (no scan). Per tenant,
│   │                      #   each job in its own try/catch (logs: tenant id + error NAME): (1) cleanupExpiredHolds on
│   │                      #   the run scheduled 03:00-03:14 UTC, for EVERY tenant whatever schedulingEnabled; (2)
│   │                      #   reminders (switch on, reminderHours > 0): AP3 readIntervals per resource + AP6
│   │                      #   runsNotEndedBy, confirmed only, start in [now, now + reminderHours] → markReminder (stale
│   │                      #   guard) → mintToken (new token per mail) → mail built from the booking as saved; one check
│   │                      #   after the mint (slot: still starts at S; seat: same course and run — NOT the run's start:
│   │                      #   a run moved between mark and send is reminded with the earlier start, its `moved` mail
│   │                      #   carries the new time, limit S1G1-R04); (3) the Sunday planner mail (switch on, weekMailDue
│   │                      #   due, weekAhead sendToAdmin, contactEmail, ≥ 1 resource with weekly hours) → claimWeekMail →
│   │                      #   planDay per resource and local day (weekSummary, counts only, no BOOKING# read) → SES →
│   │                      #   markWeekMailSent only after SES accepted (SCHED-WEEKMAIL-DELIVERY = B). One summary line per
│   │                      #   run: `[scheduling] job summary {…}` (counts only). Limits: a committed mark stays when a later
│   │                      #   step fails (that reminder is lost); a weekly mail can be sent twice after an uncertain
│   │                      #   result. Two runs at once (nothing prevents it): reminders one per start (conditional mark),
│   │                      #   cleanup idempotent, weekly mail possibly twice. Weekly default text = § 11.4 (corrected in
│   │                      #   SCHED-1G1). Tests: test/unit/scheduling-reminders.test.ts (G10, G14, G15, G17, C29 tenant part,
│   │                      #   the cadence proof, isolation)
│   ├── visitor/           # SCHED-1D2 (sched-1.md § 10.2, § 7.2, § 8, § 9, § 16.3; PROTOTYPE): the visitor routes, in
│   │                      #   the SchedulingApi nested stack; renderer-proxied (the hosted pages are sched-1g). Every
│   │                      #   handler goes through common.ts visitorRoute: x-tenant-id (the tenant the renderer derived
│   │                      #   from the URL); requireRole(["RENDERER"]) WITHOUT a target tenant (the renderer key is
│   │                      #   tenantId "ALL"; GLOBAL_ADMIN passes first; every other role → 403 forbidden; no
│   │                      #   credential never reaches a handler: the authorizer refuses it); switch off or no tenant
│   │                      #   record → 403 notAvailable, decided on the RAW record before any stored setting is parsed
│   │                      #   (../common.ts parseSchedulingTenant comes after); enabled without a stored time zone →
│   │                      #   500 storedDataInvalid. Reads that decide whether a write runs are consistent (token,
│   │                      #   booking, course, run, move target); answers and mails use placeFor (the place of the
│   │                      #   EXACT booking described; a known place only for the same course+run).
│   │                      #   offer, slots, runs (GET; § 16.3 class 1: derived reads, no resource id/name, no
│   │                      #   customer data — row D9; slots: the kernel's availableSlots over AVAILABILITY#+DAYS#
│   │                      #   and readIntervals, range checked by the kernel before any read, days after
│   │                      #   lastBookableDate empty and not read); holds (POST; class 2: § 7.2 intent replay BEFORE
│   │                      #   reCAPTCHA; a seat language must be one of the course's; reCAPTCHA as orders/create.ts —
│   │                      #   resolveRecaptchaConfig(tenant.recaptcha), 400 verificationRequired / 403
│   │                      #   verificationFailed — except remoteip = the viewer address (§ 9.1) and FAIL CLOSED: no
│   │                      #   resolvable configuration → 503 verificationUnavailable (operator ruling); x-viewer-address
│   │                      #   read ONLY from a RENDERER caller and re-checked with client-address.ts → addressKey for
│   │                      #   the LIMIT#ADDR counter; holdSlot/holdSeat carry the limits; then the `hold` mail and
│   │                      #   markHoldMail → 201 or 503 mailFailed); bookings-view / -confirm / -cancel / -move (POST
│   │                      #   { token }; class 3: parseLinkBody checks the token IN FULL before any other field —
│   │                      #   absent, not a string, or not the § 8.1 format (43 chars of [A-Za-z0-9_-], the same rule
│   │                      #   as getBookingByToken, pinned equal by a test) → 404 linkNotValid with no lookup, write or
│   │                      #   mail; only then 400 invalid for other fields; bookingByLink = getBookingByToken + readPlace,
│   │                      #   consistent, + tokenView; every miss is 404 linkNotValid; view changes nothing, an expired
│   │                      #   hold → 410 expired (§ 8.4; BookingViewDTO.state "expired" has no producer); confirm mails
│   │                      #   `confirmed` with a NEW token (mintToken) only on the store's `applied` outcome; cancel
│   │                      #   mails `cancelled` without a link; move keeps the id and mails `moved` with a new token). dto.ts: RunDTO / ProposalDTO (kernel propose) / HoldResult /
│   │                      #   BookingViewDTO — never a booking id or token (row D5), email masked. mail.ts: the four
│   │                      #   visitor mails; the `hold` customer copy is always sent (the only way to confirm); owner
│   │                      #   copies (sendToAdmin → integrations.contactEmail) never carry the link. NO audit event
│   │                      #   on any visitor route (SCHED-AUDIT-PII = C: history is in the booking's own write).
│   │                      #   Tests: test/unit/scheduling-visitor.test.ts (D1-D7, D9-D11, D14, D15, route parts of
│   │                      #   C4-C7), scheduling-visitor-d8.test.ts (D8 on the REAL scheduling-db.ts over
│   │                      #   MemoryTable), scheduling-visitor-auth.test.ts (D2: the real authorizer).
│   │                      #   feed.ts (SCHED-1G1, § 12; § 16.3 class 4): POST /scheduling/visitor/feed { resourceId,
│   │                      #   secret } — NOT through visitorRoute (the feed answers 404, not 403, when off): RENDERER
│   │                      #   role; switch off, no record, malformed body field, unknown resource, no secret, wrong or
│   │                      #   rotated secret → one 404 linkNotValid; the last three take the same steps (tenant Get,
│   │                      #   RESOURCE# Get, sha256, timingSafeEqual against the stored hash or a dummy). Both access
│   │                      #   reads are CONSISTENT (a rotation or switch-off acts at once, review S1G1-R02). 200
│   │                      #   text/calendar, Cache-Control private, max-age=300: confirmed / held (TENTATIVE) slots from
│   │                      #   BOOKING# (feed projection, no `who`) and run meetings in the RUN's zone; window −60/+365
│   │                      #   days; feedCalendar (pure) writes RFC 5545 (CRLF, folding, TEXT escaping). Capacity of
│   │                      #   `taken/capacity` read with getRun (decision SCHED-1G1-FEED-CAPACITY). The renderer proxy is
│   │                      #   sched-1g2. Tests: test/unit/scheduling-feed.test.ts (G11)
│   └── admin/             # SCHED-1D1 (sched-1.md § 10.3; PROTOTYPE): the admin routes shared by both shapes, in the
│                          #   SchedulingApi nested stack (infra/lib/api-scheduling.ts). Every handler goes through
│                          #   common.ts adminRoute (x-tenant-id; requireRole E+T = EDITOR/TENANT_ADMIN, T =
│                          #   TENANT_ADMIN, GLOBAL_ADMIN passes; then ../common.ts guarded: StoredDataInvalidError →
│                          #   500 storedDataInvalid logged by key; errors `{ error, code, ...context }`; logs carry
│                          #   ids only; SCHED-1D2 moved these shared parts to ../common.ts) and calls
│                          #   lib/scheduling-db.ts — never DynamoDB for scheduling data (the tenant record is read
│                          #   from the main table). Admin routes work whether schedulingEnabled is on or off.
│                          #   A handler that USES a stored scheduling attribute reads the tenant only through
│                          #   ../common.ts readSchedulingTenant (`scheduling` and `schedulingEmailConfig` parsed by their
│                          #   shared schemas → StoredDataInvalidError keyed TENANT#<id>.<attribute>), BEFORE any
│                          #   write; the mail after a commit cannot change the answer (one exception, recorded in
│                          #   bookings-cancel.ts: a names re-read after a concurrent move); the catch-all logs the
│                          #   error name only (review S1D1-R01). A read whose result decides whether a write runs is
│                          #   consistent — readTenantRecord / readSchedulingTenant take `consistent` like the store
│                          #   (cancel: tenant + booking; feed secret: tenant); display reads stay eventual (S1D1-R07).
│                          #   bookings-get (GET …/bookings/{id} → BookingAdminDTO with `history`, booking-dto.ts),
│                          #   bookings-cancel (POST …/cancel: cancelBooking with the admin Actor — the history entry
│                          #   is in the cancel's own write, NO audit event; then mail `cancelled` to the customer, no
│                          #   link, no owner copy; a caller without a valid email → 403), customers-lookup and
│                          #   customers-erase (email in the body, normalized; erase T-only, audit
│                          #   SCHEDULING_CUSTOMER_ERASED with the two counts, title "Scheduling customer erasure"),
│                          #   resources-list/create/update/delete (bound 200, read-then-create: sequential creates
│                          #   are refused above 200; two simultaneous creates at 199 can both succeed — no reader
│                          #   breaks above 200, ruling S1D1-R02; delete = removeResource's three steps:
│                          #   409 resourceInUse / resourceRemovalInProgress), resources-feed-secret (T; 32 random
│                          #   bytes, SHA-256 stored, URL answered once: <bookingBase>/_booking/feed/<r>/<secret>.ics),
│                          #   email-templates (GET: defaults + resolved overrides; writes go through PUT /settings).
│                          #   Main-table audit (no `ip`, no customer data) only on resource writes, feed rotation and
│                          #   erasure (§ 6.5): target.title = the resource name (or the fixed erasure title); the only
│                          #   `details` are the erasure's two counts. Tests: test/unit/scheduling-admin.test.ts (rows D7, D10, D12, D13, D16)
│                          # appt-*.ts — SCHED-1E1 (sched-1.md § 10.3 routes of `sched-1e`, § 5.5, § 23; PROTOTYPE):
│                          #   the appointment admin routes, same frame (adminRoute, E+T), work with the switch off.
│                          #   appt-services-list/create/update/delete (ServiceDTO; strict body; an `only` list must
│                          #   name existing resources, one consistent list read → 400 with the issue path; bound 200
│                          #   on a consistent count: sequential creates refused above 200, two simultaneous creates
│                          #   at 199 can both succeed (S1D1-R02 wording); update = replaceService → 404 when the
│                          #   service is gone, a concurrent delete stays done; delete reads the service consistently
│                          #   → 404; bookings keep their stored times and serviceName, § 13), appt-availability-get/put (the
│                          #   defaults: ≤ 50 rules, 5-minute boundaries, end > start, one Put; overrides untouched),
│                          #   appt-week (GET …/week?start → WeekPlanDTO: one readIntervals over the 7 local days, then
│                          #   per day activeEntries + the kernel's planDay; one BatchGet of BOOKING# display views,
│                          #   unreturned ids skipped; lastBookableDate from the horizon), appt-days-edit (PUT …/days)
│                          #   and appt-days-copy-week (POST …/days/copy-week), both through appt-common.ts
│                          #   applyDayEdit (consistent tenant + resource reads, defaults read, all BEFORE the write;
│                          #   editResourceDays = the versioned DAYS# Put with one retry → 503 busy; DaysEditError →
│                          #   400 with its kind as code; the audit event right after the commit, before any display
│                          #   read; then outsideHours = refs derived from the ids of
│                          #   planDay per changed date over ONE readIntervals; nobody is mailed, § 23.4),
│                          #   appt-appointments-list (GET /scheduling/admin/appointments?from&to: ≤ 31 local days →
│                          #   else 400 rangeTooLong; per resource one readIntervals; refs and names from BOOKING#),
│                          #   appt-appointments-create (POST /scheduling/admin/appointments: createManualAppointment —
│                          #   confirmed, source manual, no window/grid/day-off/horizon check, § 5.2; mail `confirmed`
│                          #   with the transaction's token) and appt-move-slot (POST …/bookings/{id}/move-slot:
│                          #   moveSlot with the admin Actor and the screen's rev → 409 stale / notConfirmed /
│                          #   slotTaken / resourceUnavailable; then mintToken + mail `moved`; the answer carries the
│                          #   rev after the mint; names of the EXACT booking answered — appt-common.ts slotNames reuses
│                          #   a pre-read name only for that booking's resource). Every route that WRITES reads its tenant
│                          #   first through appt-common.ts readTenantBeforeWrite (consistent; a malformed stored
│                          #   scheduling setting or mail configuration → 500 storedDataInvalid, nothing written).
│                          #   Every route that reads or writes local wall time (week, day edits,
│                          #   appointments read, manual slot, move slot) needs scheduling.timezone: absent → 409
│                          #   timezoneNotSet (§ 4.1: no default zone). Audit: one main-table event per service,
│                          #   default-availability, day-edit or copy-week write (resource or service name as title;
│                          #   details = counts, dates and the setting kind; never a ref; no `ip`); the two booking
│                          #   routes publish none (SCHED-AUDIT-PII = C) and mail through visitor/mail.ts
│                          #   sendVisitorMail (its name is narrower than this use — recorded, no rename yet).
│                          #   Tests: test/unit/scheduling-appt.test.ts (rows E1-E14 backend parts, E16, E22, E23, E25)
│                          # group-*.ts — SCHED-1F1 (sched-1.md § 10.3 routes of `sched-1f`, § 5.4, § 7.4, § 7.6, § 11.1;
│                          #   PROTOTYPE): the group admin routes, same frame (adminRoute, E+T), work with the switch
│                          #   off. group-courses-list (CourseDTO by name), group-courses-create (strict body, 45
│                          #   text, distinct languages; bound 200 on a CONSISTENT count, S1D1-R02 wording),
│                          #   group-courses-update (consistent course + run reads; 409 languageInUse when a tag the
│                          #   update REMOVES from the stored list is used by any run, cancelled ones included —
│                          #   review S1F1-R06; replaceCourse → 404, never re-created), group-courses-delete (deleteCourse:
│                          #   404; 409 courseInUse while a run or an UNPLACED# exists, also when one is written
│                          #   between its checks and its Delete — S1F1-COURSE-DELETE-GUARD),
│                          #   group-runs-list (RunAdminDTO by first meeting: taken = active seats, overCapacityBy;
│                          #   the seat map never leaves the server), group-runs-create (createRun: meetings checked by
│                          #   the kernel's validateMeetings → 400 with the MeetingError kind as code; trainers 1-10,
│                          #   distinct (S1F1-R03), read consistently: unknown → 400 with the path, being removed → 409
│                          #   resourceUnavailable; capacity 1-45, above → 400 "A group in this version holds at most
│                          #   45 people."; language one of the course's AT THE TIME IT IS SET; the tenant's zone
│                          #   copied), group-runs-update
│                          #   (updateRun: capacity / trainers / language|null / groupLink|null / open|closed; a
│                          #   cancelled run → 409), group-runs-move (moveRun; then per active booking mintToken +
│                          #   `moved` mail; answer { run, mailed, notSentPlacementChanged }), group-runs-cancel
│                          #   (cancelRun; the audit from its committed run snapshot first; then
│                          #   clearCancelledRunTokens; then per unplaced booking
│                          #   mintToken + `unplaced` mail, per cancelled hold the `cancelled` mail without link and
│                          #   without owner copy; answer { unplaced, cancelled, notSentPlacementChanged,
│                          #   tokenCleanupFailed }). Ruling S1F1-LANGUAGE-CONSIST (amends § 4.3): a run language is
│                          #   checked against the course list when it is SET (run create / update, a visitor's
│                          #   first booking); a course update concurrent with such a writer can leave a run whose
│                          #   language is no longer in the list — valid stored data: no reader, schema or writer
│                          #   refuses it (the languageInUse guard looks only at removed tags). group-roster (AP7:
│                          #   exactly the active seats as RosterRow — customer data, E+T only, never logged; the CSV of `sched-1f2` is
│                          #   built from it in the admin page, § 10.3: no route), group-unplaced (AP8, 100 per page,
│                          #   opaque cursor; a foreign cursor → 400), group-seats-create (createManualSeat: admin seat
│                          #   rules, no runId → unplaced; mail `confirmed` with the group link for a seat) and
│                          #   group-move-seat (moveSeat with the admin Actor and the screen's rev; runId null →
│                          #   unplaced; mintToken + `moved` or `unplaced` mail; unplaced → unplaced writes nothing).
│                          #   Shared parts in group-common.ts (DTO builders, the trainer check, the refusal maps,
│                          #   seatPlace = the course and run of the EXACT booking answered, sendGroupAdminMail = the
│                          #   `unplaced` mail and the admin-run-cancel `cancelled` mail, which visitor/mail.ts does not
│                          #   send as § 11.1 states; hasPlacement = review S1F1-R01: every notice after a commit is
│                          #   built from the minted booking and sent only when it still has the notice's placement).
│                          #   Writers read the tenant first (appt-common.ts
│                          #   readTenantBeforeWrite); the mailing routes and run create need scheduling.timezone (409
│                          #   timezoneNotSet). Audit: one main-table event per course create / update / delete, run
│                          #   create / update /
│                          #   move / cancel (title = course name + the run's first local date; details = dates and
│                          #   counts only; no `ip`); the two person routes publish none and append history.
│                          #   Tests: test/unit/scheduling-group.test.ts (rows F1-F8 backend parts, F6 through the
│                          #   real visitor hold route; review S1F1-R01…R05; the REAL store transactions over an
│                          #   in-memory table that refuses two actions on one item, as DynamoDB)
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
│   └── paddle.ts          # POST /webhooks/paddle — fulfils nothing (PADDLE-HOOK-1): unverified, so every request
│                          #   gets 200 + one event-name log line; no table/S3/mail. Verified fulfilment: pay-2
└── import/
    ├── wordpress.ts       # WordPress XML import handler (featured-image copy under the image destination policy;
    │                      #   unreachable today: wxr-parser.ts never sets featuredImage). LANG-1A: an overwrite
    │                      #   copies the page's translationKey and conditions its Put on it (failed → post failed)
    ├── wxr-parser.ts      # WXR XML parser utility
    ├── html-to-tiptap.ts  # HTML → Tiptap JSON converter
    ├── woocommerce.ts     # POST /import/woocommerce — product CSV import; refuses a catalog tenant (403) and
    │                      #   a missing tenant (404) before the first write (CATALOG-MODE-1, CM-D8 guard 1);
    │                      #   creates an absent CATEGORY#<slug> with attribute_not_exists(SK) — never replaces
    │                      #   a category (its `blocks`, CATEGORY-CONTENT-1); a refused create fails the row
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
    │                      #   profile and no non-default choice, every write equals the base capture (golden test)
    │                      #   except the intended changes: `status` (CAT-IMAGE-GATE-1, below) and, ONLY when a
    │                      #   product outside this sheet's previous set holds a slug the file plans, that
    │                      #   product's slug (CAT-SLUG-UNIQUE-1, below); the golden covers the no-holder case.
    │                      #   CAT-IMAGE-GATE-1: every product is written `draft` (hidden) unless the profile says
    │                      #   `publishWithoutImages: true` (`glam/profile.ts` importStatus; absent ≡ false, also in
    │                      #   the "same profile" comparison); response member `publication` { status, startHidden,
    │                      #   withoutImageAddress[] } on the dry run and the execution.
    │                      #   CAT-SLUG-UNIQUE-1: the PRODUCT# read also projects `slug`; a product slug held by a
    │                      #   product outside this sheet's previous set (other importSource, or none) is not
    │                      #   taken — the product gets the held slug followed by the sheet's slug and/or a number
    │                      #   (`glam/group.ts` avoidTakenSlugs: -<sheet>, -<sheet>-<n>, or -<n> when the sheet
    │                      #   gives an empty slug); the plan that is written is made from that read (under the
    │                      #   lock; the dry run's read has no lock, so its list can differ); response member
    │                      #   `crossSheetSuffixed` [{ slug, previousSlug, rowIndex, heldBy }] on the dry run and
    │                      #   the execution
    │                      #   CDL-1 (docs/slices/catalog-data-labels-1.md § 4): after the mode read, one consistent
    │                      #   Get of the tenant's `locale` + `catalogStrings` → the SITE labels and the default
    │                      #   option name (shared catalogServerTexts); the FILE labels = the parser's headerLabels,
    │                      #   an empty cell → the site label of its column; body `labels` "site" (absent) | "file"
    │                      #   (other → 400 before any read); two chosen labels equal after norm → 400 (dry run
    │                      #   too, nothing written); the chosen set is the core's input (planGlamImport,
    │                      #   checkProfile — a stored profile label equal to one → unsupported → 409) and each
    │                      #   product's `importLabels`. Answers `labels { site, file, used }` (dry run, execution);
    │                      #   the dry run also `otherLabels` (other glam: lists whose products hold other labels,
    │                      #   from the existing PRODUCT# read, + `importLabels` projected). A request without an
    │                      #   option name gets the site default under both choices (report `variantName`).
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
    │                      #   producer URL left); audit `productsPublished`. CAT-IMPORT-GALLERY-1: an option's
    │                      #   additionalImageLinks (extras) are sources too, holder `{ …, extra: true }`, one
    │                      #   holding per (option, address); a failed/refused extra is removed (key removed when
    │                      #   none is left), rebased from the read like the main image and merged by the ORIGINAL
    │                      #   holding (read order; when every stored copy is identified by its MEDIAMAP# entry, read
    │                      #   on the re-plan (`storedCopies`), one stored image per holding, no second copy; a copy
    │                      #   whose entry a later copy overwrote can be matched to the wrong holding — misorder,
    │                      #   suppressed copy, second copy: residual frozen for CAT-IMAGES-OVERLAP-1);
    │                      #   CIG-STALE-WRITE: the write condition also names the `variants` read (`AND #variants =
    │                      #   :readVariants`), so a stale write is cancelled and re-planned (cat-images-1.md § 11);
    │                      #   an extra holding is reported
    │                      #   when the committed write applied this request's result to it (`committedHolding`);
    │                      #   `counts.extras`, `progress.remainingExtras`; `complete` needs main and extra
    │                      #   holdings at 0; an extra NEVER publishes (holdsCopiedImage ignores extras; the hidden
    │                      #   list is about MAIN images)
    ├── glam/              # CAT-IMPORT-1 PURE core (no I/O): parse.ts (RFC 4180, misplaced quotes refused; 12
    │                      #   columns by index, a non-12-cell record refuses the file — CAT-IMPORT-GALLERY-1: or
    │                      #   13 when the header has 13 cells, column 13 read ONLY into `galleryUrls` (split on
    │                      #   |, trimmed, no empty / column-9 / repeated part), one width per file; the row type has NO field
    │                      #   for columns 2–5; columns 3–4 = prices never read; columns 2/5 = producer codes read
    │                      #   only to drop every specs line holding one as a whole token), group.ts (key
    │                      #   normalisation trim→collapse→lower→NFC, U+001F rule, styles, options merged on equal
    │                      #   label + equal image cell — CAT-IMPORT-GALLERY-1: GlamOptionPlan.additionalImageLinks
    │                      #   = the http(s) column-13 addresses of the option's rows (`usableGallery`), each once —,
    │                      #   collision-aware labels and slugs; with TakenSlugs the
    │                      #   cross-sheet pass `avoidTakenSlugs`), map.ts (upload identifier rule, importSource,
    │                      #   CDL-1: the label set and the default option name are INPUTS of planGlamImport, the
    │                      #   upload's `variantName` is present only when the request gave one, plan `variantName`
    │                      #   = it or the default, every draft carries `importLabels`; parse.ts returns the header
    │                      #   cells of columns 0/6/7/8 as `headerLabels`;
    │                      #   GlamStyleDraft DTO, report counts; CAT-IMPORT-GALLERY-1: plan `gallery` (rows,
    │                      #   addresses, non-http(s) parts dropped) only for a 13-column file, the options' extras
    │                      #   stored on the draft, product gallery by deriveGallery; `takenSlugsOf` = the slugs of products outside
    │                      #   the previous set; with an AppliedProfile: the profile's row rules, extracted
    │                      #   attributes, stamps, refusals);
    │                      #   profile.ts (CAT-IMPORT-PROFILE-1A: checkProfile, parseProfileChoice,
    │                      #   readStoredProfile, resolveProfile, applyProfileToRows (grouping trailing-number,
    │                      #   collection from a spec key → else the sheet name), extractAttributes (union over the
    │                      #   style's rows), guardSpecLine (value guard B1 + T3: file-wide code cells and money
    │                      #   words, unfolded AND folded by group.ts `foldTokens` = slugify∘norm, on the line and
    │                      #   each fragment it can feed), analyseSpecKeys; never sees a raw record — it gets the
    │                      #   file's code cells as parse.ts `codeCells`); images.ts
    │                      #   (CAT-IMAGES-1: sources + holders, decision per source, per-product rewrite with the
    │                      #   derivation rule injected, termination measure; CAT-IMPORT-GALLERY-1: extras)
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

Protected public endpoints: `POST /contact`, `POST /leads`, `POST /public/forms/{slug}/submit`, `POST /public/interest`, `POST /public/orders`, `POST /public/coupons/validate`.

Each of these handlers refuses on `!result.success || result.score < threshold`. `verifyRecaptcha()` checks the provider
answer so that this comparison holds (PUBLIC-HARDEN-1): when the answer's `success` is truthy and its `score` is not a
finite number (absent — a v2 key pair answers `{ success: true }` —, a string, `null`, `NaN`), or the answer is not an
object, it returns the refusal `{ success: false, score: 0 }` and logs one `console.warn` that names the case (never
the token or the secret). The handler then answers 403 with its own refusal text, unchanged by this rule:
`getRecaptchaErrorMessage()` ("Verification failed. Please try again." for this refusal) in `forms/public-submit`,
`contact/send`, `leads/create`, `interest/public`; the fixed "Verification failed. Please try again." in
`orders/create`; the fixed "Verification failed" in `coupons/public-validate`. Every other answer is returned
unchanged. Unit: `test/unit/recaptcha-verify.test.ts`. The answer's `action` and `hostname` are not checked.

Logs include `[deployment]` or `[tenant]` tag for tracing which key source was used.

## DynamoDB Single-Table Design

All entities in one table. Partition key `PK`, sort key `SK`.

| Entity | PK | SK Pattern |
|--------|----|-----------|
| Tenant config | `SYSTEM` | `TENANT#<id>` |
| Content (latest) | `TENANT#<id>` | `CONTENT#<nodeId>#LATEST` |
| Content (version) | `TENANT#<id>` | `CONTENT#<nodeId>#v<N>` |
| Route | `TENANT#<id>` | `ROUTE#<slug>` |
| Translation membership (LANG-1A; `docs/database-patterns.md` § Translation Sets) | `TENANT#<id>` | `TRANSLATION#<translationKey>#<nodeId>` |
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
- **Presigned S3 URLs:** Assets get 5-min upload URLs. Resources get 15-min download URLs. (Paddle no longer signs URLs — PADDLE-HOOK-1.)
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
- **Total confirmation (ORDER-CONFIRM-1, record `docs/slices/order-confirm-1.md`):** `orders/create.ts` compares the
  request's optional `expectedTotal` (the total the checkout showed) with its own `total` by the shared
  `sameAmountInCents`, after the coupon block. Different → 409 with the shared `PriceChangedAnswer` (`code:
  "price-changed"`, an English `error`, `total` rounded to cents, `subtotal`, `shippingCost`, `couponDiscount`, per
  request item `productId`, `selectedVariant?`, `quantity`, `unitPrice`, `totalPrice`). On an initial total mismatch
  (the first pass) the comparison runs before the first write (the `COUNTER#ORDER` update) and the 409 writes nothing
  of any kind. On the COUPON-FIX-1 second pass (the coupon lost a race) the `COUNTER#ORDER` update has already run and
  the first transaction was cancelled (none of its items applied); that 409 leaves the order number unused. Absent →
  no comparison (a page from before the slice).
  Ruling OC1-TEXT = A: the answer also has `message`, the tenant's commerce text `pricesChanged` resolved from the
  tenant item it already read (`resolveLocaleStrings`; override, else the pack of its locale; a blank override → the
  pack text, the `catalogServerTexts` rule). `error` stays English.
- **Coupon limits at order time (COUPON-FIX-1, record `docs/slices/coupon-fix-1.md`):** `orders/create.ts` applies
  the shared `evaluateCoupon` to its own lines (server line totals in cents, the STORED product `categoryIds`); a
  coupon that does not apply is silently not applied, and the `expectedTotal` comparison tells the visitor. A `type`
  outside the schema enum (`isCouponType`) → not applied, one `console.warn`. When `perCustomerLimit` > 0 the handler
  reads `COUPONUSE#<couponId>#<sha256 hex of the normalized email>` (consistent) BEFORE the totals and passes its
  `count` to the rule (`customer-limit`). In the order transaction the `COUPON#` `usageCount` update is conditional
  on the stored `usageLimit` / `usageCount`, and the `COUPONUSE#` counter is raised under "absent or
  `count < perCustomerLimit`". A cancellation whose reason on one of those two items is `ConditionalCheckFailed` →
  one second pass without the coupon (same order id and order number; 409 when `expectedTotal` differs, else the
  order without the discount); any other cancellation is rethrown (500). The advisory pre-check
  `coupons/public-validate.ts` uses the same rule on the cart's lines (`productId`, `quantity`, `lineTotal`; ≤ 50,
  else 400) with each product's `categoryIds` from one tenant-scoped `BatchGet` (`UnprocessedKeys` ≤ 3 retries, then
  500); an old body without line totals is one line of the `subtotal`; it passes no customer count.
- **Payment state (PAY-1, record `docs/slices/pay-1.md`):** `PUT /orders/{id}` (`orders/update.ts`) with
  `paymentStatus` in the body is a transition, not a field: `changePaymentStatus` validates the body (enum; only
  `paymentStatus` and an optional `note` ≤ 500 characters, else 400), reads the order (tenant key; absent → 404),
  applies the shared `paymentTransition` (refused → 409 with the reason and the current state; no-op → 200, nothing
  written), then sends ONE `UpdateCommand` conditional on `attribute_exists(SK)` and the state read
  (`#paymentStatus = :previous`, or `attribute_not_exists` when the field was absent) that sets `paymentStatus`,
  `updatedAt` and `paidAt`/`refundedAt`; a failed condition → 409. After the write: audit `UPDATE_ORDER_PAYMENT`
  and, on `pending → paid` only, the `paid` order mail (template `orderEmailConfig.templates.paid`, else the default
  of `lib/order-email.ts`; sender, recipients and failure handling of `update-status.ts`). The function
  `UpdateOrderFunc` has `SES_FROM_EMAIL` and `ses:SendEmail` on the sender identity since PAY-1 revision 1
  (`infra/lib/api-commerce.ts`, pinned by `(pay1-1)`/`(pay1-2)` in `infra/test/amodx-stack.test.ts`); without the
  variable the handler sends no mail. A stored value outside the enum, `null` included → 409 (no write). A body without `paymentStatus` is the field patch of before (`trackingNumber`,
  `internalNotes`, `estimatedDeliveryDate`), byte for byte. This handler's 500 answers the fixed "Internal error"
  and logs `[orders/update] Error:`. Future consumers of "the order was paid" attach in `changePaymentStatus` after
  the audit entry.
- **Order line price (ORDER-PRICE-1, record `docs/slices/order-price-1.md`):** `orders/create.ts` charges each line by
  the shared `linePrice` (`@amodx/shared`) from the STORED product — the rule the product page and the cart show
  (option `priceOverride` > volume tier > `salePrice` > `price`, plus the matched personalizations' `addedCost`). It
  never reads a price or a cost from the request. The chosen option comes from the item's `selectedVariant` label and
  is needed only when an option of the product's first variant group has a `priceOverride`: an option matches when the
  label equals `<group>: <value>` or starts with it followed by `, `; not exactly one match → 400 `Variant selection not
  recognised for product: <id>`. A price text that does not parse → 400 `Invalid price for product: <id>`. Both refuse
  before any write. Stored item: `unitPrice` string with two decimals (unit + added cost), `totalPrice` number rounded
  to cents; `subtotal` = their sum, rounded to cents. PRICE-LOCALE-1 (record `docs/slices/price-locale-1.md`): the
  price texts are read with the locale of the TENANT ITEM (`tenantConfig.locale`, never the request), so a `ro-RO`
  tenant's `12,50` is 12.5; an en-US tenant's `12,50` is still a 400
- **Bulk price change (PRICE-LOCALE-1):** `products/bulk-price.ts` reads the tenant item (`GetCommand` `SYSTEM` /
  `TENANT#<id>`) for its `locale` and reads the old `price` / `salePrice` with the shared `parseMoney` (was
  `parseFloat`, which read `12,50` as 12). A text that does not parse is skipped. New prices are written in machine
  form (`toFixed(2)`)

## Response Format

```typescript
// Success
{ statusCode: 200 | 201, body: JSON.stringify({ ...data }) }

// Error
{ statusCode: 400 | 403 | 404 | 409 | 500, body: JSON.stringify({ error: "message" }) }
```

**Public routes — a 500 has a fixed text (PUBLIC-HARDEN-1).** A public route accepts a caller with no credential:
the three routes the authorizer allows as `anonymous` when the request has no master, renderer or service key (the
renderer proxies call them with the renderer key, as `RENDERER`), and the `noAuth: true` routes of `api-commerce.ts` /
`api-engagement.ts` (no authorizer runs). None of their handlers has a role gate. The
outer `catch` of each of their 15 handlers logs `console.error("[<dir>/<file>] …", e)` and answers
`500 { error: "Internal error" }`; the exception text (it can carry ARNs, table names, regions) never goes to the
caller. The list of routes and handlers: `docs/slices/public-harden-1.md` § 3. Unit:
`test/unit/public-harden-1-errors.test.ts` (one row per route), `test/unit/forms-public-submit.test.ts`. Many handlers
of authenticated routes still answer the exception text (the review finding "46 handlers"; not re-counted, not changed here).

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
   CAT-IMAGE-GATE-1 status change; CDL-1 adds six named deltas D1–D6, each asserted, no re-capture
   (`test/unit/glam-profile-golden.test.ts`, fixture
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
`test/unit/scheduling-admin.test.ts` and `test/unit/scheduling-settings.test.ts` (SCHED-1D1) are shape 2: the real
handlers, `requireRole`, `events.ts` and `scheduling-email.ts`, with the EventBridge and SES clients replaced by
recorders (so the "no `ip`, no customer data in any audit event" rows read the real `PutEvents` input) and, for the
admin routes, the store functions of `scheduling-db.ts` replaced (their transactions are the `sched-1c` rows of
`scheduling-db.test.ts`). `test/unit/scheduling-visitor.test.ts` (SCHED-1D2) is the same shape for the visitor
routes, with `verifyRecaptcha` (the call to Google) replaced and `resolveRecaptchaConfig` real; row D8 is in
`scheduling-visitor-d8.test.ts`, which runs the REAL `scheduling-db.ts` over `MemoryTable` (every D8 refusal is decided
on Get reads before the hold transaction; a positive control shows the request reaching `TransactWriteCommand` before
the `dayOff` edit); `scheduling-visitor-auth.test.ts` runs the real authorizer on the visitor route keys.
`test/unit/scheduling-appt.test.ts` (SCHED-1E1) runs the appointment admin routes and the visitor `slots` / `offer`
routes with every READ and configuration write of `scheduling-db.ts` REAL, over a test-local in-memory table
(`MemTable`: Get, Query with `begins_with` and `BETWEEN`, BatchGet without the consistency assertion, Put with
`attribute_not_exists(SK)`, `attribute_exists(SK)` or `#v = :v`, Delete, a one-shot hook after a consistent Get to
force the E11 interleavings and one before a Put for the S1E1-R03 delete); the shared `MemoryTable` does not answer those scheduling request forms. Only the three booking
transactions (`createManualAppointment`, `moveSlot`, `mintToken`) are replaced: they are `sched-1c` rows.
`test/unit/order-price-1.test.ts` (ORDER-PRICE-1) is the same shape for `orders/create.ts` (plus a mocked SES client,
so the confirmation mail's item lines are read): each row inspects the `TransactWriteCommand`, or that none is sent.
`test/unit/order-confirm-1.test.ts` (ORDER-CONFIRM-1) is the same shape for `orders/create.ts` (delivery config and
coupon reads added to the mock): each 409 row checks that only `GetCommand`s were sent; the `message` rows cover the
default, the `ro` pack, an override and a blank override.
`test/unit/coupon-fix-1.test.ts` (COUPON-FIX-1) is the same shape for `orders/create.ts` and
`coupons/public-validate.ts`; its DynamoDB fake keeps the stored coupon and the per-customer counters apart from what
a read returns (a stale counter read models a race), answers the pre-check's `BatchGet` (with injectable
`UnprocessedKeys`), evaluates only the two coupon condition texts the handler sends (any other condition throws) and
cancels a transaction with a real `TransactionCanceledException` carrying one reason per item.
`test/unit/pay-1.test.ts` (PAY-1) is the same shape for `orders/update.ts` (`db.js`, `publishAudit`, SES mocked;
the clock fixed): one row per taxonomy row of the slice, including a golden of the field patch's `UpdateCommand` input
that was also run against the handler before the slice.
`test/unit/price-locale-1.test.ts` (PRICE-LOCALE-1) is the same shape for `orders/create.ts` and
`products/bulk-price.ts` (audit, purge and the invalidation wrapper mocked): the tenant item's locale decides how a
price text is read.

Run: `cd backend && npm run test:unit`.
