import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
    S3Client,
    PutObjectCommand,
    CopyObjectCommand,
    HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { AssetSchema } from "@amodx/shared";
import { MAX_UPLOAD_BYTES } from "@amodx/shared";
import {
    checkReviewImageInput,
    stageReviewImage,
    promotionAllowed,
    promoteReviewImage,
    rollbackPromotedReviewImage,
    reviewOriginalKey,
    HEIC_REJECTION_REASON,
    REVIEW_STAGING_PREFIX,
} from "../../src/lib/review-media.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * REV-2a — the SECURITY-half proofs for the staged media pipeline (moderation-only, D-REV-4
 * SUPERSEDED — there is no byte-level decoder any more; the native image-decode dependency was
 * removed from the backend). The whole pipeline is STAGE → human approval → PROMOTE, and this file
 * proves both effectful ends.
 *
 * Pure/mocked: no AWS, no credentials. Runs under `npm run test:unit` (vitest.unit.config.ts,
 * no setupFiles). S3 and the DynamoDB document client are mocked with aws-sdk-client-mock.
 *
 * Covers:
 *   - STAGING declared TYPE-AND-SIZE gate: accept the real types, reject SVG + disguised/non-image,
 *     require a valid declared size and record it as object metadata.
 *   - PROMOTION gate: requires BOTH approvals, copies the staged ORIGINAL only (moderation-only
 *     pipeline, D-REV-4 SUPERSEDED — no byte-screen), records the original's declared type + true
 *     size, and COMPENSATES a post-copy failure so no public orphan survives.
 *
 * NOTE: the deleted `review-media-screen.ts` / `review-media-ingest.ts` (image-decode) modules and
 * their tests were removed with the byte-screen (D-REV-4 SUPERSEDED); this is the only review-media test.
 */

const s3mock = mockClient(S3Client);
const ddbmock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
    s3mock.reset();
    ddbmock.reset();
    // Deterministic clock for createdAt; the value is not asserted but keeps the record stable.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00.000Z"));
});

// ── STEP 1: declared-type allowlist ─────────────────────────────────────────────────────────
describe("checkReviewImageInput — declared-type allowlist (STEP 1)", () => {
    // Ratified amendment (REV2A-HEIC-RUNTIME): allowlist = JPEG/JPG, PNG, WebP, AVIF. HEIC OUT.
    it.each(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"])(
        "accepts the ratified type %s",
        (mime) => {
            expect(checkReviewImageInput(mime)).toEqual({ accepted: true, contentType: mime });
        },
    );

    it("normalizes case before matching", () => {
        expect(checkReviewImageInput("IMAGE/JPEG")).toEqual({ accepted: true, contentType: "image/jpeg" });
    });

    it("rejects SVG outright (ratified — no rasterize branch)", () => {
        const r = checkReviewImageInput("image/svg+xml");
        expect(r.accepted).toBe(false);
        expect(r.accepted === false && r.reason).toMatch(/svg/i);
    });

    // Ratified amendment: HEIC/HEIF is rejected with the EXACT export-as-JPEG guidance message,
    // not a bare denial — a pure string/MIME check at the declared gate (no decode; D-REV-4
    // SUPERSEDED — there is no byte-screen).
    it.each(["image/heic", "image/heif"])("rejects HEIC-family %s with the ratified guidance message", (mime) => {
        const r = checkReviewImageInput(mime);
        expect(r.accepted).toBe(false);
        expect(r.accepted === false && r.reason).toBe(HEIC_REJECTION_REASON);
    });

    it.each(["image/gif", "application/pdf", "text/plain", "application/octet-stream"])(
        "rejects the non-allowlisted / disguised type %s",
        (mime) => {
            expect(checkReviewImageInput(mime).accepted).toBe(false);
        },
    );

    it("rejects a missing declared type", () => {
        expect(checkReviewImageInput(undefined).accepted).toBe(false);
        expect(checkReviewImageInput("").accepted).toBe(false);
    });

    // HONEST SCOPE, pinned as a test so it cannot be silently mis-read: a text file DECLARED
    // image/jpeg PASSES this gate. The declared gate is a claim-check, not byte inspection. With
    // the byte-screen removed (D-REV-4 SUPERSEDED), catching a fake .jpg-that-is-text is the HUMAN
    // MODERATION gate's job (every staged image is pending until approved), not this step.
    it("passes bytes that only CLAIM to be jpeg (declared gate is not byte inspection)", () => {
        expect(checkReviewImageInput("image/jpeg").accepted).toBe(true);
    });
});

