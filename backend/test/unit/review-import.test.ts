import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { zipSync } from "fflate";

/**
 * REV-2b — the FIXTURE END-TO-END proof for the bulk import handler (moderation-only pipeline,
 * D-REV-4 SUPERSEDED — no automated byte-screen). A real ZIP through fflate; S3 + DynamoDB mocked
 * (aws-sdk-client-mock) so it runs credential-free under `npm run test:unit`.
 *
 * Because there is no decode step, the ZIP entry BYTES are never inspected — the declared type
 * comes from the entry's extension, so fixture "images" can be arbitrary bytes. The content control
 * on what reaches the public is the HUMAN moderation gate: every staged image lands `pending`.
 *
 * Pins the ratified slice invariants:
 *   • ATTESTATION GATE — no attestation payload → 400 and NOTHING is written (no batch, no rows).
 *   • BATCH-FIRST — the ImportBatch record is the FIRST write; if it fails, no review is written.
 *   • ZIP → STAGE WIRING — a referenced ZIP entry is STAGED (1 S3 put, the `/original`) and its
 *     PRIVATE original key lands on a PENDING ReviewImage; the review is PENDING + imported +
 *     carries importBatchId.
 *   • PER-ROW RESILIENCE — a malformed row and a missing image become report rejections, never an
 *     aborted batch; a malformed row's referenced images still appear in the report.
 *   • DECLARED-TYPE GATE — an off-allowlist declared type (by extension) is a per-image rejection.
 *   • SCOPE — productId → product key; no productId → SITEREVIEW# key.
 */

process.env.TABLE_NAME = "amodx-table";
process.env.PRIVATE_BUCKET = "amodx-private-staging";

const s3mock = mockClient(S3Client);
const ddbmock = mockClient(DynamoDBDocumentClient);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: any;
beforeAll(async () => {
    handler = (await import("../../src/import/reviews.js")).handler;
});

/** Arbitrary "photo" bytes — never decoded (moderation-only pipeline). */
function fakePhoto(): Uint8Array {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);
}

/** base64 of a real ZIP holding the given name→bytes entries. */
function zipBase64(entries: Record<string, Uint8Array>): string {
    return Buffer.from(zipSync(entries)).toString("base64");
}

