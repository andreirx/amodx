# MIGRATION-UPLOAD-1 — the admin Migration screen can upload an export again, to a private place

Status: **IMPLEMENTED 2026-11-27** (code complete, revision 1 after review-0; operator gates and the staging proof
pending). Track: import.
Depends: `import-paths-1` (shipped; its admin path is blocked by F-MIGRATION-UPLOAD-REFUSED). Source plan: none — the
operator closeout of `docs/slices/import-paths-1.md` (F-MIGRATION-UPLOAD-REFUSED) and the operator ruling below.
Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`. Base `f3aec88`. Maturity target: MATURE (the upload path); the
Migration screen stays PROTOTYPE (no DOM test, no end-to-end test).

## Purpose / risk retired

1. The admin Migration screen cannot start its media step, its "Check addresses" or its pages import: they upload the
   WordPress export through `POST /assets`, which accepts images and videos only (`packages/shared/src/media.ts`
   `validateUpload`, `ALLOWED_UPLOAD_MIMES`) and answers 400 `File type "application/xml" is not allowed` (OBSERVED on
   staging 2026-11-27, `import-paths-1` closeout).
2. `/assets` stores under the public media bucket, at an address the CDN serves. A WordPress export holds commenters'
   names and mail addresses. It must not be stored at a public address (VISION guarantee 2: public/private trust
   boundaries).

## Operator ruling (decided before the build; precedent: REV-2A's private staging)

Do not widen `validateUpload`; do not store an export in the public bucket. The export goes to the PRIVATE bucket under
a prefix of its own, with a grant scoped to that prefix, read by the importers, deleted when no longer needed, with a
one-day lifecycle rule as the backstop.

## Cause and call-site inventory (base `f3aec88`; OBSERVED on the code)

| Caller | What it sends | Affected by the defect |
|---|---|---|
| `admin/src/pages/Migration.tsx:64-89` `uploadToS3` | `POST /assets` `{ filename: "migration/<name>", contentType: file.type \|\| "application/xml", size }`, then a PUT to the public bucket; the key was read back from `publicUrl` | the cause |
| `Migration.tsx:97` media step → `POST /import/media` `{ s3Key, batchStart, batchSize: 50 }` (:108) | uploaded key | yes |
| `Migration.tsx:184-186` `uploadedPagesKey` → the check (:198, `?dryRun=1`) and the import (:217) of `POST /import/wordpress` through `admin/src/lib/wpImportRun.ts` | uploaded key, one upload for both | yes |
| `Migration.tsx:168-170` products step → `POST /import/woocommerce` `{ csvContent }` | the CSV text inline | no (not in this slice) |
| `admin/src/pages/Products.tsx` "Import CSV" → `POST /import/woocommerce` `{ csvContent, currency }` | inline | no |
| `admin/src/pages/ContentList.tsx:87` → `POST /import/wordpress` `{ wxrContent }` | the export inline | no (stays as it is) |
| `admin/src/pages/Reviews.tsx` → `POST /import/reviews` | inline | no |
| MCP server (`tools/mcp-server/src/index.ts`) | its only import tool is `import_glam_pricelist` → `POST /import/glam-pricelist`; no tool sends a WordPress export or calls `/import/wordpress` or `/import/media` | no; nothing changed |

Server side before this slice: `backend/src/import/media.ts:112` and `wordpress.ts:142-146` accepted an `s3Key`
starting with `<tenantId>/` (BACKEND-CONTRACT-1 D4, after `requireRole(auth, ["TENANT_ADMIN", "EDITOR"], tenantId)`)
and read it from `UPLOADS_BUCKET` (the public media bucket).

No presign route exists for the reviews import: `reviews.ts` receives its file inline and stages bytes server-side
under `review-staging/<tenantId>/…` (`backend/src/lib/review-media.ts` `reviewStagingBase`). The only presign into the
private bucket is `backend/src/resources/presign.ts` `uploadHandler` (`POST /resources/upload-url`): it writes a
`RESOURCE#` record (a digital product file) and has no role check, so reusing it would change its contract → one new
handler.

## Scope (as built)

