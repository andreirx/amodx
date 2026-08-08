> **RATIFIED 2026-08-07 (human).** D-REV-1..5 ratified in their CONVERGED form
> (packet: `.agent-manager/slices/REV-1/ratification-packet.md`, all-converged), plus
> two human rulings recorded 2026-08-05: (1) SVG is REJECTED outright — no rasterize
> branch; input allowlist = JPEG/JPG, PNG, WebP, AVIF — **HEIC amended OUT 2026-08-08 (human)**: HEVC decode is patent-encumbered and absent from standard image runtimes; converting requires the same patented decode; iOS auto-converts to JPEG in sharing/upload flows and Google/FB exports never serve HEIC. Genuine .heic input is REJECTED with an explicit "iPhone photo? Export as JPEG" message in the import report / upload UI; (2) images live in S3 — the review record holds only bounded
> per-image METADATA entries; the DDB 400KB cap bounds entry count, never photo size.
> > **D-REV-4 SUPERSEDED 2026-08-08 (human): no automated byte-screening.** sharp is
> dropped entirely (its Linux-binary-on-Lambda cost outweighed a benefit that was
> mostly privacy+display, not security). The HUMAN MODERATION gate is the content
> control — every imported image lands `pending` and a human approves before it goes
> public ("admins check what they import regardless"). The `stage` step keeps its
> DECLARED type+size guard + allowlist (JPEG/PNG/WebP/AVIF — all display natively, so
> no normalization is lost; HEIC still rejected). Promotion copies the ORIGINAL on
> approval. RESIDUAL, tracked (TECH-DEBT): imported customer photos may carry EXIF/GPS;
> Google/FB exports strip it server-side (primary path safe); a pure-JS EXIF strip is
> the revisit if direct device-uploads become a heavy path — NOT built now (less
> machinery, per the ruling).
> 
> Spine principle binding on all phases: the moderation gate governs the PUBLIC
> OBJECT (private-stage → screen → promote), not merely the render.
> (Recovery note: this file spent 2026-08-01→08-07 in a git stash created by the
> CACHE-7 builder for review-scope isolation and never popped — TD-016 candidate.)

# Reviews-with-Images Import Plan (Track REV)

## Status

- **Discovery plan — doc only.** No implementation, no `infra/` changes, no AWS mutations,
  read-only repo audit. This document decides nothing; it records what exists, proposes
  phase boundaries, and raises the image/media/legal decisions as `DECISION_REQUIRED`
  blocks (§ 6) for ratification.
- Track: `REV` (`docs/ROADMAP.md` § *Backlog / Discovery Tracks*). **NOT an active slice.**
  Not promoted into Current Priority; `docs/ROADMAP.md` order places its authoring while
  Track B runs, doc-only.
- Source of the problem statement: human notes, 2026-07-30.
- **Writable surface of this slice (REV-1):** this document plus the `docs/ROADMAP.md` REV
  row. Nothing else — no code, no `infra/`, no schema. The `rev-` prefix registration in
  `docs/documentation.md` § *Naming Conventions* and the `docs/TECH-DEBT.md` entry for the
  two source-enum defects (§ 2.5) are named follow-ups here, **not written by REV-1** — they
  land with the first implementation slice doc (`rev-1`), matching how `email-1` deferred its
  own prefix registration.
- Audit evidence: `OBSERVED` 2026-08-01 against the working tree (file:line for every claim
  below). External-API capability claims (Google Business Profile, Facebook) are **not**
  verified here and are marked `VERIFY-AT-PHASE-START` (§ 3); nothing in `rev-1`..`rev-4`
  depends on one.
- Current maturity of the review estate: **PROTOTYPE for import** (no importer, no images,
  no connectors), **MATURE for the two existing render/CRUD paths** (§ 2).
- Target maturity of the track: bulk import + moderation + image gallery at MATURE;
  connectors at PROTOTYPE behind a `VERIFY-AT-PHASE-START` gate.

---

## 1. Problem

Tenants want their existing Google and Facebook reviews — **with the photos customers
attached** — shown on their AMODX sites, brought over in bulk from an export rather than
retyped. The repo has review storage, moderation, and a display block, but three gaps:

1. **No image can be attached to a review anywhere.** Neither storage schema carries a
   review-photo field (§ 2.1, § 2.2). The carousel block has an author *avatar* URL — that
   is the reviewer's face, not the photos in the review body.
2. **No importer.** Reviews are created one at a time through the admin API (§ 2.1). There
   is no CSV/JSON path and no media-bundle path.
3. **No connector.** `ReviewSchema` reserves `source: "google"` and a `googleReviewId`
   field, but nothing pulls from Google or Facebook (§ 2.4, and `docs/TECH-DEBT.md`
   § *Google Reviews sync*).

The commercially urgent half is **bulk import first** (a tenant hands us a Google Takeout /
Facebook export); live API connectors are the *last* two phases and are gated on capability
that the human's notes assert but this plan does not treat as fact (§ 3).

---

## 2. Current-estate audit (`OBSERVED` 2026-08-01)

**The single most important finding: there are two separate, unlinked "review" systems.**
They do not share a schema, a source enum, a storage location, or a render path. A plan that
says "reviews" without saying *which* system will scope the wrong work.

### 2.1 System A — DB-backed product reviews (moderated)

- **Schema:** `ReviewSchema` — `packages/shared/src/index.ts:1256-1268`. Fields: `id`,
  `tenantId`, `productId`, `source: enum("google","internal","imported") .default("internal")`,
  `authorName`, `rating 1-5`, `content .default("")`, `googleReviewId?`,
  `status: enum("approved","pending","hidden") .default("pending")`, `createdAt`.
  **No image/media field of any kind.**
- **Storage key:** single-table, `PK = TENANT#<tenantId>`, `SK = REVIEW#<productId>#<id>`
  (`backend/src/reviews/create.ts:39-40`). **Product-attached by key construction** — a review
  cannot exist without a `productId`; the public/renderer read paths build
  `REVIEW#<productId>#`, while the ADMIN list (`list.ts:23-32`) may query the tenant-local
  `begins_with(SK, "REVIEW#")` prefix WITHOUT a productId (§ 2.6). This is
  the crux of decision D-REV-5.