function event(body: Record<string, unknown>, role = "TENANT_ADMIN") {
    return {
        headers: { "x-tenant-id": "t1" },
        body: JSON.stringify(body),
        requestContext: {
            authorizer: { lambda: { sub: "u1", email: "admin@example.com", role, tenantId: "t1" } },
            http: { sourceIp: "127.0.0.1" },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

const ATTEST = { rightsBasis: "Tenant owns the review content", legalTextVersion: "v1" };

/** PutCommand calls whose SK starts with the given prefix. */
function putsWithSk(prefix: string) {
    return ddbmock
        .commandCalls(PutCommand)
        .map((c) => c.args[0].input)
        .filter((i: any) => String(i.Item?.SK ?? "").startsWith(prefix));
}

beforeEach(() => {
    s3mock.reset();
    ddbmock.reset();
    s3mock.on(PutObjectCommand).resolves({});
    ddbmock.on(PutCommand).resolves({});
});

describe("POST /import/reviews — attestation gate", () => {
    it("rejects without an attestation payload and writes NOTHING", async () => {
        const res = await handler(event({ format: "csv", csvContent: "authorName,rating\nA,5\n" }));
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/attestation is required/);
        // No batch, no reviews — no DDB writes attributable to the import.
        expect(putsWithSk("IMPORTBATCH#")).toHaveLength(0);
        expect(putsWithSk("REVIEW#")).toHaveLength(0);
        expect(putsWithSk("SITEREVIEW#")).toHaveLength(0);
    });

    it("rejects when only half the attestation is present", async () => {
        const res = await handler(
            event({ format: "csv", csvContent: "authorName,rating\nA,5\n", attestation: { rightsBasis: "x" } }),
        );
        expect(res.statusCode).toBe(400);
    });

    it("rejects a non-admin caller", async () => {
        const res = await handler(
            event({ format: "csv", csvContent: "authorName,rating\nA,5\n", attestation: ATTEST }, "EDITOR"),
        );
        expect(res.statusCode).toBe(403);
    });
});

describe("POST /import/reviews — batch-first invariant", () => {
    it("writes the ImportBatch FIRST; if it fails, no review is written", async () => {
        // Fail the ImportBatch write specifically; succeed everything else.
        ddbmock.on(PutCommand).callsFake((input: any) => {
            if (String(input.Item?.SK ?? "").startsWith("IMPORTBATCH#")) {
                throw new Error("simulated batch write failure");
            }
            return {};
        });

        const res = await handler(
            event({ format: "csv", csvContent: "authorName,rating\nA,5\n", attestation: ATTEST }),
        );
        expect(res.statusCode).toBe(500);
        // The batch write threw → no review write happened.
        expect(putsWithSk("REVIEW#")).toHaveLength(0);
        expect(putsWithSk("SITEREVIEW#")).toHaveLength(0);
    });

    it("orders the batch write before any review write", async () => {
        const res = await handler(
            event({ format: "csv", csvContent: "authorName,rating,productId\nA,5,p1\n", attestation: ATTEST }),
        );
        expect(res.statusCode).toBe(200);
        const allSks = ddbmock.commandCalls(PutCommand).map((c) => String((c.args[0].input as any).Item?.SK ?? ""));
        const batchIdx = allSks.findIndex((s) => s.startsWith("IMPORTBATCH#"));
        const reviewIdx = allSks.findIndex((s) => s.startsWith("REVIEW#"));
        expect(batchIdx).toBeGreaterThanOrEqual(0);
        expect(reviewIdx).toBeGreaterThan(batchIdx);
    });
});

describe("POST /import/reviews — ZIP → stage wiring", () => {
    it("stages a referenced image and lands a PENDING imported review with the private original key", async () => {
        const photo = fakePhoto();
        const z = zipBase64({ "photo1.png": photo });
        const csv = "authorName,rating,content,images\nAna,5,Loved it,photo1.png\n";

        const res = await handler(event({ format: "csv", csvContent: csv, zipBase64: z, attestation: ATTEST }));
        expect(res.statusCode).toBe(200);
        const report = JSON.parse(res.body);

        // Report shape.
        expect(report.accepted).toBe(1);
        expect(report.rejected).toBe(0);
        expect(report.totalRows).toBe(1);
        expect(report.rows[0]).toMatchObject({ index: 0, status: "accepted", scope: "site", imagesAccepted: 1 });
        expect(typeof report.batchId).toBe("string");

        // FULL per-image disposition (revise #3): the accepted image is a FIRST-CLASS entry carrying
        // the PRIVATE original key + its staged byte size, not merely a count on the row.
        const accImgs = report.images.filter((i: any) => i.status === "accepted");
        const rejImgs = report.images.filter((i: any) => i.status === "rejected");
        expect(rejImgs).toHaveLength(0);
        expect(accImgs).toHaveLength(1);
        expect(accImgs[0]).toMatchObject({ status: "accepted", rowIndex: 0, entry: "photo1.png" });
        expect(accImgs[0].assetKey).toMatch(/^review-staging\/t1\//);
        expect(accImgs[0].assetKey.endsWith("/original")).toBe(true);
        expect(accImgs[0].size).toBe(photo.length);

        // Media wiring: exactly one S3 put (the raw original — no normalized derivative any more).
        const puts = s3mock.commandCalls(PutObjectCommand).map((c) => String(c.args[0].input.Key));
        expect(puts).toHaveLength(1);
        expect(puts[0].endsWith("/original")).toBe(true);

        // Review write: site scope (no productId), pending, imported, importBatchId, private image key.
        const siteReviews = putsWithSk("SITEREVIEW#");
        expect(siteReviews).toHaveLength(1);
        const item = siteReviews[0].Item as any;
        expect(item.status).toBe("pending");
        expect(item.source).toBe("imported");
        expect(item.scope).toBe("site");
        expect(item.importBatchId).toBe(report.batchId);
        expect(item.images).toHaveLength(1);
        expect(item.images[0].status).toBe("pending");
        // assetKey is the PRIVATE original key (promotion to public is rev-2a, on human approval).
        expect(item.images[0].assetKey).toMatch(/^review-staging\/t1\//);
        expect(item.images[0].assetKey.endsWith("/original")).toBe(true);
    });

    it("product-scope review lands under REVIEW#<productId>#", async () => {
        const csv = "authorName,rating,productId\nBob,4,prod-9\n";
        const res = await handler(event({ format: "csv", csvContent: csv, attestation: ATTEST }));
        expect(res.statusCode).toBe(200);
        const productReviews = putsWithSk("REVIEW#prod-9#");
        expect(productReviews).toHaveLength(1);
        expect((productReviews[0].Item as any).scope).toBe("product");
    });
});

describe("POST /import/reviews — per-row resilience", () => {
    it("rejects a bad row and a missing image but still imports the good rows; a rejected row's images still appear", async () => {
        const photo = fakePhoto();
        const z = zipBase64({ "good.png": photo });
        // Row 0: valid, image present. Row 1: missing rating (rejected) but references x.png.
        // Row 2: valid but image absent from the ZIP.
        const csv =
            "authorName,rating,images\n" +
            "Good,5,good.png\n" +
            "NoRating,,x.png\n" +
            "MissingImg,3,ghost.png\n";

        const res = await handler(event({ format: "csv", csvContent: csv, zipBase64: z, attestation: ATTEST }));
        expect(res.statusCode).toBe(200);
        const report = JSON.parse(res.body);

        expect(report.totalRows).toBe(3);
        expect(report.accepted).toBe(2); // rows 0 and 2 (row 2 accepted, its image rejected separately)
        expect(report.rejected).toBe(1); // row 1
        const row1 = report.rows.find((r: any) => r.index === 1);
        expect(row1.status).toBe("rejected");
        expect(row1.reason).toMatch(/rating/);

        const rejImgs = report.images.filter((i: any) => i.status === "rejected");
        const accImgs = report.images.filter((i: any) => i.status === "accepted");
        // Row 0's image is accepted; row 2's image is rejected (missing from ZIP); row 1's image
        // (x.png) appears as rejected EVEN THOUGH its row was rejected (reviewer fix — every
        // referenced image appears once in the report).
        expect(accImgs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ status: "accepted", rowIndex: 0, entry: "good.png" }),
            ]),
        );
        expect(rejImgs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ status: "rejected", rowIndex: 2, entry: "ghost.png", reason: expect.stringMatching(/not found/i) }),
                expect.objectContaining({ status: "rejected", rowIndex: 1, entry: "x.png", reason: expect.stringMatching(/row rejected/i) }),
            ]),
        );
        // A batch was still written (one bad row never aborts the batch).
        expect(putsWithSk("IMPORTBATCH#")).toHaveLength(1);
    });

    it("rejects an off-allowlist declared type (by extension) as a per-image rejection at the STAGE gate", async () => {
        // A .heic entry is refused by the DECLARED-type gate with the ratified export-as-JPEG message
        // — a pure string/MIME check, no decode (moderation-only pipeline).
        const z = zipBase64({ "iphone.heic": fakePhoto(), "notes.txt": fakePhoto() });
        const csv = "authorName,rating,images\nAna,5,iphone.heic|notes.txt\n";

        const res = await handler(event({ format: "csv", csvContent: csv, zipBase64: z, attestation: ATTEST }));
        expect(res.statusCode).toBe(200);
        const report = JSON.parse(res.body);
        // Row accepted (valid fields), both images rejected at the declared gate.
        expect(report.accepted).toBe(1);
        expect(report.rows[0].imagesAccepted).toBe(0);
        const rejImgs = report.images.filter((i: any) => i.status === "rejected");
        expect(report.images.filter((i: any) => i.status === "accepted")).toHaveLength(0);
        expect(rejImgs).toHaveLength(2);
        const heic = rejImgs.find((i: any) => i.entry === "iphone.heic");
        expect(heic.reason).toMatch(/HEIC|export as JPEG/i);
        // Neither reached S3 (declared gate refuses before any PutObject).
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });
});

