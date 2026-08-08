# REV-2a: Staged media pipeline — private-stage → byte-screen → promote

- **Status:** PLANNED (implementation wave; REV phase 2, security half)
- **Track:** REV
- **Depends:** rev-1 (d5d8705). Implements ratified D-REV-2 + D-REV-4 + the human
  format rulings. This is the "moderation gate governs the public object" spine.

## Scope

1. **Staging write:** a support module (backend) that writes an incoming image (bytes
   or fetched URL) to the PRIVATE bucket under a quarantine prefix
   (`review-staging/<tenantId>/<batchId>/<id>`), recording declared metadata. Input
   allowlist enforced on DECLARED **type AND size** at this step (D-REV-2): JPEG/JPG,
   PNG, WebP, AVIF, size ≤ `MAX_UPLOAD_BYTES.image` (10 MB). SVG and everything else
   rejected outright (ratified). Genuine HEIC is REJECTED with the ratified guidance
   message (REV2A-HEIC-RUNTIME: HEVC decode is patent-encumbered/absent; iOS exports
   JPEG). AVIF is an accepted input in its own right (this build's libvips decodes AV1).
2. **Byte-level screen (D-REV-4):** decode + re-encode via sharp (backend Lambda):
   verify the bytes ARE a decodable image of an allowlisted format; output a
   normalized JPEG (AVIF/WebP → JPEG derivative; JPEG/PNG re-encoded). Decode failure
   → item marked rejected with reason. Genuine HEIC is refused as the OUTCOME of the
   FULL screen path (REV2A-HEIC-RUNTIME, CYCLE-3): sharp is asked to decode the bytes,
   this AV1-only libvips fails, and the decode failure is then mapped to the ratified
   export-as-JPEG guidance by inspecting the ISOBMFF `ftyp` container brand — the
   rejection is proven on a real decode attempt, not a pre-decode classifier
   short-circuit. HONEST SCOPE recorded in code comment: this is controlled-decode
   normalization, NOT antivirus.
3. **Promotion:** only on (review approved AND image approved) — copy the NORMALIZED
   derivative (never the original) to the public assets bucket + write a
   contract-complete AssetSchema record (including true size). Original stays in
   quarantine (lifecycle expiry — see 5).
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
6. sharp becomes a backend dependency (it's currently renderer-side via Next):
   pin the patched **`>=0.35.0`** family (resolves 0.35.3); audit after install per repo DoD.
   (CORRECTED 2026-08-08, operator ruling REV2A-SHARP-PIN: the original "0.34.5 patched family"
   was a factual error — `docs/TECH-DEBT.md` item 2 records the sharp HIGH advisories as fixed
   only in `>=0.35.0`. Pinning 0.34.5 into an untrusted-byte decoder would ship the very CVE this
   security slice closes. Backend now installs a separate patched sharp; `next`'s 0.34.5 remains
   `dep-1`'s to close. Toolchain caveat: prebuilt libvips here is AV1/AVIF-only, no HEVC — which is
   why AVIF is an accepted input and genuine HEVC `.heic` is REJECTED outright with a ratified
   export-as-JPEG message (REV2A-HEIC-RUNTIME, amended 2026-08-08): the decode is ATTEMPTED and
   fails (no HEVC codec here), and the `ftyp` container brand then names that failure as HEIC so
   the specific guidance is emitted instead of a generic decode error.)

## Non-scope

CSV/JSON/ZIP parsing + batch flow + attestation WRITING (rev-2b); moderation UI
(rev-3); gallery (rev-4); antivirus (recorded later-hardening).

## DoD / evidence

Unit tests: allowlist accept/reject incl. SVG + disguised extensions + HEIC (rejected
with the ratified guidance message) + declared type-AND-size guard; decode-failure
path; promotion gate requires BOTH approvals; derivative-only promotion; the
staging-path wiring (stage→screen→normalized.jpg); the approve-image action — which
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
Integration evidence: EXECUTED local run of the screen step on fixture images (real
tiny JPEG/PNG/WebP/AVIF accepted+normalized; a fake .jpg-that-is-text, SVG, GIF, and
genuine HEIC bytes → rejected). Staging-deploy probes are the operator's NOT RUN gate.
cdk synth green for the lifecycle rule; assertion added pinning quarantine-prefix expiry.
