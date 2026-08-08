import { describe, it, expect } from "vitest";
import {
    ImportBatchSchema,
    MAX_REVIEW_IMAGES,
    ReviewImageSchema,
    ReviewSchema,
} from "../src/index.js";

/**
 * slice `rev-1` — the review domain model (ratified D-REV-1 / D-REV-3 / D-REV-5).
 *
 * This transcript PINS each ratified invariant the schema change encodes. `ReviewSchema` is
 * the ONE contract System A's backend handlers, the importer (rev-2), the moderation UI
 * (rev-3) and the renderer gallery (rev-4) will all build against; a silent drift here is a
 * silent drift to all of them. Pure by construction — `@amodx/shared` depends only on `zod`
 * (no AWS, no network); see `docs/testing-strategy.md` §7.
 *
 * Each `it` names an invariant something outside this package depends on. It is NOT
 * field-by-field coverage — fields with no cross-workspace consequence are left unpinned so
 * this suite is a contract, not a change-detector.
 */

/** The minimum product review the store persists today (pre-rev-1 shape). */
const LEGACY_PRODUCT_REVIEW = {
    id: "rev-1",
    tenantId: "client-bob",
    productId: "prod-42",
    authorName: "Alice",
    rating: 5,
    createdAt: "2026-01-01T00:00:00.000Z",
} as const;

/**
 * The EXACT item `backend/src/reviews/create.ts` persists — copied field-for-field from the
 * `PutCommand` Item (create.ts:44-64) as it has been written since inception, INCLUDING the two
 * shapes the pre-revise schema rejected:
 *   • `source: "manual"`      — create.ts:57 `source: source || "manual"` when `source` is omitted.
 *   • `googleReviewId: null`  — create.ts:61 `googleReviewId: googleReviewId || null` when omitted.
 * Plus the storage envelope (`PK`/`SK`/`Type`) that a NON-projected read returns; zod strips
 * unknown keys, so their presence must not break the parse. This fixture is the ground truth for
 * the slice's HARD backward-compat requirement — it is not the idealized row, it is the real one.
 */
const CREATE_TS_PERSISTED_ROW = {
    PK: "TENANT#client-bob",
    SK: "REVIEW#prod-42#rev-9",
    id: "rev-9",
    tenantId: "client-bob",
    productId: "prod-42",
    source: "manual",
    authorName: "Alice",
    rating: 5,
    content: "",
    googleReviewId: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    Type: "Review",
} as const;

// ---------------------------------------------------------------------------------------

describe("ReviewSchema — backward compatibility (no data migration)", () => {
    /**
     * INVARIANT: a review row written BEFORE rev-1 (no `scope`, no `images`, no
     * `importBatchId`) still parses. This is the hard requirement of the slice — existing
     * product-review rows are untouched in DynamoDB and must read back valid.
     */
    it("parses a pre-rev-1 product review unchanged", () => {
        const parsed = ReviewSchema.parse(LEGACY_PRODUCT_REVIEW);
        expect(parsed.scope).toBe("product");     // D-REV-5: defaults to product
        expect(parsed.images).toEqual([]);        // D-REV-1: empty by default
        expect(parsed.importBatchId).toBeUndefined(); // D-REV-3: absent for first-party reviews
        expect(parsed.source).toBe("internal");   // unchanged default (source omitted → default)
        expect(parsed.status).toBe("pending");    // unchanged default
    });

    /**
     * INVARIANT (revise cycle — the reviewer PROVED the schema↔persistence drift): the EXACT
     * item `reviews/create.ts` writes — `source: "manual"`, `googleReviewId: null`, no scope /
     * images / importBatchId — MUST parse. The write path bypasses Zod (F-REV1-x, TECH-DEBT), so
     * the schema is widened to describe persisted reality. If this row failed to parse, every
     * default-source review ever created by the handler would be unreadable through the contract.
     */
    it("parses the EXACT row create.ts persists (source \"manual\", googleReviewId null)", () => {
        const result = ReviewSchema.safeParse(CREATE_TS_PERSISTED_ROW);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.source).toBe("manual");        // legacy enum member, admitted
            expect(result.data.googleReviewId).toBeNull();    // .nullable() admits the persisted null
            expect(result.data.scope).toBe("product");        // additive default fills in
            expect(result.data.images).toEqual([]);           // additive default fills in
            expect(result.data.importBatchId).toBeUndefined();
        }
    });
});