describe("POST /import/reviews — image-count cap is enforced BEFORE staging (review-1 #2)", () => {
    it("a 13-reference row is ONE rejected row, one rejected disposition per reference, NO review write, NO staged objects", async () => {
        // The row's fields are valid; only the image COUNT (13 > the 12-image max) trips it. The
        // entries EXIST in the ZIP, so if the cap were enforced at write-time (ReviewSchema.parse)
        // the handler would have staged all 13 first. Enforcing it in the parser means none stage.
        const refs = Array.from({ length: 13 }, (_, i) => `p${i}.png`);
        const entries: Record<string, Uint8Array> = {};
        for (const r of refs) entries[r] = fakePhoto();
        const z = zipBase64(entries);
        const csv = `authorName,rating,images\nAna,5,${refs.join(";")}\n`;

        const res = await handler(event({ format: "csv", csvContent: csv, zipBase64: z, attestation: ATTEST }));
        expect(res.statusCode).toBe(200);
        const report = JSON.parse(res.body);

        // One rejected row, nothing accepted.
        expect(report.totalRows).toBe(1);
        expect(report.accepted).toBe(0);
        expect(report.rejected).toBe(1);
        expect(report.rows[0]).toMatchObject({ index: 0, status: "rejected" });
        expect(report.rows[0].reason).toMatch(/too many images/);

        // Every one of the 13 references appears ONCE, all rejected (full-disposition contract holds
        // even for a rejected row) — and none is "accepted".
        const rejImgs = report.images.filter((i: any) => i.status === "rejected");
        const accImgs = report.images.filter((i: any) => i.status === "accepted");
        expect(accImgs).toHaveLength(0);
        expect(rejImgs).toHaveLength(13);
        expect(new Set(rejImgs.map((i: any) => i.entry)).size).toBe(13);
        for (const i of rejImgs) expect(i.reason).toMatch(/row rejected/i);

        // NO review write and NO staged objects — only the (mandatory) ImportBatch write exists.
        expect(putsWithSk("SITEREVIEW#")).toHaveLength(0);
        expect(putsWithSk("REVIEW#")).toHaveLength(0);
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
        expect(putsWithSk("IMPORTBATCH#")).toHaveLength(1);
    });
});

