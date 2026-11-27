// Reviews: the review record, its photos, the import batch and the bulk-import report DTOs.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

// --- REVIEWS ---

/**
 * UTF-8 byte length of a string. `z.string().max(n)` bounds UTF-16 CODE UNITS, not bytes, so it
 * CANNOT enforce a byte-denominated limit: `"\u{1F600}".repeat(512)` is 1024 code units but 2048
 * UTF-8 bytes. `TextEncoder` is a standard global in Node 22 and every browser engine (shared is
 * consumed by both the backend and the Vite/Next front-ends), so it is safe to use here.
 */
const utf8ByteLength = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Predicate for a zod `.refine` that bounds a string by UTF-8 BYTES. Two current callers:
 * `ReviewImageSchema.assetKey` (S3's hard 1024-byte object-key limit) and `.alt` (the per-entry
 * size budget behind MAX_REVIEW_IMAGES). Rejected the simpler `z.string().max(n)` — it counts
 * code units, under-counts multibyte input, and would admit an over-limit S3 key (review-0 defect).
 */
const withinUtf8Bytes = (maxBytes: number) => (s: string): boolean => utf8ByteLength(s) <= maxBytes;

/**
 * Upper bound on photos carried INLINE on a single review record (D-REV-1, ratified).
 *
 * Ratified human ruling (2026-08-05, #2): review photos live in S3 — the review row holds
 * only bounded per-image METADATA, never bytes. So this constant bounds the ENTRY COUNT,
 * never the photo size (§ plan-reviews-import D-REV-1).
 *
 * What this constant bounds — and what it does NOT. It bounds ONLY the image-metadata
 * CONTRIBUTION to the review item, against the DynamoDB 400 KB item cap (409,600 bytes,
 * counted across PK + SK + every attribute name and value):
 *   Worst-case bytes per ReviewImage entry (all fields at their schema max):
 *     assetKey ≤ 1024 B  (S3's hard object-key limit; enforced in UTF-8 BYTES on the field below)
 *     alt      ≤ 1000 B  (enforced in UTF-8 BYTES on the field below)
 *     status   ≈   12 B  ("approved")
 *     width/height + per-key/map framing ≈ 80 B
 *   → ≈ 2.1 KB per entry. 12 × 2.1 KB ≈ 25 KB — the images add at most ~25 KB (< 7% of the
 *   cap). This does NOT by itself make the whole item "provably ≤ 400 KB": `content` and the
 *   other string fields on ReviewSchema are UNBOUNDED, so a pathological `content` could still
 *   blow the item regardless of this constant. Bounding image COUNT keeps the images' share of
 *   the item small, bounded, and predictable on every read/projection, and leaves > 370 KB of
 *   headroom for the body — it is not, and is not claimed to be, a whole-item size guarantee
 *   (bounding the review body is a separate concern this constant does not address).
 *
 * 12 also clears the demonstrated need (D-REV-1: realistic galleries are ~1–10 photos) with
 * headroom, without the cost of the rejected out-of-item option B (separate REVIEWIMG# rows).
 * Bytes never live in DynamoDB — photos live in S3; this bounds ENTRY COUNT, never photo size.
 */
export const MAX_REVIEW_IMAGES = 12;

/**
 * One photo attached to a review — METADATA ONLY (D-REV-1). `assetKey` is the S3 object key
 * of the re-hosted image that rev-2's importer writes; no image bytes ever live in DynamoDB.
 * Per-image `status` DEFAULTS to "pending": an imported/added photo is non-publishable until
 * a human approves it — the moderation gate governs the PUBLIC OBJECT, not merely the render
 * (ratified spine principle; D-REV-4 human-moderation model).
 *
 * `assetKey`/`alt` are bounded in UTF-8 BYTES (see `withinUtf8Bytes`) so the per-entry size in
 * the MAX_REVIEW_IMAGES budget above is a real byte bound, not an assumption — `z.string().max()`
 * would count UTF-16 code units and admit an over-limit S3 key for multibyte input.
 */