describe("ReviewSchema — scope discriminator (D-REV-5)", () => {
    /** INVARIANT: scope is exactly product|site (narrowed-D — page/others rejected). */
    it("rejects a scope outside product|site", () => {
        expect(ReviewSchema.safeParse({ ...LEGACY_PRODUCT_REVIEW, scope: "page" }).success).toBe(false);
        expect(ReviewSchema.safeParse({ ...LEGACY_PRODUCT_REVIEW, scope: "site", productId: undefined }).success).toBe(true);
    });

    /**
     * INVARIANT: productId is required IFF scope === "product". A product review with no
     * product is meaningless; a site (business-level) review has no product by definition.
     */
    it("requires productId when scope is product", () => {
        const { productId, ...noProduct } = LEGACY_PRODUCT_REVIEW;
        expect(ReviewSchema.safeParse(noProduct).success).toBe(false); // scope defaults to product
        expect(ReviewSchema.safeParse({ ...noProduct, scope: "product" }).success).toBe(false);
    });

    it("accepts a site-scope review WITHOUT a productId", () => {
        const siteReview = {
            id: "srev-1",
            tenantId: "client-bob",
            scope: "site",
            authorName: "Google User",
            rating: 4,
            createdAt: "2026-02-01T00:00:00.000Z",
        };
        const r = ReviewSchema.safeParse(siteReview);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.productId).toBeUndefined();
    });
});

describe("ReviewSchema — inline images (D-REV-1)", () => {
    /** INVARIANT: images default to an empty array (additive, backward-compatible). */
    it("defaults images to []", () => {
        expect(ReviewSchema.parse(LEGACY_PRODUCT_REVIEW).images).toEqual([]);
    });

    /**
     * INVARIANT: a per-image `status` DEFAULTS to "pending" — an added photo is
     * non-publishable until a human approves it (the moderation gate governs the public
     * object; D-REV-4). A default of "approved" would auto-publish imported third-party media.
     */
    it("defaults a per-image status to pending", () => {
        const parsed = ReviewSchema.parse({
            ...LEGACY_PRODUCT_REVIEW,
            images: [{ assetKey: "client-bob/asset-1.jpg" }],
        });
        expect(parsed.images[0].status).toBe("pending");
    });

    /**
     * INVARIANT: the array is COUNT-bounded by MAX_REVIEW_IMAGES. This bounds the images'
     * CONTRIBUTION to the DDB item (metadata only; bytes live in S3) — it does NOT by itself
     * bound the whole item, whose `content` and other string fields are unbounded (see the
     * constant's header in src/index.ts). It keeps the image share small and predictable.
     */
    it(`accepts exactly MAX_REVIEW_IMAGES (${MAX_REVIEW_IMAGES}) images and rejects one more`, () => {
        const img = { assetKey: "client-bob/a.jpg" };
        const atCap = { ...LEGACY_PRODUCT_REVIEW, images: Array(MAX_REVIEW_IMAGES).fill(img) };
        const overCap = { ...LEGACY_PRODUCT_REVIEW, images: Array(MAX_REVIEW_IMAGES + 1).fill(img) };
        expect(ReviewSchema.safeParse(atCap).success).toBe(true);
        expect(ReviewSchema.safeParse(overCap).success).toBe(false);
    });

    /** The count bound is a named constant that keeps the image-metadata share of the item small. */
    it("pins MAX_REVIEW_IMAGES to a value that bounds the image-metadata contribution well under the cap", () => {
        // 12 entries × ~2.1 KB worst-case metadata ≈ 25 KB ≪ 409,600 B — this is the images'
        // CONTRIBUTION, not a whole-item guarantee (content is unbounded). See the constant's
        // justification in src/index.ts. Guard against an unjustified widening of the bound.
        expect(MAX_REVIEW_IMAGES).toBe(12);
    });
});

