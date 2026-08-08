import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
    S3Client,
    CopyObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
    DynamoDBDocumentClient,
    GetCommand,
    UpdateCommand,
    PutCommand,
    DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { reviewOriginalKey } from "../../src/lib/review-media.js";

/**
 * REV-2a — the WIRING proof for the FOLDED handler (REV2A-INFRA-SURFACE = option B): the review-
 * image approval action now rides the EXISTING `PUT /reviews/{id}` moderation handler
 * (`reviews/update.ts`) via `action: "approve-image"` — there is no dedicated Lambda/route.
 *
 * Verifies the ratified spine end-to-end at the seam:
 *   • the DEFAULT (no `action`) field update is UNCHANGED — existing callers unaffected;
 *   • approval is DERIVED FROM THE TENANT-SCOPED ROW, never the client body — a pending review is
 *     not promoted even if the body forges `status: "approved"`;
 *   • on an approved review, the private staged ORIGINAL is COPIED to public and the entry's
 *     `assetKey` is REPLACED with the public KEY (not a URL);
 *   • the PER-IMAGE concurrency guard: a concurrent duplicate approval loses (conditional update
 *     fails) and its promoted public object is ROLLED BACK — one wins, no double-copy, no orphan.
 *
 * Credential-free: DynamoDBDocumentClient + S3Client mocked (aws-sdk-client-mock). Env is set
 * before the handler module is imported (it reads bucket names at load). `npm run test:unit`.
 */

process.env.TABLE_NAME = "amodx-table";
process.env.PRIVATE_BUCKET = "amodx-private-staging";
process.env.UPLOADS_BUCKET = "amodx-assets-staging";
process.env.UPLOADS_CDN_URL = "https://cdn.example.com";

const s3mock = mockClient(S3Client);
const ddbmock = mockClient(DynamoDBDocumentClient);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: any;
beforeAll(async () => {
    handler = (await import("../../src/reviews/update.js")).handler;
});

const STAGING_KEY = reviewOriginalKey("t1", "b1", "img1");

function reviewItem(status: string, imageStatus = "pending", assetKey = STAGING_KEY) {
    return {
        PK: "TENANT#t1",
        SK: "REVIEW#p1#r1",
        id: "r1",
        tenantId: "t1",
        scope: "product",
        productId: "p1",
        source: "imported",
        authorName: "A. Customer",
        rating: 5,
        content: "",
        status,
        images: [{ assetKey, status: imageStatus }],
        createdAt: "2026-08-08T00:00:00.000Z",
    };
}