- **Backend handlers** (`backend/src/reviews/`, 5 handlers, registered
  `infra/lib/api-commerce.ts:371-408`):
  - `create.ts` — `POST /reviews`, roles EDITOR/TENANT_ADMIN, `withInvalidation`.
  - `list.ts` — `GET /reviews` (admin, all statuses, `ScanIndexForward:false`).
  - `update.ts` — `PUT /reviews/{id}`, dynamic allow-list of mutable fields
    (`status,content,authorName,rating` — `update.ts:37-42`), `ConditionExpression`.
  - `delete.ts` — `DELETE /reviews/{id}`, role TENANT_ADMIN only.
  - `public-list.ts` — `GET /public/reviews/{productId}` (`noAuth`), filters
    `status = approved`, returns `{items, averageRating, totalReviews}`.
- **Render surface (SSR):** `renderer/src/lib/dynamo.ts:441-470` `getProductReviews()` paginates
  approved reviews; `renderer/src/components/SitePage.tsx:216-217` fetches them; the
  `ProductPageView` reviews block (`SitePage.tsx:875-900`) renders author + date + star rating +
  `content` + a "Google" text badge, and emits `aggregateRating` JSON-LD
  (`SitePage.tsx:661-665`). **The render maps `authorName`, `rating`, `content`, `source`,
  `createdAt` only — it has no slot for a photo.** `ProjectionExpression`s that would have to
  grow for images: `public-list.ts:23`, `list.ts:32`, `dynamo.ts:460`.
- **Admin moderation surface (input to `rev-3`):** `admin/src/pages/Reviews.tsx` is the existing
  moderation console over System A. It offers **one-at-a-time** creation (a create dialog posting
  to `POST /reviews`, `Reviews.tsx:57-73,231-247`), a status filter, and **per-review** actions:
  approve (`handleStatusUpdate(...,"approved")`, `Reviews.tsx:319,351`), hide
  (`handleStatusUpdate(...,"hidden")`, `Reviews.tsx:328,340`), and delete
  (`Reviews.tsx:358-364`). **There is no batch operation and no media/photo column** — every
  action is single-review, single-status. `rev-3` extends *this* surface; it is not greenfield.

### 2.2 System B — the `reviews-carousel` plugin block (static, author-typed)

- **Schema:** `packages/plugins/src/reviews-carousel/schema.ts:3-23`. A block whose `items[]`
  are embedded **in the block's own attrs** — no DB linkage. Per item: `id`, `name`,
  `avatarUrl?`, `date`, `rating`, `text`, `source: enum("google","facebook","manual")`.
  **`avatarUrl` is the reviewer's avatar (`ReviewsCarouselRender.tsx:73-78`), not a
  content/gallery photo.** No field for review photos.
- **Render:** `packages/plugins/src/reviews-carousel/ReviewsCarouselRender.tsx` — client
  carousel, Google/Facebook SVG badges, star display, expand/collapse. Authors type reviews
  directly in `ReviewsCarouselEditor.tsx`; nothing imports them.
- **Consequence for this track:** System B is a *presentational* block filled by hand. Bulk
  import (`rev-2`) targets **System A** (the DB store), because that is the only place a
  batch of records can land and be moderated. The gallery block (`rev-4`) is a *new* render
  path over System A data — it is **not** an edit to System B, which stays as the
  manual-authoring block it is today. Do not conflate them.

### 2.3 Media / upload estate (input to D-REV-2)

**There are TWO distinct image-ingestion paths, and only one guards the upload at all — and
even that guard is on the DECLARED content-type/size, never the bytes.** Conflating them is
exactly the trap this track must avoid, because the review importer is a *server-side* job and
would reuse the path that guards *nothing*.

- **Path 1 — browser presign (guarded).** `backend/src/assets/create.ts` — presigned **PUT**
  to `UPLOADS_BUCKET`, key `${tenantId}/${assetId}-${filename}` (`create.ts:44`), served from
  `UPLOADS_CDN_URL` (`create.ts:60`). Writes an `ASSET#<assetId>` DDB record (`create.ts:63-78`)
  and audits. Roles GLOBAL_ADMIN/TENANT_ADMIN/EDITOR. It **calls
  `validateUpload(contentType, size)`** from `@amodx/shared` (`create.ts:9,34`) — MIME
  allow-list (`ALLOWED_IMAGE_MIMES`, `media.ts:16`), size caps **image 10 MB / video 50 MB**
  (`MAX_UPLOAD_BYTES`, `media.ts:42-45`). MIME is enforced on the DECLARED `ContentType` request header only — `validateUpload()`
  (`media.ts:91-107`) evaluates the supplied contentType/size and the presigned PUT signs that
  same declared value (`create.ts:52-57`); NEITHER identifies the uploaded BYTES; **size is advisory only** (presigned PUT cannot bind
  `content-length` — `create.ts:47-51`, `docs/TECH-DEBT.md` § *Upload size limit is advisory*).
- **Path 2 — server-side URL import (UNGUARDED — `rev-2` reuses its storage *tail*, see Relevance).**
  `downloadAndUploadImage(tenantId, imageUrl, bucket, cdnUrl)`
  (`backend/src/lib/image-upload.ts:23-71`) `fetch`es a remote URL, reads the **whole** body
  into memory (`arrayBuffer()`, `image-upload.ts:34`), `PutObject`s it to `UPLOADS_BUCKET`, and
  writes the same `ASSET#` record shape. It is the estate's **existing server-side put
  primitive**, already used by the WordPress media importer (`backend/src/import/media.ts:64-74`)
  and the WordPress post importer (`backend/src/import/wordpress.ts:207-215`), registered as
  `POST /import/media` with `grantReadWrite` on the bucket (`infra/lib/api.ts:378-397`,
  15-min / 3008 MB Lambda). **It does NOT call `validateUpload`.** It takes the `content-type`
  straight from the *upstream* response header (`image-upload.ts:35`) and defaults it to
  `image/jpeg` when absent — so it trusts an attacker-influenced source for both MIME and size,
  buffers the entire download (memory-DoS surface on a large file), and applies no allow-list
  and no size cap.