export const ReviewImageSchema = z.object({
    // S3 caps object keys at 1024 BYTES. `.max()` counts code units, so enforce the byte bound.
    assetKey: z
        .string()
        .min(1)
        .refine(withinUtf8Bytes(1024), { message: "assetKey exceeds S3's 1024-byte object-key limit" }),
    status: z.enum(["approved", "pending", "hidden"]).default("pending"),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    alt: z.string().refine(withinUtf8Bytes(1000), { message: "alt exceeds 1000 UTF-8 bytes" }).optional(),
});
export type ReviewImage = z.infer<typeof ReviewImageSchema>;

/**
 * A moderated review (System A — the DB-backed review store; see plan-reviews-import § 2.1).
 *
 * rev-1 adds three ratified fields ADDITIVELY — each defaults or is optional, so the three
 * NEW fields introduce no data migration (MEMORY: "all new fields have `.default()` for
 * backward compat"). Note the precise scope of that guarantee: adding defaulted/optional
 * fields cannot, on its own, break a stored row — but whether a given row parses OVERALL also
 * depends on its PRE-EXISTING fields (`source`, `googleReviewId`). Those are the reason for the
 * widenings in the BACKWARD-COMPAT NOTE below, and that note bounds exactly which pre-rev-1
 * rows are covered (the observed default-write shape — NOT every conceivable persisted row):
 *   • `scope` (D-REV-5, ratified narrowed-D: product|site only). Defaults to "product", so a
 *     stored product review with no `scope` attribute parses as product-scoped. Site-scope
 *     reviews (business-level Google/FB imports) are written by rev-2 under a DISJOINT sort
 *     key `SITEREVIEW#<id>` — chosen over `REVIEW#SITE#<id>` because it shares NO prefix with
 *     the existing `REVIEW#<productId>#<id>` namespace, so it provably cannot collide (a
 *     productId literally equal to "SITE" could otherwise alias). rev-1 defines the type; rev-2
 *     writes the key and rev-3's admin list must also query the `SITEREVIEW#` prefix.
 *   • `images` (D-REV-1) — inline metadata array, count-bounded by MAX_REVIEW_IMAGES.
 *   • `importBatchId` (D-REV-3) — reference to the immutable ImportBatch carrying the tenant's
 *     rights attestation. Set only on imported reviews (rev-2 populates it). Images inherit
 *     their batch from the parent review, so it is NOT duplicated per-image — one source of
 *     truth avoids divergent per-photo rights state.
 *
 * `productId` is now OPTIONAL at the field level and REQUIRED by refinement only when
 * scope === "product" (a site-scope review has no product). The refine runs AFTER defaults,
 * so an object with a productId and no scope is product-scoped and valid.
 *
 * BACKWARD-COMPAT NOTE (revise cycle, 2026-08-08): the pre-existing `source`/`googleReviewId`
 * fields required WIDENING the schema to match what `reviews/create.ts` actually persists,
 * because that write path bypasses Zod entirely (`JSON.parse(...) as Partial<Review>` is a
 * compile-time cast, not runtime validation — create.ts:31) and has, since inception, written
 * two DEFAULT-WRITE shapes the pre-rev-1 enum/optionality never admitted (the reviewer proved
 * this against the working tree):
 *   • `source: "manual"` when the caller OMITS `source` (`source || "manual"`, create.ts:57) —
 *     added to the enum below.
 *   • `googleReviewId: null` when the caller OMITS it (`googleReviewId || null`, create.ts:61) —
 *     `.nullable()` below.
 * SCOPE OF THE COMPAT GUARANTEE (do not over-read it): these two widenings admit the DEFAULT-WRITE
 * shape — the row create.ts emits when the caller supplies neither field, which is what a
 * first-party product review carries. They do NOT retroactively admit a row whose caller PASSED an
 * out-of-enum `source` (e.g. `source: "other"`), because the unvalidated write passes any truthy
 * `source` straight through (`source || "manual"`, create.ts:57); making such rows parse would
 * mean widening `source` to `z.string()`, which is BEYOND the ratified resolution and would erase
 * the enum's meaning. Rows like that are the write-path defect itself, not something rev-1 can
 * make well-typed without endorsing arbitrary sources. These widenings are compat, NOT an
 * endorsement of "manual"/null for new writes: the underlying defect (writes bypass the shared
 * contract — the shared-first rule violated historically) is F-REV1-x in docs/TECH-DEBT.md, and
 * fixing the WRITE path (validate-on-write, default→internal, which also closes the arbitrary-
 * `source` door going forward) is rev-2, not this slice. Schema-first here means the schema
 * describes the PERSISTED REALITY the handler actually produces by default.
 */
