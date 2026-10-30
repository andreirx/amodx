# CAT-IMAGES-1 — ingest producer images into tenant media after import (IMPL slice)

Status: **READY 2026-10-28** — exists because `CATALOG-MODE-1` CM-D2 = (b) ingest, ratified with the destination policy
(`163c777`, § 4 CM-D2 corrected cell, § 8.5 "cat-images-1"). Depends on `cat-import-1` (reads its report's
`products[]` and per-row image disposition) and `cat-mode-1` (image absence rules, the update condition). Track: Glam
catalog. Image optimisation stays parked.

## 1. Purpose

A storefront is its images. Producer image URLs are a third party's web layout — they rot (the BNR incident: a silent
302-to-HTML). This slice copies every imported option image into the tenant's own media (S3 + CDN) so the catalogue's
pictures are the tenant's, without opening a server-side request-forgery path.

## 2. Scope (spec § 4 CM-D2, § 8.5)

1. **Input.** The import report: for each created product, the fresh `productId` and each option's image URL, plus
   the per-row image disposition. Every distinct source URL is copied once.
2. **Reuse, not a new map.** `downloadAndUploadImage` (`backend/src/lib/image-upload.ts`) and `MEDIAMAP#<md5(url)>`
   (`backend/src/lib/media-map.ts`) — idempotency by source URL; no `externalRef.media[]`.
3. **Destination policy inside `downloadAndUploadImage`, BEFORE any request** (ratified cell): http/https only;
   resolve the hostname and refuse if ANY resolved address is loopback, private (RFC 1918), link-local
   (`169.254/16`), CGNAT (`100.64/10`), IPv6 unique-local (`fc00::/7`), IPv6 link-local (`fe80::/10`),
   unspecified, or IPv4-mapped to any of those ranges (an IPv4-mapped PUBLIC address is allowed); connect to the
   checked address; `redirect: "manual"`, the whole policy re-run per hop, at most 3 hops; THEN the fetch timeout,
   the size cap and the magic-byte check (`image/jpeg|png|webp`). The WordPress (`import/wordpress.ts`) and media
   (`import/media.ts`) importers call the same helper and inherit the refusal — the operator confirms that
   behaviour change in this slice's review and records it.
4. **Rewrite.** On success the option's `imageLink` becomes the CDN URL, then `imageLink` and
   `additionalImageLinks` are derived again by the § 3.4 rule (first option with an image, then the other distinct
   option images); one `UpdateCommand` per product **with `ConditionExpression: "attribute_exists(PK)"`** (an
   unconditional update would upsert a product a replacement deleted meanwhile; a cancelled update means the product
   was replaced and the ingest of that product stops, reported). After a successful update the product's `CATPROD#`
   items are rewritten with the existing helper, as the product writers do today.
5. **Failure rule per source (C8-4).** A source that fails (policy refusal, timeout, non-image, 4xx/5xx) is REMOVED
   from the option that holds it (the option keeps its label, without an image — explicit `REMOVE`, never `""`/`null`,
   CM-D7); the sources that succeeded are kept; the derived fields are recomputed — when the original main image
   fails the next option image becomes the main one; when every source fails the product is imageless (the gallery
   renders nothing, the card shows its placeholder).
6. **Re-runs.** Products are recreated on each import (new ids); `MEDIAMAP#` keeps an already-copied URL from being
   fetched again, so a re-import costs no refetch for unchanged sources.
7. **Report.** Per product and per source URL: `ingested` (CDN URL) / `cached` / `refused` (policy, with the range
   that matched) / `failed` (status, content-type, bytes) — the admin import report's image section lists failures
   with the row and the producer URL so the client can source a picture by hand.

## 3. Non-scope

Image optimisation/resizing (parked); re-hosting of non-glam tenants' images; galleries beyond the derived fields;
projection consistency under concurrent admin edits (`CATPROD-CONSISTENCY-1`).

## 4. Architectural boundaries

The policy is one function with three concrete callers (glam ingest, WordPress import, media import) — the earned
shared helper, in `lib/image-upload.ts`; the ingest step is a pure decision per source (`new / cached / refused /
failed`) over a fetcher port, tested without the network. No new CDK resources (the media pipeline exists) — state it.

## 5. Definition of Done / evidence

- Unit: the policy — one row per prohibited range including an IPv4-mapped private address and an IPv4-mapped
  public address (allowed); a 302 to a private address refused at the hop; a 3-hop chain accepted, a 4-hop chain
  refused; a `text/html` body served as `image/jpeg` refused by magic bytes (the BNR shape); the decision per
  source over a fake fetcher; the update condition cancelled → reported, no write.
- Integration: an import of a 3-style fixture with one dead URL → 2 images ingested, 1 reported, the affected
  option imageless and the product's derived fields recomputed; a re-run → 0 fetches.