- **Relevance — and the reuse boundary `rev-2` must respect.** `downloadAndUploadImage` takes a
  **URL** and calls `fetch()` (`image-upload.ts:23-35`). That means it is a **direct reuse only
  for URL-shaped inputs** — the connector payloads of `rev-5`/`rev-6` (Google/FB CDN URLs) or a
  D-REV-2-B hot-link. **It cannot ingest a media-ZIP entry**: a ZIP entry is already-in-hand bytes
  with no URL to fetch, and there is **no ZIP handling anywhere in the repo** (verified absence,
  § 2.7). The honest reuse for the ZIP path (`rev-2`'s core) is therefore **not** the whole
  primitive — it is the primitive's *tail*: the `PutObject` + `ASSET#`-record write
  (`image-upload.ts:42-70`) that runs *after* the fetch. The smallest safe implementation is to
  extract that tail into a bytes-taking put (`(tenantId, bytes, contentType) → assetUrl`) that
  both the URL primitive and the new ZIP path call — reuse of the storage step, without
  pretending the URL-fetch front door ingests ZIP bytes.
- **Whichever input, the same trust deficit applies, and `validateUpload` does not close all of
  it.** The primitive trusts an upstream/declared `content-type`, buffers the whole body, and
  never calls `validateUpload` — so re-hosted bytes carry none of Path 1's checks. `rev-2` must
  add a guard, but be precise about what the guard is: **`validateUpload(contentType, size)`
  inspects only the *declared* MIME string and *declared* size** (`media.ts:91-101`) — it is an
  **allow-list + size-declaration check, not content inspection.** Run against a remote response
  header or a ZIP manifest entry it validates a *claim*, not the bytes. It closes the
  MIME/size-*declaration* gap (rejects a `.exe` claiming to be one, an oversized declared file);
  it does **not** verify that bytes claiming `image/jpeg` are a benign JPEG. Payload verification
  — a valid-looking image carrying an exploit — requires **re-encode/scan**, which is D-REV-4, not
  `validateUpload`. So: `rev-2` re-validates the declared `content-type`+size through
  `validateUpload` (or explicitly, ratifiedly gates that it does not) before publishing any
  imported byte; the residual payload risk plus the advisory-size gap (§ 2.3) are the inputs to
  D-REV-4.

### 2.4 Connector estate

- **Reserved but unused:** `ReviewSchema.source` includes `"google"` and there is a
  `googleReviewId?` field (`index.ts:1260,1264`); nothing writes them from an API.
  `docs/TECH-DEBT.md` § *Google Reviews sync* records the gap explicitly: "no import/sync
  handler for Google Places API reviews." **No Facebook field or handler exists at all.**
- **What DOES exist (and what it is actually for — do not overclaim it as a reviews
  connector):** `IntegrationsSchema` already carries a Google OAuth block —
  `integrations.google.clientId` + `clientSecret` (`packages/shared/src/index.ts:404-407`) —
  and a `googlePlaceId` field (`index.ts:428`). The `clientSecret` is a first-class secret,
  read-gated to TENANT_ADMIN/GLOBAL_ADMIN via `GET /settings/secrets`
  (`backend/src/tenant/settings-secrets.ts:17-20,49-60`) and stripped from the plain
  `GET /settings`. **But its declared purpose is Comments/Identity** — the schema comment reads
  "GOOGLE OAUTH (Comments/Identity) … so the Renderer can load them dynamically per tenant"
  (`index.ts:402-403`); it is the NextAuth sign-in credential (MEMORY: "Customer accounts:
  Google OAuth via NextAuth"). `googlePlaceId` is a bare Place identifier under a "GOOGLE MY
  BUSINESS (Reviews)" comment (`index.ts:427`); a `grep` of `packages/shared/src`,
  `backend/src`, `admin/src`, `renderer/src`, and `infra/lib` finds it **only at its schema
  definition — no source consumer reads it at all** (basis: deterministic ripgrep over those
  source trees, 2026-08-01; excludes build artifacts). It is a reserved field, not a working
  Place-reviews integration.
- **The true connector gap:** there is **no reviews connector, no OAuth token lifecycle**
  (the stored `clientId`/`clientSecret` are an app credential, not a per-tenant authorized
  Business-Profile access/refresh token), **no connector-specific authorization model, no
  Facebook/Meta credential of any kind, and no connector Lambda.** The existing Google fields
  must **not** be assumed suitable for Google Business Profile review access — whether that API
  even uses this credential shape, and whether the tenant has authorized it for their
  locations, is exactly what the § 3 `VERIFY-AT-PHASE-START` gate exists to answer. Everything
  substantive in `rev-5`/`rev-6` — the authorization flow, token storage, the pull, and the FB
  credential surface — is still greenfield and capability-gated (§ 3).

### 2.5 Name/semantics defects found during the audit (surface, do not fix here)

Per CLAUDE.md ("a name that does not match what it does is a defect"), two are recorded for
the `rev-1` slice doc + a `docs/TECH-DEBT.md` entry; **REV-1 does not change code**:

- **D1 — `create.ts` writes an out-of-enum `source`.** `backend/src/reviews/create.ts:44`
  writes `source: source || "manual"`. `"manual"` is **not** a member of `ReviewSchema.source`
  (`"google"|"internal"|"imported"`, `index.ts:1260`); the schema default is `"internal"`. So
  the create path can persist a value the schema forbids, and the render only special-cases
  `"google"` (§ 2.1) — every other source, valid or not, renders identically. `rev-1` (which
  touches this schema for images) is the natural place to reconcile the default to
  `"internal"` and validate the body with `ReviewSchema` on write.
- **D2 — the two systems' source enums diverge.** System A: `google|internal|imported`.
  System B: `google|facebook|manual` (`schema.ts:10`). `"facebook"` exists only in the block,
  `"imported"` only in the DB, `"manual"`/`"internal"` are two names for the same idea. Any
  cross-system feature (e.g. rendering System-A imported FB reviews) trips over this. Note it;
  a unification is a schema-migration decision, not a REV-1 edit.
- **Reconciliation of the ROADMAP wording:** the REV row's "schema `source: google/imported`"
  is an abbreviation — the actual enum is `google/internal/imported` (`index.ts:1260`). The
  row is updated in § 7 to cite the real enum and the two-system split.

### 2.6 Product-attachment is structural, not incidental

The public/renderer/System-A item reads hard-code `begins_with(SK, REVIEW#<productId>#)`
(`public-list.ts:19`, `delete.ts:32`, `update.ts:62`, `dynamo.ts:456`); the ADMIN list is the
exception — `list.ts:23-32` permits querying `begins_with(SK, "REVIEW#")` tenant-locally
without a productId and the
public route is `GET /public/reviews/{productId}` (`api-commerce.ts:408`). **A business-level
review (Google/FB reviews are about the business/place, not one SKU) has no key it can be
written under today.** This is why D-REV-5 (product-vs-page attachment) is on the critical
path for import: an importer cannot place a business-level review without an answer.

### 2.7 What does not exist (verified absence, `OBSERVED`)

- No image/photo field on either review schema (§ 2.1, § 2.2).
- No CSV/JSON parser for reviews (only `backend/src/import/woocommerce.ts` for products, and
  `backend/src/import/wordpress.ts` for pages — neither touches reviews).
- No media-ZIP handling anywhere in the repo.
- No malware/abuse scanning on any upload path (`create.ts` does MIME + advisory size only).
- No rights/consent field on any review or asset record.
- No **reviews-specific** connector, no per-tenant Business-Profile authorization/token lifecycle,
  and **no Facebook/Meta credential of any kind**. (A *generic* Google OAuth credential does
  exist — `integrations.google.clientId`/`clientSecret`, `index.ts:404-407` — but its declared
  purpose is Comments/Identity sign-in via NextAuth, `renderer/src/app/api/auth/[...nextauth]/route.ts:21-31`;
  it is **not** a reviews connector. See § 2.4 for the full contract and the § 3 gate.)

---

## 3. External-API capability — `VERIFY-AT-PHASE-START`

The human's 2026-07-30 notes assert that Google and Facebook reviews (with images) can be
pulled by API. **This plan treats those as inputs, not facts.** No phase `rev-1`..`rev-4`
depends on them; `rev-5`/`rev-6` open with a verification gate and may be re-scoped or
`WITHDRAWN` by what it finds.

Questions each connector phase must answer *before* it is scoped (from primary API docs and a
live credentialed probe, dated and labelled `EXECUTED`/`OBSERVED` in the slice doc):

- **Google (rev-5):** Which API actually returns reviews — Google Business Profile API
  (owner-authenticated, the tenant's *own* locations) vs Places API (public, capped, no photo
  bodies)? Does the returned payload include **review photos** or only author avatars + text?
  What is the rate/quota ceiling, and does it permit storing/redisplaying the review and its
  photos (ToS)? Historically Google's review payloads have **not** included attached photos
  via the public Places path — this must be re-confirmed at phase start, not assumed.
- **Facebook (rev-6):** Is a Page Ratings/Reviews read still offered under current Graph API
  permissions and App Review, and does it return photos? Meta has repeatedly narrowed this
  surface; assume nothing until a live probe confirms.

If either returns no photos or no redistribution right, that connector degrades to
**text-only import** or is `WITHDRAWN` — and the bulk-export path (`rev-2`), which does not
depend on any API, remains the delivery vehicle for images.

---

## 4. Proposed phases

Order: **bulk import first, connectors last**, per the ROADMAP row and the human's priority.
Each phase is **deep-vertical**: whatever it lands must *render somewhere* by the end of that
phase. Because System A already renders on the product page (§ 2.1), the render surface for
images is opened in `rev-1` — so a review that gains a photo is visible immediately, before
any importer exists, and every later phase lands onto a live surface.

### 4.1 `rev-1` — Domain model + import schema (the enabling schema, and the render that proves it)

- **Scope (System A only).** Add the review-image representation to `ReviewSchema` (shape is
  D-REV-1). Open the System-A write path so the field can actually be persisted: the
  `POST /reviews` handler currently destructures a fixed field list and does **not** read or
  store any image field (`backend/src/reviews/create.ts:27,44-51`), so `create.ts` must be
  extended to accept and persist `images` (and `update.ts`'s mutable allow-list,
  `update.ts:37-42`, to permit editing it). Extend the System-A **render** path to display it —
  the `ProductPageView` reviews block (`SitePage.tsx:875-900`). Grow the `ProjectionExpression`s
  that must carry the new field (`public-list.ts:23`, `dynamo.ts:460`, `list.ts:32`). Define the
  **import DTO** (the CSV/JSON row + media-manifest shape `rev-2` will parse) as a shared type,
  so `rev-2` has a contract to build against. Reconcile the § 2.5 source-enum defects in the
  same schema pass (validate the body with `ReviewSchema`; default `source` to `"internal"`).
- **Non-scope.** No importer, no upload of review media, no connectors, no moderation-UI
  change. No new storage key (D-REV-5 may add one later; `rev-1` does not). **No edit to the
  `reviews-carousel` block (System B, § 2.2)** — it is an unlinked, author-typed presentational
  block with no imported-review role; `rev-4` confirms it is not touched by this track.
- **Deep-vertical proof.** With `create.ts` extended, a review created via `POST /reviews`
  carrying an image URL persists that URL and renders with its photo on the product page (the
  grown projection surfaces it through `getProductReviews()` → `SitePage.tsx`). That is the
  phase's runnable evidence — images work end-to-end through the real write and read paths
  before the bulk importer exists, and every later phase lands onto this live surface.
- **Risks.** Schema change to a persisted record → must be additive with `.default()` for
  backward compat (repo convention, MEMORY "all new fields have `.default()`"). Touching
  `ReviewSchema` ripples to every handler's projection — enumerate them (§ 2.1) or a projected
  read silently drops the field.
- **Output surface.** Product page shows review photos; import DTO type exists in
  `@amodx/shared`.

### 4.2 `rev-2` — Bulk import: CSV/JSON + media-ZIP (**the commercial core**)

- **Scope.** A backend import handler (sibling of `backend/src/import/woocommerce.ts` and the
  existing `backend/src/import/media.ts`) that accepts a reviews **CSV/JSON** and an
  accompanying **media ZIP**, maps rows to the `rev-1` DTO → `ReviewSchema`, stores photos per
  D-REV-2, and writes reviews at `status: "pending"` (moderation-gated, § 4.3 handles
  approval). Two-pass like the Woo importer: parse manifest, then resolve each row's referenced
  media entries. **Media storage reuses the *storage tail* of `downloadAndUploadImage`
  (`image-upload.ts:42-70` — the `PutObject` + `ASSET#` write), not its URL front door (§ 2.3):**
  the ZIP path holds bytes, not a URL, so the smallest safe move is to extract that tail into a
  bytes-taking put shared by both the URL primitive and the new ZIP path — reuse of the proven
  storage step, without pretending the `fetch()`-based primitive ingests ZIP entries. (A
  connector phase — `rev-5`/`rev-6` — whose payload *is* a URL reuses the primitive whole.) This
  phase guards DECLARED metadata only; byte-level assurance comes solely from the separately ratified re-encode/scanning control before publishing: re-validate the ZIP-entry/declared `content-type` and
  size through `validateUpload` (`@amodx/shared`). **Be precise on what that buys:**
  `validateUpload` checks the *declared* MIME + *declared* size only (an allow-list + size
  declaration, § 2.3) — it is **not** byte inspection, so it does not verify the bytes are the
  image they claim to be; that residual (a valid-looking image carrying a payload) is D-REV-4's
  re-encode/scan, not this guard. If the declaration guard is deferred, the deficit must be an
  explicit, ratified gate — not silent. Admin entry point: an "Import reviews" action on the
  reviews admin page (extends the existing single-review console, § 2.1).
- **Non-scope.** No connectors. No auto-approve (imported reviews are **pending** until
  `rev-3`). No rights *decision* — it consumes D-REV-3's answer.
- **Deep-vertical proof.** After an import, the imported reviews (once approved) render via the
  System-A path opened in `rev-1`. If D-REV-5 says business-level reviews need a new key, the
  minimal render for that key ships in this phase too — an imported review must not land
  write-only.
- **Risks.** ZIP handling in Lambda (memory/size vs the 10 MB image cap, § 2.3); malformed
  export rows; the advisory-size gap (§ 2.3) means an oversized media file can still reach S3 —
  D-REV-4 governs scanning. Tenant isolation: every row keyed under `TENANT#<tenantId>` from
  the header, never trusted from the file.
- **Output surface.** `POST /import/reviews` (+ admin button); imported reviews appear in the
  moderation list and, once approved, on the site.

### 4.3 `rev-3` — Moderation / selection UI (imported reviews are curated, not auto-published)

- **Scope.** Extend the existing admin reviews moderation (System A already has
  approve/hide/delete via `update.ts`/`delete.ts`) to handle a **batch** of imported pending
  reviews: bulk approve/reject, per-review photo approve/reject (consumes D-REV-4), and
  selection of which imported reviews go live. Surfaces the imported `source` and any
  rights/consent flag from D-REV-3.
- **Non-scope.** No new import formats; no connectors; no render change beyond what `rev-1`
  shipped.
- **Deep-vertical proof.** Approving an imported review in the UI flips it to `approved` and it
  renders on the site immediately (existing `withInvalidation` purge on `update.ts`).
- **Risks.** Batch operations over many items (DDB write throughput / partial failure); a
  photo-level moderation state needs somewhere to live (folds into D-REV-1 shape).
- **Output surface.** Admin reviews page gains batch moderation + media approval.

### 4.4 `rev-4` — Renderer gallery block (the image-first display surface)

- **Scope.** A **new render path over System-A data** that displays reviews *with their photo
  galleries* — either a new plugin block (peer of `reviews-carousel`, § 2.2) or a gallery mode
  on the product-page reviews section. Pulls approved reviews + approved photos via a
  projection that now includes the image field.
- **Non-scope.** Not an edit to the manual `reviews-carousel` block (§ 2.2); not a connector.
- **Deep-vertical proof.** The block renders imported, approved, photo-bearing reviews on a
  live page — this is the phase the whole track exists to deliver.
- **Risks.** Image performance (the `_next/image` optimizer is currently 500-ing pending
  `opennext-1` — `docs/TECH-DEBT.md`; the gallery must degrade gracefully to un-optimized
  `<img>` until that ships). CLS/lazy-loading; hot-linked vs re-hosted images (D-REV-2).
- **Output surface.** A gallery block/mode renders reviews-with-images on tenant sites.

### 4.5 `rev-5` — Google connector (`VERIFY-AT-PHASE-START`)

- **Opens with the § 3 Google verification gate.** Only after it is answered `EXECUTED` (which
  API returns reviews, whether it returns photos, quota, and ToS on redisplay) does scoping
  proceed. The phase may be re-scoped to text-only or `WITHDRAWN` by what the gate finds.
- **Scope.** A connector Lambda that authenticates to the verified Google API, pulls the
  tenant's reviews, maps each through `rev-2`'s row→`ReviewSchema` mapping, re-hosts any photos
  per D-REV-2, and writes them into **System A** with `source: "google"` + `googleReviewId` (the
  reserved fields, § 2.4) at `status: "pending"`. Reuses `rev-3`'s moderation to approve. An
  admin "Sync Google reviews" action triggers it.
- **Non-scope.** No Facebook. No new render path — approved connector reviews render through the
  **existing System-A path** opened in `rev-1` (product page) and `rev-4` (gallery). No bypass
  of moderation (connector reviews are `pending`). No auto-approve.
- **Deep-vertical proof.** A live sync writes pending reviews; approving one in `rev-3`'s UI
  makes it render on the site through the System-A path (`rev-1`/`rev-4`), photos included **if
  the § 3 gate confirmed the API returns them**. No write-only landing.
- **Risks.** Credential storage: `IntegrationsSchema` already carries a Google
  `clientId`/`clientSecret` (for identity/comments, § 2.4) and a `googlePlaceId`, but a reviews
  connector needs a **per-tenant authorized access/refresh token** — a genuinely new secret
  surface distinct from the existing app credential (CLAUDE.md rule 8 — never hardcode; must be
  read-gated like `settings-secrets.ts`). Quota; ToS on redisplay/storage of photos; the gate
  may find no photo bodies (degrade to text-only).
- **Output surface.** Admin "Sync Google reviews" → pending imported reviews that, once
  approved, render on the existing System-A surfaces.

### 4.6 `rev-6` — Facebook connector (`VERIFY-AT-PHASE-START`)

- **Opens with the § 3 Facebook verification gate**, the higher-risk of the two (Meta's
  review-read surface has been repeatedly narrowed via Graph API permissions + App Review). The
  phase may be `WITHDRAWN` outright if the capability does not verify.
- **Scope.** Same connector shape as `rev-5` against the verified Facebook Graph endpoint:
  pull → map via `rev-2` → re-host photos per D-REV-2 → write into **System A** at
  `status: "pending"`. Requires the § 2.5-D2 enum reconciliation resolved first — System A has
  no `"facebook"` source member today (`google/internal/imported`, `index.ts:1260`), so this
  phase adds it (a schema-migration decision, not a silent edit). Admin "Sync Facebook reviews"
  action triggers it.
- **Non-scope.** No Google (that is `rev-5`). No new render path — approved reviews render
  through the existing System-A path (`rev-1`/`rev-4`). No moderation bypass.
- **Deep-vertical proof.** A live sync (if the capability verifies) writes pending reviews;
  approving one renders it on the site via the System-A path, photos included only if the § 3
  FB gate confirmed the API returns them. If the gate fails, the phase ships nothing and the
  bulk-export path (`rev-2`) remains the delivery vehicle for FB reviews-with-images.
- **Risks.** App Review / permission availability (may be `WITHDRAWN`); enum migration to add a
  `"facebook"` source; OAuth secret surface; quota; ToS on photo redisplay.
- **Output surface.** Admin "Sync Facebook reviews" → pending imported reviews that, once
  approved, render on the existing System-A surfaces — **if the capability verifies**.

### 4.7 Phase summary

| Phase | Delivers | Renders in-phase? | New AWS/infra? | Gated on |
|---|---|---|---|---|
| `rev-1` | Image field on schema + import DTO + render slot | **yes** (product page) | no | D-REV-1 |
| `rev-2` | Bulk CSV/JSON + media-ZIP importer | yes (via rev-1 surface) | maybe (IAM to assets bucket) | D-REV-2, D-REV-3, D-REV-5 |
| `rev-3` | Batch moderation + media approval UI | yes | no | D-REV-4 |
| `rev-4` | Renderer gallery block | **yes** (the point) | no | D-REV-1, D-REV-2 |
| `rev-5` | Google connector | yes (if photos) | yes (OAuth secret) | **§ 3 Google gate**, D-REV-5 |
| `rev-6` | Facebook connector | yes (if capability) | yes (OAuth secret) | **§ 3 FB gate**, § 2.5-D2 |

---

## 5. Non-goals of the whole track

- **AMODX does not become a review-solicitation platform** (sending review-request emails,
  collecting first-party reviews via forms) — this track is *import + display*, not
  acquisition. That is a separate opportunity.
- **AMODX does not host arbitrary third-party media hot-linked forever without a decision** —
  D-REV-2 settles re-host vs hot-link explicitly.
- **AMODX does not auto-publish imported reviews** — everything imported is `pending` until a
  human approves (§ 4.3). Reviews are legal/reputational content; the moderation gate is a
  product guarantee, not a nicety.
- **No cross-tenant review sharing** — every review is keyed under `TENANT#<tenantId>`
  (PD-001, tenant isolation).

---

## 6. Decisions requiring ratification

Five. D-REV-1 (image shape) and D-REV-5 (attachment) block phase scoping and matter first.
Each is problem-first with RISK/REWARD per option, per repo convention.

DECISION_REQUIRED:
- ID: D-REV-1
  QUESTION: How are review images represented on the schema — an image array on
    `ReviewSchema`, or separate image items keyed under the review?
  PROBLEM: `ReviewSchema` (`index.ts:1256-1268`) has no media field. Reviews can carry
    zero-to-many photos. The representation determines the projection cost on every read
    (§ 2.1) and whether per-photo moderation state (D-REV-4) has somewhere to live. A review
    is a single DDB item today (SK `REVIEW#<productId>#<id>`); photos can be (A) inline on that
    item or (B) their own items.
  OPTIONS:
  - A) `images: z.array(ReviewImageSchema).default([])` inline on the review item, where
    `ReviewImageSchema` = `{ url, status?: approved|pending|hidden, width?, height?, alt? }`.
    REWARD: one item = one read, no fan-out; per-photo moderation fits as a field; matches the
    additive-`.default()` backward-compat convention (MEMORY). Simplest thing that renders.
    RISK: DDB 400 KB item cap bounds photo count/metadata (fine for realistic review galleries,
    ~1-10 photos); a projection that forgets `images` silently drops all photos (mitigated by
    enumerating projections in `rev-1`).
  - B) Separate `REVIEWIMG#<reviewId>#<imgId>` items. REWARD: unbounded photos, per-photo
    lifecycle is a first-class record. RISK: every review render becomes a second query or a
    fan-out (the § 2.1 SSR path already paginates reviews — this multiplies reads); more
    handlers, more moderation surface; over-built for the demonstrated need (bulk import of a
    handful of photos per review). Violates "architecture earned by demonstrated variation."
  RECOMMENDED: A — inline array. It is the smallest shape that satisfies the ratified behavior
    (reviews with a handful of photos, rendered + moderated), keeps reads O(1) per review, and
    follows the estate's additive-default convention. B is debt with better PR unless a tenant
    demonstrably needs unbounded per-review galleries.
  BLOCKING_REASON: `rev-1` cannot define the schema, the import DTO, or the render slot without
    this; every later phase builds on the chosen shape.

