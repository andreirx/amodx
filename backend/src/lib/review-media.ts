import { S3Client, PutObjectCommand, CopyObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { AssetSchema, MAX_UPLOAD_BYTES, type Asset } from "@amodx/shared";
import { db } from "./db.js";

/**
 * REV-2a — staged media pipeline (private-stage → HUMAN MODERATION → promote), the SECURITY half of
 * D-REV-2. This module carries both ends of that spine: the private-bucket STAGING write (declared
 * type-AND-size gate) and the PROMOTION gate (both-approvals → copy the staged ORIGINAL to public).
 *
 * D-REV-4 SUPERSEDED (2026-08-08, human): there is NO automated byte-screen. The image-decode
 * dependency was dropped entirely — its native-Linux-binary-on-Lambda cost outweighed a benefit
 * that was mostly privacy+display, not security. The HUMAN MODERATION gate is now the content
 * control: every imported/added image
 * lands `pending` and a human approves it before it can go public ("admins check what they import
 * regardless"). No normalization step means no `normalized.jpg` derivative — promotion copies the
 * staged ORIGINAL, whose declared type/size become the public Asset record's. The declared
 * type-AND-size STAGE gate (below) is all that runs pre-approval; the allowlisted formats
 * (JPEG/PNG/WebP/AVIF) all display natively, so nothing is lost by not re-encoding. RESIDUAL
 * (tracked, TECH-DEBT): a raw original may carry EXIF/GPS — Google/FB exports strip it server-side
 * (primary path safe); a pure-JS EXIF strip is the revisit, NOT built now.
 *
 * Spine principle (ratified, plan-reviews-import header): the moderation gate governs the
 * PUBLIC OBJECT, not merely the render. Nothing reaches the public assets bucket until BOTH the
 * review and the specific image are approved by a human — the public bucket only ever receives an
 * object a moderator explicitly released.
 */

// ── Quarantine key namespace ────────────────────────────────────────────────────────────────
// Raw imported bytes land under this ONE prefix on the PRIVATE bucket. The infra lifecycle rule
// (rev-2a, one rule) expires everything under it after 30 days — abandoned-import cleanup, the
// named gain ratified in D-REV-2's mitigation. Keep this string in exact sync with the
// `prefix` on that lifecycle rule (infra/lib/uploads.ts); they are one contract.
export const REVIEW_STAGING_PREFIX = "review-staging/";

/** Base quarantine "folder" for one image within one import batch. */
export function reviewStagingBase(tenantId: string, batchId: string, imageId: string): string {
    return `${REVIEW_STAGING_PREFIX}${tenantId}/${batchId}/${imageId}`;
}

/**
 * The raw, as-declared bytes exactly as they arrived (a ZIP entry, or a fetched connector URL).
 * This IS the object promotion copies to public on approval (D-REV-4 SUPERSEDED — no normalized
 * derivative; see the STEP 2 note below). Until approved it lives only in the private quarantine
 * and expires with the lifecycle rule.
 */
export function reviewOriginalKey(tenantId: string, batchId: string, imageId: string): string {
    return `${reviewStagingBase(tenantId, batchId, imageId)}/original`;
}

// ── Declared-type input allowlist (STEP 1 — staging gate) ───────────────────────────────────
// Ratified human ruling — AMENDED 2026-08-08 (REV2A-HEIC-RUNTIME, plan-reviews-import ratification
// header): input allowlist = JPEG/JPG, PNG, WebP, AVIF. SVG and everything else rejected OUTRIGHT
// — no rasterize branch. HEIC was AMENDED OUT: HEVC decode is patent-encumbered and absent from
// standard image runtimes (this repo's libvips carries AV1/AVIF, not HEVC), and iOS auto-converts
// to JPEG in share/upload flows, so genuine HEIC is REJECTED with an explicit guidance message
// rather than silently failing to decode. This list is NARROWER than the platform's general
// ALLOWED_IMAGE_MIMES (which also admits gif/svg/heic/heif); imported review media is
// attacker-influenced third-party content and gets the tighter list.
//
// HONEST SCOPE: this is a check on the DECLARED content-type only — a claim, not the bytes. A
// text file DECLARED `image/jpeg` passes this gate (there is no byte-level check any more, D-REV-4
// SUPERSEDED). The content control on what actually reaches the public is the HUMAN MODERATION gate
// (STEP 2): every staged image is `pending` until a moderator approves it. See D-REV-2 in
// plan-reviews-import.
export const REVIEW_IMAGE_INPUT_MIMES = new Set<string>([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/avif",
]);

/**
 * File extension for a promoted public asset key, derived from the ORIGINAL's declared MIME. With
 * the byte-screen removed the promoted object is the raw original (JPEG/PNG/WebP/AVIF), so the
 * public key + Asset.fileName must carry the TRUE extension — a `.jpg` key for a PNG object would
 * be a name-mismatch defect. Only the allowlisted types reach promotion; an unexpected type falls
 * back to `bin` so the key is still valid (never a wrong-format lie). One caller: `promoteReviewImage`.
 */
const REVIEW_MIME_EXT: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
};
function reviewAssetExt(contentType: string): string {
    return REVIEW_MIME_EXT[contentType.trim().toLowerCase()] ?? "bin";
}