describe("POST /import/reviews — a per-image stage FAILURE is a rejected disposition, not a lost image (review-1 #3)", () => {
    it("an S3 PutObject rejection surfaces the image as rejected and the row continues", async () => {
        // Simulate infra failure on the staging PUT. The exception must be caught PER IMAGE, not by
        // the outer row catch — otherwise the referenced entry would vanish from the report.
        s3mock.on(PutObjectCommand).rejects(new Error("S3 unavailable"));
        const z = zipBase64({ "photo1.png": fakePhoto() });
        const csv = "authorName,rating,images\nAna,5,photo1.png\n";

        const res = await handler(event({ format: "csv", csvContent: csv, zipBase64: z, attestation: ATTEST }));
        expect(res.statusCode).toBe(200);
        const report = JSON.parse(res.body);

        // Row still ACCEPTED (a transient stage error is not a content rejection of the whole row);
        // its one image is a rejected disposition — appearing exactly once.
        expect(report.accepted).toBe(1);
        expect(report.rows[0]).toMatchObject({ index: 0, status: "accepted", imagesAccepted: 0 });
        const accImgs = report.images.filter((i: any) => i.status === "accepted");
        const rejImgs = report.images.filter((i: any) => i.status === "rejected");
        expect(accImgs).toHaveLength(0);
        expect(rejImgs).toHaveLength(1);
        expect(rejImgs[0]).toMatchObject({ status: "rejected", rowIndex: 0, entry: "photo1.png" });
        expect(rejImgs[0].reason).toMatch(/staging failed/i);

        // The review WAS written (with zero images), and the S3 put was attempted.
        const siteReviews = putsWithSk("SITEREVIEW#");
        expect(siteReviews).toHaveLength(1);
        expect((siteReviews[0].Item as any).images).toHaveLength(0);
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(1);
    });
});