DECISION_REQUIRED:
- ID: D-REV-2
  QUESTION: Where do imported review photos live — re-hosted into the existing assets bucket,
    or hot-linked to the Google/Facebook CDN URL in the export?
  PROBLEM: The export's media ZIP (or a connector payload) gives us image bytes or CDN URLs.
    The estate has TWO image-ingestion paths (§ 2.3): the browser-presign path
    (`backend/src/assets/create.ts`) which **does** run `validateUpload` on the DECLARED
    content-type/size (a declaration/allow-list check, not byte inspection), and the
    existing **server-side** put primitive `downloadAndUploadImage`
    (`backend/src/lib/image-upload.ts`) — already used by the WordPress importers — which writes
    the same `ASSET#`/bucket shape but is **NOT** guarded (it trusts the upstream `content-type`
    and buffers the whole response, § 2.3). A server-side review import would reuse the second.
    Hot-linking avoids storage but ties display to a third-party URL we do not control.
  OPTIONS:
  - A) Re-host into the assets bucket (same `${tenantId}/<assetId>` key + `ASSET#` record) by
    reusing the **storage tail** of `downloadAndUploadImage` (`image-upload.ts:42-70`). REWARD:
    durable, same-origin (helps the `_next/image` path once `opennext-1` lands), tenant-scoped, we
    control the URL, and the S3-put + `ASSET#` write is a **proven step already wired for the
    WordPress importers** — no new storage seam. RISK: the reuse is *partial* — the primitive's
    front door is a `fetch(url)` (`image-upload.ts:23-35`), so it ingests connector/hot-link
    **URLs** directly but **not media-ZIP entries** (bytes in hand, no URL); the ZIP path (rev-2's
    core) needs the tail factored into a bytes-taking put, small but real (§ 2.3). And the
    primitive is **currently unguarded** — it trusts the upstream/declared MIME and caps nothing,
    so `rev-2` must add a guard. **That guard is `validateUpload`, which validates the *declared*
    `content-type`+size against `ALLOWED_UPLOAD_MIMES`/`MAX_UPLOAD_BYTES` (`media.ts:91-101`) — a
    declaration/allow-list check, not byte inspection.** It does not confirm the bytes are the
    image they claim; that residual is D-REV-4. The advisory-size gap (§ 2.3) also persists;
    storage cost applies.
  - B) Hot-link the Google/FB CDN URL. REWARD: zero storage work, zero bytes moved. RISK: link
    rot (Google/FB rotate/expire media URLs → broken galleries), no MIME/malware control (we
    cannot even attempt to scan bytes we do not hold), an external dependency on every page
    view, and likely a ToS problem redistributing their CDN assets. Fragile for a display we are
    selling as durable.
  RECOMMENDED: A — re-host via the primitive's storage tail, **plus the mandatory `validateUpload`
    declaration guard `rev-2` must add**. It is the one path that yields a durable, same-origin
    image and reuses a proven storage step rather than inventing a parallel one. Be honest about
    the two named costs: (1) the ZIP path needs the tail factored into a bytes-taking put (the
    `fetch()` front door does not ingest ZIP bytes), and (2) `validateUpload` only re-checks the
    *declared* MIME/size — it is a declaration guard, **not** byte inspection, so it does not by
    itself make imported bytes as trustworthy as browser-uploaded ones (those go through the same
    declaration check, not a stronger one). Byte-level trust is D-REV-4's re-encode/scan. The
    genuine work here is closing the declaration gap and factoring the shared put — not a new
    seam, and not a false claim of full byte validation.
  BLOCKING_REASON: `rev-2`'s storage step and `rev-4`'s render URL both depend on this; it also
    sets whether D-REV-4 scanning is on our bytes or someone else's.