function event(body: Record<string, unknown>) {
    return {
        headers: { "x-tenant-id": "t1" },
        pathParameters: { id: "r1" },
        body: JSON.stringify(body),
        requestContext: {
            authorizer: { lambda: { sub: "u1", email: "mod@example.com", role: "TENANT_ADMIN", tenantId: "t1" } },
            http: { sourceIp: "127.0.0.1" },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

beforeEach(() => {
    s3mock.reset();
    ddbmock.reset();
    ddbmock.on(PutCommand).resolves({});
    ddbmock.on(DeleteCommand).resolves({});
    s3mock.on(CopyObjectCommand).resolves({});
    // Source head (private) supplies the declared type; destination head (public) the true size —
    // one stub with both fields serves both calls in the promotion path.
    s3mock.on(HeadObjectCommand).resolves({ ContentType: "image/jpeg", ContentLength: 12345 });
    s3mock.on(DeleteObjectCommand).resolves({});
});

describe("PUT /reviews/{id} — DEFAULT action (field update) is unchanged", () => {
    it("updates status without touching S3 (no promotion path)", async () => {
        ddbmock.on(UpdateCommand).resolves({});

        const res = await handler(event({ productId: "p1", status: "approved" }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).message).toBe("Review updated");

        // No image action → no GetCommand, no S3.
        expect(ddbmock.commandCalls(GetCommand)).toHaveLength(0);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);

        const updates = ddbmock.commandCalls(UpdateCommand);
        expect(updates).toHaveLength(1);
        const input = updates[0].args[0].input as any;
        expect(input.Key.SK).toBe("REVIEW#p1#r1");
        expect(input.ConditionExpression).toBe("attribute_exists(SK)");
    });

    it("routes a no-productId field update to the SITEREVIEW# namespace (rev-2b finding #1)", async () => {
        // A business (site-scope) review has NO productId (rev-1 D-REV-5). The moderation status
        // transition must reach it under the DISJOINT SITEREVIEW# key — mirroring approve-image —
        // so imported business reviews surfaced in the list can actually be approved/hidden.
        ddbmock.on(UpdateCommand).resolves({});
        const res = await handler(event({ status: "approved" }));
        expect(res.statusCode).toBe(200);
        const updates = ddbmock.commandCalls(UpdateCommand);
        expect(updates).toHaveLength(1);
        const input = updates[0].args[0].input as any;
        expect(input.Key.SK).toBe("SITEREVIEW#r1");
        expect(input.ConditionExpression).toBe("attribute_exists(SK)");
    });
});

describe("PUT /reviews/{id} — action: approve-image", () => {
    it("promotes on an approved review: copies the staged original and REPLACES assetKey with the public key", async () => {
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("approved") });
        ddbmock.on(UpdateCommand).resolves({});

        const res = await handler(event({ action: "approve-image", productId: "p1", imageIndex: 0 }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).promoted).toBe(true);

        // The staged original was copied to the PUBLIC bucket.
        const copies = s3mock.commandCalls(CopyObjectCommand);
        expect(copies).toHaveLength(1);
        expect(String(copies[0].args[0].input.CopySource)).toContain(STAGING_KEY);

        // The entry update touches ONLY the targeted element's document paths — status → approved
        // and assetKey → the PUBLIC key (not the staging key, not a URL) — and NEVER writes a whole
        // `:images` array (the review-4 clobber fix).
        const updates = ddbmock.commandCalls(UpdateCommand);
        expect(updates).toHaveLength(1);
        const input = updates[0].args[0].input as any;
        expect(input.UpdateExpression).toContain("#images[0].#status = :approvedImageStatus");
        expect(input.UpdateExpression).toContain("#images[0].#assetKey = :newAssetKey");
        expect(input.ExpressionAttributeValues[":images"]).toBeUndefined();
        expect(input.ExpressionAttributeValues[":approvedImageStatus"]).toBe("approved");
        const newKey = input.ExpressionAttributeValues[":newAssetKey"];
        expect(newKey).not.toBe(STAGING_KEY);
        expect(newKey).toMatch(/^t1\/.+\.jpg$/);
        expect(newKey).not.toContain("://");

        // PER-IMAGE concurrency guard: the condition pins the entry's OWN status AND assetKey (the
        // dedup mechanism) plus the review status (the un-approve guard).
        expect(input.ConditionExpression).toContain("#images[0].#status = :priorImageStatus");
        expect(input.ConditionExpression).toContain("#images[0].#assetKey = :priorAssetKey");
        expect(input.ConditionExpression).toContain("#status = :reviewStatus");
        expect(input.ExpressionAttributeValues[":priorImageStatus"]).toBe("pending");
        expect(input.ExpressionAttributeValues[":priorAssetKey"]).toBe(STAGING_KEY);
        expect(input.ExpressionAttributeValues[":reviewStatus"]).toBe("approved");
    });

    it("REFUSES approve-image on a PENDING review even when the body forges status:approved → 409, no write, no copy (ordering gate; derived from the row)", async () => {
        // review-1 state-machine-hole fix: a still-pending REVIEW cannot have its images approved.
        // Approving would flip the image to `approved` while promotion is skipped (review not
        // approved) → an approved image stuck on its private staging key that can never be promoted.
        // The action refuses (409) and leaves the entry UNTOUCHED, so the dead state is never created.
        // Approval remains derived from the tenant-scoped row: a forged body `status:approved` does
        // not change the outcome.
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("pending") });
        ddbmock.on(UpdateCommand).resolves({});

        const res = await handler(event({ action: "approve-image", productId: "p1", imageIndex: 0, status: "approved" }));
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).error).toMatch(/review is not approved/);

        // No copy and NO write — the image entry is left exactly as it was (still pending, staging).
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
        expect(ddbmock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it("TWO-STEP SEQUENCE (review-1 fix): approve the review (default field update), THEN approve-image promotes — no unpromotable dead state", async () => {
        // Step 1 — the moderator approves the REVIEW via the DEFAULT field-update path (no `action`).
        // This is a plain DDB SET; it touches no S3 and does not itself promote any image.
        ddbmock.on(UpdateCommand).resolves({});
        const step1 = await handler(event({ productId: "p1", status: "approved" }));
        expect(step1.statusCode).toBe(200);
        expect(JSON.parse(step1.body).message).toBe("Review updated");
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
        expect(ddbmock.commandCalls(GetCommand)).toHaveLength(0); // default path never reads the row

        // Step 2 — the review row is now approved; approve-image on the pending staging image PROMOTES.
        // (The row the second call reads reflects step 1's write.)
        ddbmock.reset();
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("approved") }); // pending image, staging key
        ddbmock.on(UpdateCommand).resolves({});
        const step2 = await handler(event({ action: "approve-image", productId: "p1", imageIndex: 0 }));
        expect(step2.statusCode).toBe(200);
        expect(JSON.parse(step2.body).promoted).toBe(true);

        // The original was copied to public and the entry's assetKey became the PUBLIC key
        // (written on the element path, not as a full-array replacement).
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(1);
        const input = ddbmock.commandCalls(UpdateCommand)[0].args[0].input as any;
        expect(input.ExpressionAttributeValues[":images"]).toBeUndefined();
        expect(input.ExpressionAttributeValues[":approvedImageStatus"]).toBe("approved");
        expect(input.ExpressionAttributeValues[":newAssetKey"]).not.toBe(STAGING_KEY);
        expect(input.ExpressionAttributeValues[":newAssetKey"]).toMatch(/^t1\/.+\.jpg$/);
    });

    it("CONCURRENT DUPLICATE APPROVAL: the loser's conditional update fails → promoted object rolled back → 409, no orphan", async () => {
        // Both racers read the same (approved review, pending image on the staging key). Both copy.
        // DynamoDB serialises the two conditional writes: the FIRST wins; the SECOND (this call)
        // finds the entry already transitioned, so its condition fails. We model the loser here.
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("approved") });
        ddbmock.on(UpdateCommand).rejects(
            Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" }),
        );

        const res = await handler(event({ action: "approve-image", productId: "p1", imageIndex: 0 }));
        expect(res.statusCode).toBe(409);

        // The loser DID copy (promotion ran), then rolled it back: public object + asset record gone.
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(1);
        const deletes = s3mock.commandCalls(DeleteObjectCommand);
        expect(deletes).toHaveLength(1);
        expect(deletes[0].args[0].input.Bucket).toBe("amodx-assets-staging");
        expect(String(deletes[0].args[0].input.Key)).toMatch(/^t1\/.+\.jpg$/);
        expect(ddbmock.commandCalls(DeleteCommand)).toHaveLength(1);
    });

    it("CONCURRENT approvals of TWO DISTINCT indices each write ONLY their own element paths — no cross-index clobber (review-4)", async () => {
        // review-4: the fix that makes the final write a per-ELEMENT document-path update instead of
        // a full-array `SET #images = :images`. With a two-image review, approving index 0 and index
        // 1 concurrently must produce writes over DISJOINT attributes so DynamoDB applies them
        // independently — neither can restore the other's entry to its stale pending/staging
        // snapshot (which is what a full-array last-writer-wins overwrite would do, orphaning the
        // first promotion's public object).
        const KEY0 = reviewOriginalKey("t1", "b1", "img1");
        const KEY1 = reviewOriginalKey("t1", "b1", "img2");
        const twoImageReview = {
            ...reviewItem("approved"),
            images: [
                { assetKey: KEY0, status: "pending" },
                { assetKey: KEY1, status: "pending" },
            ],
        };
        ddbmock.on(GetCommand).resolves({ Item: twoImageReview });
        ddbmock.on(UpdateCommand).resolves({});

        // Both racers read the same two-image snapshot; each approves a different index.
        const [res0, res1] = await Promise.all([
            handler(event({ action: "approve-image", productId: "p1", imageIndex: 0 })),
            handler(event({ action: "approve-image", productId: "p1", imageIndex: 1 })),
        ]);
        expect(res0.statusCode).toBe(200);
        expect(res1.statusCode).toBe(200);

        const updates = ddbmock.commandCalls(UpdateCommand);
        expect(updates).toHaveLength(2);

        const byIndex = (i: number) =>
            updates
                .map((c) => c.args[0].input as any)
                .find((inp) => String(inp.UpdateExpression).includes(`#images[${i}].#status`));

        const u0 = byIndex(0);
        const u1 = byIndex(1);
        expect(u0).toBeDefined();
        expect(u1).toBeDefined();

        // Each write targets ONLY its own element — never the sibling's paths, never the whole array.
        expect(u0.UpdateExpression).toContain("#images[0].#status = :approvedImageStatus");
        expect(u0.UpdateExpression).toContain("#images[0].#assetKey = :newAssetKey");
        expect(u0.UpdateExpression).not.toContain("#images[1]");
        expect(u0.ExpressionAttributeValues[":images"]).toBeUndefined();
        expect(u0.ExpressionAttributeValues[":priorAssetKey"]).toBe(KEY0);

        expect(u1.UpdateExpression).toContain("#images[1].#status = :approvedImageStatus");
        expect(u1.UpdateExpression).toContain("#images[1].#assetKey = :newAssetKey");
        expect(u1.UpdateExpression).not.toContain("#images[0]");
        expect(u1.ExpressionAttributeValues[":images"]).toBeUndefined();
        expect(u1.ExpressionAttributeValues[":priorAssetKey"]).toBe(KEY1);

        // Each condition still pins its OWN index's status+assetKey plus the review status — so
        // same-index dedup is intact while distinct-index writes never collide.
        expect(u0.ConditionExpression).toContain("#images[0].#status = :priorImageStatus");
        expect(u1.ConditionExpression).toContain("#images[1].#status = :priorImageStatus");
    });

    it("NON-CONDITIONAL final-update failure after promotion → public object + asset record rolled back, then 500", async () => {
        // rev-2a review-3: cleanup must cover EVERY post-copy failure, not only the conditional-loss
        // race. Here the final entry UpdateCommand fails with a NON-conditional error (e.g. a
        // throttle / transient DDB fault). Without compensation the already-copied public object and
        // its ASSET# record would be orphaned. Proof: the public DeleteObject + asset DeleteCommand
        // run, and the outer handler still surfaces the original failure as 500 (error semantics
        // preserved — this is NOT a 409).
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("approved") });
        ddbmock.on(UpdateCommand).rejects(
            Object.assign(new Error("Throughput exceeded"), { name: "ProvisionedThroughputExceededException" }),
        );

        const res = await handler(event({ action: "approve-image", productId: "p1", imageIndex: 0 }));
        expect(res.statusCode).toBe(500);

        // Promotion ran (copy happened), then was compensated on the non-conditional failure.
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(1);
        const deletes = s3mock.commandCalls(DeleteObjectCommand);
        expect(deletes).toHaveLength(1);
        expect(deletes[0].args[0].input.Bucket).toBe("amodx-assets-staging");
        expect(String(deletes[0].args[0].input.Key)).toMatch(/^t1\/.+\.jpg$/);
        expect(ddbmock.commandCalls(DeleteCommand)).toHaveLength(1);
    });

    it("IDEMPOTENT repeat: an already-approved+promoted image (public key) no-ops with no write, no copy", async () => {
        // The entry is already fully done: approved AND its assetKey is a PUBLIC key (no staging
        // prefix). A repeat approve-image must NOT re-copy or re-write — distinct from a lost race.
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("approved", "approved", "t1/already-public.jpg") });

        const res = await handler(event({ action: "approve-image", productId: "p1", imageIndex: 0 }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).promoted).toBe(false);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
        expect(ddbmock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it("REJECTS a non-pending (hidden) image → 409, no copy, no write (pending→approved only)", async () => {
        // CYCLE-3 transition rule: approve-image performs EXACTLY pending→approved. A moderated-out
        // (hidden) image must NOT be flippable to approved-and-promoted through this action.
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("approved", "hidden") });
        ddbmock.on(UpdateCommand).resolves({});

        const res = await handler(event({ action: "approve-image", productId: "p1", imageIndex: 0 }));
        expect(res.statusCode).toBe(409);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
        expect(ddbmock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it("REJECTS re-approving an approved-but-unpromoted (staging-key) image → 409 (not a pending edge)", async () => {
        // approved + still on a staging key = approved while the review was pending (no promotion).
        // That is not a pending→approved edge, so this action refuses it rather than promoting.
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("approved", "approved", STAGING_KEY) });
        const res = await handler(event({ action: "approve-image", productId: "p1", imageIndex: 0 }));
        expect(res.statusCode).toBe(409);
        expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
        expect(ddbmock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it("404s when the review row does not exist", async () => {
        ddbmock.on(GetCommand).resolves({ Item: undefined });
        const res = await handler(event({ action: "approve-image", productId: "p1", imageIndex: 0 }));
        expect(res.statusCode).toBe(404);
    });

    it("400s on a missing/invalid imageIndex", async () => {
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("approved") });
        const res = await handler(event({ action: "approve-image", productId: "p1" }));
        expect(res.statusCode).toBe(400);
    });
});
