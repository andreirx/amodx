import { describe, it, expect, vi } from "vitest";

/**
 * MIGRATION-UPLOAD-1 review-0 F-MU1-SIGNING — the upload link as the REAL presigner builds it (no SDK mock), so a
 * change of SDK defaults is caught here. Credential-free and offline: signing is a local computation; the credentials
 * are dummies set before the handler module creates its client, and no request is sent.
 *
 * Contract: the browser PUTs the file it holds, which the signer never saw. So the URL signs no body checksum
 * (`x-amz-checksum-*`, `x-amz-sdk-checksum-algorithm`: S3 would refuse any body but the empty one) and signs
 * `content-type`, the type the route admitted (a PUT with another type is refused by S3).
 */
vi.hoisted(() => {
    process.env.AWS_REGION = "eu-central-1";
    process.env.AWS_ACCESS_KEY_ID = "AKIDMIGRATIONUPLOAD1";
    process.env.AWS_SECRET_ACCESS_KEY = "dummy-secret-for-offline-signing";
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_PROFILE;
    process.env.PRIVATE_BUCKET = "private-test";
});

import { handler } from "../../src/import/upload-url.js";

const event = (body: unknown) => ({
    headers: { "x-tenant-id": "t1" },
    body: JSON.stringify(body),
    requestContext: { authorizer: { lambda: { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" } }, http: { sourceIp: "127.0.0.1" } },
}) as any;

describe("MU1-SIGNING — the real presigned PUT link", () => {
    it.each([["text/xml"], ["application/xml"], ["text/csv"]])("%s: signs content-type and host, signs no body checksum, targets the key it answers", async (contentType) => {
        const res = (await handler(event({ filename: "export.xml", contentType, size: 6381 }), {} as any, () => {})) as any;
        expect(res.statusCode).toBe(200);
        const { uploadUrl, s3Key } = JSON.parse(res.body);
        const url = new URL(uploadUrl);
        expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
        expect([...url.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
        expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
        expect(decodeURIComponent(url.pathname)).toMatch(new RegExp(`/${s3Key}$`));
        expect(s3Key).toMatch(/^migration\/t1\/[0-9a-f-]{36}-export\.xml$/);
    });
});
