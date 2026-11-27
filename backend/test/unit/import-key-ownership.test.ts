import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * BACKEND-CONTRACT-1 D4 — key ownership = the caller is authorised for the target tenant
 * (`requireRole(auth, ["TENANT_ADMIN", "EDITOR"], x-tenant-id)`: a TENANT_ADMIN or EDITOR whose token
 * tenant equals the header — IMPORT-POLICY-1 D1 added EDITOR — or a GLOBAL_ADMIN, which requireRole
 * passes WITHOUT any tenant check) AND the key is the tenant's migration upload.
 *
 * MIGRATION-UPLOAD-1: migration uploads are keyed `migration/${tenantId}/${uuid}-${safe name}` in the PRIVATE
 * bucket (backend/src/import/upload-url.ts); before that slice they were `${tenantId}/…` in the public uploads
 * bucket. The prefix check alone is not enough: a caller who forges the header would also choose a matching key.
 * The full table of the new key rule is in migration-upload-1.test.ts; this file keeps the D4 cases.
 *
 * What the tests assert: an authorisation failure → 403 with no S3 call and no DynamoDB call; a
 * prefix failure → 403 with no S3 call. GLOBAL_ADMIN is not exercised here.
 *
 * Credential-free: `@aws-sdk/client-s3` and `db.js` are mocked; the media-map / image-upload /
 * audit helpers are mocked because they do their own I/O. `withInvalidation` stays real (it
 * writes through the mocked `db`).
 */

const { s3Send, ddbSend } = vi.hoisted(() => {
    process.env.PRIVATE_BUCKET = "private-test"; // read at module import by both handlers (MIGRATION-UPLOAD-1)
    return { s3Send: vi.fn(), ddbSend: vi.fn() };
});

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class {
        send = s3Send;
    },
    GetObjectCommand: class {
        constructor(public input: any) {}
    },
    DeleteObjectCommand: class {
        constructor(public input: any) {}
    },
}));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));
vi.mock("../../src/lib/media-map.js", () => ({ loadMediaMap: vi.fn(async () => new Map()), writeMediaMapEntry: vi.fn() }));
vi.mock("../../src/lib/image-upload.js", () => ({ downloadAndUploadImage: vi.fn() }));

import { handler as mediaHandler } from "../../src/import/media.js";
import { handler as wordpressHandler } from "../../src/import/wordpress.js";

const TENANT = "t1";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const keyOf = (tenant: string) => `migration/${tenant}/${ID}-x.xml`;
const WXR = "<rss><channel><title>x</title></channel></rss>";

function event(s3Key: string, { header = TENANT, tokenTenant = TENANT, role = "TENANT_ADMIN" } = {}) {
    return {
        headers: { "x-tenant-id": header },
        body: JSON.stringify({ s3Key }),
        requestContext: {
            authorizer: { lambda: { sub: "u1", email: "admin@t1.test", role, tenantId: tokenTenant } },
            http: { sourceIp: "127.0.0.1" },
        },
    } as any;
}

const HANDLERS = [
    ["import/media.ts", mediaHandler],
    ["import/wordpress.ts", wordpressHandler],
] as const;

beforeEach(() => {
    s3Send.mockReset();
    s3Send.mockResolvedValue({ Body: { transformToString: async () => WXR } });
    ddbSend.mockReset();
    ddbSend.mockResolvedValue({ Items: [] });
});

describe.each(HANDLERS)("BACKEND-CONTRACT-1 D4 — %s s3Key ownership", (_name, handler) => {
    it("s3Key under another tenant's prefix → 403, S3 never called", async () => {
        const res = (await handler(event(keyOf("other-tenant")), {} as any, () => {})) as any;
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toBe("s3Key is not owned by this tenant");
        expect(s3Send).not.toHaveBeenCalled();
    });

    it("s3Key whose prefix only STARTS like the tenant id ('migration/t10/…') → 403 (the '/' is part of the check)", async () => {
        const res = (await handler(event(keyOf("t10")), {} as any, () => {})) as any;
        expect(res.statusCode).toBe(403);
        expect(s3Send).not.toHaveBeenCalled();
    });

    it("forged header (token t1, header t2, s3Key 'migration/t2/…') → 403, no S3 call, no DynamoDB call", async () => {
        const res = (await handler(event(keyOf("t2"), { header: "t2", tokenTenant: TENANT }), {} as any, () => {})) as any;
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/Access Denied/);
        expect(s3Send).not.toHaveBeenCalled();
        expect(ddbSend).not.toHaveBeenCalled();
    });

    // IMPORT-POLICY-1 D1: an EDITOR may import, bound to the tenant of its token like a TENANT_ADMIN.
    it("EDITOR of its own tenant → authorised: GetObject called with the key; status is not 403", async () => {
        const res = (await handler(event(keyOf(TENANT), { role: "EDITOR" }), {} as any, () => {})) as any;
        expect(res.statusCode).not.toBe(403);
        expect(s3Send.mock.calls[0][0].input).toEqual({ Bucket: "private-test", Key: keyOf(TENANT) });
    });

    it("EDITOR of tenant t1 with header t2 and s3Key 'migration/t2/…' → 403, no S3 call, no DynamoDB call", async () => {
        const res = (await handler(event(keyOf("t2"), { header: "t2", tokenTenant: TENANT, role: "EDITOR" }), {} as any, () => {})) as any;
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/Access Denied/);
        expect(s3Send).not.toHaveBeenCalled();
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("s3Key under 'migration/<tenantId>/' → GetObject on the PRIVATE bucket with exactly that key; status is not 403", async () => {
        const res = (await handler(event(keyOf(TENANT)), {} as any, () => {})) as any;
        expect(res.statusCode).not.toBe(403);
        expect(s3Send.mock.calls[0][0].input).toEqual({ Bucket: "private-test", Key: keyOf(TENANT) });
    });
});
