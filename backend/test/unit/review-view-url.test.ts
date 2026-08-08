import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { reviewOriginalKey } from "../../src/lib/review-media.js";

/**
 * REV-3 — the presigned-GET MODERATOR VIEW path folded onto the existing reviews-update Lambda
 * (GET /reviews/{id}/image-view-url). It rides updateReviewFunc (no new deployable unit) and follows
 * the existing presign pattern (resources/presign.ts): a short-lived presigned GET.
 *
 * These credential-free tests (DynamoDB mocked; `getSignedUrl` mocked so no AWS credential chain is
 * touched) pin:
 *   • a PENDING image on a PRIVATE staging key → presigned GET on the PRIVATE bucket for that key;
 *   • an APPROVED image on a PUBLIC key → the derived CDN URL, no signing;
 *   • site-scope routing (no productId → SITEREVIEW#), 404, and 400 on a bad imageIndex;
 *   • the GET path does NOT write a CDN-invalidation marker — it bypasses withInvalidation (a view
 *     is a read, not a mutation).
 * `npm run test:unit`.
 */

// Mock the presigner so signing needs no credentials and is deterministic + inspectable.
vi.mock("@aws-sdk/s3-request-presigner", () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getSignedUrl: vi.fn(async (_client: any, command: any) => `https://signed.example/${command.input.Bucket}/${command.input.Key}`),
}));
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
const mockSign = getSignedUrl as unknown as ReturnType<typeof vi.fn>;

process.env.TABLE_NAME = "amodx-table";
process.env.PRIVATE_BUCKET = "amodx-private-staging";
process.env.UPLOADS_BUCKET = "amodx-assets-staging";
process.env.UPLOADS_CDN_URL = "https://cdn.example.com";

const ddbmock = mockClient(DynamoDBDocumentClient);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: any;
beforeAll(async () => {
    handler = (await import("../../src/reviews/update.js")).handler;
});

const STAGING_KEY = reviewOriginalKey("t1", "b1", "img1"); // review-staging/t1/b1/img1/original
const PUBLIC_KEY = "t1/promoted-abc.jpg";

function reviewItem(imageStatus: string, assetKey: string, sk = "REVIEW#p1#r1") {
    return {
        PK: "TENANT#t1",
        SK: sk,
        id: "r1",
        tenantId: "t1",
        scope: sk.startsWith("SITEREVIEW#") ? "site" : "product",
        productId: sk.startsWith("SITEREVIEW#") ? undefined : "p1",
        source: "imported",
        authorName: "A. Customer",
        rating: 5,
        content: "",
        status: "approved",
        images: [{ assetKey, status: imageStatus }],
        createdAt: "2026-08-08T00:00:00.000Z",
    };
}

function getEvent(query: Record<string, string>, id = "r1") {
    return {
        headers: { "x-tenant-id": "t1" },
        pathParameters: { id },
        queryStringParameters: query,
        requestContext: {
            authorizer: { lambda: { sub: "u1", email: "mod@example.com", role: "TENANT_ADMIN", tenantId: "t1" } },
            http: { method: "GET", sourceIp: "127.0.0.1" },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

beforeEach(() => {
    ddbmock.reset();
    mockSign.mockClear();
    ddbmock.on(PutCommand).resolves({});
});

describe("GET /reviews/{id}/image-view-url — presigned moderator view", () => {
    it("signs a PRIVATE GET for a pending staged original", async () => {
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("pending", STAGING_KEY) });

        const res = await handler(getEvent({ imageIndex: "0", productId: "p1" }));
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.kind).toBe("staged");
        expect(body.status).toBe("pending");
        expect(body.viewUrl).toContain("amodx-private-staging");
        expect(body.viewUrl).toContain(STAGING_KEY);

        // Signed on the PRIVATE bucket + the staging key.
        expect(mockSign).toHaveBeenCalledTimes(1);
        const command = mockSign.mock.calls[0][1] as InstanceType<typeof GetObjectCommand>;
        expect(command.input.Bucket).toBe("amodx-private-staging");
        expect(command.input.Key).toBe(STAGING_KEY);

        // Read path only: no CDN-invalidation marker written (withInvalidation bypassed).
        expect(ddbmock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it("returns the CDN URL (no signing) for an approved public image", async () => {
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("approved", PUBLIC_KEY) });

        const res = await handler(getEvent({ imageIndex: "0", productId: "p1" }));
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.kind).toBe("public");
        expect(body.viewUrl).toBe(`https://cdn.example.com/${PUBLIC_KEY}`);
        expect(mockSign).not.toHaveBeenCalled();
        expect(ddbmock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it("routes a no-productId view to the SITEREVIEW# key (site-scope review)", async () => {
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("pending", STAGING_KEY, "SITEREVIEW#r1") });

        const res = await handler(getEvent({ imageIndex: "0" }));
        expect(res.statusCode).toBe(200);

        const gets = ddbmock.commandCalls(GetCommand);
        expect(gets).toHaveLength(1);
        expect((gets[0].args[0].input as any).Key.SK).toBe("SITEREVIEW#r1");
    });

    it("404s when the review does not exist", async () => {
        ddbmock.on(GetCommand).resolves({ Item: undefined });
        const res = await handler(getEvent({ imageIndex: "0", productId: "p1" }));
        expect(res.statusCode).toBe(404);
    });

    it("400s on a missing/invalid imageIndex", async () => {
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("pending", STAGING_KEY) });
        const res = await handler(getEvent({ productId: "p1" }));
        expect(res.statusCode).toBe(400);
    });

    it("400s when imageIndex is out of range", async () => {
        ddbmock.on(GetCommand).resolves({ Item: reviewItem("pending", STAGING_KEY) });
        const res = await handler(getEvent({ imageIndex: "5", productId: "p1" }));
        expect(res.statusCode).toBe(400);
    });
});
