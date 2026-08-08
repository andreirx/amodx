import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { reviewOriginalKey } from "../../src/lib/review-media.js";

/**
 * REV-3 DEEP-VERTICAL PROOF (the packet's EXECUTED public-list visibility proof).
 *
 * The whole rev-3 pipeline ends at the PUBLIC boundary: a moderated review whose image was approved
 * (promoted to the public bucket, its entry's assetKey rewritten to the PUBLIC key) must become
 * VISIBLE via the existing `GET /public/reviews/{productId}` handler, carrying that public assetKey —
 * AND a pending/hidden image (still on its PRIVATE `review-staging/` key) must NEVER appear in the
 * public payload. These credential-free tests (DynamoDB document client mocked, no AWS) pin exactly
 * that public-boundary filter. `npm run test:unit`.
 */

process.env.TABLE_NAME = "amodx-table";

const ddbmock = mockClient(DynamoDBDocumentClient);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: any;
beforeAll(async () => {
    handler = (await import("../../src/reviews/public-list.js")).handler;
});

const STAGING_KEY = reviewOriginalKey("t1", "b1", "img-pending"); // review-staging/t1/b1/img-pending/original
const PUBLIC_KEY = "t1/promoted-abc.jpg";

function event(productId = "p1") {
    return {
        headers: { "x-tenant-id": "t1" },
        pathParameters: { productId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

beforeEach(() => {
    ddbmock.reset();
});

describe("GET /public/reviews/{productId} — approved-image visibility at the public boundary", () => {
    it("exposes ONLY approved+public images and excludes pending staging images", async () => {
        ddbmock.on(QueryCommand).resolves({
            Items: [
                {
                    id: "r1",
                    authorName: "A. Customer",
                    rating: 5,
                    content: "Great",
                    source: "imported",
                    createdAt: "2026-08-08T00:00:00.000Z",
                    images: [
                        { assetKey: PUBLIC_KEY, status: "approved", alt: "the ring" },
                        { assetKey: STAGING_KEY, status: "pending" },
                    ],
                },
            ],
        });

        const res = await handler(event());
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);

        expect(body.items).toHaveLength(1);
        const imgs = body.items[0].images;
        // Exactly the one approved public image — the pending staging image is filtered out.
        expect(imgs).toHaveLength(1);
        expect(imgs[0].assetKey).toBe(PUBLIC_KEY);
        expect(imgs[0].alt).toBe("the ring");

        // HARD BOUNDARY INVARIANT: no private staging key may ever appear in a public response.
        expect(JSON.stringify(body)).not.toContain("review-staging/");
    });

    it("defense-in-depth: an (approved + still-staging) entry is STILL excluded (no private-key leak)", async () => {
        // Should not occur through the handlers (approve promotes + rewrites the key), but if a stray
        // approved-yet-staging entry ever existed, the public filter must not leak its private key.
        ddbmock.on(QueryCommand).resolves({
            Items: [
                {
                    id: "r2",
                    authorName: "B. Customer",
                    rating: 4,
                    content: "",
                    source: "imported",
                    createdAt: "2026-08-08T00:00:00.000Z",
                    images: [{ assetKey: STAGING_KEY, status: "approved" }],
                },
            ],
        });

        const res = await handler(event());
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.items[0].images).toHaveLength(0);
        expect(JSON.stringify(body)).not.toContain("review-staging/");
    });

    it("rev-3 hide: a HIDDEN image on a PUBLIC key (previously promoted, then moderated out) is excluded", async () => {
        // The hide-image action (REV3-IMG-HIDE-SCOPE = B) is a pure status flip: an already-promoted
        // image keeps its PUBLIC key but flips status→hidden. The public boundary must stop emitting it
        // purely on the status filter (no S3 delete happens). This is the deep-vertical proof that
        // hide reaches the public payload — the sibling of the pending-exclusion case above.
        ddbmock.on(QueryCommand).resolves({
            Items: [
                {
                    id: "r4",
                    authorName: "D. Customer",
                    rating: 5,
                    content: "Great",
                    source: "internal",
                    createdAt: "2026-08-08T00:00:00.000Z",
                    images: [
                        { assetKey: PUBLIC_KEY, status: "approved" },
                        { assetKey: "t1/promoted-hidden.jpg", status: "hidden" },
                    ],
                },
            ],
        });

        const res = await handler(event());
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        // Only the still-approved image survives; the hidden (public-key) one is filtered out.
        expect(body.items[0].images).toHaveLength(1);
        expect(body.items[0].images[0].assetKey).toBe(PUBLIC_KEY);
        expect(JSON.stringify(body)).not.toContain("promoted-hidden");
    });

    it("a review with no images returns an empty images array (shape stable for rev-4)", async () => {
        ddbmock.on(QueryCommand).resolves({
            Items: [
                {
                    id: "r3",
                    authorName: "C. Customer",
                    rating: 5,
                    content: "text only",
                    source: "internal",
                    createdAt: "2026-08-08T00:00:00.000Z",
                },
            ],
        });

        const res = await handler(event());
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.items[0].images).toEqual([]);
        expect(body.totalReviews).toBe(1);
        expect(body.averageRating).toBe(5);
    });
});
