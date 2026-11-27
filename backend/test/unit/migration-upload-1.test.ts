import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * MIGRATION-UPLOAD-1 (docs/slices/migration-upload-1.md § Evidence taxonomy) — the upload link for a migration file,
 * the importers' read of it from the PRIVATE bucket, and its deletion after the last batch of an import.
 *
 * Credential-free: `@aws-sdk/client-s3` and the presigner are mocked (every S3 call is recorded by command name),
 * `db.js` answers empty, the parser of the WordPress importer is mocked to an empty export (so a first batch is also
 * the last), and the media map / image upload / audit / CDN helpers are mocked because they do their own I/O.
 */

const { s3Send, ddbSend, signed, mediaMap, downloads } = vi.hoisted(() => {
    process.env.PRIVATE_BUCKET = "private-test"; // read at module import by the three handlers
    process.env.UPLOADS_BUCKET = "uploads-test";
    process.env.UPLOADS_CDN_URL = "https://cdn.test";
    // The media map KEEPS its writes across requests, as the real MEDIAMAP# items do (review-0 F-MU1-EARLY-DELETE: a
    // map that never grows hid the shrinking-cursor defect). A source URL containing "fail" cannot be downloaded.
    return { s3Send: vi.fn(), ddbSend: vi.fn(), signed: vi.fn(), mediaMap: new Map<string, string>(), downloads: [] as string[] };
});

vi.mock("@aws-sdk/client-s3", () => {
    class Command { constructor(public input: any) {} }
    return {
        S3Client: class { send = s3Send; },
        GetObjectCommand: class GetObjectCommand extends Command {},
        DeleteObjectCommand: class DeleteObjectCommand extends Command {},
        PutObjectCommand: class PutObjectCommand extends Command {},
    };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: signed }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));
vi.mock("../../src/lib/media-map.js", () => ({
    loadMediaMap: vi.fn(async () => new Map(mediaMap)),
    writeMediaMapEntry: vi.fn(async (_tenant: string, from: string, to: string) => { mediaMap.set(from, to); }),
}));
vi.mock("../../src/lib/image-upload.js", () => ({
    downloadAndUploadImage: vi.fn(async (_tenant: string, url: string) => {
        downloads.push(url);
        if (url.includes("fail")) throw new Error("source answered 404");
        return `https://cdn.test/t1/${url.split("/").pop()}`;
    }),
}));
vi.mock("../../src/lib/invalidate-cdn.js", () => ({ withInvalidation: (handler: any) => handler }));
vi.mock("../../src/lib/revalidate.js", () => ({ purgeStoredPagesOfRequestTenant: vi.fn() }));
vi.mock("../../src/import/wxr-parser.js", () => ({ parseWXR: vi.fn(async () => []) }));

import { handler as uploadUrlHandler } from "../../src/import/upload-url.js";
import { handler as mediaHandler } from "../../src/import/media.js";
import { handler as wordpressHandler } from "../../src/import/wordpress.js";
import { MIGRATION_UPLOAD_MAX_BYTES, UPLOAD_AGAIN, migrationUploadKey, safeFileName } from "../../src/import/migration-upload.js";

const TENANT = "t1";
const KEY = `migration/${TENANT}/0f8fad5b-d9cb-469f-a165-70867728950e-export.xml`;
const OTHER_KEY = `migration/t2/0f8fad5b-d9cb-469f-a165-70867728950e-export.xml`;

function event(body: unknown, { header = TENANT, tokenTenant = TENANT, role = "TENANT_ADMIN", query = undefined as Record<string, string> | undefined } = {}) {
    return {
        headers: { "x-tenant-id": header },
        body: JSON.stringify(body),
        queryStringParameters: query,
        requestContext: {
            authorizer: { lambda: { sub: "u1", email: "admin@t1.test", role, tenantId: tokenTenant } },
            http: { sourceIp: "127.0.0.1" },
        },
    } as any;
}
const call = async (handler: any, ev: any) => (await handler(ev, {} as any, () => {})) as { statusCode: number; body: string };
const s3Calls = (name: string) => s3Send.mock.calls.filter((c) => c[0].constructor.name === name).map((c) => c[0].input);