export const ReviewSchema = z
    .object({
        id: z.string(),
        tenantId: z.string(),
        scope: z.enum(["product", "site"]).default("product"),
        productId: z.string().optional(),
        // "manual" is a LEGACY member: `reviews/create.ts` has, since inception, persisted
        // `source: source || "manual"` (create.ts:57) — a value the pre-rev-1 enum never listed.
        // The enum is WIDENED (not the create path fixed) so those already-persisted rows parse;
        // widening the schema to describe PERSISTED REALITY is the backward-compat requirement.
        // "manual" MUST NOT be the default for NEW writes — the default stays "internal", and
        // rev-2 is to stop create.ts writing "manual" and validate-on-write (F-REV1-x, TECH-DEBT).
        source: z.enum(["google", "internal", "imported", "manual"]).default("internal"),
        authorName: z.string().min(1),
        rating: z.number().min(1).max(5),
        content: z.string().default(""),
        // `.nullable()`: `reviews/create.ts:61` persists `googleReviewId: googleReviewId || null`,
        // so a non-Google review has the attribute present and set to null. `.optional()` alone
        // rejects null; a legacy row would fail to parse. `.nullable().optional()` admits null,
        // absent, or a string — covering the `googleReviewId || null` the DEFAULT write produces
        // (null when the caller omits it, the string when supplied). It does NOT claim to admit a
        // non-string the unvalidated write could still emit if a caller passed one (e.g. a JSON
        // number) — that residual is the same write-path defect, F-REV1-x (fixed in rev-2).
        googleReviewId: z.string().nullable().optional(),
        importBatchId: z.string().optional(),
        images: z.array(ReviewImageSchema).max(MAX_REVIEW_IMAGES).default([]),
        status: z.enum(["approved", "pending", "hidden"]).default("pending"),
        createdAt: z.string(),
    })
    .refine((r) => r.scope !== "product" || (r.productId != null && r.productId.length > 0), {
        message: 'productId is required when scope is "product"',
        path: ["productId"],
    });
export type Review = z.infer<typeof ReviewSchema>;

/**
 * Immutable rights-attestation record (D-REV-3, ratified). Written ONCE by the importer
 * (rev-2) when a tenant imports a batch of reviews, and never mutated — imported review
 * photos are third-party content, so publication is gated on an explicit, recorded human
 * assertion that the tenant has the right to display them. rev-1 DEFINES the shape and the
 * reference (`ReviewSchema.importBatchId`); rev-2 writes it. Immutability is a write-once
 * storage property (rev-2 enforces it on the write path), not something a parse schema states.
 */
export const ImportBatchSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    attestedBy: z.string().min(1),        // actor identity (email) — CLAUDE.md audit-context rule
    attestedAt: z.string(),               // ISO-8601 timestamp of the attestation
    rightsBasis: z.string().min(1),       // the tenant's asserted basis to display the media
    legalTextVersion: z.string().min(1),  // version of the attestation wording shown at import time
});
export type ImportBatch = z.infer<typeof ImportBatchSchema>;