describe("ReviewImageSchema — metadata only, bounded (D-REV-1, ratified: bytes in S3)", () => {
    /** INVARIANT: assetKey is required and non-empty — a photo with no S3 key is unrenderable. */
    it("requires a non-empty assetKey", () => {
        expect(ReviewImageSchema.safeParse({ assetKey: "" }).success).toBe(false);
        expect(ReviewImageSchema.safeParse({}).success).toBe(false);
        expect(ReviewImageSchema.safeParse({ assetKey: "client-bob/a.jpg" }).success).toBe(true);
    });

    /**
     * INVARIANT: assetKey and alt are bounded in UTF-8 BYTES (not UTF-16 code units), so the
     * per-entry size in the MAX_REVIEW_IMAGES budget is a real byte bound. `z.string().max(n)`
     * counts code units and would admit an over-limit S3 object key for multibyte input — the
     * review-0 defect. These tests pin acceptance AT and rejection BEYOND each byte limit in
     * ASCII (1 B/char), a 2-byte char (U+00E9 é), and a 4-byte char (U+1F600 😀).
     */
    it("bounds assetKey to 1024 UTF-8 BYTES (ASCII and multibyte)", () => {
        // ASCII: 1 byte/char.
        expect(ReviewImageSchema.safeParse({ assetKey: "a".repeat(1024) }).success).toBe(true);
        expect(ReviewImageSchema.safeParse({ assetKey: "a".repeat(1025) }).success).toBe(false);
        // 2-byte char (U+00E9 precomposed — verified 2 UTF-8 bytes):
        // 512×2 = 1024 B accept; 513×2 = 1026 B reject.
        expect(ReviewImageSchema.safeParse({ assetKey: "é".repeat(512) }).success).toBe(true);
        expect(ReviewImageSchema.safeParse({ assetKey: "é".repeat(513) }).success).toBe(false);
        // 4-byte char (U+1F600): 256×4 = 1024 B accept; 257×4 = 1028 B reject.
        expect(ReviewImageSchema.safeParse({ assetKey: "\u{1F600}".repeat(256) }).success).toBe(true);
        expect(ReviewImageSchema.safeParse({ assetKey: "\u{1F600}".repeat(257) }).success).toBe(false);
        // The review-0 defect case: 512 emoji = 1024 CODE UNITS but 2048 BYTES → MUST reject.
        expect("\u{1F600}".repeat(512).length).toBe(1024); // 1024 UTF-16 code units
        expect(ReviewImageSchema.safeParse({ assetKey: "\u{1F600}".repeat(512) }).success).toBe(false);
    });

    it("bounds alt to 1000 UTF-8 BYTES (ASCII, 2-byte, and 4-byte)", () => {
        // ASCII: 1 byte/char.
        expect(ReviewImageSchema.safeParse({ assetKey: "k", alt: "a".repeat(1000) }).success).toBe(true);
        expect(ReviewImageSchema.safeParse({ assetKey: "k", alt: "a".repeat(1001) }).success).toBe(false);
        // 2-byte char (U+00E9 é, precomposed — verified 2 UTF-8 bytes): 500×2 = 1000 B accept; 501×2 = 1002 B reject.
        expect(ReviewImageSchema.safeParse({ assetKey: "k", alt: "é".repeat(500) }).success).toBe(true);
        expect(ReviewImageSchema.safeParse({ assetKey: "k", alt: "é".repeat(501) }).success).toBe(false);
        // 4-byte char (U+1F600): 250×4 = 1000 B accept; 251×4 = 1004 B reject.
        expect(ReviewImageSchema.safeParse({ assetKey: "k", alt: "\u{1F600}".repeat(250) }).success).toBe(true);
        expect(ReviewImageSchema.safeParse({ assetKey: "k", alt: "\u{1F600}".repeat(251) }).success).toBe(false);
        // 500 emoji = 1000 CODE UNITS but 2000 BYTES → MUST reject (the code-unit trap for alt).
        expect(ReviewImageSchema.safeParse({ assetKey: "k", alt: "\u{1F600}".repeat(500) }).success).toBe(false);
    });
});

describe("ImportBatchSchema — immutable rights attestation (D-REV-3)", () => {
    const BATCH = {
        id: "batch-1",
        tenantId: "client-bob",
        attestedBy: "owner@client-bob.com",
        attestedAt: "2026-03-01T00:00:00.000Z",
        rightsBasis: "Tenant owns/has license to the imported review media",
        legalTextVersion: "v1",
    } as const;

    /** INVARIANT: the full attestation record parses — this is the shape rev-2 writes once. */
    it("accepts a complete attestation record", () => {
        expect(ImportBatchSchema.safeParse(BATCH).success).toBe(true);
    });

    /**
     * INVARIANT: every attestation field is required and non-empty. The record exists to be
     * an auditable consent trail; an empty attester or rights basis would defeat its purpose.
     */
    it.each(["attestedBy", "rightsBasis", "legalTextVersion"] as const)(
        "rejects an empty %s",
        (field) => {
            expect(ImportBatchSchema.safeParse({ ...BATCH, [field]: "" }).success).toBe(false);
        },
    );

    it.each(["id", "tenantId", "attestedBy", "attestedAt", "rightsBasis", "legalTextVersion"] as const)(
        "rejects a batch missing %s",
        (field) => {
            const partial: Record<string, unknown> = { ...BATCH };
            delete partial[field];
            expect(ImportBatchSchema.safeParse(partial).success).toBe(false);
        },
    );
});
