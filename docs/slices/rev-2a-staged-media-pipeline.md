# REV-2a: Staged media pipeline — private-stage → human moderation → promote

- **Status:** IMPLEMENTED (committed, undeployed). **RE-SCOPED 2026-08-08 by rev-2b revise cycle 2
  (D-REV-4 SUPERSEDED):** the sharp byte-screen was dropped entirely. See the **D-REV-4 SUPERSEDED**
  box below — it governs items 2, 3 and 6.
- **Track:** REV
- **Depends:** rev-1 (d5d8705). Implements ratified D-REV-2 + the human format rulings. This is the
  "moderation gate governs the public object" spine.

> **D-REV-4 SUPERSEDED (2026-08-08, human) — no automated byte-screening.** `sharp` is dropped
> entirely: its Linux-binary-on-Lambda cost outweighed a benefit that was mostly privacy+display,
> not security. The **human moderation gate** is the content control — every image lands `pending`
> and a human approves it before promotion ("admins check what they import regardless"). The STAGE
> step keeps its declared **type-AND-size** gate + allowlist (JPEG/PNG/WebP/AVIF — all display
> natively, so nothing is lost by not re-encoding; HEIC still rejected by a pure MIME check).
> **Promotion copies the staged ORIGINAL** (no `normalized.jpg` derivative), and the `Asset` record
> takes the original's declared **type + true size**. This eliminated `review-media-screen.ts` and
> `review-media-ingest.ts` (the sharp modules) and removed `sharp` from `backend/package.json`.
> RESIDUAL, tracked (TECH-DEBT): imported customer photos may carry EXIF/GPS; Google/FB exports
> strip it server-side (primary path safe); a pure-JS EXIF strip is the revisit, NOT built now.

## Scope

1. **Staging write:** a support module (backend) that writes an incoming image (bytes
   or fetched URL) to the PRIVATE bucket under a quarantine prefix
   (`review-staging/<tenantId>/<batchId>/<id>`), recording declared metadata. Input
   allowlist enforced on DECLARED **type AND size** at this step (D-REV-2): JPEG/JPG,
   PNG, WebP, AVIF, size ≤ `MAX_UPLOAD_BYTES.image` (10 MB). SVG and everything else
   rejected outright (ratified). Genuine HEIC is REJECTED with the ratified guidance
   message (REV2A-HEIC-RUNTIME: HEVC decode is patent-encumbered/absent; iOS exports
   JPEG). AVIF is an accepted input in its own right (this build's libvips decodes AV1).
2. ~~**Byte-level screen (D-REV-4):** decode + re-encode via sharp.~~ **SUPERSEDED** — see the
   D-REV-4 box above. There is no automated byte-screen; the HUMAN MODERATION gate is the content
   control. HEIC is still rejected at the DECLARED gate by a pure MIME/string check (no decode),
   with the ratified export-as-JPEG guidance.
3. **Promotion:** only on (review approved AND image approved) — copy the staged **ORIGINAL** to the
   public assets bucket + write a contract-complete AssetSchema record carrying the original's
   declared **type + TRUE size** (true size read via HeadObject on the copied object; the declared
   type via HeadObject on the private source, pre-copy). The original is what a human released; a
   rejected/hidden image is never promoted. (Was: copy the normalized derivative.)
4. **Wiring surface (deep-vertical):** the reviews moderate handler gains the
   image-approval action that triggers promotion (minimal — full moderation UI is
   rev-3); on promotion the ReviewImage entry's `assetKey` is REPLACED with the PUBLIC
   S3 object KEY of the promoted derivative (never a URL — the field is documented as a
   key; the public URL is derived at render via the existing asset-record/CDN pattern,
   `${CDN_URL}/${key}`, and served as a raw asset URL — NEVER next/image, per the
   opennext-1 parking rule).
5. **Lifecycle:** S3 lifecycle rule on the quarantine prefix (30d expiry) — this IS an
   infra change: ONE lifecycle rule on the existing private bucket. Named gain:
   abandoned-import cleanup, ratified in D-REV-2's mitigation. If it requires more
   than a lifecycle rule addition, STOP and surface.
6. ~~sharp becomes a backend dependency.~~ **SUPERSEDED (D-REV-4, 2026-08-08)** — `sharp` was
   dropped from `backend/package.json` entirely; the backend carries no image decoder. `next`'s own
   `sharp` (renderer-side) is untouched and remains `dep-1`'s to close. HEIC is rejected by a pure
   declared-MIME check (no decode, so no libvips/HEVC-codec dependency at all).

## Non-scope

CSV/JSON/ZIP parsing + batch flow + attestation WRITING (rev-2b); moderation UI
(rev-3); gallery (rev-4); antivirus (recorded later-hardening).

## DoD / evidence

Unit tests: allowlist accept/reject incl. SVG + disguised extensions + HEIC (rejected
with the ratified guidance message) + declared type-AND-size guard; promotion gate requires
BOTH approvals; **original-only** promotion (source must be the staged `/original`); the
approve-image action — which
rides the EXISTING `PUT /reviews/{id}` moderation handler ADDITIVELY (REV2A-INFRA-SURFACE
= option B: no dedicated Lambda, no new route; grants (least-privilege, review-2 finding — never
`grantReadWrite`/`grantRead`): on the PUBLIC uploads bucket, EXACTLY `s3:PutObject`/`s3:GetObject`/
`s3:DeleteObject` (CopyObject dest, HeadObject, rollback delete) to the existing `UpdateReviewFunc`
in the nested stack, and a lone `s3:GetObject` on the PRIVATE bucket scoped to `review-staging/*`
(CopyObject source) wired in the PARENT stack (composition root) directly against the
exposed function — so the nested stack carries NO `privateBucket` prop; the exact action/resource set
is pinned by `infra/test/amodx-stack.test.ts` `rev2a-iam`) — proving approval is derived from the
tenant-scoped row, assetKey replaced with the PUBLIC key, and the PER-IMAGE concurrency guard
(a concurrent duplicate approval loses on the entry's own status+assetKey condition → the
loser's promoted public object is rolled back → one wins, no double-copy, no orphan). The
DEFAULT (no-`action`) field-update path is proven unchanged.
Integration evidence: EXECUTED local run of the STAGE gate + promotion on fixtures (declared
type-AND-size accept/reject; original-only promotion; post-copy rollback). The former byte-screen
fixture run is obsolete (screen removed, D-REV-4 superseded). Staging-deploy probes are the
operator's NOT RUN gate. cdk synth green for the lifecycle rule; assertion added pinning
quarantine-prefix expiry.