const MEDIA_WXR = `<rss><channel><item><title>a</title><wp:post_type>attachment</wp:post_type><wp:attachment_url>https://old.test/a.jpg</wp:attachment_url></item>` +
    `<item><title>b</title><wp:post_type>attachment</wp:post_type><wp:attachment_url>https://old.test/b.jpg</wp:attachment_url></item></channel></rss>`;
const EMPTY_WXR = "<rss><channel><title>x</title></channel></rss>";
const stored = (content: string, length = content.length) => ({ ContentLength: length, Body: { transformToString: async () => content, destroy: vi.fn() } });

beforeEach(() => {
    mediaMap.clear();
    downloads.length = 0;
    s3Send.mockReset();
    ddbSend.mockReset().mockResolvedValue({ Items: [] });
    signed.mockReset().mockImplementation(async (_client: unknown, command: any) => `https://signed.test/${command.input.Key}`);
});

describe("MU1-LINK — POST /import/upload-url", () => {
    it.each([["application/xml"], ["text/xml"], ["text/csv"]])("MU1-LINK-OK: %s within the limit → link + key under migration/<tenant>/", async (contentType) => {
        const res = await call(uploadUrlHandler, event({ filename: "My Export (1).xml", contentType, size: 1234 }));
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.s3Key).toMatch(/^migration\/t1\/[0-9a-f-]{36}-My_Export_1_\.xml$/);
        expect(body.uploadUrl).toBe(`https://signed.test/${body.s3Key}`);
        const command = signed.mock.calls[0][1];
        expect(command.constructor.name).toBe("PutObjectCommand");
        expect(command.input).toEqual({ Bucket: "private-test", Key: body.s3Key, ContentType: contentType });
        expect(signed.mock.calls[0][2]).toEqual({ expiresIn: 300, signableHeaders: new Set(["content-type"]) });
    });

    it("MU1-LINK-SIZE-EDGE: exactly the limit → link", async () => {
        const res = await call(uploadUrlHandler, event({ filename: "x.xml", contentType: "application/xml", size: MIGRATION_UPLOAD_MAX_BYTES }));
        expect(res.statusCode).toBe(200);
    });

    it.each([
        ["an image type", { filename: "x.jpg", contentType: "image/jpeg", size: 10 }, /File type "image\/jpeg" is not allowed for a migration file/],
        ["no content type", { filename: "x.xml", size: 10 }, /is not allowed for a migration file/],
        ["over the limit", { filename: "x.xml", contentType: "application/xml", size: MIGRATION_UPLOAD_MAX_BYTES + 1 }, /the limit for a migration file is 41943040 bytes \(40 MB\)\. Split the export/],
        ["size missing", { filename: "x.xml", contentType: "application/xml" }, /File size is required/],
        ["size zero", { filename: "x.xml", contentType: "application/xml", size: 0 }, /File size is required/],
        ["size not a number", { filename: "x.xml", contentType: "application/xml", size: "10" }, /File size is required/],
        ["file name missing", { contentType: "application/xml", size: 10 }, /filename is required/],
    ])("MU1-LINK-REFUSED: %s → 400 with a message, no link", async (_case, body, message) => {
        const res = await call(uploadUrlHandler, event(body));
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(message);
        expect(signed).not.toHaveBeenCalled();
    });

    it.each([
        ["a forged header (token t1, header t2)", { header: "t2" }, /Access Denied/],
        ["a role outside the import roles", { role: "CUSTOMER" }, /Access Denied: Role 'CUSTOMER'/],
        ["a service key (no service scope on this route)", { role: "SERVICE" }, /not available to service keys/],
    ])("MU1-LINK-ROLE: %s → 403 as the import routes refuse, no link", async (_case, opts, message) => {
        const res = await call(uploadUrlHandler, event({ filename: "x.xml", contentType: "application/xml", size: 10 }, opts as any));
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(message);
        expect(signed).not.toHaveBeenCalled();
    });

    it("MU1-LINK-EDITOR: an EDITOR of its own tenant gets a link (as the import routes admit it)", async () => {
        const res = await call(uploadUrlHandler, event({ filename: "x.xml", contentType: "application/xml", size: 10 }, { role: "EDITOR" }));
        expect(res.statusCode).toBe(200);
    });

    it("MU1-KEY-FORM: the safe name keeps letters, digits, '.', '_', '-'; a name of nothing safe → 'upload'", () => {
        expect(safeFileName("../../etc/passwd")).toBe("etc_passwd");
        expect(safeFileName("șțăî.xml")).toBe("xml"); // "_.xml", then the leading "_." is removed (no hidden-file name)
        expect(safeFileName("///")).toBe("upload");
        expect(migrationUploadKey("t1", "a b.csv")).toMatch(/^migration\/t1\/[0-9a-f-]{36}-a_b\.csv$/);
    });
});