- Staging: the BOEN import with ingest (310 image rows expected per the operator's measure); the report's counts;
  three product pages with tenant-hosted images; a deliberately unreachable URL leaves its option imageless and the
  product still renders (operator-run). The WordPress importer's refusal of a private destination proven once.
- Typecheck + `npm run test:unit` bare-green; no new CDK resources (stated).

## 6. References

`docs/slices/catalog-mode-1.md` § 4 (CM-D2, CM-D7), § 3.4 (derived fields), § 8.5; `backend/src/lib/image-upload.ts`,
`backend/src/lib/media-map.ts`, `backend/src/import/{media,wordpress}.ts`; `docs/slices/cat-import-1.md` § 2.8 (report).

## 7. Launch amendment CIM-A1 (human rulings 2026-10-30; operator evidence)

**Evidence (operator, 2026-10-30, verified TLS from the operator's machine).** The enriched files carry: BOEN 310
image cells → 203 distinct URLs, all on `https://coreapi.boen.com`; ALPOD 1214 → 793 on `https://www.alpod.eu`; ITC
531 → 366 on `https://www.arcedition.com`. ALPOD and ITC samples answer `200 image/jpeg`, 30–275 KB, 0.12–0.28 s.
Every BOEN request fails: the host presents `CN=boen.com` (SAN `boen.com`, `*.boen.com`, issuer Buypass Class 2 CA 2,
serial `2E16B6566C364B12C74A`), valid `2019-02-20` → `2021-02-20`; Node `fetch` fails with `CERT_HAS_EXPIRED`, and a
browser refuses it too — the BOEN images that `cat-import-1` stores as producer URLs do not display today. The same
path on `http://coreapi.boen.com`, `https://www.boen.com` and `https://boen.com` answers `404 application/json`.
Whether `coreapi.boen.com` still serves the files is not known (not checked: a download without certificate checks
was not run).

**CIM-A1-1 — where the copy runs: browser batches (human).** A distinct-source copy of ALPOD's 793 images takes
minutes; the HTTP API answers 503 after 30 s. The copy runs as the media importer's pattern does
(`backend/src/import/media.ts`: one bounded batch per request, the admin page calls again until `complete`):
- route `POST /import/glam-pricelist/images`, body `{ producer, sheet }` (the same normalisation as the import, so
  the same `importSource`); the server reads the set by `importSource` itself — it never takes product ids or URLs
  from the request;
- each request processes distinct sources not yet copied, stops starting new sources at a time budget so that the
  whole request ends inside 30 s, records each success in `MEDIAMAP#` at once, then writes one conditional
  `UpdateCommand` per product it touched (successes → the CDN URL; failures → the option's `imageLink` removed; the
  derived fields recomputed by the one § 3.4 rule); it answers per-source results, progress and `complete`;
- termination: every processed source leaves the set's producer URLs (rewritten or removed), so each request
  shrinks the remaining work; a closed tab leaves producer URLs, and the next "copy images" resumes (copied sources
  come from `MEDIAMAP#` without a fetch);
- after a successful import the admin page starts the batches by itself, shows progress, and adds the image section
  to the report; the page also offers "copy images" for a pricelist without an import in the same session;
- scope `catalog:write`, the same as the import; MCP tool: not in this slice (follow-up `CAT-IMAGES-MCP-1`; the
  route is listed in `tools/mcp-server/routes.json` as the live route table);
- infra: the route, its integration and its invoke permission in the parent stack (three resources, like
  `cat-import-1`), served by the existing `GlamPricelistImportFunc`, which gains read/write on the uploads bucket
  and the `UPLOADS_BUCKET` / `UPLOADS_CDN_URL` variables — no new function. § 4's "No new CDK resources" reads:
  no new function, bucket or pipeline. Named gain: the copy must write to the uploads bucket and must be reachable
  by a route.
- REJECTED: a background job (self-invoke + stored job/report record + status route) — more state to build and
  review; its reward (survives a closed tab) is covered by resume.

**CIM-A1-2 — BOEN's expired certificate: allowed by a pin (human: "allow expired cert for BOEN").** Implemented in
its narrowest form inside the destination policy: a TLS connection whose certificate verification fails is refused,
EXCEPT when all hold: the request host is exactly `coreapi.boen.com`; the verification error is exactly
`CERT_HAS_EXPIRED`; the hostname check against the presented certificate passes; and the presented leaf
certificate's SHA-256 fingerprint equals
`4C:5E:21:C9:A9:2D:A3:1F:11:5C:15:38:EA:42:AB:49:9F:E0:1C:E2:0C:81:6C:D1:33:BE:88:39:66:42:6F:27`.
One constant entry in `lib/image-upload.ts`, no configuration layer. Every other host, error or certificate is
refused as before; the address policy, hop limit, timeout, size cap and magic-byte check apply unchanged. Risk
accepted by the human: a party holding that certificate's (expired) private key could serve any image for that host.
When BOEN renews its certificate, the normal path applies and the pin no longer matches anything. If the old server
no longer serves the files, the sources fail with their HTTP status and the products are imageless (§ 2 item 5).

**CIM-A1-3 — report kinds.** A failure without an HTTP answer (DNS, connect, TLS, timeout) is `failed` with the
error code (e.g. `CERT_HAS_EXPIRED`, `ETIMEDOUT`) instead of status/content-type/bytes.

**CIM-A1-4 — staging acceptance.** BOEN stays the acceptance pricelist: 203 distinct sources over 310 cells; the
record states how many were ingested, cached, refused and failed, with reasons. The "dead URL" proof uses a staging
copy of the BOEN file with one URL changed (operator-run).

## 8. Implementation record (builder, 2026-10-30; uncommitted on `main` at `ae24451`)

Status: **iteration 3 — review-2 CIM-F2-OVERLAP corrected (§ 8.11: the latest committed outcome per holding); the
§ 9 rulings stand as built in iteration 2 (copy provenance, the overlap row, § 8.3; CIM-F1-ATOMIC deferred, D).** Evidence labels: EXECUTED (run here), OBSERVED (read here), INFERRED, NOT RUN.

### 8.1 What changed, per packet item

1. **Destination policy** — `backend/src/lib/image-upload.ts`. `fetchImage` (`:309`) runs per hop, before any byte:
   `checkDestination` (`:212`, scheme http/https; `dns.lookup` `all: true` through an injectable `Resolver`; ANY
   address in a prohibited range → `refused` with the range) → `Connector` (`:231`, production: TCP/TLS to the
   CHECKED address; SNI, the certificate check and the `Host` header use the host name) → GET → manual redirects,
   `MAX_REDIRECT_HOPS = 3` (`:32`) → `SOURCE_DEADLINE_MS = 8 s` for all hops + body (`:34`) → `MAX_IMAGE_BYTES =
   10 MiB` (`:36`) → magic bytes (`imageTypeOf`, `:185`); the stored type is the magic-byte type. Ranges: `BLOCKED_IPV4`
   (`:77`) and `blockedRangeOf` (`:123`; IPv6 ::/128, ::1, fc00::/7, fe80::/10, ::ffff:0:0/96 → the IPv4 table, a
   mapped public address allowed; not-an-IP → refused, fail closed). The BOEN pin: `EXPIRED_CERTIFICATE_PIN` (`:42`)
   and the pure `acceptsTlsConnection` (`:64`) over the sum `TlsVerification = verified | failed{host,
   authorizationError, fingerprint256, hostnameCheckPassed}`; only `coreapi.boen.com` connects with
   `rejectUnauthorized: false`, and the connector then calls the decision. `copyImageToTenantMedia` (`:380`) returns
   `CopyResult = copied | refused | failed`; `downloadAndUploadImage` (`:431`) is its throwing wrapper.
   `uploadedBy` is now a parameter (`:418`); `media.ts:71` and `wordpress.ts:230` pass `"wordpress-importer"` — no
   reader of that value exists (OBSERVED: `grep -rn uploadedBy` over backend/src, admin/src, renderer/src,
   tools/mcp-server/src, packages/shared/src → writers and the schema type `index.ts:912` only; a text search, complete
   for those roots). The glam route writes `"glam-pricelist-images"`.
2. **Policy unit rows** — `backend/test/unit/image-destination-policy.test.ts`: 21 refused rows (one per range and
   edge, incl. IPv4-mapped private in dotted and hex form), 10 allowed rows (incl. IPv4-mapped public), the pin table
   (all true → accepted; each of host / error / hostname check / fingerprint false alone → refused; `verified` →
   accepted), magic bytes, and `fetchImage` over a local loopback server reached through a fake connector: the
   connection goes to the checked address; public + private resolution → refused, no connection; 302 to a private
   address → refused at hop 1, never connected; 3-hop chain accepted (4 resolutions, 4 connections); 4-hop refused;
   `text/html` as `image/jpeg` → `failed not-image`; 404; cap + 1 refused, cap exactly accepted; deadline (server and
   resolver that never answer) → `ETIMEDOUT`; DNS error code.
3. **Ingest core** — `backend/src/import/glam/images.ts` (pure; bundle check below): `collectSources` (`:54`),
   `decideSource` (`:68`), `resolveSources` (`:86`, `cached` first without a fetch, then `COPY_CONCURRENCY` workers
   that start a copy only while the budget allows; `allSettled` so an infrastructure error is raised only after every
   worker stopped), `rewriteProduct` (`:134`; success → CDN URL, failure → option `imageLink` key removed; derived
   fields by the injected § 3.4 rule), `remainingWork` (`:167`: `options` = (product, option) holdings still on a
   producer URL — the termination measure; `sources` = distinct URLs among them, informational). Rows:
   `backend/test/unit/glam-images-core.test.ts` (18).
4. **Handler** — `backend/src/import/glam-images.ts`: admission as the import (`requireRole(..., "catalog:write")`,
   then `checkUpload({producer, sheet})`, then the ConsistentRead tenant mode 404/403); the set = `PRODUCT#` query
   (ConsistentRead, every page) selected by `importSource` in code (`:212`); `MEDIAMAP#` read once (`loadMediaMap`),
   each success written at once; one `UpdateCommand` per touched product with `attribute_exists(PK)` (`:252`),
   `SET variants, additionalImageLinks, updatedAt[, imageLink]` / `REMOVE imageLink`, `ReturnValues: ALL_NEW`;
   cancelled → `products.replaced`, no `CATPROD#` write; success → `deleteCatProductItems` + `writeCatProductItems`
   (`:147`); `withInvalidation` (`:200`); audit `GLAM_PRICELIST_IMAGES` with `actor.email` and target title
   `Imagini <producer> / <sheet>` when a product was written. Response: `sources[]` (kind + CDN URL / rule / failure +
   the holders `{productId, slug, option}` whose product write COMMITTED in this request — a source with none is not
   reported, `:158`), `copied` (provenance, `:164`: every source this request fetched and stored, committed holders or
   not), `counts` (over the reported sources), `products {updated, replaced}`, `progress
   {sourcesAtStart, resolved, remainingOptions, remainingSources}`, `complete` = `remainingOptions === 0` (`:195`). Dispatch: `glam-pricelist.ts:228-248`, union `GlamRoute` + exhaustive switch
   (`never` default); an unknown route key → 404. Integration rows: `backend/test/unit/glam-images-handler.test.ts`
   (15) over `backend/test/unit/memory-table.ts` (extracted from `glam-import-handler.test.ts`; gained the conditional
   `UpdateCommand`).
5. **Existing callers** — `backend/test/unit/image-destination-importers.test.ts`: media → the refusal text reaches
   `errors[]`, no upload/ASSET#/MEDIAMAP#; WordPress → `console.warn`, post imported without the image.
   `import-key-ownership.test.ts` unchanged (the importers' import surface did not change).
6. **Scope + infra** — `policy.ts:19` + `service-key-policy.test.ts`; `infra/lib/api.ts:379-385` (route +
   integration `GlamPricelistImagesInt` → the same function); `infra/lib/api-catalog.ts:274-294`
   (`UPLOADS_BUCKET`, `UPLOADS_CDN_URL`, `uploadsBucket.grantReadWrite`); `infra/test/amodx-stack.test.ts`: 16 route
   keys by name, new test `(cat-images-1)` (route → `GlamPricelistImportFunc`; env and S3 statements EQUAL to
   `MediaImportFunc`'s), still exactly 15 functions.
7. **Admin** — `admin/src/components/GlamPricelistImport.tsx`: `mergeSources` (`:203`, batches MERGED BY SOURCE URL
   into holder outcomes, never added up; a holding's recorded outcome is its LATEST committed outcome, under any URL —
   § 8.11), `imageCopyReducer` (`:226`, sum `idle | running | done | stopped`; the session's copy provenance
   `copiedThisSession` kept apart, `:236`; a batch that changed no product while work remains → `stopped`),
   `summarizeSource` (`:267`, the precedence rule over CURRENT holding outcomes), `imageCounts` (`:282`, distinct URLs
   with ≥ 1 holding), `imageProblems` (`:306`, one entry per problem URL with only the holdings that lost the image: file
   rows from the import report of the same `importSource`, else `slug — option`), the loop `copyImages` (`:394`,
   started by itself after a successful import), "Copiază imaginile" (`:468`), `ImageCopyReport` (`:488`). Rows in
   `GlamPricelistImport.test.ts` (22 image rows; 30 in the file).
8. `tools/mcp-server/routes.json:77` (no tool).
9. Docs: `backend/ARCHITECTURE.md` (lib/image-upload.ts entry, glam-images.ts, glam/images.ts, scope table, media /
   WordPress notes), `docs/authentication-architecture.md` (scope table).

### 8.2 Oracles (EXECUTED 2026-10-30, iteration 3, after a fresh root build; logs `iter3-*.log` in `.agent-manager/slices/CAT-IMAGES-1/`, gitignored)

| # | Command | Last lines |
|---|---------|-----------|
| 0 | `npm run build` (root; shared → effects → plugins → backend → admin → renderer → mcp-server → infra) — CIM-F3 | exit 0, all 8 steps ran (`iter3-root-build.log`); `git status` unchanged (outputs gitignored) |
| 1 | `npm run typecheck` (root) | exit 0; 0 `error TS` lines (`iter3-o1.log`) |
| 2 | `cd backend && npm run test:unit` | exit 0; `Test Files 39 passed (39)`, `Tests 629 passed (629)` (`iter3-o2.log`); the 15 handler rows listed verbosely in `iter2-o2-handler-rows.log` (iteration 3 added assertions inside the overlap row, no new row), iteration-0 rows in `oracle2-new-rows.log` |
| 3 | `cd admin && npx vitest run src/components/GlamPricelistImport.test.ts` | exit 0; `Tests 30 passed (30)` (`iter3-o3.log`) |
| 4 | `cd tools/mcp-server && npm test` | exit 0; `# pass 10`, `# fail 0`; the new route is listed under "admin routes with no tool" (print only) |
| 5 | `cd infra && npx jest test/amodx-stack.test.ts` (the infra package's `test` script is `jest`) | exit 0; `Tests: 60 passed, 60 total`; `DEPLOYED parent ≈ 467 (raw 401 …); DEPLOYED CatalogApi ≈ 61 (raw 45 …)` |
| 6 | `cd renderer && npm run test:serving` | exit 0; `# pass 50`, `# fail 0` — no renderer change |
| 7 | `grep -n "fetch(" backend/src/lib/image-upload.ts` | no output (exit 1): no `fetch` call remains; the only HTTP request is `httpRequest` in `getOver`, over a socket the connector opened to the checked address of that hop |
| 8 | `git status --porcelain`; `git diff --check` | only allocated paths; `diff --check` exit 0 |
| — | purity of `import/glam/images.ts`: `npx esbuild src/import/glam/images.ts --bundle --platform=node --format=esm \| grep -ci "dynamodb\|client-s3\|@aws-sdk"` | `0` (95 bundled lines; re-run in iteration 2) |
| — | backend build | covered by row 0 (root build, iteration 3) |

### 8.3 Time budget of one request — the corrected obligation (§ 9)

Iteration 0 called a ≈ 26 s figure a proof; it was not one (review-0 CIM-F1). The operator corrected the obligation
(§ 9): **every third-party network wait is bounded by a timer; AWS calls rely on their normal latency, as every amodx
route does; an overrun shows as a stopped batch that says copying again is safe; repeated or overlapping requests
converge.** No shared AWS helper, SDK client or `withInvalidation` was changed. Clock = handler entry.

**Bounded by timers (the third-party part, EXECUTED by test rows):**

| Wait | Bound | Code / row |
|------|-------|------------|
| Start of a new copy (a fetch from a producer host) | only while `elapsed < 12 s` | `COPY_START_BUDGET_MS`; core budget rows, the 9-style handler row (3 copies per request) |
| One source: DNS (abandoned at the deadline), connect, TLS, every hop, the body | ≤ 8 s | `SOURCE_DEADLINE_MS`; hanging-server and hanging-resolver rows → `ETIMEDOUT` |
| Body size | ≤ 10 MiB | `MAX_IMAGE_BYTES`; cap rows |
| So: the last producer byte arrives by | 12 s + 8 s = **20 s** after entry | arithmetic over the two timers |
| Start of a product update | only while `elapsed < 24 s`, except the first of the request | `UPDATE_START_BUDGET_MS` |

**Relying on normal AWS latency (not bounded by a timer, by ruling):** the tenant `GetItem`; the `PRODUCT#` and
`MEDIAMAP#` queries (all pages); per copy one S3 `PutObject` (≤ 10 MiB, in-region) and two DynamoDB puts (`ASSET#`,
`MEDIAMAP#`); per product one `UpdateItem` and two `BatchWriteItem` (`CATPROD#` delete + write); the audit `PutEvents`;
the CDN marker (`markCdnPending`, two DynamoDB writes). The SDK clients set no timeout (OBSERVED: no `requestHandler`,
`maxAttempts` or `requestTimeout` in `backend/src/lib`). Arithmetic with typical single-digit-to-tens-of-ms DynamoDB
calls and sub-second in-region S3 puts (INFERRED, not measured here): the copy phase ends ≈ 20–21 s, the update phase
stops starting work at 24 s, finalisation adds well under 1 s → an answer near 25 s in the worst third-party case and
far earlier normally (ALPOD: ~0.2 s per image × 4 workers).

**What the user sees on an overrun.** API Gateway answers 503 after 30 s; `apiRequest` throws; the reducer goes to
`stopped` with the message "… Copying again is safe: images already copied are not fetched again." The Lambda keeps
running (timeout 15 min) and finishes the request's writes. "Copiază imaginile" starts a new copy.

**Overlap (§ 9 duty).** A new copy can start while the overrun request still runs. Both read the set; a request whose
read predates the other's committed write may overwrite it — restoring a producer URL, or a source the other removed as
failed. The next request repairs it: a copied source from `MEDIAMAP#` (no fetch), a dead one is fetched, fails and is
removed again. EXECUTED: the overlap row (R2 held after its `MEDIAMAP#` read; R1 completes; R2 writes from its stale
read and X is back on its producer URL; R3 converges — 0 fetches when R1 copied X, 1 fetch when X is dead). An overlap
may also copy one source twice: the second copy leaves an unreferenced `ASSET#` item and S3 object (named, not
cleaned — § 8.7).

**Crash between writes (limit, ruling CIM-F1-ATOMIC = D).** The order is the prescribed one (§ 2 item 4): the
conditional product update, then the `CATPROD#` rewrite with the existing helpers. A 503 does not interrupt it (the
Lambda continues). Only a Lambda crash or an AWS error between the two writes leaves the product's listing card with
its previous image (or without the card, if the delete landed and the write did not) until the sheet's next import or
the product's next save; a later copy does not repair it, because the product no longer holds a producer URL. That gap
belongs to `CATPROD-CONSISTENCY-1`. No "safe resume" claim is made for cards.

**Termination.** The measure is `remainingOptions`, the (product, option) holdings still on a producer URL. Every
committed product write rewrites ≥ 1 holding; a product found replaced leaves the set. With the "first update of a
request always starts" rule, a request that resolved ≥ 1 source lowers `remainingOptions` by ≥ 1 (EXECUTED: shared-source
rows 2 → 1 → 0; the 9-style row 9 → 6 → 3 → 0). The distinct-URL count can stay equal across a request (review-0's
witness, a core row: 1 → 1). The measure grows only through a concurrent import of the same sheet, or through an
overlap as above (bounded: the next request repairs what the stale write restored). The admin loop stops on a batch
that changed no product.

### 8.4 Expected `cdk diff` (operator reads it; `NOT RUN` here — needs credentials)

Parent: + `AWS::ApiGatewayV2::Route` (`POST /import/glam-pricelist/images`), + `AWS::ApiGatewayV2::Integration`
(`GlamPricelistImagesInt`), + `AWS::Lambda::Permission` (that route → `GlamPricelistImportFunc`); test synth raw
398 → 401. CatalogApi: `GlamPricelistImportFunc` `Environment` + `UPLOADS_BUCKET`, `UPLOADS_CDN_URL`; its existing
`AWS::IAM::Policy` + the uploads-bucket statements of `grantReadWrite` (asserted equal to `MediaImportFunc`'s); no
resource added (raw 45 unchanged), nothing removed or replaced.

### 8.5 Abstractions (one line each: what — users — axis — rejected simpler alternative)

- `Resolver` + `Connector` (`FetchDeps`) in image-upload.ts — production defaults + the policy test — test seam: the
  policy refuses loopback, so a local server is reachable only through an injected connector; the resolver injection
  is the packet's — rejected: real DNS/network in unit tests (prohibited); a fake-response port (leaves the real
  hop/socket code untested).
- `copyImageToTenantMedia` (`CopyResult` sum) next to `downloadAndUploadImage` — glam-images (per-kind report);
  media + WordPress (throwing wrapper, unchanged behaviour) — two concrete call shapes — rejected: an error class
  carrying the outcome, caught by the glam handler (exceptions as control flow for expected outcomes).
- `copy` port of `resolveSources` — glam-images, core tests — pure core vs I/O (packet: "over a fetcher port") —
  rejected: the core calling S3/DynamoDB.
- `DeriveGallery` parameter of `rewriteProduct` — glam-images passes `withDerivedGallery`; core tests pass the same —
  keeps `import/glam/` free of `lib/db.ts` (the purity rule of `backend/ARCHITECTURE.md` § unit tests) while the
  § 3.4 rule keeps ONE implementation — rejected: importing `catalog-product.ts` in the core (loads `db.ts`; my
  first version did this, and the core test needed a `db.js` mock — found in self-review and corrected); a copy of
  the rule.
- `test/unit/memory-table.ts` — glam-import-handler.test.ts, glam-images-handler.test.ts — two callers of ~140 lines
  of non-trivial table behaviour — rejected: a second copy of the table.
- `GlamRoute` union + exhaustive switch (`glam-pricelist.ts`) — the one function's two routes — variants fixed by
  infra, a new route must break the switch (packet) — rejected: `if/else` on strings.
- `TlsVerification` and `ImageCopyState` sum types — the connector / the admin loop — mutually exclusive states with
  their own data — rejected: booleans plus nullable fields.

### 8.6 Deviations, interpretations, findings

- **Interpretation of § 5 "a re-run → 0 fetches".** A re-run of the COPY fetches nothing (row 2). A re-IMPORT then a
  copy takes the copied sources from `MEDIAMAP#` (0 fetches for them) but fetches the dead URL again, because
  failures are not stored in `MEDIAMAP#` (packet § 0 fact; slice § 2.6 promises no refetch only for copied sources).
  Both are tested (rows 2 and 3).
- **Behaviour change for the media and WordPress importers (operator records it, slice § 2.3):** private
  destinations refused; redirects > 3 refused; 8 s deadline; 10 MiB cap; and **GIF and SVG sources are now refused**
  (the ratified magic-byte list is jpeg/png/webp) — earlier they were stored.
- **Finding (OBSERVED, outside the allocation, not fixed):** `backend/src/import/wxr-parser.ts:71-77` never sets
  `featuredImage` (the `_thumbnail_id` lookup is a stub), so the WordPress importer's image copy
  (`wordpress.ts:227-235`) cannot run from a real WXR. The § 5 staging proof "the WordPress importer's refusal of a
  private destination" cannot be made with a real file until that is fixed; the media importer's can. The unit row
  mocks the parser.
- **BOEN evidence (EXECUTED, one read-only probe of `fetchImage` alone, no S3/DynamoDB, from the builder's machine,
  temporary directory removed):** a TLS handshake to `coreapi.boen.com` reports `authorized: false`,
  `CERT_HAS_EXPIRED`, fingerprint equal to the pin, hostname check true — the pin path; through it, the fixture URL
  `https://coreapi.boen.com//image/GRD_10151968_EBGV2KMD_Oak Adagio Herringbone Click Castle.jpg` answered
  `404 text/html; charset=us-ascii`, 315 bytes. One URL only. If the 203 BOEN sources all answer 404, the copy leaves
  every BOEN product imageless (§ 2 item 5) — check before the CIM-A1-4 acceptance. `https://boen.com/` (valid
  certificate) answered `200 text/html` → `failed not-image`; `http://127.0.0.1/x.jpg` → refused, loopback.
- Defect class found in self-review: **a concurrent worker pool that returned before every worker stopped**
  (`Promise.all` rejects on the first error). Rule applied: `allSettled`, then raise; a row proves it (it fails with
  `Promise.all` — EXECUTED mutation check).

### 8.7 Follow-ups

- `CAT-IMAGES-MCP-1` (an MCP tool for the copy; CIM-A1-1).
- WXR `featuredImage` resolution (finding above).
- `cardOf` exists in `glam-pricelist.ts`, `glam-images.ts` and inline in `products/update.ts`: move one copy to
  `lib/catprod.ts` (outside this allocation).
- The `catalog-product.ts` header still says "CAT-IMPORT-1 will call …" (stale; export-only allocation).
- Ranges NOT in the ratified list and so not refused: NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, IPv4-compatible
  `::a.b.c.d`, multicast, broadcast, `198.18.0.0/15`. Extending the list is a human policy decision.
- The update sets the whole `variants` list read at the start of the request: an admin edit of the same product's
  variants between that read and the write is overwritten (only `attribute_exists(PK)` is checked, as ratified;
  concurrent admin edits are § 3 non-scope).
- `withInvalidation` marks the CDN on every 2xx, also for a batch that wrote nothing (at most one extra `/*`
  invalidation per debounce window).
- `routes.json` lists the route before it is live; `generatedAt` is unchanged — the operator refreshes the table
  from the live API after the deploy.
- Overlapping copies (§ 8.3) can leave an unreferenced `ASSET#` item + S3 object per source copied twice: named, not
  cleaned (operator ruling § 9).
- A crash between a product update and its `CATPROD#` rewrite leaves the card's previous image until the next import or
  save (ruling CIM-F1-ATOMIC = D) → `CATPROD-CONSISTENCY-1`.
- AWS calls on the images route have no timeout (ruling CIM-F1-SCOPE: unchanged, as every amodx route).

### 8.8 What I could not determine

- Whether `coreapi.boen.com` serves any of the 203 BOEN files (one tried: 404).
- The production connector's TLS branch under unit test (no X.509 creation without a new dependency); only the
  live handshake above shows the pin path on the real certificate.
- The AWS-call latencies in § 8.3 (INFERRED); `cdk diff` against staging (NOT RUN, operator).
- The staging proofs of § 5 (operator-run after review).

### 8.9 Iteration 1 — answers to review-0 (2026-10-30)

**CIM-F2 (corrected).** Defect class: *a report built per request from the resolved work, not from the committed
work, then summed across requests.* One rule closes it (iteration 1; its "exactly once" and "kept as first reported"
parts are superseded by § 8.11): **each (product, option) holding is reported exactly once,
by the request that committed its rewrite; the page merges reports by source URL and derives every count from the
merged holdings.** Server: `glam-images.ts:154` reports a source only with its committed holders (a deferred holder is
reported by the later request that writes it). Client: `mergeSources` + `summarizeSource` + `imageCounts`. Precedence
per URL: a problem when any holding lost its image (refused/failed and the reason from the latest such outcome),
else `ingested` when any holding got a copy in this session, else `cached`; a holding reported twice is kept as first
reported. Rows: handler — a shared source across a deferred update, copied / dead twice / failure then success (each
request reports one holder; holdings 2 → 1 → 0); admin — ingested+cached → 1 ingested; failed twice → 1 failed, 1
problem entry with both holdings; failure then success → 1 problem listing only the holding that lost the image; a
later refusal; a duplicate holding.

**CIM-F3 (corrected).** Root `npm run build` executed (all 8 workspaces in dependency order, exit 0), then oracles
1–8 re-run on that build (§ 8.2).

**CIM-F1 (iteration 1: open — blocked on scope; superseded by § 9 and § 8.10).** What is in the allocation cannot bound the request: the calls without a bound
(§ 8.3 table) are made inside `lib/catalog-product.ts` (`readTenantMode`; allocation: "export `withDerivedGallery`
only"), `lib/media-map.ts`, `lib/catprod.ts`, `lib/events.ts`, `lib/invalidate-cdn.ts` (not allocated) and through the
shared `lib/db.ts` client (not allocated). Re-implementing those calls inside the allocation would duplicate the
authoritative tenant-mode read (CM-D11) and the `CATPROD#`/`MEDIAMAP#` writers — rejected. Safe stopping also exposes a
second defect class that exists today: *a two-write unit whose completion marker is written FIRST* — the product
update (which resume reads as "done") lands before its `CATPROD#` rebuild; a stop or error between them leaves a stale
or missing listing card that no later request repairs. The packet's decision text is in the build report as
`DECISION_REQUIRED` CIM-F1-SCOPE and CIM-F1-ATOMIC.

### 8.10 Iteration 2 — answers to review-1 and the operator's § 9 rulings (2026-10-30)

**§ 8.9 corrections.** § 8.9's CIM-F2 paragraph claimed the class closed; review-1 showed it was not: the rule
"report only committed holders" also dropped COPY PROVENANCE — a source copied in a request whose products were all
deferred reached the admin later as `cached` (counts `ingested: 1, cached: 1` for two sources copied in this session).
§ 8.9's CIM-F1 paragraph is superseded by § 9 and § 8.3 (no scope extension; the obligation was corrected).

**CIM-F2 (corrected).** The defect class is wider than iteration 1 named: *one report field asked to carry two facts —
what was written and where its bytes came from.* Rule: **holder outcomes come only from committed writes; copy
provenance comes only from the copy step, reported by every request that copies (`copied`), independent of commits;
the page derives "copied in this session" from provenance and everything else from holder outcomes.** No failure is
claimed for a deferred holder (provenance carries successes only; a failure is reported by the request that writes its
removal). Rows: handler — two sources copied in request 1, the second product deferred: `copied` names both, request 2
reports the second as `cached` from `MEDIAMAP#` with 2 fetches in total; admin — the review-1 witness gives
`ingested: 2, cached: 0`; after request 1 alone the deferred source is not counted and claims no failure; a source
copied in an earlier session stays `cached`.

**§ 9 overlap duty.** Done — § 8.3 "Overlap" and the row named there.

**CIM-F1-SCOPE.** Closed by ruling: no shared-helper or client change; § 8.3 states the corrected obligation, what the
timers bound, what relies on AWS latency, what the user sees, the overlap argument and the crash limit.

**CIM-F1-ATOMIC.** Deferred by ruling (D); the limit is stated in § 8.3 "Crash between writes".

### 8.11 Iteration 3 — answer to review-2 (2026-10-30)

**CIM-F2-OVERLAP (corrected).** Review-2 replayed the reducer: a holding removed after a transient failure, its
producer URL restored by an overlapping stale write (§ 9), then copied and rewritten by the next batch, was still
reported as a failure (`failed: 1`, a problem at `boen-p — 120`) because `mergeSources` kept a holding's FIRST outcome.
Defect class: *a consumer invariant ("each holding is committed once") that the ruled server behaviour no longer
guarantees* — § 9 makes a second committed rewrite of the same holding reachable. Rule (one rule, no special cases):
**a holding's recorded outcome is its latest committed outcome; a reported holding supersedes its earlier outcome
wherever it was recorded (the same URL or another — e.g. an option image changed between batches); counts and the
failure list read current outcomes only.** Copy provenance (`copiedThisSession`) and distinct-URL counting are
unchanged. Code: `mergeSources` (`GlamPricelistImport.tsx:203`). Rows: admin — the rule table over one holding across
two batches (failed → ingested = the overlap-to-repair sequence through `imageCounts`/`imageProblems`; ingested →
failed; failed → refused; refused → cached; failed → failed listed once with the latest reason; ingested → cached) and
a holding reported under another URL; mutation check: with the old first-kept merge 7 of these rows fail (EXECUTED).
Backend — the § 9 overlap row now asserts that R1 and R3 report the same holding (the server does produce repeats).
The "reported exactly once" comments are corrected in `glam-images.ts`, the component and its test.

## 9. Operator rulings on review-1 (operator, 2026-10-30) — correction to § 7 CIM-A1-1

**Correction.** § 7 CIM-A1-1 says each request stops "at a time budget so that the whole request ends inside 30 s",
and the packet asked for a request that "provably" ends inside 30 s. That obligation was the operator's wording, not a
product need: the 30 s limit bounds only how long the browser waits; the Lambda keeps running after a 503, and the
work is idempotent and resumable. The corrected obligation: **every third-party network wait is bounded by a timer**
(the copy-start budget and the per-source deadline — the part an outside host controls); AWS calls (DynamoDB, S3,
EventBridge) rely on their normal latency, as every amodx route does; a request that still overruns shows in admin as
a stopped batch whose message says copying again is safe, and a repeated or overlapping request converges.

- **CIM-F1-SCOPE — no shared-helper change, no client timeout change, no waiver of a real duty.** Shared AWS helpers
  and SDK clients stay as they are. Added duty: two overlapping requests over the same set converge — a request whose
  read predates another's committed write may overwrite it (restoring a producer URL or a removed failed source); the
  next request repairs it (the copy from `MEDIAMAP#`, the failure again). One test row over the in-memory store shows
  that interleaving and the convergence. An overlap may copy a source twice; the second asset is an unreferenced
  `ASSET#` (named in the record, not cleaned).
- **CIM-F1-ATOMIC — D, deferred.** § 2 item 4 prescribes the order (conditional update, then the `CATPROD#` rewrite
  with the existing helpers, "as the product writers do today"). A 503 does not interrupt it (the Lambda continues);
  only a Lambda crash between the two writes leaves the product's card with its previous image until the sheet's next
  import or the product's next save. The record states that limit instead of a "safe resume" claim for cards; the gap
  belongs to `CATPROD-CONSISTENCY-1`.
- **CIM-F2 (remaining) — fix as review-1 states.** Copy provenance is kept separately from committed holders: a source
  copied in a request whose holders were all deferred still reaches the admin as copied in this session, without a
  failure claim for its deferred holders; handler and reducer rows for that case.

## 10. Operator closeout (operator, 2026-10-30)

**Review.** Cycles: review-0 revise, review-1 escalate (CIM-F1-SCOPE, CIM-F1-ATOMIC → operator rulings § 9),
review-2 revise (CIM-F2-OVERLAP), review-3 **approved** (builder claude-opus-5-5, reviewer codex gpt-6.1-sol, separate
invocations). Accepted limits as recorded: AWS waits can overrun the browser's 30 s window (stopped batch, resume
safe); an overlap can leave an unreferenced `ASSET#`; a Lambda crash between a product write and its `CATPROD#`
rewrite leaves that card stale (`CATPROD-CONSISTENCY-1`).

**Gates (operator, on the approved candidate, bare exit codes, log `ALL GATES GREEN`).** typecheck 0; backend
`test:unit` 629 passed; renderer `test:serving` 0; admin `test:unit` 54 passed; MCP `npm test` 0; infra jest 60
passed; no `fetch(` in `lib/image-upload.ts`; `git diff --check` 0; every changed path inside the allocation.

**Staging CDK diff and deploy.** Parent: `+` Route, Integration, Lambda Permission for
`POST /import/glam-pricelist/images`. CatalogApi: `GlamPricelistImportFunc` gains `UPLOADS_BUCKET`, `UPLOADS_CDN_URL`
and the uploads-bucket read/write statement (the same grant `MediaImportFunc` has). 90 functions change their code
asset only (they bundle `auth/policy.ts`, which gained one row); admin and renderer assets redeploy. Nothing removed
or replaced. `cdk deploy` to `AmodxStack-staging`: `UPDATE_COMPLETE`.

**Staging proofs (tenant `cm1-catalog`, HTTP route, real files).**
- **BOEN** (`PL.csv`, 478 rows): import 200 in 17.4 s (437 products, 437 replaced). Copy: ONE batch, 200 in 11.5 s,
  203/203 sources resolved, 280 products updated, `complete: true`. All 203 are `failed` — `404 text/html;
  charset=us-ascii` through the CIM-A1-2 pin (the TLS connection is accepted; the files are not on the server).
  BOEN is imageless: three product pages render 200 with no `<img>`, no producer host and no broken image.
- **ALPOD sample** (12 rows of `CLA.csv`, 12 distinct images, one replaced by
  `https://www.alpod.eu/cim1-does-not-exist.jpg`): import 200 (2 products). Copy 1: 200 in 1.6 s, 11 `ingested`,
  1 `failed` (404). Re-import + copy 2: 200 in 0.26 s, 0 `ingested`, 11 `cached`, the dead link `failed` again
  (failures are not cached, by design). Stored product `76ac621a-663e-458e-a119-ae5b60df6d1a`: option `#2` (the dead
  link) has no `imageLink` key; options `#1`, `#3`, `#4` point at the staging uploads CDN; `imageLink` + 2
  `additionalImageLinks` derived again. Both product pages: every `<img>` on `d29hixjg0hukc6.cloudfront.net`, no
  producer host in the HTML.
- **Media importer** (a two-item WXR at `cm1-catalog/cim1-probe-media.xml`, removed afterwards): 200 with
  `batchFailed: 2` — "169.254.169.254 resolves to 169.254.169.254: link-local 169.254.0.0/16" and "127.0.0.1 resolves
  to 127.0.0.1: loopback 127.0.0.0/8"; nothing fetched. The WordPress importer uses the same helper (unit row).
- Deviation: proofs used the HTTP route, not the admin page (its loop is covered by the reducer unit rows).

**Product consequence (BOEN).** BOEN's image server no longer serves the files the enriched list names. BOEN products
stay imageless until a new image source exists. Follow-up recorded in glamCRM (`PL-TOOLS-2` scope: BOEN's current
image addresses). Follow-ups from the record: `CAT-IMAGES-MCP-1`, `CATPROD-CONSISTENCY-1` (card drift after a crash),
orphan-asset cleanup (named, unscheduled).