DECISION_REQUIRED:
- ID: D-REV-3
  QUESTION: How are rights/consent for imported review images handled — do we record a rights
    basis per import, and gate publication on it?
  PROBLEM: Customer-submitted review photos are third-party content. Redisplaying them on a
    commercial site has a consent/licence dimension that the estate captures nowhere (§ 2.7:
    no rights/consent field on any record). This is a legal-exposure decision, not a UI one.
  OPTIONS:
  - A) Record a rights attestation per import batch (the tenant asserts they have the right to
    display), store it on the review/asset, and require it before `rev-3` can approve.
    REWARD: an auditable consent trail; publication is gated on an explicit human assertion;
    cheap (one flag + one attestation record). RISK: it is an attestation, not verification —
    it shifts liability to the tenant but does not eliminate it; needs legal review of wording.
  - B) No rights handling — import and display as-is. REWARD: zero work. RISK: unbounded
    legal/reputational exposure for AMODX and the tenant; a takedown/GDPR request has no
    handle to act on. Unacceptable for content we publish on the tenant's behalf.
  RECOMMENDED: A — per-batch attestation gating publication. It is the minimum that makes
    publication a deliberate, recorded act. The exact wording and whether per-photo consent is
    ever needed is a legal-review question the slice must carry, not resolve in code.
  BLOCKING_REASON: `rev-2` writes the import and `rev-3` approves it; both need to know whether
    a rights gate exists and what field carries it.

