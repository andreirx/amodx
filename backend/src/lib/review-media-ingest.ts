import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { stageReviewImage, reviewNormalizedKey } from "./review-media.js";
import { screenReviewImageBytes } from "./review-media-screen.js";

/**
 * REV-2a — the STAGING PATH: the wiring that runs the three steps of the pipeline's ingest half
 * in order for ONE incoming image and lands the object PROMOTION reads.
 *
 *   1. STAGE (review-media.ts, sharp-free): declared TYPE-AND-SIZE gate, then write the raw
 *      as-arrived bytes to `.../original` on the PRIVATE quarantine bucket.
 *   2. SCREEN (review-media-screen.ts, sharp): decode + verify the BYTES and re-encode to a
 *      normalized JPEG (rejects a fake .jpg / SVG / GIF / HEIC on bytes).
 *   3. WRITE NORMALIZED: put the screened JPEG at `.../normalized.jpg` — the ONLY object
 *      `promoteReviewImage` is permitted to copy to the public bucket.
 *
 * This module — NOT review-media.ts — is where `sharp` enters the graph (via the screen import),
 * so the promotion/moderation handler (`reviews/update.ts`, which imports only review-media.ts)
 * stays sharp-free. Its concrete callers: the rev-2a staging unit test, and the future rev-2
 * bulk-import Lambda (which will bundle sharp). One caller today plus one ratified near-term
 * requirement — a direct sequence, no abstraction over it; the separate FILE is the sharp-bundle
 * boundary, not indirection.
 *
 * ORDERING NOTE: the original is written in step 1 even when step 2 later rejects the bytes — the
 * quarantine's job is to hold the raw as-arrived object for forensics, and it can never be
 * promoted (promotion copies only `normalized.jpg`, which a rejected item never gets). The
 * abandoned `original` expires under the private bucket's `review-staging/` lifecycle rule.
 */

const s3 = new S3Client({});

/** Result of the ingest half — expected failure carries a reason (no throw for bad input). */
export type IngestResult =
    | {
          ingested: true;
          originalKey: string;
          /** The private staging key the ReviewImage entry's `assetKey` is set to (pre-promotion). */
          normalizedKey: string;
          contentType: string;
          sourceFormat: string;
          width: number;
          height: number;
      }
    | { ingested: false; reason: string; stagedOriginalKey?: string };

/**
 * Stage → byte-screen → write the normalized derivative for one imported review image.
 * On a declared-gate rejection nothing is written; on a byte-screen rejection the raw original
 * has been staged (and will expire) but no normalized derivative exists, so it can never promote.
 */
export async function stageAndScreenReviewImage(args: {
    tenantId: string;
    batchId: string;
    imageId: string;
    declaredContentType: string | undefined;
    bytes: Uint8Array;
    privateBucket: string;
    /** Required (D-REV-2): the size the import manifest/bundle-entry claims for this image. */
    declaredSize: number;
}): Promise<IngestResult> {
    // STEP 1 — declared TYPE-AND-SIZE gate + write the raw original to quarantine.
    const staged = await stageReviewImage({
        tenantId: args.tenantId,
        batchId: args.batchId,
        imageId: args.imageId,
        declaredContentType: args.declaredContentType,
        bytes: args.bytes,
        privateBucket: args.privateBucket,
        declaredSize: args.declaredSize,
    });
    if (!staged.staged) {
        return { ingested: false, reason: staged.reason };
    }

    // STEP 2 — the byte-level screen. A non-image / off-allowlist / HEIC is refused HERE on bytes.
    const screen = await screenReviewImageBytes(args.bytes);
    if (!screen.screened) {
        return { ingested: false, reason: screen.reason, stagedOriginalKey: staged.stagedKey };
    }

    // STEP 3 — write the normalized JPEG derivative. This is what promotion later copies.
    const normalizedKey = reviewNormalizedKey(args.tenantId, args.batchId, args.imageId);
    await s3.send(
        new PutObjectCommand({
            Bucket: args.privateBucket,
            Key: normalizedKey,
            Body: Buffer.from(screen.normalized),
            ContentType: "image/jpeg",
            Metadata: {
                "review-batch-id": args.batchId,
                "review-image-id": args.imageId,
                "source-format": screen.sourceFormat,
            },
        }),
    );

    return {
        ingested: true,
        originalKey: staged.stagedKey,
        normalizedKey,
        contentType: staged.contentType,
        sourceFormat: screen.sourceFormat,
        width: screen.width,
        height: screen.height,
    };
}
