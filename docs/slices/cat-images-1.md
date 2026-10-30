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