/**
 * The single, ratified rejection message for genuine HEIC/HEVC input (REV2A-HEIC-RUNTIME). HEIC is
 * rejected at the DECLARED gate below by a pure string/MIME check — no decode (there is no
 * byte-screen any more, D-REV-4 SUPERSEDED). rev-3's upload/import UI surfaces this verbatim.
 */
export const HEIC_REJECTION_REASON =
    "HEIC not supported — export as JPEG (iPhone: share/upload flows convert automatically)";

// Declared MIME strings that denote the HEVC/HEIC family (rejected with the guidance message).
// `image/avif` is DISTINCT and accepted — AVIF is the AV1-coded HEIF this build can decode.
const HEIC_INPUT_MIMES = new Set<string>(["image/heic", "image/heif"]);

/** Result of the declared-type gate — expected failure is in the signature (Result + reason). */
export type ReviewImageInputCheck =
    | { accepted: true; contentType: string }
    | { accepted: false; reason: string };

/**
 * STEP 1 gate: is the DECLARED content-type an allowlisted review-image type? Rejects SVG and
 * every non-image outright, and HEIC with a specific export-as-JPEG message. Does NOT inspect
 * bytes — that trust is deferred to the HUMAN MODERATION gate (D-REV-4 SUPERSEDED), not an
 * automated byte-screen.
 */
export function checkReviewImageInput(declaredContentType: string | undefined): ReviewImageInputCheck {
    const mime = (declaredContentType ?? "").trim().toLowerCase();
    if (!mime) {
        return { accepted: false, reason: "missing declared content-type" };
    }
    if (mime === "image/svg+xml") {
        // Called out explicitly: SVG is script-bearing markup, rejected outright (ratified).
        return { accepted: false, reason: "SVG is rejected outright (ratified ruling)" };
    }
    if (HEIC_INPUT_MIMES.has(mime)) {
        // Ratified amendment: HEIC/HEVC is rejected with actionable guidance, not a bare "denied".
        return { accepted: false, reason: HEIC_REJECTION_REASON };
    }
    if (!REVIEW_IMAGE_INPUT_MIMES.has(mime)) {
        return {
            accepted: false,
            reason: `declared type "${mime}" is not an allowed review-image type (JPEG, PNG, WebP, AVIF)`,
        };
    }
    return { accepted: true, contentType: mime };
}

const s3 = new S3Client({});

/** STEP 1 result. */
export type StageResult =
    | { staged: true; stagedKey: string; contentType: string }
    | { staged: false; reason: string };

/**
 * STEP 1 — STAGING WRITE. Write incoming bytes to the PRIVATE bucket under the quarantine
 * prefix, after the declared TYPE-AND-SIZE gate (D-REV-2). Records the declared type as object
 * metadata so PROMOTION (which copies this original) and any audit can see what the importer
 * CLAIMED it was. No public exposure: the private bucket has BlockPublicAccess.BLOCK_ALL and no CloudFront origin
 * (infra/lib/uploads.ts).
 *
 * SIZE GATE (D-REV-2 "declared type-AND-size"): the image-kind cap is the platform's own
 * `MAX_UPLOAD_BYTES.image` (10 MB, @amodx/shared). The declared size is a REQUIRED half of the
 * contract, not an advisory hint — an importer that cannot state a size for a bundle entry is not
 * trusted to stage bytes, so a missing / non-finite / negative `declaredSize` is refused before
 * S3 is touched, and the declared value is recorded as object metadata for the import audit.
 * Because staging ALSO holds the bytes in hand, `bytes.length` is the TRUE size — a second, REAL
 * byte bound stronger than the advisory declared-size check on the browser presign path
 * (assets/create.ts, whose presigned PUT cannot bind content-length). We deliberately do NOT route
 * this through `validateUpload()`: that helper couples size to the BROAD `ALLOWED_UPLOAD_MIMES`
 * (which still admits image/heic), whereas review-media TYPE is governed by the narrower
 * `checkReviewImageInput` above — so we reuse only its size CONSTANT.
 */
