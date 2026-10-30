import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * CAT-IMAGES-1 § 2.3 / packet item 5 — the WordPress and media importers call `downloadAndUploadImage` and so inherit
 * the destination policy; nothing else about them changes. The REAL `lib/image-upload.ts` runs; the sources are IP
 * literals, which `dns.lookup` answers without a network query (Node returns a literal as is), and the policy refuses
 * them before any connection. Mocked: S3 (the WXR read; an image upload would be recorded), `db.js`, `events.js`.
 *
 * WordPress: `wxr-parser.ts` never sets `featuredImage` today (its `_thumbnail_id` lookup is a stub, :71-77), so a
 * real WXR cannot reach the image call; the parser is mocked to hand the handler one post with a featured image.
 */

const { s3Send, ddbSend, parsedPosts } = vi.hoisted(() => {
    process.env.UPLOADS_BUCKET = "uploads-test"; // read at module import by both handlers
    process.env.UPLOADS_CDN_URL = "https://cdn.test";
    return { s3Send: vi.fn(), ddbSend: vi.fn(), parsedPosts: { value: [] as any[] } };
});

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = s3Send; },
    GetObjectCommand: class { constructor(public input: any) {} },
    PutObjectCommand: class { constructor(public input: any) {} },
}));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));
vi.mock("../../src/import/wxr-parser.js", () => ({ parseWXR: async () => parsedPosts.value }));

import { handler as mediaHandler } from "../../src/import/media.js";
import { handler as wordpressHandler } from "../../src/import/wordpress.js";

const PRIVATE_SOURCE = "http://169.254.169.254/latest/meta-data/iam.jpg";
const REFUSAL = "Refused by the image destination policy: 169.254.169.254 resolves to 169.254.169.254: link-local 169.254.0.0/16";

const event = (body: unknown) => ({
    headers: { "x-tenant-id": "t1" },
    body: JSON.stringify(body),
    requestContext: { authorizer: { lambda: { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" } }, http: { sourceIp: "127.0.0.1" } },
}) as any;

const s3Uploads = () => s3Send.mock.calls.filter((c) => c[0].constructor.name === "PutObjectCommand");
const assetWrites = () => ddbSend.mock.calls.filter((c) => String(c[0].input?.Item?.SK ?? "").startsWith("ASSET#"));

beforeEach(() => {
    s3Send.mockReset();
    ddbSend.mockReset().mockResolvedValue({ Items: [] });
});

describe("media importer inherits the destination policy", () => {
    it("an attachment on a link-local address → refused; the reason reaches errors[]; no upload, no ASSET#, no MEDIAMAP#", async () => {
        const wxr = `<rss><channel><item><title>secret</title><wp:post_type>attachment</wp:post_type>` +
            `<wp:attachment_url>${PRIVATE_SOURCE}</wp:attachment_url></item></channel></rss>`;
        s3Send.mockResolvedValue({ Body: { transformToString: async () => wxr } });
        const res = (await mediaHandler(event({ s3Key: "t1/media.xml" }), {} as any, () => {})) as any;
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.batchFailed).toBe(1);
        expect(body.errors).toEqual([`"secret": ${REFUSAL}`]);
        expect(s3Uploads()).toHaveLength(0);
        expect(assetWrites()).toHaveLength(0);
        expect(ddbSend.mock.calls.some((c) => String(c[0].input?.Item?.SK ?? "").startsWith("MEDIAMAP#"))).toBe(false);
    });
});

describe("WordPress importer inherits the destination policy", () => {
    it("a featured image on a link-local address → refused, logged with console.warn; the post is still imported without it", async () => {
        parsedPosts.value = [{ title: "Hello", slug: "hello", content: "<p>x</p>", status: "publish", postType: "post", featuredImage: PRIVATE_SOURCE, comments: [] }];
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const res = (await wordpressHandler(event({ wxrContent: "<rss/>" }), {} as any, () => {})) as any;
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ createdCount: 1, totalCount: 1 });
        expect(warn).toHaveBeenCalledWith('Failed to download featured image for "Hello":', expect.objectContaining({ message: REFUSAL }));
        expect(s3Uploads()).toHaveLength(0);
        expect(assetWrites()).toHaveLength(0);
        const contentPut = ddbSend.mock.calls.map((c) => c[0].input?.Item).find((i) => i?.title === "Hello" && i?.featuredImage !== undefined);
        expect(contentPut).toBeUndefined(); // no featured image stored
        warn.mockRestore();
    });
});