describe("stageReviewImage — writes rejected input nowhere, accepted input to quarantine", () => {
    const base = {
        tenantId: "t1",
        batchId: "b1",
        imageId: "img1",
        bytes: new Uint8Array([1, 2, 3]),
        privateBucket: "amodx-private-staging",
        declaredSize: 3, // matches bytes.length; D-REV-2 requires a declared size
    };

    it("does NOT write to S3 when the declared type is rejected (SVG)", async () => {
        const r = await stageReviewImage({ ...base, declaredContentType: "image/svg+xml" });
        expect(r.staged).toBe(false);
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it("writes accepted bytes to the PRIVATE bucket under the quarantine original key, recording declared type AND size", async () => {
        s3mock.on(PutObjectCommand).resolves({});
        const r = await stageReviewImage({ ...base, declaredContentType: "image/png" });
        expect(r.staged).toBe(true);

        const puts = s3mock.commandCalls(PutObjectCommand);
        expect(puts).toHaveLength(1);
        const input = puts[0].args[0].input;
        expect(input.Bucket).toBe("amodx-private-staging");
        expect(input.Key).toBe(reviewOriginalKey("t1", "b1", "img1"));
        expect(String(input.Key).startsWith(REVIEW_STAGING_PREFIX)).toBe(true);
        expect(input.ContentType).toBe("image/png");
        // Both halves of the D-REV-2 gate are recorded on the staged object for the import audit.
        expect(input.Metadata?.["declared-content-type"]).toBe("image/png");
        expect(input.Metadata?.["declared-size"]).toBe("3");
    });

    // D-REV-2 "declared type-AND-SIZE": a missing / non-finite / negative size CLAIM is refused
    // before S3 is touched — the size is a required half of the contract, not an advisory hint.
    it.each([
        ["missing", undefined],
        ["negative", -1],
        ["NaN", Number.NaN],
        ["Infinity", Number.POSITIVE_INFINITY],
    ])("rejects a %s declared size and writes nothing", async (_label, declaredSize) => {
        s3mock.on(PutObjectCommand).resolves({});
        const r = await stageReviewImage({
            ...base,
            declaredContentType: "image/png",
            declaredSize: declaredSize as unknown as number,
        });
        expect(r.staged).toBe(false);
        expect(r.staged === false && r.reason).toMatch(/declaredSize/i);
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    // D-REV-2 "declared type-AND-SIZE". Staging holds the bytes, so this is a TRUE-size bound
    // (unlike the advisory declared-size on assets/create.ts). Over-cap writes NOTHING to S3.
    it("rejects bytes over the image cap and writes nothing (true-size guard)", async () => {
        s3mock.on(PutObjectCommand).resolves({});
        const oversized = new Uint8Array(MAX_UPLOAD_BYTES.image + 1);
        const r = await stageReviewImage({ ...base, bytes: oversized, declaredContentType: "image/png" });
        expect(r.staged).toBe(false);
        expect(r.staged === false && r.reason).toMatch(/exceeds/i);
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it("rejects an over-cap DECLARED size before reading bytes", async () => {
        s3mock.on(PutObjectCommand).resolves({});
        const r = await stageReviewImage({
            ...base,
            declaredContentType: "image/png",
            declaredSize: MAX_UPLOAD_BYTES.image + 1,
        });
        expect(r.staged).toBe(false);
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });
});

// ── STEP 3: promotion gate ──────────────────────────────────────────────────────────────────
describe("promotionAllowed — exhaustive gate truth table", () => {
    // The full 3×3 product of the ReviewSchema status domain {approved, pending, hidden} for
    // BOTH the review and the image. All nine combinations are enumerated below (1 true + 8 false),
    // so "exhaustive" is literal, not a claim.
    const STATUSES = ["approved", "pending", "hidden"] as const;
    const ALL_COMBOS = STATUSES.flatMap((rev) => STATUSES.map((img) => [rev, img] as const));

    it("enumerates all nine review×image combinations", () => {
        expect(ALL_COMBOS).toHaveLength(9);
    });

    it("is true ONLY when review AND image are both approved", () => {
        expect(promotionAllowed("approved", "approved")).toBe(true);
    });

    it.each(ALL_COMBOS.filter(([rev, img]) => !(rev === "approved" && img === "approved")))(
        "is false for review=%s image=%s",
        (rev, img) => {
            expect(promotionAllowed(rev, img)).toBe(false);
        },
    );
});

describe("promoteReviewImage — gate + structural source guards + assetKey contract", () => {
    const base = {
        tenantId: "t1",
        // Source = the entry's current assetKey: the PRIVATE staged `/original` the importer wrote.
        sourceStagingKey: reviewOriginalKey("t1", "b1", "img1"),
        uploadedBy: "moderator@example.com",
        privateBucket: "amodx-private-staging",
        publicBucket: "amodx-assets-staging",
        publicCdnUrl: "https://cdn.example.com",
        tableName: "amodx-table",
    };

    it("does nothing and reports the reason when the review is not approved", async () => {
        const r = await promoteReviewImage({ ...base, reviewStatus: "pending", imageStatus: "approved" });
        expect(r.promoted).toBe(false);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
        expect(ddbmock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it("does nothing when the image is not approved (even if the review is)", async () => {
        const r = await promoteReviewImage({ ...base, reviewStatus: "approved", imageStatus: "pending" });
        expect(r.promoted).toBe(false);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
        expect(ddbmock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it("ORIGINAL-ONLY: refuses a staging key that is not the /original", async () => {
        const r = await promoteReviewImage({
            ...base,
            sourceStagingKey: `${REVIEW_STAGING_PREFIX}t1/b1/img1/something-else`,
            reviewStatus: "approved",
            imageStatus: "approved",
        });
        expect(r.promoted).toBe(false);
        expect(r.promoted === false && r.reason).toMatch(/original/i);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    });

    it("TENANT ISOLATION: refuses a source key under another tenant's quarantine prefix", async () => {
        const r = await promoteReviewImage({
            ...base,
            sourceStagingKey: reviewOriginalKey("t2", "b1", "img1"), // t2, not t1
            reviewStatus: "approved",
            imageStatus: "approved",
        });
        expect(r.promoted).toBe(false);
        expect(r.promoted === false && r.reason).toMatch(/tenant/i);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    });

    it("idempotent: refuses an already-PUBLIC key (no staging prefix) so a re-approve cannot re-copy", async () => {
        const r = await promoteReviewImage({
            ...base,
            sourceStagingKey: "t1/already-a-public-asset.jpg",
            reviewStatus: "approved",
            imageStatus: "approved",
        });
        expect(r.promoted).toBe(false);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    });

    it("on BOTH approved: copies the staged ORIGINAL, records the PUBLIC assetKey with the original's type + true size", async () => {
        s3mock.on(CopyObjectCommand).resolves({});
        // Source HeadObject (private) carries the declared type; destination HeadObject (public) the
        // true size. A single stub with BOTH fields serves both calls.
        s3mock.on(HeadObjectCommand).resolves({ ContentType: "image/png", ContentLength: 20480 });
        ddbmock.on(PutCommand).resolves({});

        const r = await promoteReviewImage({ ...base, reviewStatus: "approved", imageStatus: "approved" });
        expect(r.promoted).toBe(true);
        if (!r.promoted) return; // narrow for TS

        // ORIGINAL-ONLY: the copy source is the /original key.
        const copies = s3mock.commandCalls(CopyObjectCommand);
        expect(copies).toHaveLength(1);
        const copySource = String(copies[0].args[0].input.CopySource);
        expect(copySource).toContain(reviewOriginalKey("t1", "b1", "img1"));
        expect(copies[0].args[0].input.Bucket).toBe("amodx-assets-staging");
        // The copy carries the ORIGINAL's declared content-type (not a hardcoded image/jpeg).
        expect(copies[0].args[0].input.ContentType).toBe("image/png");

        // TRUE size comes from HeadObject on the copied object, not from any declared value.
        expect(r.asset.size).toBe(20480);

        // Contract-complete: the persisted item validates against the shared AssetSchema, and its
        // fileType + key extension track the ORIGINAL's type (a .jpg key for a PNG would be a lie).
        const put = ddbmock.commandCalls(PutCommand);
        expect(put).toHaveLength(1);
        const item = put[0].args[0].input.Item!;
        expect(item.PK).toBe("TENANT#t1");
        expect(String(item.SK).startsWith("ASSET#")).toBe(true);
        expect(() => AssetSchema.parse(item)).not.toThrow();
        expect(item.fileType).toBe("image/png");

        // assetKey CONTRACT (rev-1): the KEY is recorded on the entry, not a URL. It is the
        // public S3 object key; the public URL is derived from it (and returned for audit only).
        expect(r.assetKey).toBe(`t1/${r.assetId}.png`);
        expect(r.assetKey).not.toContain("://");
        expect(r.publicUrl).toBe(`https://cdn.example.com/${r.assetKey}`);
    });

    it("refuses BEFORE any copy when the staged source has no content-type", async () => {
        // The source HeadObject returns no ContentType/metadata → we refuse rather than guess a type.
        // Nothing is copied, so there is nothing to roll back on this pre-copy edge.
        s3mock.on(HeadObjectCommand).resolves({ ContentLength: 20480 }); // no ContentType
        const r = await promoteReviewImage({ ...base, reviewStatus: "approved", imageStatus: "approved" });
        expect(r.promoted).toBe(false);
        expect(r.promoted === false && r.reason).toMatch(/content-type|untyped/i);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    });

    it("refuses BEFORE any copy when the source read fails", async () => {
        s3mock.on(HeadObjectCommand).rejects(new Error("source head failed"));
        const r = await promoteReviewImage({ ...base, reviewStatus: "approved", imageStatus: "approved" });
        expect(r.promoted).toBe(false);
        expect(r.promoted === false && r.reason).toMatch(/staged source/i);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    });

    // POST-COPY COMPENSATION: the public COPY already succeeded, so a failure in either remaining
    // step (the DESTINATION HeadObject for true size, or the ASSET# PutCommand) must delete the
    // copied object — otherwise a live public image would exist with no record pointing at it (an
    // orphan outside the handler's final-update rollback path). Both failure edges are proven. The
    // mocks are BUCKET-SCOPED: the source (private) head succeeds so the copy is reached, and the
    // destination (public) head is the one that fails.
    it("rolls back the copied public object when the destination HeadObject fails after the copy", async () => {
        s3mock.on(CopyObjectCommand).resolves({});
        s3mock.on(HeadObjectCommand, { Bucket: "amodx-private-staging" }).resolves({ ContentType: "image/jpeg" });
        s3mock.on(HeadObjectCommand, { Bucket: "amodx-assets-staging" }).rejects(new Error("head failed"));
        s3mock.on(DeleteObjectCommand).resolves({});
        ddbmock.on(DeleteCommand).resolves({});

        const r = await promoteReviewImage({ ...base, reviewStatus: "approved", imageStatus: "approved" });
        expect(r.promoted).toBe(false);
        expect(r.promoted === false && r.reason).toMatch(/post-copy|rolled back/i);

        // The copy ran, no asset record was written, and the copied public object was deleted.
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(1);
        expect(ddbmock.commandCalls(PutCommand)).toHaveLength(0);
        const del = s3mock.commandCalls(DeleteObjectCommand);
        expect(del).toHaveLength(1);
        expect(del[0].args[0].input.Bucket).toBe("amodx-assets-staging");
        expect(String(del[0].args[0].input.Key)).toMatch(/^t1\/.+\.jpg$/);
    });

    // TRUE-SIZE contract (review-5): the destination HeadObject may return no ContentLength. We must
    // NOT record a fabricated `size: 0` — that would persist a lie about the object. A missing/invalid
    // size fails promotion and runs the SAME post-copy rollback (delete the copied object, write no
    // record), leaving no public orphan and no false-size asset. Both absent and negative are proven.
    it.each([
        ["absent ContentLength", { ContentType: "image/jpeg" } as { ContentType: string; ContentLength?: number }],
        ["negative ContentLength", { ContentType: "image/jpeg", ContentLength: -1 }],
    ])("rolls back when the destination HeadObject returns %s (never records a fabricated size)", async (_label, headResult) => {
        s3mock.on(CopyObjectCommand).resolves({});
        s3mock.on(HeadObjectCommand, { Bucket: "amodx-private-staging" }).resolves({ ContentType: "image/jpeg" });
        s3mock.on(HeadObjectCommand, { Bucket: "amodx-assets-staging" }).resolves(headResult);
        s3mock.on(DeleteObjectCommand).resolves({});
        ddbmock.on(DeleteCommand).resolves({});

        const r = await promoteReviewImage({ ...base, reviewStatus: "approved", imageStatus: "approved" });
        expect(r.promoted).toBe(false);
        expect(r.promoted === false && r.reason).toMatch(/ContentLength|fabricated|post-copy|rolled back/i);

        // No asset record was written; the copied public object was deleted (no orphan, no size lie).
        expect(ddbmock.commandCalls(PutCommand)).toHaveLength(0);
        const del = s3mock.commandCalls(DeleteObjectCommand);
        expect(del).toHaveLength(1);
        expect(String(del[0].args[0].input.Key)).toMatch(/^t1\/.+\.jpg$/);
    });

    it("rolls back the copied public object AND the asset record when the ASSET# PutCommand fails", async () => {
        s3mock.on(CopyObjectCommand).resolves({});
        s3mock.on(HeadObjectCommand).resolves({ ContentType: "image/jpeg", ContentLength: 20480 });
        ddbmock.on(PutCommand).rejects(new Error("ddb put failed"));
        s3mock.on(DeleteObjectCommand).resolves({});
        ddbmock.on(DeleteCommand).resolves({});

        const r = await promoteReviewImage({ ...base, reviewStatus: "approved", imageStatus: "approved" });
        expect(r.promoted).toBe(false);

        // The public object AND (best-effort) the asset record are both cleaned up.
        expect(s3mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
        expect(ddbmock.commandCalls(DeleteCommand)).toHaveLength(1);
    });
});

describe("rollbackPromotedReviewImage — undoes both writes of a promotion", () => {
    it("deletes the copied public object AND its asset record", async () => {
        s3mock.on(DeleteObjectCommand).resolves({});
        ddbmock.on(DeleteCommand).resolves({});

        await rollbackPromotedReviewImage({
            tenantId: "t1",
            publicBucket: "amodx-assets-staging",
            assetKey: "t1/abc.jpg",
            assetId: "abc",
            tableName: "amodx-table",
        });

        const del = s3mock.commandCalls(DeleteObjectCommand);
        expect(del).toHaveLength(1);
        expect(del[0].args[0].input.Bucket).toBe("amodx-assets-staging");
        expect(del[0].args[0].input.Key).toBe("t1/abc.jpg");

        const ddel = ddbmock.commandCalls(DeleteCommand);
        expect(ddel).toHaveLength(1);
        expect(ddel[0].args[0].input.Key).toEqual({ PK: "TENANT#t1", SK: "ASSET#abc" });
    });
});