export async function stageReviewImage(args: {
    tenantId: string;
    batchId: string;
    imageId: string;
    declaredContentType: string | undefined;
    bytes: Uint8Array;
    privateBucket: string;
    declaredSize: number;
}): Promise<StageResult> {
    const check = checkReviewImageInput(args.declaredContentType);
    if (!check.accepted) {
        return { staged: false, reason: check.reason };
    }

    // D-REV-2 "declared type-AND-SIZE": the size CLAIM is mandatory and must be a real byte count.
    if (
        typeof args.declaredSize !== "number" ||
        !Number.isFinite(args.declaredSize) ||
        args.declaredSize < 0
    ) {
        return {
            staged: false,
            reason: "declaredSize (a finite, non-negative byte count) is required",
        };
    }

    const maxImageBytes = MAX_UPLOAD_BYTES.image;
    if (args.declaredSize > maxImageBytes) {
        return {
            staged: false,
            reason: `declared size ${args.declaredSize}B exceeds the ${maxImageBytes}B review-image cap`,
        };
    }
    if (args.bytes.length > maxImageBytes) {
        return {
            staged: false,
            reason: `image is ${args.bytes.length}B, exceeds the ${maxImageBytes}B review-image cap`,
        };
    }

    const stagedKey = reviewOriginalKey(args.tenantId, args.batchId, args.imageId);
    await s3.send(
        new PutObjectCommand({
            Bucket: args.privateBucket,
            Key: stagedKey,
            Body: Buffer.from(args.bytes),
            ContentType: check.contentType,
            Metadata: {
                "declared-content-type": check.contentType,
                // Declared size recorded alongside the declared type — both halves of the D-REV-2
                // gate are auditable on the staged object.
                "declared-size": String(args.declaredSize),
                "review-batch-id": args.batchId,
                "review-image-id": args.imageId,
            },
        }),
    );
    return { staged: true, stagedKey, contentType: check.contentType };
}

// ── STEP 2 — HUMAN MODERATION (D-REV-4 SUPERSEDED) ───────────────────────────────────────────
// There is NO automated byte-screen step. The image-decode dependency was removed from the backend
// entirely (2026-08-08, human): the whole pipeline is now `stage → human approval → promote`. What
// used to be STEP 2 (a decode+re-encode producing `normalized.jpg`) is replaced by the human
// moderation gate — a
// moderator reviews every pending image and approves it before promotion (rev-3 UI; the
// `approve-image` action in reviews/update.ts is the handler seam today). Because there is no
// normalized derivative, promotion copies the staged ORIGINAL (below). The allowlisted input
// formats (JPEG/PNG/WebP/AVIF) all display natively, so no re-encode is needed for display.

// ── STEP 3 — PROMOTION ──────────────────────────────────────────────────────────────────────

/**
 * The promotion GATE, as a pure predicate (no I/O) so it can be proven exhaustively in
 * isolation. Promotion is permitted ONLY when the review AND the specific image are both
 * approved — the ratified spine: the moderation gate governs the public object.
 */
export function promotionAllowed(reviewStatus: string, imageStatus: string): boolean {
    return reviewStatus === "approved" && imageStatus === "approved";
}

/**
 * STEP 3 result. `assetKey` is the PUBLIC S3 object key of the promoted ORIGINAL — this is
 * what the moderation wiring records on the `ReviewImage` entry (rev-1 `ReviewImageSchema.assetKey`
 * is documented as a KEY, not a URL). The public URL is DERIVED at render from that key via the
 * existing asset-record/CDN pattern (`assets/create.ts:60` — `publicUrl = ${CDN_URL}/${key}`);
 * `publicUrl` is returned here only for the handler's response/audit, never to be stored in the
 * key field. Raw asset URL at render, never next/image (opennext-1 parking rule).
 */
export type PromoteResult =
    | { promoted: true; assetKey: string; publicUrl: string; assetId: string; asset: Asset }
    | { promoted: false; reason: string };