DECISION_REQUIRED:
- ID: D-REV-4
  QUESTION: How is imported/uploaded review media moderated for malware/abuse before it renders
    on a public page?
  PROBLEM: No upload path in the repo scans content (§ 2.7). The browser path
    (`assets/create.ts`) enforces the DECLARED MIME header (not bytes) + size (advisory only); the **server-side import
    primitive `rev-2` reuses (`downloadAndUploadImage`) enforces neither** — it takes MIME from
    the upstream header and applies no allow-list or size cap (§ 2.3). Imported media is
    attacker-influenced input (a malicious export, or a compromised CDN URL under D-REV-2 option
    B) that will be served to the public. Note the split from D-REV-2: `validateUpload`
    re-validation (which `rev-2` must add) is a **declaration/allow-list check on the *claimed*
    MIME+size (`media.ts:91-101`), not byte inspection** — it closes the MIME/size *declaration*
    gap but says nothing about payloads that are valid-looking images carrying an exploit. That
    residual — byte-level trust — is exactly what this decision governs. Abuse also includes
    off-topic/NSFW imagery, a human-moderation concern.
  OPTIONS:
  - A) Human moderation only — every photo is `pending` and a person approves it in `rev-3`
    before it renders (per-photo state from D-REV-1). REWARD: catches abuse/NSFW that no scanner
    does; reuses the moderation gate we already ship. RISK: does not catch malware in the file
    bytes; scales poorly for large imports.
  - B) Human moderation + a **byte-level** step (image **re-encode** to strip payloads — the
    control that actually inspects/normalises the bytes — plus optional AV/abuse scan). This is
    distinct from the D-REV-2 `validateUpload` declaration guard, which never touches the bytes.
    REWARD: defence in depth — closes the malware vector A and the declaration guard both leave
    open; re-encode also normalises formats. RISK: more infra (a scan/re-encode step / Lambda),
    cost, and it only bites if D-REV-2 = re-host (we cannot re-encode bytes we hot-link).
  RECOMMENDED: A for the first shippable slice (the moderation gate exists and is the real
    abuse control), with B's **re-encode on our own bytes** folded into `rev-2` *if* D-REV-2 =
    re-host — it is cheap on bytes we already stream and is the first control that actually
    verifies the payload (the `validateUpload` guard does not). Full AV is a later hardening, not
    `rev-2` scope. Do not gate the track on B.
  BLOCKING_REASON: `rev-3`'s per-photo approval state (from D-REV-1) and `rev-2`'s storage step
    both depend on the chosen moderation model.