1. **`POST /import/upload-url`** (`backend/src/import/upload-url.ts`) `{ filename, contentType, size }` →
   `{ uploadUrl, s3Key }`: a presigned PUT, 300 s, in the private bucket at
   `migration/<tenantId>/<uuid>-<safe file name>` (safe name: `[A-Za-z0-9._-]`, other runs → `_`, leading `.`/`_`
   removed, ≤ 100 characters, empty → `upload`). Content types `application/xml`, `text/xml`, `text/csv`. Size: a
   number, > 0, ≤ 40 MB (`MIGRATION_UPLOAD_MAX_BYTES` = 41 943 040; revision 1, § Size limit). Role check as the import routes:
   `requireRole(auth, ["TENANT_ADMIN", "EDITOR"], x-tenant-id)` (GLOBAL_ADMIN passes; no service scope, so a service
   key is refused). Writes no record and no audit: the link stores nothing until the PUT; the import audits as before.
   **Signing (revision 1, review-0 F-MU1-SIGNING).** The link's contract is set in the handler, not by SDK defaults:
   `S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" })` and `signableHeaders: content-type`. With the
   repository's SDK 3.1009.0 the defaults sign only `host` and add `x-amz-checksum-crc32` of the EMPTY body to the URL
   (EXECUTED: `.agent-manager/slices/MIGRATION-UPLOAD-1/signing-probe.mjs`), so S3 would refuse the real file; with the
   two settings the URL signs `content-type;host` and carries no checksum. Pinned against the real presigner by
   `backend/test/unit/migration-upload-1-signing.test.ts`. The deployed functions use the Lambda runtime's SDK
   (`externalModules: ['@aws-sdk/*']`), whose version is not inspected: an SDK older than 3.729 has no checksum default
   and ignores the setting (INFERRED); `signableHeaders` is honoured by every v3 presigner (INFERRED).
2. **The importers read the private key** (`backend/src/import/migration-upload.ts` `readMigrationUpload`, used by
   `wordpress.ts` and `media.ts`). The key rule, before any S3 call: owned = `migration/<caller tenant>/` + exactly
   `<uuid>-<safe name>` (no `/` after the tenant id). Any other key under `migration/` → 403 "s3Key is not owned by
   this tenant" (the message and status of the check before). A key outside `migration/` — the old public form
   `<tenantId>/<assetId>-…` included — → 400 "s3Key is not a migration upload: get the upload link from POST
   /import/upload-url". A non-string key → 400. At least as strict as before: the same `requireRole` runs first; the
   prefix is longer; the rest of the key is pinned to the built form.
   The inline `wxrContent` path is unchanged (no S3 call).
3. **Object missing** → 404 "The uploaded file is no longer stored (it is deleted after the import and expires one day
   after the upload). Upload the file again." S3 answers a missing key with `NoSuchKey` only to a caller with
   `s3:ListBucket`; the importers have no list right (least privilege), so S3 answers them `AccessDenied` (403) for a
   missing key. After the key rule passed and with `s3:GetObject` on `migration/*`, both mean a missing object, and
   both map to the 404. Trade-off: a broken grant would also read as "upload again" — the grant is pinned by the infra
   tests (mu1-iam), and the S3 error name is logged.
4. **Object over the limit** (the PUT link does not bind the length, as `/assets`) → 413, the body is not read. The
   messages of the 400 and the 413 are built from the one constant (`SIZE_ADVICE`: the limit in bytes and MB, and how
   to split a WordPress export), so no message can state another limit.