/**
 * STEP 3 — PROMOTION (moderation-only pipeline, D-REV-4 SUPERSEDED). On (review approved AND image
 * approved), copy the staged ORIGINAL from the private quarantine to the PUBLIC assets bucket, then
 * write a contract-complete AssetSchema record carrying the ORIGINAL's declared type + TRUE byte
 * size. There is no normalized derivative any more — the original IS the object a human released.
 *
 * The copy SOURCE is `sourceStagingKey` — the ReviewImage entry's CURRENT `assetKey`, which the
 * importer set to the private `.../original` key. Two STRUCTURAL guards make the spine unbypassable,
 * independent of the caller:
 *   • TENANT ISOLATION — the source MUST live under this tenant's quarantine prefix
 *     (`review-staging/<tenantId>/`); a key naming another tenant's staged object is refused.
 *   • ORIGINAL-ONLY — the source MUST end in `/original` (the exact object the STAGE gate wrote);
 *     any other staging key is refused, and a key that is already a PUBLIC asset key (no staging
 *     prefix) is refused as "already promoted" (idempotent signal for the handler), so a
 *     double-approve cannot re-copy or clobber.
 *
 * TYPE comes from a HeadObject on the SOURCE (pre-copy): its `ContentType` (the declared type the
 * STAGE gate recorded) drives the public key extension + the copy's content-type. A source read that
 * fails, or an untyped object, refuses BEFORE any copy — nothing to roll back on that edge. The TRUE
 * SIZE is read from a HeadObject on the DESTINATION (post-copy), so the Asset record carries the
 * ACTUAL public object's byte count; a failure there (or AssetSchema.parse / the ASSET# PutCommand)
 * runs the compensation below — delete the copied object so no orphan survives. CopyObject
 * (server-side) is used rather than stream-through-Lambda: the bytes never transit this process.
 */