const IMPORTERS = [
    ["import/media.ts", mediaHandler],
    ["import/wordpress.ts", wordpressHandler],
] as const;

describe.each(IMPORTERS)("MU1-READ — %s reads the migration upload from the private bucket", (_name, handler) => {
    it("MU1-READ-OWN: a key under the caller tenant's prefix → GetObject on the PRIVATE bucket with exactly that key", async () => {
        s3Send.mockResolvedValue(stored(EMPTY_WXR));
        const res = await call(handler, event({ s3Key: KEY, keepOldAddresses: false }));
        expect(res.statusCode).toBe(200);
        expect(s3Calls("GetObjectCommand")).toEqual([{ Bucket: "private-test", Key: KEY }]);
    });

    it.each([
        ["another tenant's migration prefix", OTHER_KEY, 403, "s3Key is not owned by this tenant"],
        ["a tenant whose id starts with the caller's id and a '/' ('migration/t1/x/…')", `migration/t1/x/0f8fad5b-d9cb-469f-a165-70867728950e-a.xml`, 403, "s3Key is not owned by this tenant"],
        ["the old public form '<tenant>/<assetId>-migration/<file>'", `${TENANT}/0f8fad5b-d9cb-469f-a165-70867728950e-migration/export.xml`, 400, /not a migration upload/],
        ["a key outside migration/", "review-staging/t1/b/i/original", 400, /not a migration upload/],
        ["the bare tenant prefix (not the form the link builds)", `migration/${TENANT}/`, 403, "s3Key is not owned by this tenant"],
        ["a key that is not a string", 42, 400, "s3Key must be a string"],
    ])("MU1-READ-REFUSED: %s → refused, nothing read", async (_case, s3Key, status, message) => {
        const res = await call(handler, event({ s3Key, keepOldAddresses: false }));
        expect(res.statusCode).toBe(status);
        expect(JSON.parse(res.body).error).toMatch(message as any);
        expect(s3Send).not.toHaveBeenCalled();
    });

    it("MU1-READ-FORGED: a forged header (token t1, header t2) with a t2 key → 403, no S3 call, no DynamoDB call", async () => {
        const res = await call(handler, event({ s3Key: OTHER_KEY }, { header: "t2" }));
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/Access Denied/);
        expect(s3Send).not.toHaveBeenCalled();
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it.each([
        ["NoSuchKey (a caller that may list)", Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } })],
        ["AccessDenied (S3's answer for a missing key to a caller that may not list)", Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } })],
    ])("MU1-READ-MISSING: the object is gone — %s → 404 'upload the file again', not a 500", async (_case, error) => {
        s3Send.mockRejectedValue(error);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const res = await call(handler, event({ s3Key: KEY, keepOldAddresses: false }));
        warn.mockRestore();
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).error).toBe(UPLOAD_AGAIN);
    });

    it("MU1-READ-OVERSIZE: a stored object over the limit (the PUT link does not bind the length) → 413, the body is not read", async () => {
        const object = stored("x", MIGRATION_UPLOAD_MAX_BYTES + 1);
        const read = vi.spyOn(object.Body, "transformToString");
        s3Send.mockResolvedValue(object);
        const res = await call(handler, event({ s3Key: KEY, keepOldAddresses: false }));
        expect(res.statusCode).toBe(413);
        expect(JSON.parse(res.body).error).toBe(`The file is ${MIGRATION_UPLOAD_MAX_BYTES + 1} bytes; the limit is 41943040 bytes (40 MB). Split the export: WordPress Tools → Export can export one content type or a date range.`);
        expect(read).not.toHaveBeenCalled();
        expect(object.Body.destroy).toHaveBeenCalled();
    });
});