describe("POST /import/reviews — attestation identity fails CLOSED (reviewer #1)", () => {
    it("rejects a master-key/robot caller that has NO attributable email; writes and stages NOTHING", async () => {
        // The master-key authorizer context (authorizer.ts) is GLOBAL_ADMIN, sub:"system-robot", and
        // carries NO email; it passes requireRole on the GLOBAL_ADMIN short-circuit. Attestation is a
        // LEGAL assertion keyed to an actor email (ImportBatch.attestedBy), so a principal with no
        // attributable identity must NOT be able to author one. The former `auth.email || auth.sub`
        // fallback would have persisted `attestedBy: "system-robot"` — a false attestation identity.
        const z = zipBase64({ "photo1.png": fakePhoto() });
        const robotEvent = {
            headers: { "x-tenant-id": "t1" },
            body: JSON.stringify({
                format: "csv",
                csvContent: "authorName,rating,images\nAna,5,photo1.png\n",
                zipBase64: z,
                attestation: ATTEST,
            }),
            requestContext: {
                // No `email` field — exactly the master-key/robot context.
                authorizer: { lambda: { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" } },
                http: { sourceIp: "127.0.0.1" },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        const res = await handler(robotEvent);
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/attributable identity|email/i);

        // Fail-closed: NOTHING written or staged — no batch, no reviews, no S3 objects.
        expect(putsWithSk("IMPORTBATCH#")).toHaveLength(0);
        expect(putsWithSk("REVIEW#")).toHaveLength(0);
        expect(putsWithSk("SITEREVIEW#")).toHaveLength(0);
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it("a TENANT_ADMIN with an email attests successfully and `attestedBy` is that email, never the sub", async () => {
        const res = await handler(
            event({ format: "csv", csvContent: "authorName,rating\nAna,5\n", attestation: ATTEST }),
        );
        expect(res.statusCode).toBe(200);
        const batch = putsWithSk("IMPORTBATCH#");
        expect(batch).toHaveLength(1);
        // attestedBy is the actor EMAIL from the authorizer context, not `auth.sub` ("u1").
        expect((batch[0].Item as any).attestedBy).toBe("admin@example.com");
    });
});

describe("POST /import/reviews — a review-write failure rejects the row AND its staged images (reviewer #2)", () => {
    it("never reports a staged image accepted when the review PutCommand fails; the image is rejected once", async () => {
        // Stage the image successfully (S3 ok) but fail the REVIEW write specifically (not the batch
        // write). The staged object is now an orphan no review references, so its disposition MUST be
        // rejected — not accepted — and it must appear exactly once carrying the row-write reason.
        ddbmock.on(PutCommand).callsFake((input: any) => {
            const sk = String(input.Item?.SK ?? "");
            if (sk.startsWith("SITEREVIEW#") || sk.startsWith("REVIEW#")) {
                throw new Error("simulated review write failure");
            }
            return {}; // IMPORTBATCH# and anything else succeed
        });

        const photo = fakePhoto();
        const z = zipBase64({ "photo1.png": photo });
        const csv = "authorName,rating,images\nAna,5,photo1.png\n";

        const res = await handler(event({ format: "csv", csvContent: csv, zipBase64: z, attestation: ATTEST }));
        // A per-row failure never aborts the batch → still 200 with a report.
        expect(res.statusCode).toBe(200);
        const report = JSON.parse(res.body);

        // Row rejected with the write-failure reason.
        expect(report.accepted).toBe(0);
        expect(report.rejected).toBe(1);
        expect(report.rows[0]).toMatchObject({ index: 0, status: "rejected" });
        expect(report.rows[0].reason).toMatch(/review write failure/i);

        // The image WAS staged (one S3 put happened) but is reported REJECTED (orphan), never
        // accepted, and appears exactly once with the row-write reason.
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(1);
        const accImgs = report.images.filter((i: any) => i.status === "accepted");
        const rejImgs = report.images.filter((i: any) => i.status === "rejected");
        expect(accImgs).toHaveLength(0);
        expect(rejImgs).toHaveLength(1);
        expect(rejImgs[0]).toMatchObject({ status: "rejected", rowIndex: 0, entry: "photo1.png" });
        expect(rejImgs[0].reason).toMatch(/row write failed/i);

        // The batch WAS written (batch-first invariant; only the review write failed).
        expect(putsWithSk("IMPORTBATCH#")).toHaveLength(1);
    });
});

describe("POST /import/reviews — ZIP decode/bound is read-only BEFORE the first write", () => {
    it("rejects a corrupt media ZIP with a 400 and writes NOTHING (no orphan attestation batch)", async () => {
        // reviewer #2: the ZIP is decoded BEFORE the ImportBatch write, so a bad ZIP is a clean
        // 400 that leaves no orphan batch. `unzipSync` throws on data with no EOCD signature.
        const notAZip = Buffer.from("this is definitely not a zip archive").toString("base64");
        const csv = "authorName,rating,images\nAna,5,photo.png\n";

        const res = await handler(
            event({ format: "csv", csvContent: csv, zipBase64: notAZip, attestation: ATTEST }),
        );
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/invalid media ZIP/);
        // Nothing written — batch is not orphaned, no reviews.
        expect(putsWithSk("IMPORTBATCH#")).toHaveLength(0);
        expect(putsWithSk("REVIEW#")).toHaveLength(0);
        expect(putsWithSk("SITEREVIEW#")).toHaveLength(0);
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it("rejects a bomb-like entry (declared uncompressed size over the per-image cap) BEFORE inflating or writing", async () => {
        // reviewer #3: 11 MB of zeros compresses to a tiny archive, but the ZIP directory declares
        // originalSize = 11 MB > the 10 MB per-image cap. fflate's `filter` throws on that DECLARED
        // size BEFORE the entry is inflated — so the 11 MB never expands into memory, and because the
        // decode runs before the first write, nothing is persisted.
        const bomb = new Uint8Array(11 * 1024 * 1024); // all zeros → tiny compressed, 11 MB declared
        const z = Buffer.from(zipSync({ "bomb.png": bomb })).toString("base64");
        const csv = "authorName,rating,images\nAna,5,bomb.png\n";

        const res = await handler(
            event({ format: "csv", csvContent: csv, zipBase64: z, attestation: ATTEST }),
        );
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/invalid media ZIP/);
        expect(putsWithSk("IMPORTBATCH#")).toHaveLength(0);
        expect(putsWithSk("REVIEW#")).toHaveLength(0);
        expect(putsWithSk("SITEREVIEW#")).toHaveLength(0);
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });
});

describe("POST /import/reviews — JSON source", () => {
    it("imports from a JSON array", async () => {
        const json = JSON.stringify([
            { author: "Ana", rating: 5, text: "Great" },
            { author: "Bob", rating: 4, text: "Good", productId: "p2" },
        ]);
        const res = await handler(event({ format: "json", jsonContent: json, attestation: ATTEST }));
        expect(res.statusCode).toBe(200);
        const report = JSON.parse(res.body);
        expect(report.accepted).toBe(2);
        expect(putsWithSk("SITEREVIEW#")).toHaveLength(1);
        expect(putsWithSk("REVIEW#p2#")).toHaveLength(1);
    });
});
