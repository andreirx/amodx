import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { zipSync } from "fflate";

/**
 * REV-2b — the FIXTURE END-TO-END TRANSCRIPT (packet output surface #1; reviewer #3).
 *
 * This is the executable, credential-free proof that a CSV + media ZIP flows all the way through the
 * bulk importer to: (1) an immutable ImportBatch written FIRST, (2) a PENDING imported review, (3) a
 * staged PRIVATE `/original` object, and (4) the structured report the admin UI renders. It DRIVES
 * the real handler with S3 + DynamoDB mocked (aws-sdk-client-mock), captures every side-effect, and
 * `console.log`s a labelled transcript so the run's stdout IS the artifact the packet asks for.
 *
 * Run it alone to reproduce the transcript verbatim:
 *   cd backend && npx vitest run review-import-fixture --reporter=basic
 *
 * Nothing here is decoded (moderation-only pipeline, D-REV-4 SUPERSEDED): the ZIP bytes are opaque;
 * the declared type comes from the entry extension; the HUMAN moderation gate is the content control.
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

beforeEach(() => {
    s3mock.reset();
    ddbmock.reset();
    s3mock.on(PutObjectCommand).resolves({});
    ddbmock.on(PutCommand).resolves({});
});

describe("REV-2b fixture end-to-end transcript", () => {
    it("CSV + ZIP → ImportBatch(first) + PENDING review + staged /original + structured report", async () => {
        // ── INPUT FIXTURE ────────────────────────────────────────────────────────────────────
        const photoBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]); // opaque "PNG"
        const zipEntries = { "sofa-front.png": photoBytes };
        const zipBase64 = Buffer.from(zipSync(zipEntries)).toString("base64");
        const csvContent =
            "authorName,rating,content,productId,images\n" +
            'Ana Pop,5,"Beautiful, exactly as pictured.",prod-42,sofa-front.png\n';
        const attestation = { rightsBasis: "Tenant owns the review content and media", legalTextVersion: "rev-terms-v1" };

        const evt = {
            headers: { "x-tenant-id": "acme" },
            body: JSON.stringify({ format: "csv", csvContent, zipBase64, attestation }),
            requestContext: {
                authorizer: { lambda: { sub: "u-9", email: "owner@acme.example", role: "TENANT_ADMIN", tenantId: "acme" } },
                http: { sourceIp: "203.0.113.7" },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        // ── DRIVE THE REAL HANDLER ───────────────────────────────────────────────────────────
        const res = await handler(evt);
        const report = JSON.parse(res.body);

        // Captured side-effects.
        const ddbPuts = ddbmock.commandCalls(PutCommand).map((c) => (c.args[0].input as any).Item);
        const batchItem = ddbPuts.find((i: any) => String(i.SK).startsWith("IMPORTBATCH#"));
        const reviewItem = ddbPuts.find((i: any) => String(i.SK).startsWith("REVIEW#"));
        const s3Puts = s3mock.commandCalls(PutObjectCommand).map((c) => c.args[0].input as any);

        // ── TRANSCRIPT (this is the packet output surface) ───────────────────────────────────
        const line = "─".repeat(78);
        /* eslint-disable no-console */
        console.log(`\n${line}\nREV-2b BULK REVIEW IMPORT — FIXTURE END-TO-END TRANSCRIPT\n${line}`);
        console.log(`HTTP status: ${res.statusCode}`);
        console.log(`\n[INPUT] x-tenant-id: acme   actor: owner@acme.example (TENANT_ADMIN)`);
        console.log(`[INPUT] attestation: rightsBasis=${JSON.stringify(attestation.rightsBasis)} legalTextVersion=${attestation.legalTextVersion}`);
        console.log(`[INPUT] CSV:\n${csvContent.trimEnd()}`);
        console.log(`[INPUT] media ZIP entries: ${Object.entries(zipEntries).map(([n, b]) => `${n} (${b.length}B)`).join(", ")}`);

        console.log(`\n[WRITE 1 · DynamoDB] ImportBatch (written FIRST, immutable):`);
        console.log(`  PK=${batchItem.PK}  SK=${batchItem.SK}`);
        console.log(`  attestedBy=${batchItem.attestedBy}  rightsBasis=${JSON.stringify(batchItem.rightsBasis)}  legalTextVersion=${batchItem.legalTextVersion}`);

        console.log(`\n[WRITE 2 · S3 private stage] staged /original (declared-type+size gate; NO decode):`);
        console.log(`  Bucket=${s3Puts[0].Bucket}  Key=${s3Puts[0].Key}`);
        console.log(`  ContentType=${s3Puts[0].ContentType}  Body=${(s3Puts[0].Body as Buffer).length}B  Metadata=${JSON.stringify(s3Puts[0].Metadata)}`);

        console.log(`\n[WRITE 3 · DynamoDB] Review (PENDING — awaits human moderation):`);
        console.log(`  PK=${reviewItem.PK}  SK=${reviewItem.SK}`);
        console.log(`  status=${reviewItem.status}  source=${reviewItem.source}  scope=${reviewItem.scope}  productId=${reviewItem.productId}`);
        console.log(`  importBatchId=${reviewItem.importBatchId}`);
        console.log(`  images=${JSON.stringify(reviewItem.images)}`);

        console.log(`\n[RESPONSE] structured import report (rendered by the admin import dialog):`);
        console.log(JSON.stringify(report, null, 2));
        console.log(`${line}\n`);
        /* eslint-enable no-console */

        // ── ASSERTIONS (the transcript above is only trustworthy if these hold) ──────────────
        expect(res.statusCode).toBe(200);

        // (1) ImportBatch written FIRST, attributed to the actor EMAIL.
        expect(batchItem).toBeDefined();
        expect(batchItem.attestedBy).toBe("owner@acme.example");
        const batchIdx = ddbPuts.findIndex((i: any) => String(i.SK).startsWith("IMPORTBATCH#"));
        const reviewIdx = ddbPuts.findIndex((i: any) => String(i.SK).startsWith("REVIEW#"));
        expect(batchIdx).toBe(0);
        expect(reviewIdx).toBeGreaterThan(batchIdx);

        // (2) exactly one staged PRIVATE `/original`.
        expect(s3Puts).toHaveLength(1);
        expect(s3Puts[0].Bucket).toBe("amodx-private-staging");
        expect(String(s3Puts[0].Key)).toMatch(/^review-staging\/acme\/.+\/original$/);
        expect(s3Puts[0].ContentType).toBe("image/png");

        // (3) PENDING imported review referencing the private original key and the batch.
        expect(reviewItem.status).toBe("pending");
        expect(reviewItem.source).toBe("imported");
        expect(reviewItem.scope).toBe("product");
        expect(reviewItem.productId).toBe("prod-42");
        expect(reviewItem.importBatchId).toBe(report.batchId);
        expect(reviewItem.images).toHaveLength(1);
        expect(reviewItem.images[0].status).toBe("pending");
        expect(String(reviewItem.images[0].assetKey)).toBe(String(s3Puts[0].Key));

        // (4) structured report: full disposition, accepted image is first-class.
        expect(report).toMatchObject({ format: "csv", totalRows: 1, accepted: 1, rejected: 0 });
        expect(report.batchId).toBe(batchItem.SK.replace("IMPORTBATCH#", ""));
        expect(report.rows[0]).toMatchObject({ index: 0, status: "accepted", scope: "product", productId: "prod-42", imagesAccepted: 1 });
        expect(report.images).toHaveLength(1);
        expect(report.images[0]).toMatchObject({ status: "accepted", rowIndex: 0, entry: "sofa-front.png", size: photoBytes.length });
        expect(String(report.images[0].assetKey)).toBe(String(s3Puts[0].Key));
    });
});
