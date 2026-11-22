import { describe, it, expect, beforeEach, vi } from "vitest";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { LangTable } from "./lang-1a-table";

/**
 * LANG-1A (docs/slices/lang-1.md § 6.3, § 11) — the WordPress importer (import/wordpress.ts) and translation sets. It
 * writes no new set key; when it overwrites an existing page it copies the page's `translationKey` and conditions its
 * whole-item Put on the key as read; a failed condition is reported for that post like any other failed post. Run as
 * the real handler on an inline WXR body, against the in-memory table (lang-1a-table.ts). Mocked: `db.js`, the WXR
 * parser (returns the posts below), S3, the media map, image upload, the CDN wrapper and the purge. Credential-free.
 */

const h = vi.hoisted(() => ({ table: null as any, posts: [] as any[] }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => h.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/import/wxr-parser.js", () => ({ parseWXR: async () => h.posts }));
vi.mock("@aws-sdk/client-s3", () => ({ S3Client: class { send = vi.fn(); }, GetObjectCommand: class { constructor(public input: any) {} } }));
vi.mock("../../src/lib/media-map.js", () => ({ loadMediaMap: vi.fn(async () => new Map()) }));
vi.mock("../../src/lib/image-upload.js", () => ({ downloadAndUploadImage: vi.fn() }));
vi.mock("../../src/lib/invalidate-cdn.js", () => ({ withInvalidation: (handler: any) => handler }));
vi.mock("../../src/lib/revalidate.js", () => ({ purgeStoredPagesOfRequestTenant: vi.fn() }));

import { handler } from "../../src/import/wordpress.js";

const T = "TENANT#t1";
let db: LangTable;
const post = (slug: string, title: string) => ({ title, slug, content: "<p>Imported</p>", status: "publish", postType: "page", comments: [] });
const run = async () => {
    const res = await (handler as any)({
        headers: { "x-tenant-id": "t1" },
        body: JSON.stringify({ wxrContent: "<rss/>" }),
        requestContext: { authorizer: { lambda: { sub: "u1", email: "ed@t1.test", role: "TENANT_ADMIN", tenantId: "t1" } } },
    }, {}, () => {});
    return { statusCode: res.statusCode as number, body: JSON.parse(res.body) };
};
const latest = (n: string) => db.get(T, `CONTENT#${n}#LATEST`);
const contentPuts = () => db.commands.filter((c) => c instanceof PutCommand && String(c.input.Item.SK).startsWith("CONTENT#"));

beforeEach(() => {
    db = new LangTable();
    h.table = db;
    db.put({ PK: T, SK: "CONTENT#ro1#LATEST", id: "c-ro1", nodeId: "ro1", slug: "/ro-despre", title: "Old", status: "Published", version: 2, createdAt: "2026-01-01T00:00:00.000Z", translationKey: "K1" });
    db.put({ PK: T, SK: "CONTENT#ro1#v1", id: "c-ro1", nodeId: "ro1", slug: "/ro-despre", version: 1, translationKey: "OLD" });
    db.put({ PK: T, SK: "ROUTE#/ro-despre", TargetNode: "NODE#ro1", Type: "Route" });
    db.put({ PK: T, SK: "TRANSLATION#K1#ro1", Type: "Translation" });
    db.put({ PK: T, SK: "CONTENT#en1#LATEST", id: "c-en1", nodeId: "en1", slug: "/about", title: "Old", status: "Published", version: 1, createdAt: "2026-01-01T00:00:00.000Z" });
    db.put({ PK: T, SK: "ROUTE#/about", TargetNode: "NODE#en1", Type: "Route" });
});

describe("WordPress import — translation sets (LANG-1A)", () => {
    it("L1A-IMPORT-KEEPS-KEY: an overwrite copies the LATEST key (not a history key) and conditions the Put on it", async () => {
        h.posts = [post("ro-despre", "Despre")];
        const res = await run();
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ updatedCount: 1, createdCount: 0 });
        expect(res.body.errors).toBeUndefined();
        expect(latest("ro1")).toMatchObject({ title: "Despre", translationKey: "K1", nodeId: "ro1" });
        expect(contentPuts()[0].input).toMatchObject({ ConditionExpression: "translationKey = :readKey", ExpressionAttributeValues: { ":readKey": "K1" } });
        expect(db.get(T, "TRANSLATION#K1#ro1")).toBeDefined();
    });

    it("L1A-IMPORT-KEEPS-KEY: a key changed between the read and the Put → that post is reported failed; the page keeps the new key", async () => {
        h.posts = [post("ro-despre", "Despre"), post("about", "About")];
        db.beforeCommand = {
            match: (c) => c instanceof PutCommand && c.input.Item.SK === "CONTENT#ro1#LATEST",
            run: async () => { db.put({ ...latest("ro1")!, translationKey: "K2" }); },
        };
        const res = await run();
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ updatedCount: 1, createdCount: 0 });
        expect(res.body.errors).toHaveLength(1);
        expect(res.body.errors[0]).toMatch(/^Failed to process "Despre": /);
        expect(latest("ro1")).toMatchObject({ title: "Old", translationKey: "K2" });
        expect(latest("en1")).toMatchObject({ title: "About" });
    });

    it("L1A-IMPORT-KEEPS-KEY: a keyless overwrite writes no key (condition attribute_not_exists); a new page has no key and no condition", async () => {
        h.posts = [post("about", "About"), post("fresh", "Fresh")];
        const res = await run();
        expect(res.body).toMatchObject({ updatedCount: 1, createdCount: 1 });
        const [overwrite, created] = contentPuts().map((c) => c.input);
        expect(overwrite.ConditionExpression).toBe("attribute_not_exists(translationKey)");
        expect(Object.hasOwn(overwrite.Item, "translationKey")).toBe(false);
        expect(created.ConditionExpression).toBeUndefined();
        expect(Object.hasOwn(created.Item, "translationKey")).toBe(false);
    });
});