5. **Batch cursor (revision 1, review-0 F-MU1-EARLY-DELETE).** Rule: *`complete` means every position of the export
   was attempted in some batch* — never that an offset passed a list that shrinks between requests. Before, the media
   importer indexed the attachments not yet in the media map; each batch writes mappings, so the next offset skipped
   attachments and `complete` came early (pre-existing; with deletion on `complete` it would delete the upload before
   every attachment was tried). Now its cursor walks the export's own attachment order; an attachment already mapped is
   skipped inside its batch (`batchSkipped`); `processedSoFar` counts positions out of `total`; `batchStart` (integer
   ≥ 0) and `batchSize` (integer ≥ 1) are checked, so the cursor always advances. The WordPress importer already obeys
   the rule: both of its paths slice a list built from the export alone (`parseWXR(…).filter(isPost)`, or
   `planAddresses(items, reserved)` over the whole export with the tenant's prefixes; OBSERVED on the code). The admin
   media loop sums the per-batch counts (an answer's `alreadyImported` also counts what this run imported before it);
   its progress line now reads "Progress: <n>/<total> images checked (<k> already imported)..."; the final line is
   unchanged.
6. **Deletion.** One upload serves the check (every batch, dry run) and the import (every batch), so the object is
   deleted by the importer **in the request that answers `complete: true` of an import that is not a dry run**:
   `wordpress.ts` (both option paths; a dry run never deletes) and `media.ts` (the request whose batch reaches the
   export's last attachment position, item 5; an export with no attachment completes on the first call). A failed delete is logged, not answered (the import is done). Backstop: lifecycle rule
   `ExpireMigrationUploads` on `migration/`, 1 day (S3 expires at the next UTC midnight after the day, then
   asynchronously: in practice within about 48 h). Not deleted: the upload of an import that stops before its last
   batch, of a check never followed by an import, and of a media import that fails part way — the lifecycle rule
   removes them. When the gateway times out on the last batch, the function may still finish it and delete the upload
   (§ Size limit, "the gateway times out").
7. **Admin** (`admin/src/lib/migrationUpload.ts`, `Migration.tsx`): every uploading step (media; the pages check and
   import) uses `POST /import/upload-url` and PUTs the file with the content type the link was signed for. A refused
   link shows the server's message (`API Error (400): …`); a refused PUT shows "The upload of "<name>" failed: the
   storage answered HTTP <status>. Try again." The pages step drops its cached key after a complete import and on a
   404, so the next check uploads the file again. UI text: the initial markup is unchanged —
   `admin/src/pages/Migration.test.ts` still renders markup equal to `__markup__/migration.content.html` and
   `migration.commerce.html` (EXECUTED, pass); one dynamic text changed (revision 1): the media step's progress line,
   shown while an import runs, now reads "Progress: <n>/<total> images checked (<k> already imported)..." (item 5). The
   result lines and every other text are unchanged.
8. **Infra.** `MigrationUploadUrlFunc` in `CatalogApi` (functions-only nested stack, like its import siblings) with
   `PRIVATE_BUCKET` and exactly `s3:PutObject` on `<private bucket>/migration/*`; route `POST /import/upload-url` in the
   parent (`api.ts`), as its siblings. `ImportFunc` and `MediaImportFunc`: `PRIVATE_BUCKET`, and exactly
   `s3:GetObject` + `s3:DeleteObject` on `<private bucket>/migration/*`. No list right, no bucket-wide grant. Their
   public-bucket `grantReadWrite` stays: both still write images there (`lib/image-upload.ts` `PutObjectCommand`).
   Lifecycle rule on the private bucket (`infra/lib/uploads.ts`).

### Size limit — the arithmetic (revision 1, review-0 F-MU1-MEMORY-BOUND)

Each batch request reads the whole object into one string and parses all of it (both importers), so its cost depends
on the file's size AND its structure. Revision 0 measured one page-shaped export and claimed "≤ 8 × the file"; review-0
showed a dense-element file at 28.8 ×. Re-measured (EXECUTED, Node 22.21.1, the build machine): one request's peak RSS —
the object bytes as S3 returns them, the decoded string, the parse — from `process.resourceUsage().maxRSS` (the parse is
synchronous: a timer cannot sample during it), with BOTH parsers (`parseWXR`, and the options of `media.ts`
`parseMediaXml` copied verbatim). Invented files; scripts kept untracked at
`.agent-manager/slices/MIGRATION-UPLOAD-1/memory-gen.mjs` and `memory-measure.mts`.

At 16 MB (ratio = peak growth / file size; parse time; `parseWXR` / media parser):

| Shape | Ratio | Time |
|---|---|---|
| pages with content and a comment (a real export's shape) | 5.6 / 5.6 | 0.2 s |
| attachment items (a real media export's shape) | 13.2 / 12.6 | 0.75 s |
| page items with 50 `wp:postmeta` each | 14.4 / 14.4 | 0.9 s |
| `<x a="1" b="2" c="3"/>` repeated | 15.2 / 15.3 | 2.0 s |
| empty `<item/>` repeated | 34.0 / 24.7 | 2.3 / 1.7 s |
| `<x a="1"/>` repeated (review-0's case) | 29.2 / 29.2 | 2.3 s |
| `<x/>` repeated | 36.4 / 36.3 | 2.4 s |
| `<x>1</x>` repeated (worst) | 49.2 / 48.8 | 2.4 s |

Directly at the chosen limit, 40 MB: `<x>1</x>` peak 1981 / 1980 MB, parse 15.3 / 10.7 s; attachments 555 / 539 MB,
2.0 / 2.2 s; pages 294 / 293 MB, 0.5 s.

- **Budget (revision 2, review-1).** `ImportFunc` and `MediaImportFunc` have 3008 MB. V8's old space on Lambda is
  ≈ 90 % of the function memory, ≈ 2700 MB (INFERRED: a community copy of the Lambda Node bootstrap; AWS documents
  only that Lambda sets a default `NODE_OPTIONS`). The batch's own work, kept apart from the measured parse:
  - media importer: 50 image copies in parallel, each ≤ 10 MiB of payload (`lib/image-upload.ts` `MAX_IMAGE_BYTES`,
    enforced) = 500 MiB of payload capacity. `readCapped` keeps the chunks while `Buffer.concat` allocates the joined
    body, so up to 2 × = 1000 MiB of payload-derived buffers (arithmetic from the code, OBSERVED). SDK, HTTP and TLS
    allocations of the copies and of the `PutObject` are NOT measured.
  - WordPress importer: featured images one at a time (≤ 2 × 10 MiB at once) plus the page conversions (not measured).
- **Limit 40 MB, by shape** (measured parse + arithmetic for the copies + an unmeasured remainder):
  - a real media export (attachment items): 555 MB + ≤ 1000 MiB ≈ 1.6 GB + unmeasured, against 3008 MB;
  - a real pages export: 294 MB + ≤ 20 MiB + unmeasured;
  - the worst parse shape (dense `<x>1</x>`): 1981 MB, and no image work — it holds no attachment and no page;
  - NOT covered: a file that mixes the worst parse shape with a full batch of images: ≈ 1981 MB + 1000 MiB +
    unmeasured can exceed 3008 MB.
  100 MB failed even the parse alone (49 × 100 MB ≫ 3008 MB). A larger export is split in WordPress (Tools → Export by
  content type or date range); the refusal says so.
- **Time.** API Gateway answers the browser after at most 30 s (the HTTP API integration limit). The functions'
  timeout is 15 min, and the function keeps running after the gateway has answered. The real shapes parse in ≤ 2.2 s
  here at 40 MB. The dense shape took 10.7–15.3 s here and can exceed 30 s on Lambda (INFERRED: Lambda's speed not
  measured).
- **What is enforced and what is not.** Enforced: the input size (the link refuses a declared size over the limit; the
  importers refuse a stored object over it, 413, before reading) and the payload of one image copy. NOT enforced: the
  parse cost, and the allocations beyond the payload. The length check alone is not a memory-safety guarantee. Two
  failures stay possible, with different outcomes:
  - **the function ends during the parse** (out of memory): the parse precedes every write of both importers
    (OBSERVED on the code), so that batch writes nothing; the upload stays until a later complete import with the same
    key deletes it, or the lifecycle rule removes it.
  - **the gateway times out** (the browser gets an error answer; its exact status is not verified here): the function can continue, finish the parse, write the batch and,
    on the last batch, delete the upload (no deadline cancellation exists in either importer; INFERRED from AWS's
    timeout model, not reproduced). The outcome is UNCONFIRMED for the operator, not "nothing written". The screen
    shows the error and stops; the pages step then needs a new check (the flow consumed the old one), and if the upload
    was deleted that check answers 404 and the next one uploads the file again; a media step run again uploads anew.
    A repeated batch updates the pages it already wrote and skips images already mapped (`import-paths-1` closeout: a
    second import of the same export added no page and no route, every page row `update` — OBSERVED on staging; the
    media skip: item 5).
- The inline `wxrContent` path stays bounded by the API's request size, as before.

### Abstractions introduced (one line each)

- `backend/src/import/migration-upload.ts` — key form, key rule, read, delete. Users: `upload-url.ts`, `wordpress.ts`,
  `media.ts`. Axis: none (removes duplicated non-trivial logic in the two importers). Rejected: the rule, the read and
  its error mapping inline twice.
- `admin/src/lib/migrationUpload.ts` `PutFile` — the injected PUT. Users: `Migration.tsx` (`putWithFetch`) and its test.
  Axis: none; the test seam of the DOM-less admin tests (as `ApiCall` in `wpImportRun.ts`). Rejected: the upload inside
  the component, testable only with a DOM runner.
- `grantMigrationReadDelete` (local in `api-catalog.ts`) — one statement for two functions. Users: `ImportFunc`,
  `MediaImportFunc`. Axis: none. Rejected: the same statement written twice.

## Non-scope

Any change to `validateUpload` or `/assets`. The MCP server's import tools (nothing sends a WordPress export; changed:
only `routes.json`, the route table its check reads). The WooCommerce CSV step (inline today). F-PREVIEW-REDIRECT-PREFIX.
The public-bucket grants of the two importers beyond verifying that they are still needed (see Findings).

## Architectural boundaries

- Tenant isolation: `requireRole` binds the caller to `x-tenant-id` before the key rule; the key rule binds the key to
  that tenant; IAM cannot know the tenant, so the grants are prefix-scoped only. No DynamoDB access added.
- Public/private: the export never reaches the public bucket; the presigned link is the only write path to
  `migration/*`; the renderer has no right on it.
- The parent template gains 3 resources (route, integration, invoke permission: INFERRED from the CDK constructs);
  the function, role and policy are in `CatalogApi`. Deployed parent ≈ 472, CatalogApi ≈ 65 (both < 500; EXECUTED,
  infra test split1-5).

## Migration / deployment notes

- One CDK deploy carries the backend functions, the route, the grants, the lifecycle rule and the admin assets
  (`infra/lib/admin-hosting.ts:77-78`, `BucketDeployment` of `admin/dist`; OBSERVED). CloudFormation does not order the
  admin upload relative to the function updates. Both transient orders are safe: an old screen against the new
  backend gets the 400 of `/assets` it already gets; a new screen against the old backend gets 404 (no route) or 403 (old
  key rule) — nothing is written in either case, and the screen is broken today.
- No data migration. Objects under `migration/` exist only after this deploy.
- Rollback: redeploy the previous commit. It removes the route, the grants AND the lifecycle rule, so first empty the
  prefix: `aws s3 rm s3://<private bucket>/migration/ --recursive` (the bucket name is the `PrivateBucketName` output).

## Definition of Done

- [x] Route, handler, importers, deletion, lifecycle, admin, infra, tests, docs (this record, `backend/ARCHITECTURE.md`,
  `admin/ARCHITECTURE.md`, `docs/TECH-DEBT.md` (two entries), ROADMAP row, MCP `routes.json`).
- [x] Builder gates (below).
- [ ] Operator: gates again, staging diff read, staging deploy, browser proof (below).

## Evidence taxonomy — bound tests

| Case | Expected | Test (all EXECUTED, pass) |
|---|---|---|
| admin asks a link for `.xml` / `.csv` within the limit | link + key under `migration/<tenant>/` | `backend/test/unit/migration-upload-1.test.ts` MU1-LINK-OK (3 types), MU1-LINK-SIZE-EDGE, MU1-KEY-FORM; admin `migrationUpload.test.ts` MU1-ADMIN-UPLOAD-OK, -NOTYPE |
| the link lets the browser PUT the file (revision 1) | signs `content-type;host`, no body checksum, 300 s, the answered key | `backend/test/unit/migration-upload-1-signing.test.ts` MU1-SIGNING (real presigner, dummy credentials, offline; 3 types) |
| other content type, over the limit, size missing | 400 with a message, no link | MU1-LINK-REFUSED (7 cases); the message reaches the screen: MU1-ADMIN-UPLOAD-REFUSED |
| caller without the import role | refused as the import routes refuse (403) | MU1-LINK-ROLE (forged header, CUSTOMER role, service key); MU1-LINK-EDITOR (admitted) |
| import with a key under the caller tenant's prefix | read from the private bucket | MU1-READ-OWN (both importers); `import-key-ownership.test.ts` (D4 cases, migrated) |
| key of another tenant; outside `migration/`; old public form | refused, nothing read | MU1-READ-REFUSED (6 cases × 2 importers), MU1-READ-FORGED |
| object missing (expired or deleted) | 4xx "upload the file again", not 500 | MU1-READ-MISSING (`NoSuchKey`, `AccessDenied`) → 404 |
| object over the limit | refused, not read | MU1-READ-OVERSIZE → 413 with the limit and the split advice |
| after the last batch of an import | object deleted; trigger = the `complete: true` answer of a non-dry-run import, and `complete` = every position attempted | MU1-DELETE-MEDIA, -MEDIA-NO-ATTACHMENT, MU1-DELETE-PAGES (option off/on); never on a check: MU1-KEEP-DRYRUN; delete failure: MU1-DELETE-FAILS; the media cursor with a media map that keeps its writes: MU1-MEDIA-CURSOR (review-0's reproduction: a.jpg, b.jpg, batch size 1), MU1-MEDIA-CURSOR-MIXED (an existing mapping, a failed download, new ones; the delete only in the request that tried the last position), MU1-MEDIA-CURSOR-REFUSED (a cursor that would not advance → 400) |
| `wxrContent` inline | unchanged, no S3 call | MU1-INLINE |
| grants and lifecycle | `migration/*` only; 1 day | infra `mu1-iam-1..4`, `mu1-route`, `mu1-lifecycle` |

Tests changed because this slice changes what they pinned (the class: a test of the old key form or of a count the
slice changes on purpose; each keeps its claim, on the new form):
- `backend/test/unit/import-key-ownership.test.ts` — the D4 cases on `migration/<tenant>/…` keys and the private
  bucket. Two `toHaveBeenCalledTimes(1)` became "the first S3 call is the GetObject": a complete import now also
  deletes.
- `backend/test/unit/image-destination-importers.test.ts` — the media case uses a migration key.
- `infra/test/amodx-stack.test.ts` — (rev2a) "exactly one rule" → exactly one rule on `review-staging/` and every rule
  of the bucket prefix-scoped (no blanket expiry); (split1-1) 15 → 16 functions; route keys + `POST /import/upload-url`;
  (cat-images-1) compares the uploads-bucket statements (MediaImportFunc has one more, on `migration/*`).
- `backend/test/unit/migration-upload-1.test.ts` (revision 1) — its media map now keeps its writes across requests
  (the map that never grew hid F-MU1-EARLY-DELETE); the link test expects the explicit `signableHeaders`.
- Not changed: `admin/src/lib/wpImportRun.test.ts` passes `"t1/migration/x.xml"` as an opaque key (the function
  forwards it); it asserts nothing about the key form.

## Builder gate results (2026-11-27, revision 2, final tree)

All EXECUTED by the builder on the final tree, in this order; exit 0 each.

| Gate | Result |
|---|---|
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix backend run test:unit` | 86 files passed, 2 skipped; 2238 tests passed, 2 skipped (51 in `migration-upload-1.test.ts`, 3 in `migration-upload-1-signing.test.ts`) |
| `cd admin && npm run test:unit` | 27 files, 457 tests passed (4 in `migrationUpload.test.ts`; `Migration.test.ts` markup equal) |
| `cd renderer && npm test` | 61 files, 929 tests passed (no renderer file changed) |
| `cd renderer && npm run test:serving` | 174 pass, 0 fail |
| `cd infra && npm test` | 89 passed; deployed parent ≈ 472, CatalogApi ≈ 65 |
| `cd tools/mcp-server && npm test` | route coverage 0 failures (136 routes); 17 shape tests pass |
| `git diff --check` (and `--no-index --check` on each new file) | no output |

## Operator proof (NOT RUN by the builder: needs a staging deploy)

On staging, a real browser on the Migration screen: upload the invented export
`backend/test/unit/fixtures/wordpress/import-paths-1.wxr.xml` in the media step and in the pages step; run "Check
addresses" and "Import Pages"; confirm in S3 that `migration/<tenant>/` is empty afterwards and that the object never
appeared in the public bucket. Also worth one look: the browser PUT to the private bucket succeeds with its CORS
(`infra/lib/uploads.ts` allows PUT from any origin, all headers; INFERRED to suffice, as `/resources/upload-url` uses it).

## Findings (not fixed here)

- **F-MU1-PUBLIC-GRANT-WIDE (pre-existing).** `ImportFunc` and `MediaImportFunc` keep `uploadsBucket.grantReadWrite`;
  after this slice they only PUT there (`lib/image-upload.ts`), so their read, list and delete rights on the public
  bucket are unused. Narrowing to the put actions is a separate IAM change (blast radius: the featured-image and media
  copies). Proposed, not applied; recorded in `docs/TECH-DEBT.md` (§ "Upload size limit is advisory").
- **F-MU1-PRESIGN-LENGTH (same class as the TECH-DEBT entry "Upload size limit is advisory").** The PUT link does not
  bind the length. The importers refuse an object over the limit on read (413), so the INPUT size is bounded (not the
  parse cost, § Size limit); storage of an oversized object until its deletion is not prevented. Recorded in the same
  TECH-DEBT entry.
- **F-MU1-PRESIGN-DEFAULTS-SIBLINGS (pre-existing; seen while fixing F-MU1-SIGNING).** `backend/src/assets/create.ts`
  and `backend/src/resources/presign.ts` sign PUT links with a default `S3Client({})`. With SDK ≥ 3.729 that signs an
  empty-body checksum (EXECUTED with 3.1009.0 for the configuration this slice had, the same as theirs). Whether the
  deployed functions are affected depends on the Lambda runtime's SDK version (not inspected). Not changed here
  (`/assets` is out of scope).
- **F-MU1-RESOURCE-UPLOAD-NO-ROLE (pre-existing, tenant isolation; seen while choosing the presign handler).**
  `backend/src/resources/presign.ts` `uploadHandler` (`POST /resources/upload-url`) calls no `requireRole`. The API
  authorizer does not tie `x-tenant-id` to the caller (comment in `backend/src/import/wordpress.ts`, BACKEND-CONTRACT-1
  D4), so an authenticated caller of one tenant can write a `RESOURCE#` record and a private object under another
  tenant's prefix (INFERRED from the code; not probed). Not changed here (outside the slice). Fix: the same
  `requireRole` as `/assets`.

## References

`docs/VISION.md` guarantee 2; `docs/slices/import-paths-1.md` operator closeout (F-MIGRATION-UPLOAD-REFUSED);
`docs/slices/rev-2b-bulk-import.md` (the prefix-scoped grant precedent); `infra/lib/api-catalog.ts` review grant comment.

## Operator closeout 2026-11-27 — SHIPPED on staging; production deploy pending (it carries an infrastructure change)

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, three cycles, approved.

Operator-executed on the final tree:

| Check | Result |
|---|---|
| Gates: build, typecheck, shared, plugins, renderer unit, serving, serving bundle, admin unit, backend unit, infra, MCP, `git diff --check` | every exit 0; no path under `renderer/`, `backend/src/assets` or `packages/shared/src/media.ts` changed |
| Staging diff, read before the deploy | new: `MigrationUploadUrlFunc` with its role, log group, route `POST /import/upload-url` and integration; permissions: `s3:PutObject` on `migration/*` for that function, `s3:GetObject` + `s3:DeleteObject` on `migration/*` for `ImportFunc` and `MediaImportFunc`; lifecycle rule `ExpireMigrationUploads` (prefix `migration/`, 1 day) on the private bucket; no resource replaced |
| Staging, a real browser on the admin Migration screen, tenant `cm1-content`, the repository's invented export | media step: `POST /import/upload-url` 200, PUT to the private bucket under `migration/cm1-content/` 200, `POST /import/media` 200, no `POST /assets`; the object is gone after the step |
| Same run, pages step | "Check addresses" shows the report (11 items, 5 with a problem, 2 that cannot be kept or redirected); one object in the private bucket during the step; "Import Pages" enabled after the complete check; the import answers 200 |
| After the import | `/cursuri/ceara` and `/2024/03/titlu` answer 200 on the site; the private bucket holds no migration object of the tenant; no uncaught page error |
| Cleanup | the 22 table items the run added are deleted; the tenant's key set equals the one before the run |

Findings of the operator run (not fixed here):

- **F-DEPLOY-SH-EXIT.** `infra/deploy.sh` answers exit 0 when `cdk deploy` refuses to continue: with no terminal
  attached and a diff that holds permission changes, CDK prints "unable to get a confirmation" and stops; the
  script's last command (the build-output cleanup) then sets the exit status. The first staging deploy of this
  slice deployed nothing and reported success; the staging check caught it (the old admin bundle was served).
  The operator then deployed the already-read diff to staging with `--require-approval never` (the switch the
  runbook `docs/runbooks/deploy-infra-split-1.md` uses). A deploy from a terminal shows the prompt and is not
  affected. Fix shape: keep the status of `cdk deploy` as the script's exit status.

Not verified on staging: the one-day lifecycle rule acting on an abandoned file (it runs on S3's schedule); a file
near the 40 MB limit; a key of another tenant through the deployed route (unit tests cover it).
