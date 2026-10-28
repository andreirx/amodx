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