/**
 * Structured result of ONE bulk review import (rev-2b), returned by `POST /import/reviews` and
 * rendered by the admin import UI (the "Report as output surface" DoD).
 *
 * This is a RESPONSE DTO, not a persisted or re-parsed entity — it is BUILT by the backend
 * importer and CONSUMED by the admin (a documented backend→admin boundary crossing). Per the
 * clean-architecture directive, data crossing a boundary is a raw, simple structure: plain TS
 * types, no Zod. Nothing ever validates a report at runtime (there is no read path that parses
 * one back), so a schema would be dead weight — the type is the contract, shared as the single
 * source of truth so the admin renders the exact shape the importer emits.
 *
 * Concrete current users: producer = `backend/src/import/reviews.ts`; consumer = the admin
 * Reviews import dialog. Axis: NONE — this is a shared DTO, not an abstraction over variation.
 * Rejected alternative: a Zod schema (unearned — the report is never parsed/validated).
 */
export interface ReviewImportRowResult {
    /** 0-based index of the row in the source CSV/JSON, so a rejection is traceable to its line. */
    index: number;
    status: "accepted" | "rejected";
    /** Set when accepted: the id of the written review. */
    reviewId?: string;
    /** Set when accepted: which key namespace the review landed under. */
    scope?: "product" | "site";
    productId?: string;
    /** Count of images that passed the declared type+size stage gate and were attached to the accepted review (no byte-screen — D-REV-4 SUPERSEDED). */
    imagesAccepted?: number;
    /** Set when rejected: why the whole row was rejected (never silently skipped). */
    reason?: string;
}

/**
 * FULL per-image disposition in a bulk import (rev-2b, revise cycle #3). The deep-vertical output
 * surface is the COMPLETE disposition of every referenced photo — not only the failures: an
 * ACCEPTED image is a first-class entry carrying the PRIVATE staged `assetKey` and its staged byte
 * `size`, so the operator sees exactly what was staged, keyed to its row and ZIP entry. A REJECTED
 * image carries the reason it was dropped (missing from the ZIP, off the declared-type/size gate,
 * or belonging to a rejected row).
 *
 * MODERATION-ONLY pipeline (D-REV-4 SUPERSEDED 2026-08-08 — the automated byte-screen was dropped): there is no
 * decode step, so an accepted entry carries the staged BYTE size (`size`), not pixel dimensions —
 * width/height would require the decoder we deliberately removed. The staged original is the object
 * a human approves and promotes (rev-2a); the moderation gate is the content control.
 *
 * Modeled as a SUM TYPE on `status` — an image is accepted XOR rejected and each variant carries
 * DISJOINT valid data (accepted → assetKey + size; rejected → reason). This is the domain-modeling
 * rule (mutually-exclusive states as a sum type, each variant holding only the data valid in that
 * state); the rejected alternative — two parallel `accepted`/`rejected` arrays, or one struct with
 * a boolean + nullable assetKey/reason — is the defect-shaped type the directive forbids. Growth
 * axis: variants FIXED (accepted|rejected), so a discriminated union is the right dispatch — the
 * admin renders both by matching `status`.
 */
export type ReviewImportImageResult =
    | {
          status: "accepted";
          /** 0-based index of the owning row. */
          rowIndex: number;
          /** The ZIP entry name the row referenced. */
          entry: string;
          /** PRIVATE staged original key. Promotion to the public bucket is rev-2a's approval path. */
          assetKey: string;
          /** Staged byte size of the original (the true byte count, = the ZIP entry's length). */
          size: number;
      }
    | {
          status: "rejected";
          /** 0-based index of the owning row. */
          rowIndex: number;
          /** The ZIP entry name the row referenced. */
          entry: string;
          reason: string;
      };

export interface ReviewImportReport {
    /** The immutable ImportBatch this import wrote FIRST; every accepted review references it. */
    batchId: string;
    format: "csv" | "json";
    totalRows: number;
    accepted: number;
    rejected: number;
    /** Per-row outcome (accepted with ids, or rejected with a reason) — every row appears once. */
    rows: ReviewImportRowResult[];
    /**
     * FULL per-image disposition across all rows — every referenced photo appears once, accepted
     * (with `assetKey` + the staged original's BYTE size — no normalization exists post-D-REV-4) OR
     * rejected (with `reason`). The row result's `imagesAccepted` is the per-row rollup of the
     * accepted entries here.
     */
    images: ReviewImportImageResult[];
}