describe("MU1-DELETE — the upload is deleted after the last batch of an import", () => {
    it("MU1-MEDIA-CURSOR (review-0 reproduction): a.jpg, b.jpg, batchSize 1 — the second request tries b.jpg before it answers complete and deletes", async () => {
        s3Send.mockImplementation(async (command: any) => command.constructor.name === "GetObjectCommand" ? stored(MEDIA_WXR) : {});
        const first = JSON.parse((await call(mediaHandler, event({ s3Key: KEY, batchStart: 0, batchSize: 1 }))).body);
        expect(first).toMatchObject({ complete: false, nextBatchStart: 1 });
        expect(s3Calls("DeleteObjectCommand")).toEqual([]);
        const second = JSON.parse((await call(mediaHandler, event({ s3Key: KEY, batchStart: 1, batchSize: 1 }))).body);
        expect(second.complete).toBe(true);
        expect(downloads).toEqual(["https://old.test/a.jpg", "https://old.test/b.jpg"]);
        expect([...mediaMap.keys()]).toEqual(["https://old.test/a.jpg", "https://old.test/b.jpg"]);
        expect(s3Calls("DeleteObjectCommand")).toEqual([{ Bucket: "private-test", Key: KEY }]);
    });

    it("MU1-MEDIA-CURSOR-MIXED: an existing mapping, a failed download and new ones, batchSize 2 — every position is tried once, the delete comes only with the request that tried the last", async () => {
        const urls = ["https://old.test/mapped.jpg", "https://old.test/n1.jpg", "https://old.test/fail.jpg", "https://old.test/n2.jpg", "https://old.test/n3.jpg"];
        const wxr = `<rss><channel>${urls.map((u, i) => `<item><title>i${i}</title><wp:post_type>attachment</wp:post_type><wp:attachment_url>${u}</wp:attachment_url></item>`).join("")}</channel></rss>`;
        mediaMap.set(urls[0], "https://cdn.test/t1/mapped.jpg");
        s3Send.mockImplementation(async (command: any) => command.constructor.name === "GetObjectCommand" ? stored(wxr) : {});
        const answers: any[] = [];
        let batchStart: number | undefined = 0;
        do {
            const deletesBefore = s3Calls("DeleteObjectCommand").length;
            const res: any = JSON.parse((await call(mediaHandler, event({ s3Key: KEY, batchStart, batchSize: 2 }))).body);
            answers.push(res);
            // A delete happens in this request only if it answers complete.
            expect(s3Calls("DeleteObjectCommand").length - deletesBefore).toBe(res.complete ? 1 : 0);
            batchStart = res.nextBatchStart;
        } while (!answers[answers.length - 1].complete);
        expect(answers.map((a) => a.processedSoFar)).toEqual([2, 4, 5]);
        expect(downloads).toEqual(urls.slice(1)); // every unmapped position tried exactly once, in export order
        expect(answers.reduce((n, a) => n + a.batchSkipped, 0)).toBe(1);
        expect(answers.reduce((n, a) => n + a.batchDownloaded, 0)).toBe(3);
        expect(answers.reduce((n, a) => n + a.batchFailed, 0)).toBe(1);
        expect(answers.flatMap((a) => a.errors)).toEqual(['"i2": source answered 404']);
        expect(mediaMap.has(urls[2])).toBe(false);
        expect(s3Calls("DeleteObjectCommand")).toEqual([{ Bucket: "private-test", Key: KEY }]);
    });

    it.each([
        ["batchSize 0 (the cursor would never advance)", { batchSize: 0 }],
        ["a negative batchStart", { batchStart: -1 }],
        ["a batchStart that is not an integer", { batchStart: "1" }],
    ])("MU1-MEDIA-CURSOR-REFUSED: %s → 400, nothing read", async (_case, extra) => {
        const res = await call(mediaHandler, event({ s3Key: KEY, ...extra }));
        expect(res.statusCode).toBe(400);
        expect(s3Send).not.toHaveBeenCalled();
    });

    it("MU1-DELETE-MEDIA: media import over two batches — no delete after the first, one delete after the last (complete)", async () => {
        s3Send.mockImplementation(async (command: any) => command.constructor.name === "GetObjectCommand" ? stored(MEDIA_WXR) : {});
        const first = JSON.parse((await call(mediaHandler, event({ s3Key: KEY, batchStart: 0, batchSize: 1 }))).body);
        expect(first.complete).toBe(false);
        expect(s3Calls("DeleteObjectCommand")).toEqual([]);
        const last = JSON.parse((await call(mediaHandler, event({ s3Key: KEY, batchStart: first.nextBatchStart, batchSize: 1 }))).body);
        expect(last.complete).toBe(true);
        expect(s3Calls("DeleteObjectCommand")).toEqual([{ Bucket: "private-test", Key: KEY }]);
    });

    it("MU1-DELETE-MEDIA-NO-ATTACHMENT: an export with no attachment is complete on the first call, which deletes the upload", async () => {
        s3Send.mockImplementation(async (command: any) => command.constructor.name === "GetObjectCommand" ? stored(EMPTY_WXR) : {});
        const res = JSON.parse((await call(mediaHandler, event({ s3Key: KEY }))).body);
        expect(res.complete).toBe(true);
        expect(s3Calls("DeleteObjectCommand")).toEqual([{ Bucket: "private-test", Key: KEY }]);
    });

    it.each([
        ["option off", false],
        ["option on", true],
    ])("MU1-DELETE-PAGES: the pages import (%s), last batch → the upload is deleted", async (_case, keep) => {
        s3Send.mockImplementation(async (command: any) => command.constructor.name === "GetObjectCommand" ? stored("<rss/>") : {});
        const res = JSON.parse((await call(wordpressHandler, event({ s3Key: KEY, keepOldAddresses: keep }))).body);
        expect(res.complete).toBe(true);
        expect(s3Calls("DeleteObjectCommand")).toEqual([{ Bucket: "private-test", Key: KEY }]);
    });

    it.each([
        ["option off", false],
        ["option on", true],
    ])("MU1-KEEP-DRYRUN: the check (dry run, %s) never deletes the upload: the import still needs it", async (_case, keep) => {
        s3Send.mockImplementation(async (command: any) => command.constructor.name === "GetObjectCommand" ? stored("<rss/>") : {});
        const res = JSON.parse((await call(wordpressHandler, event({ s3Key: KEY, keepOldAddresses: keep }, { query: { dryRun: "1" } }))).body);
        expect(res).toMatchObject({ complete: true, dryRun: true });
        expect(s3Calls("DeleteObjectCommand")).toEqual([]);
    });

    it("MU1-DELETE-FAILS: a failed delete does not fail the import (logged; the lifecycle rule is the backstop)", async () => {
        s3Send.mockImplementation(async (command: any) => {
            if (command.constructor.name === "GetObjectCommand") return stored("<rss/>");
            throw new Error("throttled");
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const res = await call(wordpressHandler, event({ s3Key: KEY, keepOldAddresses: false }));
        expect(res.statusCode).toBe(200);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Migration upload not deleted (the lifecycle rule removes it): ${KEY}: throttled`));
        warn.mockRestore();
    });
});

describe("MU1-INLINE — the inline wxrContent path is unchanged", () => {
    it("wxrContent without s3Key → imported with no S3 call at all (no read, no delete)", async () => {
        const res = await call(wordpressHandler, event({ wxrContent: "<rss/>", keepOldAddresses: false }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ complete: true, processedCount: 0, totalCount: 0 });
        expect(s3Send).not.toHaveBeenCalled();
    });
});