export async function promoteReviewImage(args: {
    tenantId: string;
    sourceStagingKey: string;
    reviewStatus: string;
    imageStatus: string;
    uploadedBy: string;
    privateBucket: string;
    publicBucket: string;
    publicCdnUrl: string;
    tableName: string;
}): Promise<PromoteResult> {
    if (!promotionAllowed(args.reviewStatus, args.imageStatus)) {
        return {
            promoted: false,
            reason: `promotion requires both approvals (review="${args.reviewStatus}", image="${args.imageStatus}")`,
        };
    }

    // TENANT ISOLATION: refuse a source key that is not under THIS tenant's quarantine prefix.
    const tenantStagingPrefix = `${REVIEW_STAGING_PREFIX}${args.tenantId}/`;
    if (!args.sourceStagingKey.startsWith(tenantStagingPrefix)) {
        return {
            promoted: false,
            reason: `source "${args.sourceStagingKey}" is not a private staging key for tenant "${args.tenantId}" (already promoted, cross-tenant, or invalid)`,
        };
    }
    // ORIGINAL-ONLY: only the staged `/original` (the object the STAGE gate wrote) may be promoted.
    if (!args.sourceStagingKey.endsWith("/original")) {
        return {
            promoted: false,
            reason: `source "${args.sourceStagingKey}" is not the staged original — only the quarantined /original may be promoted`,
        };
    }

    // TYPE from the SOURCE, pre-copy. HeadObject uses s3:GetObject (already granted for the CopyObject
    // source), so this adds no IAM surface. A read failure (object gone/expired) returns before any
    // public object is created — nothing to roll back on this edge. The content-type is what the STAGE
    // write recorded (the declared, allowlisted type); fall back to the declared-content-type
    // metadata, then refuse rather than guess — it drives both the public key extension and the copy.
    let sourceContentType: string;
    try {
        const srcHead = await s3.send(
            new HeadObjectCommand({ Bucket: args.privateBucket, Key: args.sourceStagingKey }),
        );
        sourceContentType =
            srcHead.ContentType?.trim().toLowerCase() ||
            srcHead.Metadata?.["declared-content-type"]?.trim().toLowerCase() ||
            "";
        if (!sourceContentType) {
            return {
                promoted: false,
                reason: `staged source "${args.sourceStagingKey}" has no content-type; refusing to promote an untyped object`,
            };
        }
    } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        return { promoted: false, reason: `could not read staged source: ${detail}` };
    }

    const assetId = crypto.randomUUID();
    const ext = reviewAssetExt(sourceContentType);
    const publicKey = `${args.tenantId}/${assetId}.${ext}`;

    await s3.send(
        new CopyObjectCommand({
            Bucket: args.publicBucket,
            Key: publicKey,
            CopySource: encodeURI(`${args.privateBucket}/${args.sourceStagingKey}`),
            ContentType: sourceContentType,
            MetadataDirective: "REPLACE",
        }),
    );

    // POST-COPY COMPENSATION: the public object now EXISTS. Any failure in the remaining
    // steps — HeadObject (true size), AssetSchema.parse, or the ASSET# PutCommand — would
    // otherwise leave a live public object with no record pointing at it: an orphan OUTSIDE the
    // caller's final-update rollback path (which only fires on the DDB conditional check). We
    // compensate here so the private→public boundary invariant holds on EVERY failure edge:
    // nothing lives in public unless a record and, ultimately, an approved review point at it.
    let publicUrl: string;
    let asset: Asset;
    try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: args.publicBucket, Key: publicKey }));
        // TRUE SIZE (contract): the AssetSchema record must carry the copied object's REAL byte size.
        // HeadObject.ContentLength is typed optional; if S3 returns it absent/non-finite/negative we
        // must NOT fall back to a fabricated `0` (that would persist a lie about the object). Refuse
        // instead — the throw drops into the catch below, which runs the rollback (delete the copied
        // public object) and reports the failure, so no orphan and no false-size record survive.
        const trueSize = head.ContentLength;
        if (typeof trueSize !== "number" || !Number.isFinite(trueSize) || trueSize < 0) {
            throw new Error(
                `HeadObject returned no usable ContentLength for public object "${publicKey}" (got ${String(trueSize)}); refusing to record a fabricated size`,
            );
        }
        publicUrl = `${args.publicCdnUrl}/${publicKey}`;

        asset = AssetSchema.parse({
            id: assetId,
            tenantId: args.tenantId,
            fileName: `${assetId}.${ext}`,
            fileType: sourceContentType,
            size: trueSize,
            s3Key: publicKey,
            publicUrl,
            uploadedBy: args.uploadedBy,
            createdAt: new Date().toISOString(),
        });

        await db.send(
            new PutCommand({
                TableName: args.tableName,
                Item: {
                    PK: `TENANT#${args.tenantId}`,
                    SK: `ASSET#${assetId}`,
                    ...asset,
                    Type: "Asset",
                },
            }),
        );
    } catch (e: unknown) {
        // Undo the copy (and any partial asset record) so no public orphan survives, then report
        // the failure so the caller does NOT persist an "approved" entry with no object behind it.
        await rollbackPromotedReviewImage({
            tenantId: args.tenantId,
            publicBucket: args.publicBucket,
            assetKey: publicKey,
            assetId,
            tableName: args.tableName,
        });
        const detail = e instanceof Error ? e.message : String(e);
        return { promoted: false, reason: `promotion post-copy step failed and was rolled back: ${detail}` };
    }

    return { promoted: true, assetKey: publicKey, publicUrl, assetId, asset };
}

/**
 * ROLLBACK for the promotion→record→update sequence (rev-2a concurrency guard). `promoteReviewImage`
 * writes TWO things — the public S3 object and its `ASSET#` record — BEFORE the moderation handler
 * rewrites the ReviewImage entry's `assetKey`. If that final update fails its concurrency condition
 * (the review was un-approved between the read and the write), the promoted public object would be
 * an ORPHAN: a live public image the review record never points at. This undoes both writes so the
 * spine's invariant holds — nothing lives in public unless a currently-approved review row points at
 * it. Best-effort per-step (a failed delete is logged, not thrown): a stray object at worst expires
 * under normal asset lifecycle and is never referenced.
 */
export async function rollbackPromotedReviewImage(args: {
    tenantId: string;
    publicBucket: string;
    assetKey: string;
    assetId: string;
    tableName: string;
}): Promise<void> {
    try {
        await s3.send(new DeleteObjectCommand({ Bucket: args.publicBucket, Key: args.assetKey }));
    } catch (e) {
        console.error(`[rev-2a] rollback: failed to delete promoted public object ${args.assetKey}:`, e);
    }
    try {
        await db.send(
            new DeleteCommand({
                TableName: args.tableName,
                Key: { PK: `TENANT#${args.tenantId}`, SK: `ASSET#${args.assetId}` },
            }),
        );
    } catch (e) {
        console.error(`[rev-2a] rollback: failed to delete asset record ASSET#${args.assetId}:`, e);
    }
}