DECISION_REQUIRED:
- ID: D-REV-5
  QUESTION: What does an imported review attach to — a product (System A's only current model),
    a page, or the business/site as a whole?
  PROBLEM: System A is **product-attached by key construction** — `SK = REVIEW#<productId>#<id>`
    and the public/renderer reads require a `productId`; only the admin prefix-list does not (§ 2.6). But Google/Facebook reviews are almost always
    **business-level** (about the place, not one SKU). An importer has nowhere to write a
    business-level review today, and the public route is `GET /public/reviews/{productId}`. The
    packet names three candidate anchors — product, **page**, and business/site — so all three
    are enumerated below rather than collapsed.
  OPTIONS:
  - A) Product-attachment only; require the import to map each review to a product.
    REWARD: zero storage change; reuses every existing read/render path unchanged. RISK: most
    real Google/FB reviews are not about a product — forcing a mapping is either impossible or
    fabricated; defeats the track's purpose for the common case.
  - B) Page-attachment — key reviews to a content page (`SK = REVIEW#PAGE#<pageId>#<id>` or a
    `pageId` anchor), so a tenant hangs a review set on, e.g., a "Reviews" or "About" page.
    REWARD: reuses the same by-id mechanism as product-attachment, just pointed at a page; lets
    a tenant curate reviews per landing page. RISK: it re-encodes the *same* mismatch as A one
    level up — a Google/FB review is not *about* a page any more than it is about a SKU, so the
    page-to-review mapping is an arbitrary editorial choice the importer cannot infer; it adds a
    key shape + read path for an anchor that still does not model what the reviews are, and pages
    are volatile (deleted/re-slugged) so the review set orphans. It solves "where does it render"
    but not "what is it about."
  - C) Business/site-level key (e.g. `REVIEW#SITE#<id>` or a `scope` discriminator on the key),
    with its own public read + a render surface (the `rev-4` gallery is the natural home).
    REWARD: models what Google/FB reviews actually are — one place-level set per tenant; product
    reviews keep their existing key untouched; the importer needs no per-review anchor guess.
    RISK: a new key shape + a new read path + a render surface — real work, and it is a
    data-shape change crossing the storage boundary (halt-and-ratify class per CLAUDE.md).
  - D) Both/scope discriminator — reviews carry `scope: product|site` (optionally `|page`) and
    each scope uses its own key. REWARD: covers every case explicitly. RISK: the § 2.5-D2 enum
    divergence plus a scope discriminator is a lot of schema surface; only justified if tenants
    demonstrably import more than one kind.
  RECOMMENDED: C — add a business/site-level key, because the demonstrated need (import Google/FB
    reviews) is precisely the business-level case, product reviews already work, and it is the
    only option that models what the reviews *are* rather than where they happen to render.
    Page-attachment (B) is explicitly rejected for the import track: it inherits A's
    what-is-this-about mismatch and adds orphan-on-page-delete fragility, while giving the
    importer no non-arbitrary way to pick a page. If a tenant later wants to *curate* a review
    set onto a specific page, that is a display/placement concern the `rev-4` gallery block can
    serve by pointing at the site-level set — it does not require a page-scoped storage key.
    Defer D until a tenant demonstrably needs per-product *imported* reviews. This is a
    data-shape change crossing a boundary → it is **ratification-class**; do not let `rev-2`
    invent a key silently.
  BLOCKING_REASON: `rev-2` cannot write an imported business-level review, and `rev-4` cannot
    read one, without the key/scope model. This is on the critical path for the whole import.

---

## 7. ROADMAP reconciliation

The `docs/ROADMAP.md` REV row is updated by this slice to:

- cite the **real schema enum** (`source: google/internal/imported`, not `google/imported`)
  and the reserved `googleReviewId`;
- name the **two-system split** (DB-backed product reviews vs the static `reviews-carousel`
  block) so a reader does not assume one system;
- point at this plan (`docs/plan-reviews-import.md`) and its five ratification-class decisions;
- restate the gate as **media rights/consent (D-REV-3), media storage/moderation (D-REV-2/4),
  attachment model (D-REV-5), and connector API access (`VERIFY-AT-PHASE-START`, § 3)** — the
  connector claims in the human's notes remain unverified.

No other ROADMAP row changes. Phase numbering `rev-1`..`rev-6` matches § 4 and the row exactly.

## 8. Follow-up actions (named, not done by REV-1)

- Register the `rev-` prefix in `docs/documentation.md` § *Naming Conventions* — with the first
  `rev-1` slice doc (matches `email-1`'s deferral of its own prefix).
- Add a `docs/TECH-DEBT.md` entry for the two source-enum defects (§ 2.5 D1/D2) — with `rev-1`,
  which is the slice that touches `ReviewSchema`.
